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

    const exactBoundaryVerdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-06', workoutId: 'field_acceleration_braking_01', stage: 3 }],
      checkinHistory: [],
      targetStage: 3,
    });
    expect(exactBoundaryVerdict.stage).toBe(1);

  });

  it('progresses from Stage 1 to Stage 2 only after two tolerated current-stage exposures', () => {
    const exposures: MechanicalExposureRecord[] = [
      { date: '2026-09-15', workoutId: 'running_walk_run_01', stage: 1 },
      { date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 },
    ];
    const normalTissueCheckin = () => checkin({
      tissueResponses: {
        knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' },
        achilles: { region: 'achilles', morningState: 'normal', nextMorningReaction: 'normal' },
      },
    });
    const checkins: CheckinRecord[] = [
      { date: '2026-09-16', checkin: normalTissueCheckin() },
      { date: '2026-09-18', checkin: normalTissueCheckin() },
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
    expect(verdict.eligibleWorkoutIds).not.toContain('running_easy_continuous_01');
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

  it('fails closed when a follow-up check-in exists but has no explicit lower-body tissue response', () => {
    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
      checkinHistory: [{ date: '2026-09-18', checkin: checkin() }],
      targetStage: 2,
    });

    expect(verdict.stage).toBe(1);
    expect(verdict.tissueResponse.verdict).toBe('missing');
    expect(verdict.tissueResponse.notes.join(' ')).toContain('missing');
  });

  it('holds after one tolerated current-stage exposure instead of advancing early', () => {
    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: [{ date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 }],
      checkinHistory: [{
        date: '2026-09-18',
        checkin: checkin({ tissueResponses: { knee: { region: 'knee', morningState: 'normal' } } }),
      }],
      targetStage: 2,
    });

    expect(verdict.stage).toBe(1);
    expect(verdict.tissueResponse.verdict).toBe('normal');
    expect(verdict.tissueResponse.notes.join(' ')).toContain('1/2');
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
      { date: '2026-09-15', workoutId: 'running_walk_run_01', stage: 1 },
      { date: '2026-09-17', workoutId: 'running_walk_run_01', stage: 1 },
    ];
    const checkins: CheckinRecord[] = [
      { date: '2026-09-16', checkin: checkin({ tissueResponses: { knee: { region: 'knee', morningState: 'normal' } } }) },
      { date: '2026-09-18', checkin: checkin({ tissueResponses: { knee: { region: 'knee', morningState: 'normal' } } }) },
    ];

    const verdict = evaluateMechanicalStageProgression({
      asOfDate: '2026-09-20',
      exposureHistory: exposures,
      checkinHistory: checkins,
      targetStage: 4,
    });

    expect(verdict.stage).toBe(2);
  });

  describe('held stage (#805)', () => {
    const normal = (date: string): CheckinRecord => ({
      date,
      checkin: checkin({ date, tissueResponses: { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } } }),
    });
    const stage4Then2: MechanicalExposureRecord[] = [
      { date: '2026-09-12', workoutId: 'field_controlled_maintenance_01', stage: 4 },
      { date: '2026-09-16', workoutId: 'field_sprint_mechanics_foundation_01', stage: 2 },
    ];

    it('keeps the highest stage performed with normal follow-up; a later lower-stage session does not demote', () => {
      const verdict = evaluateMechanicalStageProgression({
        asOfDate: '2026-09-20', exposureHistory: stage4Then2,
        checkinHistory: [normal('2026-09-13'), normal('2026-09-17')], targetStage: 2,
      });
      expect(verdict.stage).toBe(4);
      expect(verdict.eligibleWorkoutIds).toContain('field_controlled_maintenance_01');
    });

    it('does not ratchet to a latest higher stage until that exposure has a normal follow-up', () => {
      const stage2Then4: MechanicalExposureRecord[] = [
        { date: '2026-09-12', workoutId: 'field_sprint_mechanics_foundation_01', stage: 2 },
        { date: '2026-09-16', workoutId: 'field_controlled_maintenance_01', stage: 4 },
      ];
      const missing = evaluateMechanicalStageProgression({
        asOfDate: '2026-09-20', exposureHistory: stage2Then4,
        checkinHistory: [normal('2026-09-13')], targetStage: 4,
      });
      expect(missing.tissueResponse.verdict).toBe('missing');
      expect(missing.stage).toBe(2);
      expect(missing.eligibleWorkoutIds).not.toContain('field_controlled_maintenance_01');

      const confirmed = evaluateMechanicalStageProgression({
        asOfDate: '2026-09-20', exposureHistory: stage2Then4,
        checkinHistory: [normal('2026-09-13'), normal('2026-09-17')], targetStage: 4,
      });
      expect(confirmed.stage).toBe(4);
      expect(confirmed.eligibleWorkoutIds).toContain('field_controlled_maintenance_01');
    });

    it('fails closed to Stage 1 when no recent stage has any explicit normal follow-up', () => {
      const verdict = evaluateMechanicalStageProgression({
        asOfDate: '2026-09-20',
        exposureHistory: [{ date: '2026-09-16', workoutId: 'field_acceleration_braking_01', stage: 3 }],
        checkinHistory: [],
        targetStage: 4,
      });
      expect(verdict.tissueResponse.verdict).toBe('missing');
      expect(verdict.stage).toBe(1);
      expect(verdict.eligibleWorkoutIds).toContain('running_walk_run_01');
      expect(verdict.eligibleWorkoutIds).not.toContain('field_acceleration_braking_01');
    });

    it('does not hold a higher stage whose follow-up was missing, and still regresses on symptoms', () => {
      const unconfirmed = evaluateMechanicalStageProgression({
        asOfDate: '2026-09-20', exposureHistory: stage4Then2, checkinHistory: [normal('2026-09-17')],
      });
      expect(unconfirmed.stage).toBe(2);
      const mild = evaluateMechanicalStageProgression({
        asOfDate: '2026-09-20', exposureHistory: stage4Then2,
        checkinHistory: [normal('2026-09-13'), {
          date: '2026-09-17',
          checkin: checkin({ date: '2026-09-17', tissueResponses: { knee: { region: 'knee', morningState: 'mild', nextMorningReaction: 'mild' } } }),
        }],
      });
      expect(mild.stage).toBe(1);
      expect(mild.status).toBe('regressed');
    });

    it('still resets to Stage 1 after a gap of 14 days or more', () => {
      const verdict = evaluateMechanicalStageProgression({
        asOfDate: '2026-09-26', exposureHistory: stage4Then2.slice(0, 1), checkinHistory: [normal('2026-09-13')],
      });
      expect(verdict.stage).toBe(1);
    });
  });
});
