import { addDaysToLocalDateString } from '../utils/localDate';
import type { FixedActivity, GuardrailKey, MicrocycleState, ScheduleOverlay, UserContext, UserPreferences } from './models';
import type { PlanningContext } from './planningMode';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import type { PhaseWeights } from './periodization';
import { resolveAvailability } from './schedule';
import { inferAthleteTrainingState, mechanicalSuspensionFor, resolveEvidenceBackedStrategy, type PolicyWarning } from './evergreenStrategy';
import { capabilityGates, capabilityTargetStage, resolveCapabilityMaintenancePlan } from './capabilityMaintenancePlanning';
import type { CapabilityMaintenanceResult } from './capabilityMaintenance';
import { resolveTrainingCapacity, type ResolvedAvailabilityWindow } from './trainingCapacity';
import { EVERGREEN_PACKING_COVERAGE, packWeeklyDose, type CoverageSetDescriptor, type PackingWarning, type WeeklyBudget } from './weeklyDosePacking';
import { buildEvergreenPlanDefinition, type PlanDefinition } from './planSchedule';
import { buildMicrocycleState } from './microcycle';
import type { AerobicVolumeFloor } from './aerobicVolumeFloor';
import { KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';
import {
    evaluateMechanicalStageProgression,
    type CheckinRecord,
    type MechanicalExposureRecord,
    type MechanicalProgressionVerdict,
    MECHANICAL_CONTINUITY_WINDOW_DAYS,
} from './mechanicalProgression';
import { mechanicalIdentityFor, type MechanicalStage } from '../workouts/mechanicalExposure';
import { executableLongAerobicCeilingForWorkout, resolveWeeklyAerobicDoseEnvelope } from './weeklyAerobicDose';
import type { WeeklyAerobicDoseEnvelope } from './weeklyAerobicDose';

export interface ResolvedEvergreenPlan {
    planDefinition: PlanDefinition;
    microcycle: MicrocycleState;
    budget: WeeklyBudget;
    knowledgeRefs: string[];
    /** The #804 mechanical progression verdict this plan's mechanical allow-list came from. */
    mechanicalProgression: MechanicalProgressionVerdict;
    /** Issue #805 (D-F): capability-maintenance readout; null when the athlete has not opted in. */
    capabilityMaintenance: CapabilityMaintenanceResult | null;
    /** Typed strategy and capability warnings for this plan (never persisted in v1). */
    warnings: PolicyWarning[];
}

const AEROBIC_VOLUME_ROLE_ID = 'aerobic_volume';

/** Highest stage evergreen planning requests on its own (`policy.evergreen.mechanical_exposure_v1`):
 * the linear/bilateral ladder (Stage 1 landing/walk-run -> Stage 2 bilateral jump/linear
 * running). Stage 3 braking and Stage 4 multidirectional/COD field work are requested only by
 * an explicit athlete opt-in (issue #805 supplies `targetStage`); an athlete who already
 * performs them keeps that stage rather than being demoted by this ceiling. */
export const EVERGREEN_MECHANICAL_DEFAULT_TARGET_STAGE_CEILING: MechanicalStage = 2;

/** Mechanical capability inputs, resolved by orchestration (`rules.ts`, `planner.ts`). */
export interface EvergreenMechanicalInputs {
    /** Performed-training evidence spanning at least `MECHANICAL_CONTINUITY_WINDOW_DAYS`.
     * The seven-day operational `history` is too short: an exposure 8-13 days ago would be
     * invisible and read as a >=14-day re-entry gap. */
    exposureHistory?: readonly CompletedExposure[];
    /** Canonical structured check-ins. Missing history fails closed for stage advancement
     * rather than being interpreted as a normal tissue response. */
    checkinHistory?: readonly CheckinRecord[];
    /** Explicit opt-in progression target (issue #805 decision D-C: the due capability's
     * required stage). Absent means the evergreen default. */
    targetStage?: MechanicalStage;
}

/** The stage evergreen planning asks the evaluator for: the highest of the default ceiling,
 * the athlete's latest performed stage and any explicit opt-in target. A target only ever
 * raises the request; lowering the eligible stage is the evaluator's job (adverse response,
 * re-entry, guardrails), and the evaluator still advances at most one stage per verdict. */
export function evergreenMechanicalTargetStage(
    exposureHistory: readonly MechanicalExposureRecord[],
    asOfDate: string,
    optInTargetStage?: MechanicalStage,
): MechanicalStage {
    // Highest stage on the latest date: the evaluator's last exposure is order-dependent
    // within a day, and a request below it would demote.
    const latest = exposureHistory
        .filter(exposure => exposure.date < asOfDate)
        .reduce<MechanicalExposureRecord | null>((current, exposure) =>
            !current || exposure.date > current.date || (exposure.date === current.date && exposure.stage > current.stage)
                ? exposure
                : current, null);
    return Math.max(
        EVERGREEN_MECHANICAL_DEFAULT_TARGET_STAGE_CEILING,
        latest?.stage ?? 1,
        optInTargetStage ?? 1,
    ) as MechanicalStage;
}

/** Pure bridge from performed training and check-ins to the #804 mechanical verdict. */
export function resolveEvergreenMechanicalProgression(
    date: string,
    exposures: readonly CompletedExposure[],
    checkinHistory: readonly CheckinRecord[],
    guardrails: ReadonlySet<GuardrailKey>,
    optInTargetStage?: MechanicalStage,
): MechanicalProgressionVerdict {
    const exposureHistory = exposures.flatMap(exposure => {
        const identity = mechanicalIdentityFor(exposure.workoutId);
        return identity ? [{ date: exposure.date, workoutId: identity.workoutId, stage: identity.stage }] : [];
    });
    return evaluateMechanicalStageProgression({
        asOfDate: date,
        exposureHistory,
        checkinHistory,
        guardrails,
        targetStage: evergreenMechanicalTargetStage(exposureHistory, date, optInTargetStage),
    });
}

/**
 * Issue #757: budget the `aerobic_volume` role at the athlete floor wherever some usable
 * window can hold it. When no window can, the role keeps its catalog duration so aerobic
 * work stays planned (the aerobic objective must not silently disappear), and an explicit
 * shortfall states that capped sessions will not earn exact aerobic-volume coverage.
 */
export function aerobicPackingForFloor(
    floor: AerobicVolumeFloor | null,
    usableWindows: readonly ResolvedAvailabilityWindow[],
    weeklyDose?: WeeklyAerobicDoseEnvelope,
    reserveLongAnchor = false,
): { descriptor: CoverageSetDescriptor; shortfall: PackingWarning | null } {
    const longAnchor = reserveLongAnchor ? weeklyDose?.longAnchor : null;
    const anchorMaximum = longAnchor ? executableLongAerobicCeilingForWorkout(longAnchor.workoutId) : undefined;
    const anchorDuration = longAnchor
        ? Math.min(anchorMaximum ?? longAnchor.durationMinutes,
            Math.max(floor?.floorMin ?? 30, longAnchor.durationMinutes))
        : null;
    const descriptor: CoverageSetDescriptor = longAnchor && anchorDuration !== null
        ? {
            ...EVERGREEN_PACKING_COVERAGE,
            roles: [...EVERGREEN_PACKING_COVERAGE.roles, {
                id: 'long_aerobic_anchor', adaptations: ['aerobic_endurance'],
                exactWorkoutIds: [longAnchor.workoutId], durationMinutes: anchorDuration,
            }],
            longAerobicAnchor: { workoutId: longAnchor.workoutId, durationMinutes: anchorDuration },
        }
        : EVERGREEN_PACKING_COVERAGE;
    const role = descriptor.roles.find(item => item.id === AEROBIC_VOLUME_ROLE_ID);
    const typicalSessionMinutes = weeklyDose?.source === 'athlete_history' ? weeklyDose.typicalSessionMinutes ?? 0 : 0;
    const roleDuration = role?.durationMinutes ?? 0;
    const normalRoleMaximum = anchorMaximum ?? Number.POSITIVE_INFINITY;
    const normalRoleDuration = role
        ? Math.min(normalRoleMaximum, Math.max(roleDuration, floor?.floorMin ?? 0, typicalSessionMinutes))
        : 0;
    if (!floor || !role || floor.floorMin <= roleDuration) {
        return normalRoleDuration > roleDuration
            ? {
                descriptor: {
                    ...descriptor,
                    roles: descriptor.roles.map(item => item.id === AEROBIC_VOLUME_ROLE_ID
                        ? { ...item, durationMinutes: normalRoleDuration } : item),
                },
                shortfall: null,
            }
            : { descriptor, shortfall: null };
    }
    const longestWindow = Math.max(0, ...usableWindows.map(window => window.availableMinutes));
    if (longestWindow >= floor.floorMin) {
        return {
            descriptor: {
                ...descriptor,
                roles: descriptor.roles.map(item => item.id === AEROBIC_VOLUME_ROLE_ID
                    ? { ...item, durationMinutes: Math.min(normalRoleMaximum, Math.max(floor.floorMin, typicalSessionMinutes)) }
                    : item),
            },
            shortfall: null,
        };
    }
    return {
        descriptor,
        shortfall: {
            code: 'minimum_dose_shortfall',
            adaptation: 'aerobic_endurance',
            message: `aerobic_endurance: the longest available window (${longestWindow} min) is below this athlete's ${floor.floorMin}-min aerobic-volume session floor; capped aerobic sessions stay planned but do not earn exact aerobic-volume coverage.`,
        },
    };
}

/** The sole bridge from durable evergreen inputs to an executable rolling plan. It is
 * intentionally unavailable without preferences because duration is preference-owned,
 * not inferred from the profile. */
export function resolveEvergreenPlan(
    planningContext: PlanningContext,
    phase: PhaseWeights,
    history: readonly CompletedExposure[],
    historySnapshot: TrainingHistorySnapshot | null,
    preferences: UserPreferences | null,
    context: UserContext,
    date: string,
    fixedActivities: readonly FixedActivity[],
    days: number = 7,
    isAdverseRecovery: boolean = false,
    scheduleOverlays: readonly ScheduleOverlay[] = [],
    /** ADR-0037 D-DOSE: exact-workout duration authority derived for `date` only. The
     * weekly packer receives `date` separately so this map cannot alter sibling dates in
     * the rolling horizon. */
    progressionOverrides: ReadonlyMap<string, number> = new Map(),
    /** Issue #757: athlete-level floor. The `aerobic_volume` role is budgeted at the same
     * duration the coverage ledger will demand, so an unreachable floor surfaces as an
     * explicit packing shortfall instead of a silently dropped role. */
    aerobicVolumeFloor: AerobicVolumeFloor | null = null,
    /** Current pain/injury, illness or red-flag symptoms withhold the generic quality prior. */
    hasCurrentClinicalSymptoms: boolean = false,
    /** Inputs used only by the #804 mechanical capability owner. */
    mechanical: EvergreenMechanicalInputs = {},
): ResolvedEvergreenPlan | null {
    if (planningContext.mode !== 'evergreen' || !preferences) return null;
    const resolvedWindows = Array.from({ length: Math.max(1, days) }, (_, index) => {
        const windowDate = addDaysToLocalDateString(date, index);
        const resolved = resolveAvailability(windowDate, null, [...fixedActivities], context, scheduleOverlays);
        return { date: windowDate, maxTimeMinutes: resolved.maxTimeMinutes, environmentOverride: resolved.environmentOverride };
    });
    const availability = resolvedWindows.map(({ date: windowDate, maxTimeMinutes }) => ({ date: windowDate, maxTimeMinutes }));
    const capacity = resolveTrainingCapacity(planningContext.profile.weeklyCommitment, preferences, availability);
    const profile = planningContext.profile;
    const capabilityMaintenanceEnabled = profile.capabilityMaintenance?.enabled === true;
    const stateEvidence = historySnapshot?.athleteStateEvidence;
    const athleteEvidence = stateEvidence?.exposures ?? history;
    const observedWindowDays = stateEvidence?.observedWindowDays ?? historySnapshot?.windowDays ?? 0;
    const athleteState = inferAthleteTrainingState(athleteEvidence, observedWindowDays);
    const weeklyAerobicDose = resolveWeeklyAerobicDoseEnvelope({
        exposures: athleteEvidence,
        asOfDate: date,
        observedWindowDays,
        priorities: planningContext.profile.priorities,
        phaseName: phase.phaseName,
        trainingAgeEstablished: athleteState.trainingAgeProxy === 'established'
            && athleteState.inference.dataQuality === 'high',
    });
    const goalOrEvent = {
        priorities: profile.priorities, isAdverseRecovery, hasCurrentClinicalSymptoms, phase, capabilityMaintenanceEnabled,
    };
    const strategy = resolveEvidenceBackedStrategy(goalOrEvent, athleteState, weeklyAerobicDose);
    const longAnchorEligible = planningContext.profile.priorities.some(priority =>
        priority === 'endurance' || priority === 'sport_readiness')
        && (phase.phaseName === 'Build' || phase.phaseName === 'Specificity')
        && !isAdverseRecovery
        && !hasCurrentClinicalSymptoms;
    const aerobicPacking = aerobicPackingForFloor(aerobicVolumeFloor, capacity.usableWindows, weeklyAerobicDose, longAnchorEligible);
    // Issue #805 (D-C): an owed capability steers #804 toward its required stage; the request
    // only ever raises the #804 default, and #804 still owns the one-stage cap and evidence.
    // Cadence reads the widest evidence available: the 28-day athlete-state window, else the
    // orchestration-supplied mechanical evidence (>= the 14-day interval, e.g. on the projected
    // next-day branch), never the 7-day operational history alone.
    const capabilityEvidence = stateEvidence
        ? { exposures: athleteEvidence, observedWindowDays }
        : mechanical.exposureHistory
            ? { exposures: mechanical.exposureHistory, observedWindowDays: MECHANICAL_CONTINUITY_WINDOW_DAYS }
            : { exposures: athleteEvidence, observedWindowDays };
    const capabilityStage = capabilityTargetStage(profile, date, days, capabilityEvidence.exposures, capabilityEvidence.observedWindowDays);
    const optInTargetStage = mechanical.targetStage !== undefined || capabilityStage !== undefined
        ? Math.max(mechanical.targetStage ?? 1, capabilityStage ?? 1) as MechanicalStage
        : undefined;
    const mechanicalProgression = resolveEvergreenMechanicalProgression(
        date,
        mechanical.exposureHistory ?? stateEvidence?.exposures ?? history,
        mechanical.checkinHistory ?? [],
        new Set(context.constraints.impliedGuardrails ?? []),
        optInTargetStage,
    );
    const packed = packWeeklyDose(strategy, capacity, aerobicPacking.descriptor, progressionOverrides, date);
    const budget: WeeklyBudget = aerobicPacking.shortfall
        ? { ...packed, shortfalls: [...packed.shortfalls, aerobicPacking.shortfall] }
        : packed;
    const capability = capabilityMaintenanceEnabled ? resolveCapabilityMaintenancePlan({
        profile,
        mode: planningContext.mode,
        date,
        planningHorizonDays: Math.max(1, days),
        exposures: capabilityEvidence.exposures,
        observedWindowDays: capabilityEvidence.observedWindowDays,
        mechanicalSuspension: capabilityMaintenanceEnabled ? mechanicalSuspensionFor(goalOrEvent, athleteState)?.source ?? null : null,
        mechanicalRequirementPresent: strategy.requirements.some(requirement => requirement.adaptation === 'mechanical_exposure'),
        mechanicalVerdict: mechanicalProgression,
        gates: capabilityGates(context, preferences, date, resolvedWindows),
        supportCapacityDates: capacity.usableWindows.map(window => window.date),
    }) : null;
    const result = buildEvergreenPlanDefinition(
        strategy,
        capacity,
        budget,
        date,
        mechanicalProgression.eligible ? mechanicalProgression.eligibleWorkoutIds : [],
        capability?.result.placements ?? [],
    );
    if (result.status !== 'AVAILABLE') return null;
    const qualityRolePacked = [...budget.requiredRoles, ...budget.targetRoles, ...budget.optionalRoles]
        .some(role => role.coverageRoleId === 'sustained_quality');
    return {
        planDefinition: result.data,
        microcycle: buildMicrocycleState(phase, addDaysToLocalDateString(date, -7), [...history], null, result.data, date),
        budget,
        mechanicalProgression,
        capabilityMaintenance: capability?.result ?? null,
        warnings: [...strategy.warnings, ...(capability?.warnings ?? [])],
        knowledgeRefs: [...new Set([
            ...strategy.requirements.flatMap(requirement => requirement.knowledgeRefs),
            ...(weeklyAerobicDose.source === 'athlete_history' ? [KNOWLEDGE_CLAIM_IDS.weeklyAerobicDoseEnvelopePolicy] : []),
            ...(qualityRolePacked ? [KNOWLEDGE_CLAIM_IDS.evergreenQualitySetComposition] : []),
            ...(capability ? [KNOWLEDGE_CLAIM_IDS.athleticCapabilityMaintenancePolicy] : []),
        ])].sort(),
    };
}
