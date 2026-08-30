import { describe, expect, it } from 'vitest';
import { evaluateEnvelopes, evaluateReadinessAndSafetyEnvelope, evaluateTrainingWithIntent } from './rules';
import { evaluateRecoveryConstraints, rankCandidates } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import type { DailyReadiness, EngineObjectiveInput, FatigueState, SubjectiveInput, UserContext, UserEvent, UserPreferences } from './models';
import type { ResolvedAvailability } from './schedule';
import type { TrainingHistoryProvider } from './trainingHistory';

// Deterministic stand-in for the real Firestore-backed provider: these tests exercise
// calibration policy in isolation and must not depend on network/Firestore reachability.
const emptyHistoryProvider: TrainingHistoryProvider = { reconstruct: async () => [] };

const DEFAULT_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-03-01',
    externalLoadFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    internalResponseStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    combinedFatigue: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
};

const DEFAULT_AVAILABILITY: ResolvedAvailability = {
    date: '2026-03-01',
    maxTimeMinutes: 120,
    // outdoor_bike: this file's only outdoor-cycling candidate (end_crit_surges_01, used by
    // the Priority B race-specific calibration test) now hard-requires declared bike access.
    availableEquipment: ['free_weights', 'indoor_bike', 'treadmill', 'cable_machine', 'outdoor_bike'],
    fixedActivities: [],
    reservedCapacityCost: 0,
    reservedCapacityCostProfile: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
    environmentOverride: null,
};

const DEFAULT_PREFERENCES: UserPreferences = {
    userId: 'user_default',
    avoidedModalities: [],
    deprioritizedModalities: [],
    preferredModalities: [],
    conservativeBias: false,
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 60,
    defaultWeekendTimeMin: 90,
    preferredTimeOfDay: 'flexible',
    explanationVerbosity: 'detailed',
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
    };
}

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 9,
        sleepQuality: 9,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 9,
        timeAvailable: 60,
        painFlag: false,
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...overrides,
    };
}

function objective(overrides: Partial<EngineObjectiveInput> = {}): EngineObjectiveInput {
    return {
        total_steps: 8000,
        sleep_score: 85,
        sleep_duration_min: 450,
        rhr: 50,
        rhr_7d_avg: 50,
        rhr_delta: 0,
        hrv_weekly_avg: 50,
        hrv_last_night: 50,
        hrv_delta: 0,
        respiration: 14,
        body_battery_wake: 85,
        last_3_days_hard_sessions_count: 0,
        yesterday_training: null,
        today_training: null,
        sleep_score_delta_7d: 0,
        rhr_delta_28d: 0,
        hrv_delta_28d: 0,
        sleep_score_delta_28d: 0,
        hrv_stdev_28d: 8.5,
        rhr_stdev_28d: 3.5,
        sleep_score_stdev_28d: 7.8,
        ...overrides,
    };
}

function readiness(
    subjectiveOverrides: Partial<SubjectiveInput> = {},
    objectiveOverrides: Partial<EngineObjectiveInput> = {},
): DailyReadiness {
    return {
        subjective: subjective(subjectiveOverrides),
        objective: objective(objectiveOverrides),
    };
}

