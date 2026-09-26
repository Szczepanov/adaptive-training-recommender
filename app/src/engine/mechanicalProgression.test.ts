import { describe, expect, it } from 'vitest';
import {
  evaluateMechanicalStageProgression,
  type CheckinRecord,
  type MechanicalExposureRecord,
} from './mechanicalProgression.ts';
import type { DailySubjectiveCheckin } from './models.ts';

const checkin = (overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin => ({
  userId: 'athlete',
  date: '2026-09-20',
  readiness: 8,
  soreness: 2,
  fatigue: 2,
  mentalStress: 2,
  motivation: 8,
  sleepQuality: 8,
  painOrInjury: false,
  illnessSymptoms: false,
  unusuallyLimitedTime: false,
  alreadyTrainedToday: false,
  availability: {
    timeAvailableMin: 60,
    preferredModalityToday: 'Running',
    indoorOnly: false,
  },
  notes: null,
  submittedAt: '2026-09-20T07:00:00.000Z',
  createdAt: '2026-09-20T07:00:00.000Z',
  updatedAt: '2026-09-20T07:00:00.000Z',
  dataQuality: {
    isComplete: true,
    missingFields: [],
  },
  schemaVersion: 1,
  ...overrides,
});

describe('evaluateMechanicalStageProgression', () => {
  it('blocks mechanical exposure when avoid_high_impact guardrail is active', () => {
    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
      checkinHistory: [{ date: '2026-09-18', checkin: checkin() }],
      guardrails: new Set(['avoid_high_impact']),
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.status).toBe('blocked');
    expect(verdict.withheldReason).toContain('avoid_high_impact');
    expect(verdict.eligibleWorkoutIds).toEqual([]);
  });

  it('blocks exposure when acute pain or knee swelling is present', () => {
    const swellingVerdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
      checkinHistory: [],
      hasKneeSwelling: true,
    });
    expect(swellingVerdict.eligible).toBe(false);
    expect(swellingVerdict.status).toBe('blocked');

    const painVerdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
      checkinHistory: [{ date: '2026-09-20', checkin: checkin({ painOrInjury: true }) }],
    });
    expect(painVerdict.eligible).toBe(false);
    expect(painVerdict.status).toBe('blocked');

    const illnessVerdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
      checkinHistory: [{ date: '2026-09-20', checkin: checkin({ illnessSymptoms: true }) }],
    });
    expect(illnessVerdict.eligible).toBe(false);
    expect(illnessVerdict.status).toBe('withheld');
    expect(illnessVerdict.withheldReason).toContain('illness symptoms');
  });

  it('withholds exposure on consecutive days to protect connective tissue remodeling', () => {
    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-19', workoutId: 'running_walk_run_01', stage: 1 }],
      checkinHistory: [{ date: '2026-09-20', checkin: checkin() }],
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.status).toBe('withheld');
    expect(verdict.withheldReason).toContain('consecutive days');
  });

  it('enforces re-entry at Stage 1 when history is empty or gap is >= 14 days', () => {
    const emptyVerdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [],
      checkinHistory: [],
      targetStage: 3,
    });
    expect(emptyVerdict.eligible).toBe(true);
    expect(emptyVerdict.stage).toBe(1);
    expect(emptyVerdict.tissueResponse.notes).toContain('Re-entry dose: no exposure in past 14 days');
    expect(emptyVerdict.eligibleWorkoutIds).toContain('running_walk_run_01');
    expect(emptyVerdict.eligibleWorkoutIds).not.toContain('field_acceleration_braking_01');

    const gapVerdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-01', workoutId: 'field_acceleration_braking_01', stage: 3 }],
      checkinHistory: [],
      targetStage: 3,
    });
    expect(gapVerdict.stage).toBe(1);
  });

  it('progresses from Stage 1 to Stage 2 when prior exposure was tolerated with normal tissue response', () => {
    const exposures: MechanicalExposureRecord[] = [
      { date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 },
    ];
    const checkins: CheckinRecord[] = [
      {
        date: '2026-09-18',
        checkin: checkin({
          tissueResponses: {
            knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' },
            achilles: { region: 'achilles', morningState: 'normal', nextMorningReaction: 'normal' },
          },
        }),
      },
    ];

    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: exposures,
      checkinHistory: checkins,
      targetStage: 2,
    });

    expect(verdict.eligible).toBe(true);
    expect(verdict.stage).toBe(2);
    expect(verdict.status).toBe('eligible');
    expect(verdict.tissueResponse.verdict).toBe('normal');
    expect(verdict.eligibleWorkoutIds).toContain('running_easy_continuous_01');
    expect(verdict.eligibleWorkoutIds).toContain('strength_reactive_power_01');
  });

  it('fails closed and halts progression when follow-up tissue response evidence is missing', () => {
    const exposures: MechanicalExposureRecord[] = [
      { date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 },
    ];
    // No check-in recorded for 2026-09-18 or 2026-09-20
    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: exposures,
      checkinHistory: [],
      targetStage: 2,
    });

    expect(verdict.eligible).toBe(true);
    expect(verdict.stage).toBe(1); // Held at Stage 1, not progressed to 2
    expect(verdict.tissueResponse.verdict).toBe('missing');
  });

  it('regresses stage when mild lower-body symptoms are reported', () => {
    const exposures: MechanicalExposureRecord[] = [
      { date: '2026-09-17', workoutId: 'strength_reactive_power_01', stage: 2 },
    ];
    const checkins: CheckinRecord[] = [
      {
        date: '2026-09-18',
        checkin: checkin({
          tissueResponses: {
            achilles: { region: 'achilles', morningState: 'mild', nextMorningReaction: 'mild' },
          },
        }),
      },
    ];

    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: exposures,
      checkinHistory: checkins,
      targetStage: 2,
    });

    expect(verdict.eligible).toBe(true);
    expect(verdict.stage).toBe(1); // Regressed from 2 to 1
    expect(verdict.status).toBe('regressed');
    expect(verdict.tissueResponse.affectedRegions).toContain('achilles');
  });

  it('withholds exposure completely when moderate or severe symptoms are reported', () => {
    const exposures: MechanicalExposureRecord[] = [
      { date: '2026-09-17', workoutId: 'field_acceleration_braking_01', stage: 3 },
    ];
    const checkins: CheckinRecord[] = [
      {
        date: '2026-09-18',
        checkin: checkin({
          tissueResponses: {
            knee: { region: 'knee', morningState: 'moderate', nextMorningReaction: 'moderate' },
          },
        }),
      },
    ];

    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: exposures,
      checkinHistory: checkins,
      targetStage: 3,
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.status).toBe('withheld');
    expect(verdict.withheldReason).toContain('moderate or severe');
  });

  it('limits progression to at most +1 stage even if higher stage is requested', () => {
    const exposures: MechanicalExposureRecord[] = [
      { date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 },
    ];
    const checkins: CheckinRecord[] = [
      {
        date: '2026-09-18',
        checkin: checkin({
          tissueResponses: {
            knee: { region: 'knee', morningState: 'normal' },
          },
        }),
      },
    ];

    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: exposures,
      checkinHistory: checkins,
      targetStage: 4, // Requested Stage 4 from Stage 1
    });

    expect(verdict.stage).toBe(2); // Capped at Stage 1 + 1 = 2
  });
});
