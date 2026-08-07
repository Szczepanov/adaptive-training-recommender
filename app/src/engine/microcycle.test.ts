import { describe, expect, it } from 'vitest';
import { updateMicrocycleProgress } from './microcycle.ts';

describe('updateMicrocycleProgress', () => {
  it('credits controlled field work toward surge repeatability', () => {
    const microcycle = { weekStartDate: '2026-08-03', objectives: [{ id: 'surges', key: 'surge_repeatability' as const, title: 'Surges', targetExposures: 1, completedExposures: 0, targetStimulus: { surgeRepeatability: 0.9 } }] };
    const updated = updateMicrocycleProgress(microcycle, { id: 'field-1', title: 'Field Field Maintenance', date: '2026-08-07', durationMin: 40, isCompleted: true });
    expect(updated.objectives.find((objective) => objective.key === 'surge_repeatability')?.completedExposures).toBe(1);
  });
});