describe('plan-judge calibration policy guards', () => {
    it('treats isolated very high stress as modify rather than full recovery', () => {
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({ stress: 9 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('modify');
        expect(result.fatigueTriggeredRecover).toBe(false);
    });

    it('forces recovery for combined high fatigue and low readiness even when objective metrics are green', () => {
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({ fatigue: 8, readiness: 4 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('recover');
        expect(result.fatigueTriggeredRecover).toBe(true);
    });

    it('keeps low motivation alone from becoming a physiological safety downgrade', () => {
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({ motivation: 2 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('train');
    });

    it('reacts at the acute RHR floor when the other recovery signals are green', () => {
        // +7 bpm against the 3.5-bpm personal SD is exactly 2 SD. With the 0.3 RHR
        // weight that yields the 0.60 acute-deviation floor used by the explicit guard.
        const result = evaluateReadinessAndSafetyEnvelope(
            readiness({}, { rhr: 57, rhr_delta: 7, rhr_delta_28d: 7 }),
            context(),
            '2026-08-24',
        );

        expect(result.mode).toBe('modify');
    });

    it('makes the sleep-score plan-envelope floor explicit at the boundary', () => {
        const below = evaluateEnvelopes(readiness({}, { sleep_score: 54 }), context());
        const at = evaluateEnvelopes(readiness({}, { sleep_score: 55 }), context());

        expect(below.plan.maxAllowableTier).toBe('Easy');
        expect(at.plan.maxAllowableTier).toBe('Hard');
    });

    it('makes the body-battery plan-envelope floor explicit at the boundary', () => {
        const below = evaluateEnvelopes(readiness({}, { body_battery_wake: 29 }), context());
        const at = evaluateEnvelopes(readiness({}, { body_battery_wake: 30 }), context());

        expect(below.plan.maxAllowableTier).toBe('Easy');
        expect(at.plan.maxAllowableTier).toBe('Hard');
    });

    it('auto-applies a template easier dose on the intent-aware modify path', async () => {
        const result = await evaluateTrainingWithIntent(
            'calibration-test-user',
            readiness({ stress: 9, timeAvailable: 15, preferredModalityToday: 'Mobility' }),
            context(),
            [],
            '2026-08-24',
            undefined,
            emptyHistoryProvider,
        );

        expect(result.mode).toBe('modify');
        expect(result.template.id).toBe('mob_01');
        expect(result.template.easierDose).toBeDefined();
        expect(result.activeDose).toEqual(result.template.easierDose);
        expect(result.adjustment).toMatchObject({
            direction: 'easier',
            tier: 1,
            originalTemplateId: 'mob_01',
        });
    });

    it('auto-applies an easier dose on a plain train day when the picked template\'s range exceeds a hard time cap', async () => {
        // Regression: eligibility only requires a template's durationMin to fit the day's
        // cap (see resolveMaximumSessionMinutes), so a wide-range template like "Tempo
        // Ride (40-60 min)" stayed eligible on a 45-minute-capped day and was recommended
        // with its full, uncapped range -- silently advertising up to 60 minutes on a day
        // the athlete was told has a 45-minute hard maximum.
        const cappedContext: UserContext = { ...context(), constraints: { ...context().constraints, hasIndoorBike: true, maxTimeMinutes: 45 } };
        const result = await evaluateTrainingWithIntent(
            'calibration-test-user',
            readiness({ timeAvailable: 45, preferredModalityToday: 'Cycling' }),
            cappedContext,
            [],
            '2026-08-24',
            undefined,
            emptyHistoryProvider,
        );

        expect(result.mode).toBe('train');
        expect(result.template.durationMax).toBeGreaterThan(45);
        expect(result.activeDose).toBeDefined();
        expect(result.activeDose?.durationMax).toBeLessThanOrEqual(45);
        expect(result.adjustment).toMatchObject({ direction: 'easier', tier: 1 });
    });

    it('enforces pre-event strength restriction within 3 days of an A/B priority cycling event', () => {
        const strengthTemplate = ENRICHED_TEMPLATES.find(t => t.modality === 'Strength' && t.category === 'Full-body Strength')!;
        const focusEvent: UserEvent = {
            id: 'race-1',
            title: 'Criterium',
            category: 'cycling_event' as const,
            date: '2026-08-27',
            priority: 'A' as const,
            lifecycle: 'scheduled' as const,
            demandProfile: { aerobicEndurance: 0.5, thresholdPower: 0.5, vo2MaxPower: 0.8, repeatedSurges: 0.9, sprintPower: 0.7, fatigueResistance: 0.6, neuromuscular: 0.5 },
        };

        // 2 days before event: 2026-08-25 vs race 2026-08-27 (diff = 2)
        const reasonsTwoDaysOut = evaluateRecoveryConstraints(
            strengthTemplate,
            '2026-08-25',
            [],
            { focusEvent },
        );
        expect(reasonsTwoDaysOut).toContain('PRE_EVENT_STRENGTH_RESTRICTION');

        // 5 days before event: 2026-08-22 vs race 2026-08-27 (diff = 5)
        const reasonsFiveDaysOut = evaluateRecoveryConstraints(
            strengthTemplate,
            '2026-08-22',
            [],
            { focusEvent },
        );
        expect(reasonsFiveDaysOut).not.toContain('PRE_EVENT_STRENGTH_RESTRICTION');
    });

    it('enforces pre-event taper restriction on the eve of an A/B priority race (D-1)', () => {
        const hardIntervalTemplate = ENRICHED_TEMPLATES.find(t => t.category === 'Hard Endurance')!;
        const focusEvent: UserEvent = {
            id: 'race-1',
            title: 'Criterium',
            category: 'cycling_event' as const,
            date: '2026-08-27',
            priority: 'A' as const,
            lifecycle: 'scheduled' as const,
            demandProfile: { aerobicEndurance: 0.5, thresholdPower: 0.5, vo2MaxPower: 0.8, repeatedSurges: 0.9, sprintPower: 0.7, fatigueResistance: 0.6, neuromuscular: 0.5 },
        };

        // 1 day before race: 2026-08-26 vs race 2026-08-27 (diff = 1)
        const reasonsEveOfRace = evaluateRecoveryConstraints(
            hardIntervalTemplate,
            '2026-08-26',
            [],
            { focusEvent },
        );
        expect(reasonsEveOfRace).toContain('PRE_EVENT_TAPER_RESTRICTION');

        // Light mobility / recovery should remain allowed
        const lightMobility = ENRICHED_TEMPLATES.find(t => t.category === 'Mobility/Recovery')!;
        const reasonsMobility = evaluateRecoveryConstraints(
            lightMobility,
            '2026-08-26',
            [],
            { focusEvent },
        );
        expect(reasonsMobility).not.toContain('PRE_EVENT_TAPER_RESTRICTION');
    });

    it('enforces zero-strength buffer on Day +1 following heavy lower-body strength', () => {
        const strengthTemplate = ENRICHED_TEMPLATES.find(t => t.modality === 'Strength')!;
        const history = [{
            date: '2026-08-24',
            templateId: 'str_full_01',
            category: 'Full-body Strength' as const,
            modality: 'Strength' as const,
            systemicCost: 0.7,
            lowerBodyCost: 0.85,
        }];

        // Day +1: 2026-08-25 vs heavy strength on 2026-08-24 (diff = 1)
        const reasonsNextDay = evaluateRecoveryConstraints(
            strengthTemplate,
            '2026-08-25',
            history,
            {},
        );
        expect(reasonsNextDay).toContain('POST_HEAVY_STRENGTH_BUFFER');
    });

    it('modulates Priority B event race-specific session benefits when 1 is already in recent history', () => {
        const critSurgeTemplate = ENRICHED_TEMPLATES.find(t => t.id === 'end_crit_surges_01')!;
        const focusEventB: UserEvent = {
            id: 'race-b',
            title: 'Local Crit',
            category: 'cycling_event' as const,
            date: '2026-08-30',
            priority: 'B' as const,
            lifecycle: 'scheduled' as const,
            demandProfile: { aerobicEndurance: 0.5, thresholdPower: 0.5, vo2MaxPower: 0.8, repeatedSurges: 0.9, sprintPower: 0.7, fatigueResistance: 0.6, neuromuscular: 0.5 },
        };

        const historyWithRecentCrit = [{
            date: '2026-08-22',
            templateId: 'end_crit_surges_01',
            category: 'Race-Specific Endurance' as const,
            modality: 'Cycling' as const,
            systemicCost: 0.7,
        }];

        const result = rankCandidates(
            [critSurgeTemplate],
            [],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            [],
            DEFAULT_PREFERENCES,
            { date: '2026-08-25', focusEvent: focusEventB, recentHistory: historyWithRecentCrit },
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].benefitScore).toBeLessThan(0.40);
    });

    it('enforces pre-event taper restriction against exhaustive workouts during race week (D-7 to D-3)', () => {
        const vo2Template = ENRICHED_TEMPLATES.find(t => (t.title ?? '').toLowerCase().includes('vo2') || t.systemicCost >= 0.75)!;
        const focusEventA: UserEvent = {
            id: 'race-a',
            title: 'Championship Criterium',
            category: 'cycling_event' as const,
            date: '2026-08-30',
            priority: 'A' as const,
            lifecycle: 'scheduled' as const,
            demandProfile: { aerobicEndurance: 0.5, thresholdPower: 0.5, vo2MaxPower: 0.9, repeatedSurges: 0.9, sprintPower: 0.7, fatigueResistance: 0.6, neuromuscular: 0.5 },
        };

        // 5 days out: 2026-08-25 vs race on 2026-08-30 (diff = 5)
        const reasons5d = evaluateRecoveryConstraints(
            vo2Template,
            '2026-08-25',
            [],
            { focusEvent: focusEventA },
        );
        expect(reasons5d).toContain('PRE_EVENT_TAPER_RESTRICTION');
    });

    it('boosts upper-body and core strength sessions when lower-body guardrail is active', () => {
        const upperStrengthTemplate = ENRICHED_TEMPLATES.find(t => t.id === 'str_upper_01' || t.category === 'Upper-body Strength')!;
        const result = rankCandidates(
            [upperStrengthTemplate],
            [{ id: 'obj-str', key: 'strength_maintenance', title: 'Strength Maintenance', targetExposures: 2, completedExposures: 0, targetStimulus: { maxStrength: 0.8 } }],
            DEFAULT_FATIGUE,
            DEFAULT_AVAILABILITY,
            ['avoid_heavy_lower_body'],
            DEFAULT_PREFERENCES,
            { date: '2026-08-25' },
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.accepted[0].utilityScore).toBeGreaterThan(0.5);
    });
});
