import { describe, expect, it } from 'vitest';
import type { DailyReadiness, UserContext } from './models';
import type { SubjectiveBaseline } from './subjectiveBaseline';
import { buildSubjectiveDriftDecisionEvidence } from './simulation/subjectiveDriftEvidence';
import { compactSubjectiveDriftAudit } from './subjectiveDriftAudit';
import { REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS } from './rules';

const context: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: true, hasFreeWeights: true, hasTreadmill: true, hasIndoorBike: true, maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
};
const objective: DailyReadiness['objective'] = {
    total_steps: null, sleep_score: null, sleep_duration_min: null, rhr: null, rhr_7d_avg: null, rhr_delta: null,
    hrv_weekly_avg: null, hrv_last_night: null, hrv_delta: null, respiration: null, body_battery_wake: null,
    last_3_days_hard_sessions_count: 0, yesterday_training: null, today_training: null,
    sleep_score_delta_7d: null, rhr_delta_28d: null, hrv_delta_28d: null, sleep_score_delta_28d: null,
    hrv_stdev_28d: null, rhr_stdev_28d: null, sleep_score_stdev_28d: null,
};
const subjective: DailyReadiness['subjective'] = {
    readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, stress: 2, motivation: 8,
    timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
};
function baseline(gap: number): SubjectiveBaseline {
    const higherBetter = (longAvg: number) => ({ recentAvg: longAvg - gap, longAvg, variability: 1 });
    const lowerBetter = (longAvg: number) => ({ recentAvg: longAvg + gap, longAvg, variability: 1 });
    return {
        estimatorId: 'test-evidence-v1', historyThroughDateExclusive: '2026-08-16',
        recentRecordedDays: 7, longRecordedDays: 28, lastObservationDate: '2026-08-15',
        metrics: {
            readiness: higherBetter(8), sleepQuality: higherBetter(8), motivation: higherBetter(8),
            fatigue: lowerBetter(2), soreness: lowerBetter(2), mentalStress: lowerBetter(2),
        },
    };
}

describe('simulation buildSubjectiveDriftDecisionEvidence', () => {
    it('returns null rather than fabricated provenance when no baseline exists', () => {
        expect(buildSubjectiveDriftDecisionEvidence({ subjective, objective }, context)).toBeNull();
    });
    it('reconciles per-metric components and records the real counterfactual', () => {
        const e = buildSubjectiveDriftDecisionEvidence({ subjective, objective, subjectiveBaseline: baseline(0.25) }, context)!;
        expect(Object.values(e.perMetricContributions).reduce((a, b) => a + b, 0)).toBeCloseTo(e.contribution, 10);
        expect(e.contribution).toBeCloseTo(1.5, 10);
        expect(e.modeWithoutDrift).toBe('train');
        expect(e.modeWithDrift).toBe('modify');
        expect(e.decisionRelevant).toBe(true);
        expect(e.totalDecisionScoreWithDrift).toBeCloseTo(e.contribution, 10);
    });
    it('clamps a negative metric weight to zero through the canonical helper', () => {
        const e = buildSubjectiveDriftDecisionEvidence(
            { subjective, objective, subjectiveBaseline: baseline(0.5) }, context, undefined, undefined,
            { ...REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS, readiness: -100 },
        )!;
        expect(e.perMetricContributions.readiness).toBe(0);
        expect(e.contribution).toBeGreaterThanOrEqual(0);
        expect(Object.values(e.perMetricContributions).every(value => value >= 0)).toBe(true);
    });
    it('can observe non-zero drift that is not decision-relevant', () => {
        const e = buildSubjectiveDriftDecisionEvidence({ subjective, objective, subjectiveBaseline: baseline(0.05) }, context)!;
        expect(e.contribution).toBeGreaterThan(0);
        expect(e.modeWithoutDrift).toBe('train');
        expect(e.modeWithDrift).toBe('train');
        expect(e.decisionRelevant).toBe(false);
    });
});

describe('compactSubjectiveDriftAudit', () => {
    it('drops simulation-only counterfactual fields', () => {
        const evidence = buildSubjectiveDriftDecisionEvidence({ subjective, objective, subjectiveBaseline: baseline(0.25) }, context);
        const audit = compactSubjectiveDriftAudit(evidence);
        expect(audit).toMatchObject({ estimatorId: 'test-evidence-v1', historyThroughDateExclusive: '2026-08-16', recentRecordedDays: 7, longRecordedDays: 28, decisionRelevant: true });
        expect(audit).not.toHaveProperty('modeWithoutDrift');
        expect(audit).not.toHaveProperty('modeWithDrift');
        expect(audit).not.toHaveProperty('totalDecisionScoreWithDrift');
    });
});
