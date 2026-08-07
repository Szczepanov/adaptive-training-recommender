import { describe, expect, it } from 'vitest';
import { buildMicrocycleState, creditObjectivesFromStimulus, stimulusCoverage, updateMicrocycleProgress } from './microcycle.ts';
import type { MicrocycleState, UserEvent, WorkoutStimulusProfile } from './models.ts';
import type { CompletedExposure } from './trainingHistory.ts';

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

describe('structured completed-history credit', () => {
  it('uses structured evidence rather than a loose activity title when rebuilding a microcycle', () => {
    const phase = {
      phaseName: 'Specificity' as const,
      targetDemandVector: { aerobicEndurance: 0.6, thresholdPower: 0.6, vo2MaxPower: 0.8, repeatedSurges: 0.9, sprintPower: 0.2, fatigueResistance: 0.6, neuromuscular: 0.2 },
      volumeScale: 1,
      intensityScale: 1,
      taperActive: false,
    };
    const event: UserEvent = {
      id: 'criterion', title: 'Criterium', date: '2026-09-10', priority: 'A', lifecycle: 'scheduled', category: 'cycling_event',
      demandProfile: phase.targetDemandVector,
    };
    const exposure: CompletedExposure = {
      date: '2026-08-06',
      costProfile: { systemic: 0.5, cardiovascular: 0.6, lowerBody: 0.4, upperBody: 0, impactTissue: 0.1, neuromuscular: 0.3 },
      // This title would have matched the legacy keyword path, but its supplied profile
      // does not meet the surge objective's required minimum of 0.6.
      trainingRecordLike: { type: 'Cycling Race-Specific Endurance', duration_min: 60, training_effect: 0, intensity_tag: '' },
      modality: 'Cycling',
      stimulusProfile: { aerobicCapacity: 0.7, thresholdDevelopment: 0.5, surgeRepeatability: 0.5, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0 },
    };

    const microcycle = buildMicrocycleState(phase, '2026-08-03', [exposure], event);

    expect(microcycle.objectives.find(objective => objective.key === 'surge_repeatability')?.completedExposures).toBe(0);
  });
});

describe('protected race-specific cycling objective', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0,
  };
  const objective: MicrocycleState = {
    weekStartDate: '2026-08-03',
    objectives: [{
      id: 'race-specific', key: 'race_specific_endurance', title: 'Cycling Race-Specific Endurance', targetExposures: 1, completedExposures: 0,
      targetStimulus: { aerobicCapacity: 0.6, surgeRepeatability: 0.6 },
      qualification: { minimumStimulus: { aerobicCapacity: 0.6 }, allowedModalities: ['Cycling'], allowedCategories: ['Race-Specific Endurance'] },
    }],
  };

  it('cannot be completed by a broadly similar cycling interval outside the required category', () => {
    const updated = creditObjectivesFromStimulus(
      objective, { ...zeroStimulus, aerobicCapacity: 0.7, surgeRepeatability: 1 }, 'Cycling', 'Hard Endurance',
    );
    expect(updated.objectives[0].completedExposures).toBe(0);
  });

  it('credits only a cycling Race-Specific Endurance session that clears the stimulus gate', () => {
    const updated = creditObjectivesFromStimulus(
      objective, { ...zeroStimulus, aerobicCapacity: 0.7, surgeRepeatability: 0.6 }, 'Cycling', 'Race-Specific Endurance',
    );
    expect(updated.objectives[0].completedExposures).toBe(1);
  });
});

describe('threshold qualification', () => {
  const zeroStimulus: WorkoutStimulusProfile = {
    aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0,
  };
  const cyclingThreshold: MicrocycleState = {
    weekStartDate: '2026-08-03',
    objectives: [{
      id: 'threshold', key: 'threshold_quality', title: 'Threshold Development', targetExposures: 1, completedExposures: 0,
      targetStimulus: { thresholdDevelopment: 0.9 },
      qualification: { minimumStimulus: { thresholdDevelopment: 0.6 }, allowedModalities: ['Cycling'] },
    }],
  };

  it('requires both meaningful threshold stimulus and the event-relevant modality', () => {
    const nonCycling = creditObjectivesFromStimulus(cyclingThreshold, { ...zeroStimulus, thresholdDevelopment: 0.9 }, 'Strength');
    const tooEasy = creditObjectivesFromStimulus(cyclingThreshold, { ...zeroStimulus, thresholdDevelopment: 0.5 }, 'Cycling');
    const qualifying = creditObjectivesFromStimulus(cyclingThreshold, { ...zeroStimulus, thresholdDevelopment: 0.7 }, 'Cycling');

    expect(nonCycling.objectives[0].completedExposures).toBe(0);
    expect(tooEasy.objectives[0].completedExposures).toBe(0);
    expect(qualifying.objectives[0].completedExposures).toBe(1);
  });
});
