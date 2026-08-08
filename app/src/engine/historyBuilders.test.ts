import { describe, expect, it } from 'vitest';
import { buildFatigueStateFromHistory } from './fatigue';
import { buildMicrocycleState } from './microcycle';
import type { CompletedExposure } from './microcycleHistory';
import type { PhaseWeights } from './periodization';

const phase: PhaseWeights = {
    phaseName: 'Build', volumeScale: 1.1, intensityScale: 0.9, taperActive: false,
    targetDemandVector: { aerobicEndurance: 0.8, thresholdPower: 0.8, vo2MaxPower: 0.3, repeatedSurges: 0.3, sprintPower: 0.2, fatigueResistance: 0.6, neuromuscular: 0.3 },
};

const thresholdExposure: CompletedExposure = {
    date: '2026-08-04',
    costProfile: { systemic: 0.7, cardiovascular: 0.8, lowerBody: 0.7, upperBody: 0, impactTissue: 0.3, neuromuscular: 0.4 },
    trainingRecordLike: { type: 'Cycling Threshold', duration_min: 45, training_effect: 3, intensity_tag: 'hard' },
};

describe('history-seeded training state', () => {
    it('credits completed history into the current microcycle objectives', () => {
        const state = buildMicrocycleState(phase, '2026-08-01', [thresholdExposure], null);
        expect(state.objectives.find(objective => objective.key === 'threshold_quality')?.completedExposures).toBe(1);
    });

    it('retains and decays external history before combining it with today internal strain', () => {
        const fatigue = buildFatigueStateFromHistory([thresholdExposure], {
            systemic: 0.1, cardiovascular: 0.1, lowerBody: 0.1, upperBody: 0.1, impactTissue: 0.1, neuromuscular: 0.1,
        }, '2026-08-05');
        expect(fatigue.externalLoadFatigue.lowerBody).toBeGreaterThan(0.1);
        expect(fatigue.combinedFatigue.lowerBody).toBe(fatigue.externalLoadFatigue.lowerBody);
        expect(fatigue.rawExternalLoadFatigue).toBeDefined();
    });

    it('handles out-of-order history input deterministically without mis-decaying or throwing', () => {
        const earlyExp: CompletedExposure = { ...thresholdExposure, date: '2026-08-02' };
        const lateExp: CompletedExposure = { ...thresholdExposure, date: '2026-08-04' };
        const outOfOrderHistory = [lateExp, earlyExp];

        const fatigue = buildFatigueStateFromHistory(outOfOrderHistory, {
            systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
        }, '2026-08-05');

        expect(fatigue.lastUpdatedDate).toBe('2026-08-05');
        expect(fatigue.externalLoadFatigue.systemic).toBeGreaterThan(0);
    });
});
