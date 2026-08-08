import { describe, expect, it } from 'vitest';
import type { MicrocycleState } from './models';
import { getUnresolvedObjectives } from './microcycle';
import { applyProjectedObjectiveCredits } from './planner';

describe('projected objective credit baseline normalization', () => {
    it('keeps a fresh completed baseline separate across multiple projected allocations', () => {
        const base: MicrocycleState = {
            windowStartDate: '2026-08-03',
            objectives: [{
                id: 'obj-z2-fresh',
                key: 'zone2_aerobic',
                title: 'Aerobic Base',
                requiredCredit: 1,
                targetExposures: 1,
                completedExposures: 0,
                targetStimulus: { aerobicEndurance: 0.8 },
            }],
        };

        const first = applyProjectedObjectiveCredits(base, [
            { objectiveId: 'obj-z2-fresh', earnedCredit: 0.4 },
        ]).microcycle;

        expect(first.objectives[0].completedCredit).toBe(0);
        expect(first.objectives[0].projectedCredit).toBe(0.4);
        expect(getUnresolvedObjectives(first)).toHaveLength(1);
        expect(getUnresolvedObjectives(first, true)).toHaveLength(1);

        const second = applyProjectedObjectiveCredits(first, [
            { objectiveId: 'obj-z2-fresh', earnedCredit: 0.6 },
        ]).microcycle;

        expect(second.objectives[0].completedCredit).toBe(0);
        expect(second.objectives[0].projectedCredit).toBe(1);
        expect(getUnresolvedObjectives(second)).toHaveLength(1);
        expect(getUnresolvedObjectives(second, true)).toHaveLength(0);
    });
});
