import { describe, expect, it } from 'vitest';
import type { SessionEntry } from '../sessions/models';
import type { StepComparison } from '../sessions/performedComparison';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { completeReads } from '../training-occurrence/workoutSourceDiagnostics.fixtures';
import {
  formatLocalTime,
  formatPerformed,
  formatRest,
  formatTarget,
  sourceBadgeLabel,
  stepStatus,
  workoutTitle,
} from './completedWorkoutFormat';

function baseWorkout(overrides: Partial<CompletedWorkoutView> = {}): CompletedWorkoutView {
  return {
    performedOccurrenceId: 'pto-1',
    sourceKeys: [],
    localDate: '2026-08-26',
    modality: 'strength',
    startedAt: '2026-08-26T06:52:00.000Z',
    endedAt: '2026-08-26T07:32:00.000Z',
    sourceBadge: { hasStructured: false, hasProvider: false, providers: [] },
    reconciliation: { state: 'single_source' },
    garminExerciseSetsAreDiagnosticOnly: false,
    sourceReads: completeReads,
    ...overrides,
  };
}

const dummyEntry: SessionEntry = {
  id: 'e1',
  executionId: 'exec-1',
  stepId: 's1',
  completedAt: '2026-08-26T07:00:00.000Z',
  createdAt: '2026-08-26T07:00:00.000Z',
  updatedAt: '2026-08-26T07:00:00.000Z',
  payload: { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 100 },
};

describe('sourceBadgeLabel', () => {
  it('formats structured-only, provider-only, combined, and unknown badges', () => {
    expect(sourceBadgeLabel(baseWorkout({ sourceBadge: { hasStructured: true, hasProvider: false, providers: [] } })))
      .toBe('Adaptive Coach');
    expect(sourceBadgeLabel(baseWorkout({ sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] } })))
      .toBe('Garmin');
    expect(sourceBadgeLabel(baseWorkout({ sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin', 'polar'] } })))
      .toBe('Adaptive Coach + Garmin, Polar');
    expect(sourceBadgeLabel(baseWorkout()))
      .toBe('Unknown source');
  });
});

describe('workoutTitle', () => {
  it('prefers structured title, then formatted garmin type, then Workout fallback', () => {
    expect(workoutTitle(baseWorkout({
      structured: {
        title: 'Heavy Squat Day',
        comparison: {
          definitionId: 'w1',
          revision: 1,
          title: 'Heavy Squat Day',
          totalPlannedSteps: 0,
          completedStepsCount: 0,
          missingRequiredStepsCount: 0,
          stepComparisons: [],
          summary: { totalReps: 0, totalTonnageKg: 0, totalDurationSeconds: 0, totalDistanceMeters: 0 },
        },
        steps: [],
        performedRest: 'recorded',
      },
      garmin: {
        activityId: 'a1',
        date: '2026-08-26',
        type: 'strength_training',
        durationMin: 40,
        trainingEffectAerobic: 2,
        trainingEffectAnaerobic: 1,
        averageHr: 120,
        activityTrainingLoad: 80,
        intensityTag: 'moderate',
      },
    }))).toBe('Heavy Squat Day');

    expect(workoutTitle(baseWorkout({
      garmin: {
        activityId: 'a1',
        date: '2026-08-26',
        type: 'trail_running_session',
        durationMin: 45,
        trainingEffectAerobic: 3,
        trainingEffectAnaerobic: 0,
        averageHr: 145,
        activityTrainingLoad: 110,
        intensityTag: 'moderate',
      },
    }))).toBe('trail running session');

    expect(workoutTitle(baseWorkout())).toBe('Workout');
  });
});

describe('formatLocalTime', () => {
  it('returns null for undefined and invalid ISO strings, and formats valid timestamps in Europe/Warsaw', () => {
    expect(formatLocalTime(undefined)).toBeNull();
    expect(formatLocalTime('not-an-iso-timestamp')).toBeNull();

    const summerIso = '2026-08-26T06:50:00.000Z';
    const expectedSummer = new Date(summerIso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Warsaw',
    });
    expect(formatLocalTime(summerIso)).toBe(expectedSummer);
    expect(formatLocalTime(summerIso)).toMatch(/0?8:50/);

    const winterIso = '2026-01-15T06:50:00.000Z';
    const expectedWinter = new Date(winterIso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Warsaw',
    });
    expect(formatLocalTime(winterIso)).toBe(expectedWinter);
    expect(formatLocalTime(winterIso)).toMatch(/0?7:50/);
  });
});

describe('formatTarget', () => {
  it('formats reps, seconds, meters, and sets-only targets with optional load, effort, and rest', () => {
    expect(formatTarget({
      sets: 5,
      reps: 5,
      load: { kind: 'mass', kg: 120 },
      effort: { rir: 2 },
      restSeconds: 180,
    })).toBe('5 × 5 @ 120 kg · RIR 2 · rest 3:00');

    expect(formatTarget({
      sets: 3,
      seconds: { min: 30, max: 45 },
      effort: { rpe: { min: 7, max: 8 } },
      restSeconds: { min: 60, max: 90 },
    })).toBe('3 × 0:30–0:45 · RPE 7–8 · rest 1:00–1:30');

    expect(formatTarget({
      sets: 4,
      meters: 40,
      load: { kind: 'bodyweight' },
      effort: { rir: { min: 1, max: 2 } },
    })).toBe('4 × 40 m @ Bodyweight · RIR 1–2');

    expect(formatTarget({ sets: 1 })).toBe('1 set');
    expect(formatTarget({ sets: 3, effort: {} })).toBe('3 sets');
  });
});

