import { describe, expect, it } from 'vitest';
import { isAdverseCoreSignalEvidence } from './healthAnomaly';
import type { CoreSignalEvidence, HealthCoreSignal } from './healthAnomalyModels';

function evidence(
    signal: HealthCoreSignal,
    status: CoreSignalEvidence['status'],
    direction: CoreSignalEvidence['direction'],
): CoreSignalEvidence {
    return {
        signal,
        status,
        direction,
        currentValue: 1,
        baselineValue: 1,
        scaleValue: 1,
        standardizedDeviation: status === 'normal' ? 0 : 2,
        estimator: 'mean-stdev-28d',
        baselineVersion: 5,
    };
}

describe('isAdverseCoreSignalEvidence', () => {
    it('treats elevated RHR and respiration plus low HRV as adverse core physiology', () => {
        expect(isAdverseCoreSignalEvidence(evidence('rhr', 'moderate_anomaly', 'high'))).toBe(true);
        expect(isAdverseCoreSignalEvidence(evidence('respiration', 'strong_anomaly', 'high'))).toBe(true);
        expect(isAdverseCoreSignalEvidence(evidence('hrv', 'moderate_anomaly', 'low'))).toBe(true);
    });

    it('does not promote high HRV or normal signals into an adverse illness vote', () => {
        expect(isAdverseCoreSignalEvidence(evidence('hrv', 'strong_anomaly', 'two_sided'))).toBe(false);
        expect(isAdverseCoreSignalEvidence(evidence('rhr', 'normal', null))).toBe(false);
        expect(isAdverseCoreSignalEvidence(evidence('respiration', 'normal', null))).toBe(false);
    });
});
