import { describe, expect, it } from 'vitest';
import type { SafetyEnvelope } from '../engine/models';
import type { AthleteEvidenceProfile } from './athleteEvidence';
import {
  applyAthleteRecoveryKinetics,
  applyAthleteSubjectiveCalibration,
  assertSafetyMonotonicity,
  resolveActiveAthleteEvidenceRecords,
  resolveAthleteTissueTolerance,
} from './athleteEvidencePolicy';
import { KNOWLEDGE_CLAIM_IDS } from './sportsKnowledgeRegistry';

describe('Athlete-Specific Evidence Policy Refinement Engine (SKR4)', () => {
  const profileWithCalibrations: AthleteEvidenceProfile = {
    userId: 'athlete-calibration-01',
    schemaVersion: 1,
    updatedAt: '2026-09-02T12:00:00Z',
    records: [
      {
        id: 'habitual_high_soreness_baseline',
        userId: 'athlete-calibration-01',
        domain: 'subjective_calibration',
        status: 'active',
        version: 1,
        baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy,
        refinementType: 'calibrate_scalar',
        parameters: { scalarOffset: -1.0 },
        sampleSize: 15,
        observationWindowDays: 45,
        confidence: 'high',
        firstObservedDate: '2026-06-01',
        lastObservedDate: '2026-08-01',
        rationale: 'Athlete habitually reports mild baseline soreness 3/10 during normal training.',
      },
      {
        id: 'provisional_stoic_bias',
        userId: 'athlete-calibration-01',
        domain: 'subjective_calibration',
        status: 'provisional', // Provisional records must NOT be applied
        version: 1,
        baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy,
        refinementType: 'calibrate_scalar',
        parameters: { scalarOffset: 1.5 },
        sampleSize: 2,
        observationWindowDays: 7,
        confidence: 'low',
        firstObservedDate: '2026-08-20',
        lastObservedDate: '2026-08-25',
        rationale: 'Provisional observation under active review.',
      },
      {
        id: 'delayed_recovery_kinetics',
        userId: 'athlete-calibration-01',
        domain: 'recovery_kinetics',
        status: 'active',
        version: 1,
        baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue,
        refinementType: 'tighten_constraint',
        parameters: {
          scalarMultiplier: 1.25,
          enforcedMinimumRecoveryHours: 54,
        },
        sampleSize: 8,
        observationWindowDays: 60,
        confidence: 'high',
        firstObservedDate: '2026-05-15',
        lastObservedDate: '2026-08-10',
        rationale: 'Athlete exhibits elevated muscular fatigue 48h post heavy squats.',
      },
      {
        id: 'achilles_running_restriction',
        userId: 'athlete-calibration-01',
        domain: 'tissue_tolerance',
        status: 'active',
        version: 1,
        baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.tissueResponseSeverityPolicy,
        refinementType: 'tighten_constraint',
        parameters: {
          additionalRestrictedModalities: ['Running'],
        },
        sampleSize: 5,
        observationWindowDays: 30,
        confidence: 'moderate',
        firstObservedDate: '2026-07-01',
        lastObservedDate: '2026-08-01',
        rationale: 'Recurring right Achilles tendinopathy flares upon repeated pavement running.',
      },
    ],
  };

  it('filters active records and excludes provisional ones', () => {
    const allActive = resolveActiveAthleteEvidenceRecords(profileWithCalibrations);
    expect(allActive).toHaveLength(3);
    expect(allActive.some(r => r.id === 'provisional_stoic_bias')).toBe(false);

    const subjectiveActive = resolveActiveAthleteEvidenceRecords(profileWithCalibrations, 'subjective_calibration');
    expect(subjectiveActive).toHaveLength(1);
    expect(subjectiveActive[0].id).toBe('habitual_high_soreness_baseline');
  });

  describe('applyAthleteSubjectiveCalibration', () => {
    it('returns raw values when no profile or active calibration is present', () => {
      const res = applyAthleteSubjectiveCalibration(null, { soreness: 4, fatigue: 3 });
      expect(res.calibratedSoreness).toBe(4);
      expect(res.calibratedFatigue).toBe(3);
      expect(res.offsetApplied).toBe(0);
      expect(res.appliedRecord).toBeUndefined();
    });

    it('applies calibrated offset within valid scale bounds', () => {
      const res = applyAthleteSubjectiveCalibration(profileWithCalibrations, { soreness: 4, fatigue: 3 });
      expect(res.calibratedSoreness).toBe(3.0);
      expect(res.calibratedFatigue).toBe(2.0);
      expect(res.offsetApplied).toBe(-1.0);
      expect(res.appliedRecord?.id).toBe('habitual_high_soreness_baseline');
    });

    it('preserves safety invariant: severe soreness (>= 8) cannot be calibrated below 6', () => {
      const resSevere = applyAthleteSubjectiveCalibration(profileWithCalibrations, { soreness: 8, fatigue: 8 });
      // 8 - 1.0 = 7.0, which is >= 6, so it's allowed.
      expect(resSevere.calibratedSoreness).toBe(7.0);

      // Even if offset is -2.0 (the maximum allowed offset), 8 - 2 = 6, never below 6
      const extremeProfile: AthleteEvidenceProfile = {
        ...profileWithCalibrations,
        records: [
          {
            ...profileWithCalibrations.records[0],
            parameters: { scalarOffset: -2.0 },
          },
        ],
      };
      const resExtreme = applyAthleteSubjectiveCalibration(extremeProfile, { soreness: 8, fatigue: 8 });
      expect(resExtreme.calibratedSoreness).toBe(6.0);
    });
  });

  describe('applyAthleteRecoveryKinetics', () => {
    it('scales recovery hours by multiplier and enforces minimums', () => {
      const res = applyAthleteRecoveryKinetics(profileWithCalibrations, 48, { isStrenuousLowerBody: true });
      // 48 * 1.25 = 60, enforced minimum is 54, so 60 hours
      expect(res.effectiveRecoveryHours).toBe(60);
      expect(res.appliedRecord?.id).toBe('delayed_recovery_kinetics');
    });

    it('prevents compressing strenuous lower-body recovery hours below 36h', () => {
      const fastRecovererProfile: AthleteEvidenceProfile = {
        ...profileWithCalibrations,
        records: [
          {
            ...profileWithCalibrations.records[2],
            parameters: { scalarMultiplier: 0.75 }, // attempts 48 * 0.75 = 36
          },
        ],
      };
      const res = applyAthleteRecoveryKinetics(fastRecovererProfile, 48, { isStrenuousLowerBody: true });
      expect(res.effectiveRecoveryHours).toBe(36);
    });
  });

  describe('resolveAthleteTissueTolerance', () => {
    it('resolves additional restricted modalities from active tissue tolerance records', () => {
      const res = resolveAthleteTissueTolerance(profileWithCalibrations, { activeBodyRegions: ['achilles'] });
      expect(res.additionalRestrictedModalities).toContain('Running');
      expect(res.appliedRecords).toHaveLength(1);
    });
  });

  describe('assertSafetyMonotonicity', () => {
    const baseEnvelope: SafetyEnvelope = {
      clinicalFlagActive: true,
      redFlagActive: true,
      clinicalEscalationRequired: true,
      restrictedModalities: ['Running'],
    };

    it('passes when refined envelope preserves all safety constraints', () => {
      const validRefined: SafetyEnvelope = {
        ...baseEnvelope,
        restrictedModalities: ['Running', 'Strength'], // added restriction is safe
      };
      expect(() => assertSafetyMonotonicity(baseEnvelope, validRefined)).not.toThrow();
    });

    it('throws when clinicalFlagActive is disabled', () => {
      const weakened: SafetyEnvelope = { ...baseEnvelope, clinicalFlagActive: false };
      expect(() => assertSafetyMonotonicity(baseEnvelope, weakened)).toThrow(
        'clinicalFlagActive was disabled'
      );
    });

    it('throws when redFlagActive is disabled', () => {
      const weakened: SafetyEnvelope = { ...baseEnvelope, redFlagActive: false };
      expect(() => assertSafetyMonotonicity(baseEnvelope, weakened)).toThrow(
        'redFlagActive was disabled'
      );
    });

    it('throws when a restricted modality is removed', () => {
      const weakened: SafetyEnvelope = { ...baseEnvelope, restrictedModalities: [] };
      expect(() => assertSafetyMonotonicity(baseEnvelope, weakened)).toThrow(
        'restricted modality "Running" was removed'
      );
    });
  });
});
