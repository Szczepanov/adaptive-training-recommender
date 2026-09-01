import { describe, expect, it } from 'vitest';
import { evaluateEnvelopes } from './rules';
import type { DailyReadiness, EngineObjectiveInput, SubjectiveInput, UserContext } from './models';

function subjective(overrides: Partial<SubjectiveInput> = {}): SubjectiveInput {
    return {
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        stress: 2,
        motivation: 8,
        timeAvailable: 60,
        painFlag: false,
        clinicalEnvelopeSources: [],
        painOrInjuryRegionFamilies: [],
        alreadyTrainedToday: false,
        preferredModalityToday: null,
        ...overrides,
    };
}

function objective(): EngineObjectiveInput {
    return {
        total_steps: null,
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
        hrv_stdev_28d: 8,
        rhr_stdev_28d: 3,
        sleep_score_stdev_28d: 8,
    };
}

function context(overrides: Partial<UserContext> = {}): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: true,
            hasIndoorBike: true,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
        ...overrides,
    };
}

function envelope(subjectiveInput: SubjectiveInput, userContext = context()) {
    const readiness: DailyReadiness = { subjective: subjectiveInput, objective: objective() };
    return evaluateEnvelopes(readiness, userContext);
}

describe('SEP-C1 contextual clinical envelope', () => {
    it('fails closed for a legacy aggregate clinical flag with no source/location detail', () => {
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: undefined,
            painOrInjuryRegionFamilies: undefined,
        }));

        expect(result.safety.restrictedModalities).toContain('Running');
        expect(result.plan.maxAllowableTier).toBe('Mobility');
    });

    it('fails closed for current pain/injury when its location is unknown', () => {
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['pain_or_injury'],
            painOrInjuryRegionFamilies: [],
        }));

        expect(result.safety.restrictedModalities).toContain('Running');
        expect(result.safety.clinicalReason).toBe('Pain or injury reported.');
    });

    it.each([
        ['upper_limb_loading'],
        ['lumbar_loading'],
        ['lower_limb_strength'],
    ] as const)('does not invent a generic Running ban for isolated current %s pain context', family => {
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['pain_or_injury'],
            painOrInjuryRegionFamilies: [family],
        }));

        expect(result.safety.restrictedModalities).not.toContain('Running');
        expect(result.plan.maxAllowableTier).toBe('Mobility');
    });

    it('keeps the generic Running fallback for current lower-limb-impact pain', () => {
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['pain_or_injury'],
            painOrInjuryRegionFamilies: ['lower_limb_impact'],
        }));

        expect(result.safety.restrictedModalities).toContain('Running');
    });

    it('fails closed when current pain spans both impact and non-impact region families', () => {
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['pain_or_injury'],
            painOrInjuryRegionFamilies: ['upper_limb_loading', 'lower_limb_impact'],
        }));

        expect(result.safety.restrictedModalities).toContain('Running');
    });

    it('keeps illness systemic-only: Mobility ceiling without an anatomy-specific Running ban', () => {
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['non_allergy_illness'],
            painOrInjuryRegionFamilies: [],
        }));

        expect(result.safety.restrictedModalities).not.toContain('Running');
        expect(result.plan.maxAllowableTier).toBe('Mobility');
        expect(result.safety.clinicalReason).toBe('Non-allergy illness symptoms reported.');
    });

    it('uses source categories even if a manually constructed caller left the legacy aggregate false', () => {
        const result = envelope(subjective({
            painFlag: false,
            clinicalEnvelopeSources: ['non_allergy_illness'],
        }));

        expect(result.safety.clinicalFlagActive).toBe(true);
        expect(result.plan.maxAllowableTier).toBe('Mobility');
    });

    it('preserves explicit/standing Running restrictions independently of current symptom source', () => {
        const userContext = context({
            constraints: {
                ...context().constraints,
                restrictedModalities: ['Running'],
            },
        });
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['non_allergy_illness'],
        }), userContext);

        expect(result.safety.restrictedModalities).toContain('Running');
    });

    it('does not let an unrelated standing upper-limb provenance trace explain away unlocated current pain', () => {
        const userContext = context({
            injuryPolicyTrace: {
                tissueSeverityApplied: false,
                regionMappingFamilies: ['upper_limb_loading'],
                clinicalEnvelopeSources: ['pain_or_injury'],
            },
        });
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['pain_or_injury'],
            painOrInjuryRegionFamilies: [],
        }), userContext);

        expect(result.safety.restrictedModalities).toContain('Running');
    });

    it('does not let a standing lower-limb-impact trace create a generic Running ban for current isolated shoulder pain', () => {
        const userContext = context({
            injuryPolicyTrace: {
                tissueSeverityApplied: false,
                regionMappingFamilies: ['lower_limb_impact'],
                clinicalEnvelopeSources: ['pain_or_injury'],
            },
        });
        const result = envelope(subjective({
            painFlag: true,
            clinicalEnvelopeSources: ['pain_or_injury'],
            painOrInjuryRegionFamilies: ['upper_limb_loading'],
        }), userContext);

        expect(result.safety.restrictedModalities).not.toContain('Running');
    });

    it('keeps standing injury-only days out of the current-symptom Mobility ceiling', () => {
        const result = envelope(subjective(), context({
            constraints: {
                ...context().constraints,
                impliedGuardrails: ['avoid_overhead_pressing'],
            },
        }));

        expect(result.safety.clinicalFlagActive).toBe(true);
        expect(result.safety.clinicalReason).toBe('Active injury restriction is in effect.');
        expect(result.plan.maxAllowableTier).toBe('Hard');
    });
});