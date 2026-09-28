import { describe, expect, it } from 'vitest';
import { resolveEvergreenPlan } from './evergreenPlanning';
import { resolvePlanningContext } from './planningMode';
import { evaluatePeriodizationPhase } from './periodization';
import { buildCoverageState, coverageNeedTierForTemplate } from './coverage';
import { rankCandidates } from './optimizer';
import { resolveTrainingIntent } from './trainingIntent';
import type { DailyReadiness } from './models';
import type { TrainingHistoryProvider } from './trainingHistory';
import { ENRICHED_TEMPLATES } from './templates';
import type {
    DailySubjectiveCheckin, FatigueState, TrainingIntentProfile, TrainingSettings, UserContext, UserPreferences,
} from './models';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import type { ResolvedAvailability } from './schedule';
import type { PhaseWeights } from './periodization';
import type { CheckinRecord } from './mechanicalProgression';
import { mechanicalIdentityFor } from '../workouts/mechanicalExposure';
import { addDaysToLocalDateString } from '../utils/localDate';

/** #805 Phase 7 deterministic cases: a cycling-primary hybrid (endurance + strength). */

const D = '2026-09-14';
const at = (offset: number) => addDaysToLocalDateString(D, offset);
const COST = { systemic: 0.25, cardiovascular: 0.35, lowerBody: 0.2, upperBody: 0, impactTissue: 0.15, neuromuscular: 0.1 };
const ALL_CAPABILITIES = ['linear_speed_skill', 'acceleration_deceleration', 'multidirectional_change_of_direction', 'sport_skill'] as const;

const profile = (optedIn: boolean): TrainingIntentProfile => ({
    userId: 'u1', planningMode: 'evergreen', priorities: ['endurance', 'strength_muscle'],
    weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
    ...(optedIn ? { capabilityMaintenance: { enabled: true, capabilities: [...ALL_CAPABILITIES] } } : {}),
});
const basePreferences: UserPreferences = {
    userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible', preferredModalities: ['Cycling', 'Strength'], deprioritizedModalities: ['Running'], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};
const baseContext: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: true, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
};
const settings = (environment: 'indoor' | 'outdoor' | 'either'): TrainingSettings => ({
    userId: 'u1', schemaVersion: 2,
    equipment: { free_weights: true, cable_machine: true, treadmill: false, indoor_bike: true, pullup_bar: false, outdoor_bike: true, swim_access: false },
    guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
    defaults: { weekdayMaxMinutes: 60, weekendMaxMinutes: 120, environment },
    preferences: { preferActiveRecovery: false },
    migration: { legacyReviewed: true, migratedAt: null },
    createdAt: '', updatedAt: '',
});

const ride = (date: string, index: number): CompletedExposure => ({
    occurrenceKey: `ride-${index}`, date, costProfile: COST, modality: 'Cycling', category: 'Easy Endurance',
    trainingRecordLike: { type: 'Cycling aerobic endurance', duration_min: 75, training_effect: 2, intensity_tag: 'easy' },
});
const field = (date: string, workoutId: string): CompletedExposure => ({
    occurrenceKey: `field-${date}-${workoutId}`, date, costProfile: COST, modality: 'Field', category: 'Technical Skill', workoutId,
    trainingRecordLike: { type: 'Field technical skill', duration_min: 35, training_effect: 2, intensity_tag: 'moderate' },
});
const RIDES = Array.from({ length: 12 }, (_, index) => ride(at(-27 + index * 2), index));

/** Stage-4-ready: two stage-3 sessions with normal follow-ups inside the re-entry window;
 * the last controlled field session was 15 days ago. */
const STAGE_4_READY = [
    ...RIDES,
    field(at(-15), 'field_controlled_maintenance_01'),
    field(at(-10), 'field_acceleration_braking_01'),
    field(at(-5), 'field_acceleration_braking_01'),
].sort((left, right) => left.date.localeCompare(right.date));

/** An explicit normal next-morning lower-body response after every mechanical exposure. */
function normalFollowUps(evidence: readonly CompletedExposure[]): CheckinRecord[] {
    return evidence
        .filter(exposure => mechanicalIdentityFor(exposure.workoutId) !== undefined)
        .map(exposure => addDaysToLocalDateString(exposure.date, 1))
        .filter(date => date <= D)
        .map(date => ({
            date,
            checkin: {
                date, soreness: 2, painOrInjury: false, illnessSymptoms: false,
                tissueResponses: { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } },
            } as DailySubjectiveCheckin,
        }));
}

