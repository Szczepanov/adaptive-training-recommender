import { describe, expect, it } from 'vitest';
import {
    evaluatePhysiologicalAnomaly,
    readHealthAnomalyPolicy,
    resolveHealthAnomalyPolicy,
} from './healthAnomaly';
import type { HealthAnomalyInput, HealthAnomalyPolicy } from './healthAnomalyModels';

const EMPTY_INPUT: HealthAnomalyInput = {
    date: '2026-08-21',
    timezone: 'Europe/Warsaw',
    recoverySnapshot: null,
    subjectiveCheckin: null,
    coreSignals: [],
    supportingSignals: [],
    dataQuality: [],
    last3DaysHardSessionsCount: 0,
    persistence: {
        previousState: null,
        previousEpisodeId: null,
        previousEpisodeDay: null,
        previousAssessmentDate: null,
        unexplainedPersistenceDays: 0,
    },
};

describe('resolveHealthAnomalyPolicy', () => {
    it.each<HealthAnomalyPolicy>(['off', 'shadow-v1', 'visible-v1', 'tighten-v1'])(
        'accepts the exact configured value %s',
        policy => {
            expect(resolveHealthAnomalyPolicy(policy)).toBe(policy);
        },
    );

    it.each([
        undefined,
        null,
        '',
        'shadow',
        'SHADOW-V1',
        ' visible-v1 ',
        1,
        true,
        {},
    ])('degrades missing or invalid value %p to off', value => {
        expect(resolveHealthAnomalyPolicy(value)).toBe('off');
    });

    it('degrades a configuration read failure to off', () => {
        expect(readHealthAnomalyPolicy(() => {
            throw new Error('remote config unavailable');
        })).toBe('off');
    });

    it('does not invent a visible mode when the configuration reader returns nothing', () => {
        expect(readHealthAnomalyPolicy(() => undefined)).toBe('off');
    });
});

describe('evaluatePhysiologicalAnomaly rollout boundary', () => {
    it('is inert by default and under explicit off', () => {
        expect(evaluatePhysiologicalAnomaly(EMPTY_INPUT)).toBeNull();
        expect(evaluatePhysiologicalAnomaly(EMPTY_INPUT, 'off')).toBeNull();
    });

    it('computes an evidence-only assessment only after an explicit non-off policy is supplied', () => {
        const shadow = evaluatePhysiologicalAnomaly(EMPTY_INPUT, 'shadow-v1');
        expect(shadow).not.toBeNull();
        expect(shadow).toMatchObject({
            state: 'insufficient_evidence',
            evidenceLevel: 'none',
            episodeId: null,
            episodeDay: null,
            calibrationStage: 'insufficient_evidence',
            anomalySeverity: 'none',
            evidenceQuality: 'insufficient',
            mode: 'shadow-v1',
        });
        expect(shadow?.rationale.cautions).toContain('INSUFFICIENT_WEARABLE_BASELINE_OR_SIGNALS');
        expect(shadow?.rationale.cautions).toContain('NOT_A_DIAGNOSIS');
        expect(shadow?.coreSignals.every(signal => signal.status === 'unavailable')).toBe(true);
    });

    it('returns normal only when at least one core signal is measured and non-adverse', () => {
        const measuredNormalInput: HealthAnomalyInput = {
            ...EMPTY_INPUT,
            coreSignals: [
                {
                    signal: 'rhr',
                    status: 'normal',
                    direction: null,
                    currentValue: 50,
                    baselineValue: 50,
                    scaleValue: 2,
                    standardizedDeviation: 0,
                    estimator: 'mean-stdev-28d',
                    baselineVersion: 5,
                },
            ],
        };
        const result = evaluatePhysiologicalAnomaly(measuredNormalInput, 'shadow-v1');
        expect(result).toMatchObject({
            state: 'normal',
            evidenceLevel: 'none',
            episodeId: null,
            episodeDay: null,
            anomalySeverity: 'none',
        });
    });
});
