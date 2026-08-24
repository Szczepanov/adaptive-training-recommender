import { describe, expect, it } from 'vitest';
import { computePlanDistance } from './planDistance';
import type { ScenarioDecisionTrace } from './analyze';
import type { SessionTemplate } from '../models';

const ZERO_COST = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
const ZERO_STIMULUS = { aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0, sprintPower: 0, fatigueResistance: 0, maxStrength: 0, hypertrophy: 0 };

function makeMockTrace(
    date: string,
    mode: 'train' | 'modify' | 'recover',
    templateId: string,
    systemicCost: number,
    category: SessionTemplate['category'] = 'Hard Endurance'
): ScenarioDecisionTrace {
    return {
        weekIndex: 0,
        date,
        readinessTier: mode,
        mode,
        selected: {
            templateId,
            category,
            modality: 'Cycling',
            projectedCost: { systemic: systemicCost, cardiovascular: systemicCost, lowerBody: systemicCost, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        },
        fatigue: {
            rawExternalLoad: ZERO_COST,
            clampedExternalLoad: ZERO_COST,
            internalResponse: ZERO_COST,
            combined: ZERO_COST,
        },
        activeObjectives: [],
        contributorObjectiveChanges: { added: [], dropped: [] },
        fixedActivity: { count: 0, cost: ZERO_COST, stimulus: ZERO_STIMULUS },
        rejectionCounts: {},
        utility: { top: 1, runnerUp: null, bestBenefitTemplateId: null, bestBenefitScore: null, selectedBenefitScore: null, selectedVsBestBenefitGap: null },
    };
}

describe('computePlanDistance', () => {
    it('returns zero distance for identical plan traces', () => {
        const tracesA = [
            makeMockTrace('2026-08-01', 'train', 'end_vo2_01', 0.8),
            makeMockTrace('2026-08-02', 'modify', 'end_z2_01', 0.3),
            makeMockTrace('2026-08-03', 'recover', 'rec_total_rest', 0.0, 'Rest'),
        ];
        const distance = computePlanDistance(tracesA, tracesA);
        expect(distance.modeHammingDistance).toBe(0);
        expect(distance.sessionJaccardDistance).toBe(0);
        expect(distance.sessionEditDistance).toBe(0);
        expect(distance.systemicCostL1Distance).toBe(0);
        expect(distance.restPlacementDistance).toBe(0);
        expect(distance.compositeDistance).toBe(0);
    });

    it('detects mode shifts and template substitutions', () => {
        const tracesA = [
            makeMockTrace('2026-08-01', 'train', 'end_vo2_01', 0.8),
            makeMockTrace('2026-08-02', 'train', 'end_threshold_01', 0.7),
        ];
        const tracesB = [
            makeMockTrace('2026-08-01', 'modify', 'end_z2_01', 0.3),
            makeMockTrace('2026-08-02', 'train', 'end_threshold_01', 0.7),
        ];
        const distance = computePlanDistance(tracesA, tracesB);
        expect(distance.modeHammingDistance).toBe(0.5); // 1 out of 2 days differ
        expect(distance.sessionEditDistance).toBe(0.5); // 1 out of 2 positions differ
        expect(distance.systemicCostL1Distance).toBe(0.25); // |0.8 - 0.3| / 2 = 0.25
        expect(distance.compositeDistance).toBeGreaterThan(0);
        expect(distance.compositeDistance).toBeLessThan(1);
    });

    it('detects rest day displacement', () => {
        const tracesA = [
            makeMockTrace('2026-08-01', 'recover', 'rec_total_rest', 0.0, 'Rest'),
            makeMockTrace('2026-08-02', 'train', 'end_vo2_01', 0.8),
        ];
        const tracesB = [
            makeMockTrace('2026-08-01', 'train', 'end_vo2_01', 0.8),
            makeMockTrace('2026-08-02', 'recover', 'rec_total_rest', 0.0, 'Rest'),
        ];
        const distance = computePlanDistance(tracesA, tracesB);
        expect(distance.restPlacementDistance).toBe(1.0); // rest days swapped
        expect(distance.compositeDistance).toBeGreaterThan(0.3);
    });
});
