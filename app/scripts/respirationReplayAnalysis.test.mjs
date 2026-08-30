import { describe, expect, it } from 'vitest';
import {
    assessLabelledFalsePositives,
    buildRespirationThresholdSweep,
    classifyRespirationThreshold,
    RESPIRATION_ELEVATION_CANDIDATES,
    summarizeCounterfactualRows,
} from './respirationReplayAnalysis.mjs';

function row(overrides = {}) {
    return {
        date: '2026-08-01',
        respirationDelta7d: 0.5,
        respirationDelta28d: 1,
        productionMode: 'train',
        candidateMode: 'modify',
        respirationAddedStrain: 1,
        productionMetricStrain: 0,
        modeFlip: true,
        actionableMorning: true,
        todayTrainingPresent: false,
        ...overrides,
    };
}

describe('respiration replay analysis', () => {
    it('uses the actionable-morning denominator independently from aggregate rows', () => {
        const rows = [
            row(),
            row({ date: '2026-08-02', actionableMorning: false, todayTrainingPresent: true }),
            row({ date: '2026-08-03', candidateMode: 'train', modeFlip: false }),
        ];
        expect(summarizeCounterfactualRows(rows)).toMatchObject({ evaluatedDays: 3, modeFlipCount: 2 });
        expect(summarizeCounterfactualRows(rows.filter(value => value.actionableMorning))).toMatchObject({
            evaluatedDays: 2,
            modeFlipCount: 1,
            modeFlipRate: 0.5,
        });
    });

    it('classifies rising and resolving deltas without treating absolute respiration as a threshold', () => {
        const e2 = RESPIRATION_ELEVATION_CANDIDATES.find(candidate => candidate.id === 'E2');
        expect(classifyRespirationThreshold(row({ respirationDelta7d: 0.5, respirationDelta28d: 1 }), e2)).toBe('elevated');
        expect(classifyRespirationThreshold(row({ respiration: 15, respirationDelta7d: -0.1, respirationDelta28d: 1.2 }), e2)).toBe('resolving');
        expect(classifyRespirationThreshold(row({ respiration: 16, respirationDelta7d: 0.2, respirationDelta28d: 0.4 }), e2)).toBe('normal');
    });

    it('reports threshold matches, conservative overlap, readiness-strain overlap and resolving tails', () => {
        const sweep = buildRespirationThresholdSweep([
            row(),
            row({ date: '2026-08-02', productionMode: 'modify', candidateMode: 'modify', modeFlip: false, productionMetricStrain: 1 }),
            row({ date: '2026-08-03', respirationDelta7d: -0.1, respirationDelta28d: 1.2 }),
        ]);
        expect(sweep.find(candidate => candidate.id === 'E2')).toMatchObject({
            matchedDays: 2,
            actionableMatchedDays: 2,
            actionableDaysAlreadyConservative: 1,
            persistentTwoNightDays: 1,
            existingReadinessStrainOverlapDays: 1,
            noExistingReadinessStrainOverlapDays: 1,
            resolvingTailDays: 1,
        });
    });

    it('does not expose aggregate readiness strain under physiological corroboration names', () => {
        const result = buildRespirationThresholdSweep([row({ productionMetricStrain: 1 })])
            .find(candidate => candidate.id === 'E2');
        expect(result).not.toHaveProperty('corroboratedByExistingMetricStrainDays');
        expect(result).not.toHaveProperty('isolatedFromExistingMetricStrainDays');
        expect(result).toMatchObject({ existingReadinessStrainOverlapDays: 1 });
    });

    it('keeps false-positive rate null without labels and computes only labelled healthy days', () => {
        const rows = [row(), row({ date: '2026-08-02', modeFlip: false, candidateMode: 'train' })];
        expect(assessLabelledFalsePositives(rows, null).rate).toBeNull();
        expect(assessLabelledFalsePositives(rows, {
            '2026-08-01': { healthy: true, symptomsReported: false },
            '2026-08-02': { healthy: true, symptomsReported: false },
        })).toMatchObject({ count: 1, rate: 0.5, labelledHealthyActionableDays: 2 });
    });
});