describe('formatPerformed', () => {
  it('formats all 7 SessionEntryPayload variants including jump details and intensity gauges', () => {
    expect(formatPerformed({
      kind: 'repetition',
      setIndex: 0,
      reps: 5,
      weightKg: 120,
      gauge: { scale: 'rir', value: 2 },
    })).toBe('5 × 120 kg · RIR 2');

    expect(formatPerformed({
      kind: 'repetition',
      setIndex: 0,
      reps: 6,
      weightKg: 0,
      jumpHeightCm: 48,
      gauge: { scale: 'velocity_loss', percent: 15 },
    })).toBe('6 reps · best 48 cm · VL 15%');

    expect(formatPerformed({
      kind: 'repetition',
      setIndex: 0,
      reps: 3,
      jumpDistanceMeters: 2.65,
      gauge: { scale: 'technical', met: true },
    })).toBe('3 reps · best 2.65 m · technique held');

    expect(formatPerformed({
      kind: 'repetition',
      setIndex: 0,
      reps: 3,
      gauge: { scale: 'technical', met: false },
    })).toBe('3 reps · technique broke down');

    expect(formatPerformed({
      kind: 'duration',
      seconds: 75,
      loadKg: 20,
      gauge: { scale: 'rpe_rts', value: 8 },
    })).toBe('1:15 @ 20 kg · RPE 8');

    expect(formatPerformed({
      kind: 'duration',
      seconds: 45,
    })).toBe('0:45');

    expect(formatPerformed({
      kind: 'distance',
      meters: 40,
      durationSeconds: 32,
      loadKg: 32,
      gauge: { scale: 'rpe_rts', value: 7.5 },
    })).toBe('40 m in 0:32 @ 32 kg · RPE 7.5');

    expect(formatPerformed({
      kind: 'distance',
      meters: 200,
    })).toBe('200 m');

    expect(formatPerformed({
      kind: 'sprint',
      meters: 30,
      splitSeconds: 4.1,
    })).toBe('30 m in 4.10 s');

    expect(formatPerformed({
      kind: 'jump_attempt',
      attemptIndex: 0,
      heightInches: 32,
    })).toBe('32 in');

    expect(formatPerformed({
      kind: 'jump_attempt',
      attemptIndex: 1,
      distanceMeters: 2.8,
    })).toBe('2.8 m');

    expect(formatPerformed({
      kind: 'jump_attempt',
      attemptIndex: 2,
    })).toBe('Attempt');

    expect(formatPerformed({ kind: 'checkoff', completed: true })).toBe('Done');
    expect(formatPerformed({ kind: 'checkoff', completed: false })).toBe('Not done');
    expect(formatPerformed({ kind: 'choice', choiceId: 'c1', optionId: 'o1' })).toBe('Choice');
  });
});

describe('formatRest', () => {
  it('omits session_ended rest and formats skipped/next_set_started with and without targets', () => {
    expect(formatRest({ actualSeconds: 1500, prescribedSeconds: 180, endReason: 'session_ended' })).toBeNull();
    expect(formatRest({ actualSeconds: 95, endReason: 'skipped' })).toBe('Rest skipped at 1:35');
    expect(formatRest({ actualSeconds: 95, prescribedSeconds: 180, endReason: 'skipped' }))
      .toBe('Rest skipped at 1:35 (target 3:00)');
    expect(formatRest({ actualSeconds: 180, endReason: 'next_set_started' })).toBe('Rest 3:00');
    expect(formatRest({ actualSeconds: 205, prescribedSeconds: 180, endReason: 'next_set_started' }))
      .toBe('Rest 3:25 (target 3:00)');
  });
});

describe('stepStatus', () => {
  function comparison(overrides: Partial<StepComparison>): StepComparison {
    return {
      stepId: 's1',
      blockId: 'b1',
      stepTitle: 'Squat',
      isOptional: false,
      targetSets: 5,
      completedSets: 0,
      isComplete: false,
      entries: [],
      ...overrides,
    };
  }

  it('formats undefined, complete, optional, and required step statuses', () => {
    expect(stepStatus(undefined)).toBeNull();
    expect(stepStatus(comparison({ isComplete: true, completedSets: 5 }))).toBe('✓ complete');
    expect(stepStatus(comparison({ isOptional: true, entries: [dummyEntry], completedSets: 1 }))).toBe('optional, partial');
    expect(stepStatus(comparison({ isOptional: true, entries: [] }))).toBe('optional, skipped');
    expect(stepStatus(comparison({ isOptional: false, entries: [dummyEntry], completedSets: 2 }))).toBe('✗ 2/5 sets');
    expect(stepStatus(comparison({ isOptional: false, entries: [] }))).toBe('✗ missed');
  });
});
