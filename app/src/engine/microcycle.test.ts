import { describe, expect, it } from 'vitest';
import { creditObjectivesFromStimulus, stimulusCoverage, updateMicrocycleProgress } from './microcycle.ts';
import type { MicrocycleState, WorkoutStimulusProfile } from './models.ts';

describe('updateMicrocycleProgress', () => {
  it('credits controlled field work toward surge repeatability', () => {
    const microcycle = { weekStartDate: '2026-08-03', objectives: [{ id: 'surges', key: 'surge_repeatability' as const, title: 'Surges', targetExposures: 1, completedExposures: 0, targetStimulus: { surgeRepeatability: 0.9 } }] };
    const updated = updateMicrocycleProgress(microcycle, { id: 'field-1', title: 'Field Field Maintenance', date: '2026-08-07', durationMin: 40, isCompleted: true });
    expect(updated.objectives.find((objective) => objective.key === 'surge_repeatability')?.completedExposures).toBe(1);
  });
});

describe('creditObjectivesFromStimulus (regression: the split-brain ledger bug)', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0,
  };
  const microcycleWith = (targetStimulus: Record<string, number>): MicrocycleState => ({
    weekStartDate: '2026-08-03',
    objectives: [{ id: 'obj', key: 'threshold_quality', title: 'Threshold Development', targetExposures: 1, completedExposures: 0, targetStimulus }],
  });

  it('credits an objective a pick genuinely covers, using the SAME vector that earned it the benefit score', () => {
    // This is exactly the failure mode from the incident: a template (e.g. Tempo Ride)
    // claims thresholdDevelopment: 0.8 to win ranking, but the old keyword matcher
    // credited objectives from `${modality} ${category}` ("Cycling Moderate Endurance")
    // -- a string containing neither "tempo" nor "threshold" -- so the objective it won
    // on could never actually resolve. Crediting from the real profile fixes that.
    const microcycle = microcycleWith({ thresholdDevelopment: 0.9 });
    const tempoRideStimulus: WorkoutStimulusProfile = { ...zeroStimulus, aerobicCapacity: 0.7, thresholdDevelopment: 0.8 };

    const updated = creditObjectivesFromStimulus(microcycle, tempoRideStimulus, 'Cycling');

    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('does NOT credit an objective a pick only touches with a token amount (false-positive guard)', () => {
    // The old keyword matcher would ALSO over-credit: "Cycling Pedalling Economy" (a
    // technical-skill drill) matched the same substring check as a real aerobic session
    // purely because both descriptions contain "cycling". A drill whose real aerobic
    // contribution is 0.1 must not satisfy a 0.8-target aerobic objective.
    const microcycle = microcycleWith({ aerobicCapacity: 0.8 });
    const technicalDrillStimulus: WorkoutStimulusProfile = { ...zeroStimulus, aerobicCapacity: 0.1, surgeRepeatability: 0.2 };

    const updated = creditObjectivesFromStimulus(microcycle, technicalDrillStimulus, 'Cycling');

    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('never exceeds targetExposures and leaves already-resolved objectives untouched', () => {
    const microcycle: MicrocycleState = {
      weekStartDate: '2026-08-03',
      objectives: [{ id: 'obj', key: 'threshold_quality', title: 'Threshold Development', targetExposures: 1, completedExposures: 1, targetStimulus: { thresholdDevelopment: 0.9 } }],
    };
    const updated = creditObjectivesFromStimulus(microcycle, { ...zeroStimulus, thresholdDevelopment: 1.0 }, 'Cycling');
    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('stimulusCoverage is 0 for an objective with no target axes, and is a target-weighted average of the stimulus (matching calculateStimulusBenefit\'s own target*stimulus convention)', () => {
    expect(stimulusCoverage(zeroStimulus, {})).toBe(0);

    // Single-axis objective: coverage collapses to that axis's raw stimulus value.
    expect(stimulusCoverage({ ...zeroStimulus, aerobicCapacity: 0.8 }, { aerobicCapacity: 0.8 })).toBeCloseTo(0.8, 5);
    expect(stimulusCoverage({ ...zeroStimulus, aerobicCapacity: 0.1 }, { aerobicCapacity: 0.8 })).toBeCloseTo(0.1, 5);

    // Multi-axis objective: a pick strong on the heavily-weighted axis and weak on the
    // lightly-weighted one scores close to its strong axis, not a flat 50/50 average --
    // i.e. the weighting actually reflects how much each axis matters to the objective.
    const mixedStimulus: WorkoutStimulusProfile = { ...zeroStimulus, thresholdDevelopment: 0.9, aerobicCapacity: 0.1 };
    const mixedTarget = { thresholdDevelopment: 0.9, aerobicCapacity: 0.1 }; // threshold dominates the weighting
    expect(stimulusCoverage(mixedStimulus, mixedTarget)).toBeGreaterThan(0.8);
  });
});

describe('surge_repeatability qualification', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0,
  };
  const cyclingSurgeObjective = (): MicrocycleState => ({
    weekStartDate: '2026-08-03',
    objectives: [{
      id: 'obj-surges', key: 'surge_repeatability', title: 'Surges', targetExposures: 1, completedExposures: 0,
      targetStimulus: { surgeRepeatability: 0.9, aerobicCapacity: 0.5 },
      qualification: { minimumStimulus: { surgeRepeatability: 0.6 }, allowedModalities: ['Cycling'] },
    }],
  });

  it('rejects a broad Cycling tempo stimulus that passes weighted coverage but misses the surge minimum', () => {
    const updated = creditObjectivesFromStimulus(
      cyclingSurgeObjective(), { ...zeroStimulus, aerobicCapacity: 0.9, surgeRepeatability: 0.5 }, 'Cycling',
    );
    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('rejects a high-surge Strength candidate for a cycling-scoped objective', () => {
    const updated = creditObjectivesFromStimulus(
      cyclingSurgeObjective(), { ...zeroStimulus, aerobicCapacity: 0.7, surgeRepeatability: 0.8 }, 'Strength',
    );
    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('credits a Cycling candidate that clears both the coverage and strict surge gates', () => {
    const updated = creditObjectivesFromStimulus(
      cyclingSurgeObjective(), { ...zeroStimulus, aerobicCapacity: 0.7, surgeRepeatability: 0.8 }, 'Cycling',
    );
    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('allows a qualifying non-Cycling candidate when the objective is intentionally unscoped', () => {
    const microcycle = cyclingSurgeObjective();
    microcycle.objectives[0].qualification = { minimumStimulus: { surgeRepeatability: 0.6 } };
    const updated = creditObjectivesFromStimulus(
      microcycle, { ...zeroStimulus, aerobicCapacity: 0.7, surgeRepeatability: 0.8 }, 'Field',
    );
    expect(updated.objectives[0].completedExposures).toBe(1);
  });

  it('preserves legacy weighted-average behavior for an objective without qualification', () => {
    const microcycle: MicrocycleState = {
      weekStartDate: '2026-08-03',
      objectives: [{ id: 'obj', key: 'surge_repeatability', title: 'Surges', targetExposures: 1, completedExposures: 0, targetStimulus: { surgeRepeatability: 0.9, aerobicCapacity: 0.5 } }],
    };
    const updated = creditObjectivesFromStimulus(
      microcycle, { ...zeroStimulus, aerobicCapacity: 0.9, surgeRepeatability: 0.5 }, 'Strength',
    );
    expect(updated.objectives[0].completedExposures).toBe(1);
  });
});
