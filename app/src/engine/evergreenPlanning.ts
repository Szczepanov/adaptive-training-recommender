import { addDaysToLocalDateString } from '../utils/localDate';
import type { FixedActivity, MicrocycleState, ScheduleOverlay, UserContext, UserPreferences } from './models';
import type { PlanningContext } from './planningMode';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import type { PhaseWeights } from './periodization';
import { resolveAvailability } from './schedule';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from './evergreenStrategy';
import { resolveTrainingCapacity, type ResolvedAvailabilityWindow } from './trainingCapacity';
import { EVERGREEN_PACKING_COVERAGE, packWeeklyDose, type CoverageSetDescriptor, type PackingWarning, type WeeklyBudget } from './weeklyDosePacking';
import { buildEvergreenPlanDefinition, type PlanDefinition } from './planSchedule';
import { buildMicrocycleState } from './microcycle';
import type { AerobicVolumeFloor } from './aerobicVolumeFloor';
import { KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';

export interface ResolvedEvergreenPlan {
    planDefinition: PlanDefinition;
    microcycle: MicrocycleState;
    budget: WeeklyBudget;
    knowledgeRefs: string[];
}

const AEROBIC_VOLUME_ROLE_ID = 'aerobic_volume';

/**
 * Issue #757: budget the `aerobic_volume` role at the athlete floor wherever some usable
 * window can hold it. When no window can, the role keeps its catalog duration so aerobic
 * work stays planned (the aerobic objective must not silently disappear), and an explicit
 * shortfall states that capped sessions will not earn exact aerobic-volume coverage.
 */
export function aerobicPackingForFloor(
    floor: AerobicVolumeFloor | null,
    usableWindows: readonly ResolvedAvailabilityWindow[],
): { descriptor: CoverageSetDescriptor; shortfall: PackingWarning | null } {
    const role = EVERGREEN_PACKING_COVERAGE.roles.find(item => item.id === AEROBIC_VOLUME_ROLE_ID);
    if (!floor || !role || floor.floorMin <= role.durationMinutes) {
        return { descriptor: EVERGREEN_PACKING_COVERAGE, shortfall: null };
    }
    const longestWindow = Math.max(0, ...usableWindows.map(window => window.availableMinutes));
    if (longestWindow >= floor.floorMin) {
        return {
            descriptor: {
                ...EVERGREEN_PACKING_COVERAGE,
                roles: EVERGREEN_PACKING_COVERAGE.roles.map(item =>
                    item.id === AEROBIC_VOLUME_ROLE_ID ? { ...item, durationMinutes: floor.floorMin } : item),
            },
            shortfall: null,
        };
    }
    return {
        descriptor: EVERGREEN_PACKING_COVERAGE,
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
): ResolvedEvergreenPlan | null {
    if (planningContext.mode !== 'evergreen' || !preferences) return null;
    const availability = Array.from({ length: Math.max(1, days) }, (_, index) => {
        const windowDate = addDaysToLocalDateString(date, index);
        return {
            date: windowDate,
            maxTimeMinutes: resolveAvailability(windowDate, null, [...fixedActivities], context, scheduleOverlays).maxTimeMinutes,
        };
    });
    const capacity = resolveTrainingCapacity(planningContext.profile.weeklyCommitment, preferences, availability);
    const stateEvidence = historySnapshot?.athleteStateEvidence;
    const strategy = resolveEvidenceBackedStrategy(
        { priorities: planningContext.profile.priorities, isAdverseRecovery },
        inferAthleteTrainingState(
            stateEvidence?.exposures ?? history,
            stateEvidence?.observedWindowDays ?? historySnapshot?.windowDays ?? 0,
        ),
    );
    const aerobicPacking = aerobicPackingForFloor(aerobicVolumeFloor, capacity.usableWindows);
    const packed = packWeeklyDose(strategy, capacity, aerobicPacking.descriptor, progressionOverrides, date);
    const budget: WeeklyBudget = aerobicPacking.shortfall
        ? { ...packed, shortfalls: [...packed.shortfalls, aerobicPacking.shortfall] }
        : packed;
    const result = buildEvergreenPlanDefinition(strategy, capacity, budget, date);
    if (result.status !== 'AVAILABLE') return null;
    const qualityRolePacked = [...budget.requiredRoles, ...budget.targetRoles, ...budget.optionalRoles]
        .some(role => role.coverageRoleId === 'sustained_quality');
    return {
        planDefinition: result.data,
        microcycle: buildMicrocycleState(phase, addDaysToLocalDateString(date, -7), [...history], null, result.data, date),
        budget,
        knowledgeRefs: [...new Set([
            ...strategy.requirements.flatMap(requirement => requirement.knowledgeRefs),
            ...(qualityRolePacked ? [KNOWLEDGE_CLAIM_IDS.evergreenQualitySetComposition] : []),
        ])].sort(),
    };
}
