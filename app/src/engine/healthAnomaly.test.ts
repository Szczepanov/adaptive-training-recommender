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

describe('evaluatePhysiologicalAnomaly HA0 scaffolding', () => {
    it('is inert by default', () => {
        expect(evaluatePhysiologicalAnomaly(EMPTY_INPUT)).toBeNull();
    });

    it('remains inert for every explicit policy until the HA3 evaluator lands', () => {
        for (const policy of ['off', 'shadow-v1', 'visible-v1', 'tighten-v1'] as const) {
            expect(evaluatePhysiologicalAnomaly(EMPTY_INPUT, policy)).toBeNull();
        }
    });
});
