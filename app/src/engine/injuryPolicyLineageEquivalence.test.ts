import { describe, expect, it } from 'vitest';
import type { BodyRegion, DailyReadiness, InjuryConstraint, UserContext } from './models';
import { resolveEffectiveInjuryConstraints, resolveInjuryPolicy, resolveInjuryRestrictions } from './injuryPolicy';
import { evaluateEnvelopes, evaluateTraining } from './rules';

const TODAY = '2026-09-01';
const REGIONS: readonly BodyRegion[] = [
    'knee', 'achilles', 'ankle', 'calf', 'hamstring', 'quadriceps',
    'adductor_groin', 'hip', 'lower_back', 'shoulder', 'elbow', 'wrist',
];

const readiness: DailyReadiness = {
    subjective: {
        readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
        timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
    },
    objective: {
        total_steps: null, sleep_score: null, sleep_duration_min: null, rhr: null, rhr_7d_avg: null,
        rhr_delta: null, hrv_weekly_avg: null, hrv_last_night: null, hrv_delta: null, respiration: null,
        body_battery_wake: null, last_3_days_hard_sessions_count: 0, yesterday_training: null,
        today_training: null, sleep_score_delta_7d: null, rhr_delta_28d: null, hrv_delta_28d: null,
        sleep_score_delta_28d: null, hrv_stdev_28d: null, rhr_stdev_28d: null, sleep_score_stdev_28d: null,
    },
};

function contextFromPolicy(policy: ReturnType<typeof resolveInjuryPolicy>): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: true, hasIndoorBike: true,
            ...policy.restrictions, maxTimeMinutes: 180,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
        injuryPolicyTrace: policy.trace,
    };
}

function decisionSurface(rec: ReturnType<typeof evaluateTraining>) {
    const surface = { ...rec };
    delete surface.knowledgeRefs;
    return surface;
}

describe('injury-policy lineage equivalence', () => {
    it.each(REGIONS)('keeps resolver outputs exact for every active %s severity', region => {
        (['monitor', 'limit', 'exclude'] as const).forEach(severity => {
            const injuries: InjuryConstraint[] = [{ region, severity }];
            const traced = resolveInjuryPolicy(injuries, undefined, TODAY);
            expect(traced.effectiveInjuries).toEqual(resolveEffectiveInjuryConstraints(injuries, undefined, TODAY));
            expect(traced.restrictions).toEqual(resolveInjuryRestrictions(traced.effectiveInjuries, TODAY));
        });
    });

    it('keeps expiry, explicit modality pass-through, and tissue tightening outputs exact', () => {
        const injuries: InjuryConstraint[] = [
            { region: 'knee', severity: 'exclude', reviewBy: '2026-08-31' },
            { region: 'shoulder', severity: 'monitor', restrictedModalities: ['Cycling'] },
        ];
        const responses = {
            knee: { region: 'knee' as const, morningState: 'moderate' as const },
            shoulder: { region: 'shoulder' as const, morningState: 'severe' as const },
        };
        const traced = resolveInjuryPolicy(injuries, responses, TODAY);
        const effective = resolveEffectiveInjuryConstraints(injuries, responses, TODAY);
        expect(traced.effectiveInjuries).toEqual(effective);
        expect(traced.restrictions).toEqual(resolveInjuryRestrictions(effective, TODAY));
    });

    it('changes only knowledge lineage, never envelope or selected recommendation', () => {
        const policy = resolveInjuryPolicy([{ region: 'knee', severity: 'exclude' }], undefined, TODAY);
        const tracedContext = contextFromPolicy(policy);
        const untracedContext = { ...tracedContext, injuryPolicyTrace: undefined };

        expect(evaluateEnvelopes(readiness, tracedContext)).toEqual(evaluateEnvelopes(readiness, untracedContext));
        expect(decisionSurface(evaluateTraining(readiness, tracedContext, TODAY)))
            .toEqual(decisionSurface(evaluateTraining(readiness, untracedContext, TODAY)));
    });
});