function snapshot(evidence: CompletedExposure[]): TrainingHistorySnapshot {
    const operational = evidence.filter(exposure => exposure.date >= at(-7));
    return {
        throughDateExclusive: D, windowDays: 7, completedEvents: [], exposures: operational,
        sourceStates: {
            activities: { status: 'AVAILABLE', revision: 'a' }, recommendations: { status: 'AVAILABLE', revision: 'r' },
            manualTraining: { status: 'MISSING' },
        },
        generatedAt: `${D}T00:00:00.000Z`, revision: 'test',
        athleteStateEvidence: { observedWindowDays: 28, exposures: evidence },
    };
}

interface Options {
    optedIn?: boolean;
    evidence?: CompletedExposure[];
    preferences?: Partial<UserPreferences>;
    context?: UserContext;
    adverse?: boolean;
    clinical?: boolean;
    phase?: PhaseWeights;
}

function plan(options: Options = {}) {
    const evidence = options.evidence ?? STAGE_4_READY;
    const planningContext = resolvePlanningContext(profile(options.optedIn ?? true), evaluatePeriodizationPhase([], D), D);
    const history = snapshot(evidence);
    return resolveEvergreenPlan(
        planningContext, options.phase ?? evaluatePeriodizationPhase([], D).phase, history.exposures, history,
        { ...basePreferences, ...options.preferences }, options.context ?? baseContext, D, [], 7,
        options.adverse ?? false, [], new Map(), null, options.clinical ?? false,
        { checkinHistory: normalFollowUps(evidence) },
    )!;
}

const capability = (resolved: ReturnType<typeof plan>, key: string) =>
    resolved.capabilityMaintenance!.capabilities.find(item => item.capability === key)!;
const sessionCount = (resolved: ReturnType<typeof plan>) =>
    resolved.budget.requiredRoles.length + resolved.budget.targetRoles.length + resolved.budget.optionalRoles.length;

const template = (id: string) => ENRICHED_TEMPLATES.find(item => item.id === id)!;
const FATIGUE: FatigueState = {
    lastUpdatedDate: D,
    externalLoadFatigue: { ...COST, systemic: 0, cardiovascular: 0, lowerBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { ...COST, systemic: 0, cardiovascular: 0, lowerBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { ...COST, systemic: 0, cardiovascular: 0, lowerBody: 0, impactTissue: 0, neuromuscular: 0 },
};
const availability = (date: string): ResolvedAvailability => ({
    date, maxTimeMinutes: 90, availableEquipment: ['free_weights', 'indoor_bike'], fixedActivities: [],
    reservedCapacityCost: 0, reservedCapacityCostProfile: { ...FATIGUE.combinedFatigue }, environmentOverride: null,
});
function rankOn(resolved: ReturnType<typeof plan>, date: string, preferences: UserPreferences = basePreferences, candidates = [template('field_maint_01')]) {
    const coverageState = buildCoverageState(resolved.planDefinition, date, STAGE_4_READY.filter(item => item.date >= at(-7)));
    return rankCandidates(candidates, [], FATIGUE, availability(date), [], preferences, { date, coverageState });
}

describe('periodic capability maintenance in evergreen planning (#805 Phase 7)', () => {
    it('progresses a stage-4-ready opted-in athlete to controlled field work on the existing support occurrence', () => {
        const optedIn = plan();
        expect(optedIn.mechanicalProgression.stage).toBe(4);
        expect(capability(optedIn, 'sport_skill')).toMatchObject({ status: 'overdue', fulfilment: { status: 'plannable' } });
        expect(capability(optedIn, 'multidirectional_change_of_direction').fulfilment).toEqual({ status: 'plannable' });
        expect(capability(optedIn, 'linear_speed_skill').status).toBe('satisfied');
        const mechanical = optedIn.planDefinition.coverageRequirements?.filter(item => item.coverageKey === 'mechanical_exposure') ?? [];
        expect(mechanical).toHaveLength(1);
        expect(mechanical[0].capabilityPlacements?.map(item => item.capability).sort()).toEqual(['multidirectional_change_of_direction', 'sport_skill']);

        const coverage = buildCoverageState(optedIn.planDefinition, D, []);
        const support = coverage.requirements.find(item => item.key === 'mechanical_exposure')!;
        expect(support.eligibleWorkoutIds).toEqual(['field_controlled_maintenance_01']);
        expect(support.capabilityConsentWorkoutIds).toEqual(['field_controlled_maintenance_01']);

        const ranked = rankOn(optedIn, D);
        expect(ranked.accepted.map(item => item.template.id)).toContain('field_maint_01');
        expect(ranked.accepted.find(item => item.template.id === 'field_maint_01')?.coverageNeedTier).toBe(2);
        expect(optedIn.knowledgeRefs).toContain('policy.evergreen.athletic_capability_maintenance_v1');
    });

    it('adds no session, objective or requirement compared with the opted-out plan', () => {
        const optedIn = plan();
        const optedOut = plan({ optedIn: false });
        expect(sessionCount(optedIn)).toBe(sessionCount(optedOut));
        expect(optedIn.planDefinition.objectives).toEqual(optedOut.planDefinition.objectives);
        expect(optedIn.planDefinition.coverageRequirements?.map(item => item.coverageKey))
            .toEqual(optedOut.planDefinition.coverageRequirements?.map(item => item.coverageKey));
    });

    it('does not prescribe field work without the opt-in', () => {
        const optedOut = plan({ optedIn: false });
        expect(optedOut.capabilityMaintenance).toBeNull();
        const ranked = rankOn(optedOut, D);
        expect(ranked.rejected.find(item => item.template.id === 'field_maint_01')?.excludedReasons)
            .toContain('EXPLICIT_MODALITY_PREFERENCE_REQUIRED');
    });

    it('consents only exact capability identities; a non-capability Field template stays excluded', () => {
        const optedIn = plan();
        const futureField = { ...template('field_maint_01'), id: 'future_field_template_01' };
        const ranked = rankOn(optedIn, D, basePreferences, [template('field_maint_01'), futureField, template('field_technical_01')]);
        expect(ranked.accepted.map(item => item.template.id)).toContain('field_maint_01');
        for (const id of ['future_field_template_01', 'field_technical_01']) {
            expect(ranked.rejected.find(item => item.template.id === id)?.excludedReasons).toContain('EXPLICIT_MODALITY_PREFERENCE_REQUIRED');
        }
    });

    it('blocks under avoid_high_impact and substitutes nothing', () => {
        const blocked = plan({ context: { ...baseContext, constraints: { ...baseContext.constraints, impliedGuardrails: ['avoid_high_impact'] } } });
        expect(capability(blocked, 'sport_skill').fulfilment).toEqual({ status: 'blocked', reason: 'mechanical_guardrail' });
        expect(blocked.capabilityMaintenance!.placements).toEqual([]);
        expect(blocked.warnings.some(warning => warning.code === 'capability_maintenance_unfulfilled')).toBe(true);
    });

    it('deliberately suspends during adverse recovery or clinical symptoms without a warning or catch-up', () => {
        const adverse = plan({ adverse: true });
        expect(capability(adverse, 'sport_skill').fulfilment).toEqual({ status: 'deliberately_suspended', reason: 'adverse_recovery' });
        expect(adverse.capabilityMaintenance!.placements).toEqual([]);
        expect(adverse.warnings.some(warning => warning.code === 'capability_maintenance_unfulfilled')).toBe(false);
        const clinical = plan({ clinical: true });
        expect(capability(clinical, 'sport_skill').fulfilment).toEqual({ status: 'deliberately_suspended', reason: 'clinical_symptoms' });
    });

    it('lets unavailable Field win over consent, blocks avoided Field, and keeps deprioritized Field soft', () => {
        const unavailable = plan({ preferences: { unavailableModalities: ['Field'] } });
        expect(capability(unavailable, 'sport_skill').fulfilment).toEqual({ status: 'blocked', reason: 'modality_unavailable' });
        const consented = rankOn(plan(), D, { ...basePreferences, unavailableModalities: ['Field'] });
        expect(consented.rejected.find(item => item.template.id === 'field_maint_01')?.excludedReasons).toContain('UNAVAILABLE_MODALITY');

        const avoided = plan({ preferences: { avoidedModalities: ['Field'] } });
        expect(capability(avoided, 'sport_skill').fulfilment).toEqual({ status: 'blocked', reason: 'modality_avoided' });
        expect(avoided.capabilityMaintenance!.placements).toEqual([]);

        const deprioritized = plan({ preferences: { deprioritizedModalities: ['Field'] } });
        expect(capability(deprioritized, 'sport_skill').fulfilment).toEqual({ status: 'plannable' });
        expect(deprioritized.capabilityMaintenance!.softContext).toHaveLength(1);
    });

    it('reports a configured indoor-only environment as environment_unavailable', () => {
        const indoor = plan({ context: { ...baseContext, trainingSettings: settings('indoor') } });
        expect(capability(indoor, 'sport_skill').fulfilment).toEqual({ status: 'blocked', reason: 'environment_unavailable' });
    });

    it('suspends for an evergreen Peak/Taper phase', () => {
        const base = evaluatePeriodizationPhase([], D).phase;
        const taper = plan({ phase: { ...base, phaseName: 'Peak/Taper' } });
        expect(capability(taper, 'sport_skill').fulfilment).toEqual({ status: 'deliberately_suspended', reason: 'event_phase' });
        expect(taper.capabilityMaintenance!.placements).toEqual([]);
    });

    it('returns no evergreen plan, and so unlocks nothing, in event-directed mode', () => {
        const evergreen = resolvePlanningContext(profile(true), evaluatePeriodizationPhase([], D), D);
        const context = { ...evergreen, mode: 'event_directed' as const };
        const eventPhase = evaluatePeriodizationPhase([], D);
        const history = snapshot(STAGE_4_READY);
        expect(resolveEvergreenPlan(context, eventPhase.phase, history.exposures, history, basePreferences, baseContext, D, [])).toBeNull();
    });

    it('starts a cold athlete on the safest progression identity and reports stage insufficiency', () => {
        const cold = plan({ evidence: RIDES });
        expect(cold.mechanicalProgression.stage).toBe(1);
        expect(capability(cold, 'sport_skill').fulfilment).toEqual({ status: 'blocked', reason: 'mechanical_stage_insufficient' });
        expect(cold.capabilityMaintenance!.placements.every(item => item.progressionOnly && item.consentWorkoutIds.length === 0)).toBe(true);
        const support = buildCoverageState(cold.planDefinition, D, []).requirements.find(item => item.key === 'mechanical_exposure')!;
        expect(support.eligibleWorkoutIds).toEqual(['running_walk_run_01']);
        expect(support.capabilityConsentWorkoutIds).toBeUndefined();
        expect(cold.warnings.filter(warning => warning.code === 'capability_maintenance_unfulfilled')).toHaveLength(4);
    });

    it('shows a horizon-entry target as due but gives no consent or coverage urgency before its due date', () => {
        const evidence = [...RIDES, field(at(-8), 'field_controlled_maintenance_01')].sort((left, right) => left.date.localeCompare(right.date));
        const sportSkillOnly = {
            ...profile(true),
            capabilityMaintenance: { enabled: true as const, capabilities: ['sport_skill' as const] },
        };
        const planningContext = resolvePlanningContext(sportSkillOnly, evaluatePeriodizationPhase([], D), D);
        const history = snapshot(evidence);
        const resolved = resolveEvergreenPlan(
            planningContext, evaluatePeriodizationPhase([], D).phase, history.exposures, history,
            basePreferences, baseContext, D, [], 7, false, [], new Map(), null, false,
            { checkinHistory: normalFollowUps(evidence) },
        )!;
        expect(capability(resolved, 'sport_skill')).toMatchObject({ status: 'due', notBeforeDate: at(5) });
        const stateOn = (date: string) => buildCoverageState(resolved.planDefinition, date, []);
        const supportNow = stateOn(D).requirements.find(item => item.key === 'mechanical_exposure')!;
        expect(supportNow.candidateWorkoutNotBeforeDates?.field_controlled_maintenance_01).toBe(at(5));
        for (let offset = 0; offset < 5; offset++) {
            const state = stateOn(at(offset));
            expect(state.requirements.find(item => item.key === 'mechanical_exposure')?.capabilityConsentWorkoutIds ?? [])
                .not.toContain('field_controlled_maintenance_01');
            expect(coverageNeedTierForTemplate(state, template('field_maint_01'))).toBe(3);
        }
        const dueState = stateOn(at(5));
        expect(dueState.requirements.find(item => item.key === 'mechanical_exposure')?.capabilityConsentWorkoutIds)
            .toContain('field_controlled_maintenance_01');
        expect(coverageNeedTierForTemplate(dueState, template('field_maint_01'))).toBe(2);
    });

    it('lifts the narrowing once a qualifying touch is projected on or after the not-before date', () => {
        const optedIn = plan();
        const projectedField = { ...field(at(1), 'field_controlled_maintenance_01'), source: 'projected' as const };
        const later = buildCoverageState(optedIn.planDefinition, at(3), [projectedField]);
        const support = later.requirements.find(item => item.key === 'mechanical_exposure')!;
        expect(support.capabilityConsentWorkoutIds).toBeUndefined();
        expect(support.eligibleWorkoutIds).toContain('running_walk_run_01');
    });

    it('does not let the opt-in widen athlete-state evidence or change the aerobic floor (D-A)', async () => {
        const provider: TrainingHistoryProvider = {
            reconstruct: async (_userId, through, windowDays) => STAGE_4_READY.filter(item =>
                item.date >= addDaysToLocalDateString(through, -windowDays) && item.date < through),
            getSnapshot: async (_userId, through, windowDays) => ({
                ...snapshot(STAGE_4_READY), throughDateExclusive: through, windowDays,
                exposures: STAGE_4_READY.filter(item => item.date >= addDaysToLocalDateString(through, -windowDays) && item.date < through),
                athleteStateEvidence: undefined,
            }),
        };
        const readiness = { subjective: { readiness: 8, fatigue: 2, soreness: 2 }, objective: {} } as unknown as DailyReadiness;
        const health = (optedIn: boolean): TrainingIntentProfile => ({ ...profile(optedIn), priorities: ['health'] });
        const withOptIn = await resolveTrainingIntent('u1', [], D, readiness, 7, provider, undefined, [], health(true));
        const without = await resolveTrainingIntent('u1', [], D, readiness, 7, provider, undefined, [], health(false));
        expect(withOptIn.historySnapshot?.athleteStateEvidence).toBeUndefined();
        expect(withOptIn.aerobicVolumeFloor).toEqual(without.aerobicVolumeFloor);
        // The opt-in loads a dedicated 28-day #804 establishment stream without attaching
        // it to the general athlete-state snapshot.
        expect(withOptIn.mechanicalEvidenceObservedWindowDays).toBe(28);
        expect(withOptIn.mechanicalExposureHistory.some(item => item.date < at(-14))).toBe(true);

        const resolvedHealth = resolveEvergreenPlan(
            withOptIn.planningContext,
            evaluatePeriodizationPhase([], D).phase,
            withOptIn.history,
            withOptIn.historySnapshot,
            basePreferences,
            baseContext,
            D,
            [],
            7,
            false,
            [],
            new Map(),
            withOptIn.aerobicVolumeFloor,
            false,
            {
                exposureHistory: withOptIn.mechanicalExposureHistory,
                observedWindowDays: withOptIn.mechanicalEvidenceObservedWindowDays,
                checkinHistory: normalFollowUps(withOptIn.mechanicalExposureHistory),
            },
        )!;
        expect(resolvedHealth.planDefinition.coverageRequirements?.some(item => item.coverageKey === 'mechanical_exposure')).toBe(true);
        expect(resolvedHealth.warnings.some(item => item.code === 'mechanical_exposure_withheld')).toBe(false);
        expect(resolvedHealth.capabilityMaintenance?.enabled).toBe(true);
    });

    it('does not invent a 28-day observation span for reconstruct-only history providers', async () => {
        const provider: TrainingHistoryProvider = {
            reconstruct: async (_userId, through, requestedWindowDays) => STAGE_4_READY.filter(item =>
                item.date >= addDaysToLocalDateString(through, -requestedWindowDays) && item.date < through),
        };
        const readiness = { subjective: { readiness: 8, fatigue: 2, soreness: 2 }, objective: {} } as unknown as DailyReadiness;
        const healthProfile: TrainingIntentProfile = { ...profile(true), priorities: ['health'] };
        const intent = await resolveTrainingIntent('u1', [], D, readiness, 7, provider, undefined, [], healthProfile);
        expect(intent.mechanicalExposureHistory.some(item => item.date < at(-14))).toBe(true);
        expect(intent.mechanicalEvidenceObservedWindowDays).toBe(7);

        const resolved = resolveEvergreenPlan(
            intent.planningContext,
            evaluatePeriodizationPhase([], D).phase,
            intent.history,
            intent.historySnapshot,
            basePreferences,
            baseContext,
            D,
            [],
            7,
            false,
            [],
            new Map(),
            intent.aerobicVolumeFloor,
            false,
            {
                exposureHistory: intent.mechanicalExposureHistory,
                observedWindowDays: intent.mechanicalEvidenceObservedWindowDays,
                checkinHistory: normalFollowUps(intent.mechanicalExposureHistory),
            },
        )!;
        expect(resolved.capabilityMaintenance?.capabilities.every(item => item.status === 'insufficient_history')).toBe(true);
        expect(resolved.capabilityMaintenance?.placements).toEqual([]);
    });
});
