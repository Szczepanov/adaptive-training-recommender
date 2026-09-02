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
        id: 'conservative_subjective_calibration',
        userId: 'athlete-calibration-01',
        domain: 'subjective_calibration',
        status: 'active',
        version: 1,
        baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy,
        refinementType: 'calibrate_scalar',
        parameters: { scalarOffset: 1.0 },
        sampleSize: 15,
        observationWindowDays: 45,
        confidence: 'high',
        firstObservedDate: '2026-06-01',
        lastObservedDate: '2026-08-01',
        rationale: 'Repeated athlete-specific evidence supports a conservative one-point escalation.',
      },
      {
        id: 'provisional_stoic_bias',
        userId: 'athlete-calibration-01',
        domain: 'subjective_calibration',
        status: 'provisional',
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
        parameters: { scalarMultiplier: 1.25, enforcedMinimumRecoveryHours: 54 },
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
          applicableBodyRegions: ['achilles'],
        },
        sampleSize: 5,
        observationWindowDays: 30,
        confidence: 'moderate',
        firstObservedDate: '2026-07-01',
        lastObservedDate: '2026-08-01',
        rationale: 'Recurring right Achilles irritation with repeated high-impact running exposure.',
      },
    ],
  };

  it('filters active records and fails closed on cross-user records', () => {
    const contaminated: AthleteEvidenceProfile = {
      ...profileWithCalibrations,
      records: [
        ...profileWithCalibrations.records,
        { ...profileWithCalibrations.records[3], id: 'foreign_record', userId: 'other-athlete' },
      ],
    };
    const allActive = resolveActiveAthleteEvidenceRecords(contaminated);
    expect(allActive).toHaveLength(3);
    expect(allActive.some(r => r.id === 'foreign_record')).toBe(false);
    expect(allActive.some(r => r.id === 'provisional_stoic_bias')).toBe(false);
  });

  describe('applyAthleteSubjectiveCalibration', () => {
    it('returns raw values when no profile or active calibration is present', () => {
      const res = applyAthleteSubjectiveCalibration(null, { soreness: 4, fatigue: 3 });
      expect(res).toEqual({ calibratedSoreness: 4, calibratedFatigue: 3, offsetApplied: 0 });
    });

    it('applies only conservative positive calibration', () => {
      const res = applyAthleteSubjectiveCalibration(profileWithCalibrations, { soreness: 4, fatigue: 3 });
      expect(res.calibratedSoreness).toBe(5);
      expect(res.calibratedFatigue).toBe(4);
      expect(res.offsetApplied).toBe(1);
      expect(res.appliedRecord?.id).toBe('conservative_subjective_calibration');
    });

    it('makes an unvalidated negative offset a no-op so absolute floors cannot be weakened', () => {
      const unsafeProfile: AthleteEvidenceProfile = {
        ...profileWithCalibrations,
        records: [{ ...profileWithCalibrations.records[0], parameters: { scalarOffset: -2 } }],
      };
      const res = applyAthleteSubjectiveCalibration(unsafeProfile, { soreness: 7, fatigue: 9 });
      expect(res.calibratedSoreness).toBe(7);
      expect(res.calibratedFatigue).toBe(9);
      expect(res.offsetApplied).toBe(0);
      expect(res.appliedRecord).toBeUndefined();
    });
  });

  describe('applyAthleteRecoveryKinetics', () => {
    it('lengthens recovery hours by multiplier and enforced minimum', () => {
      const res = applyAthleteRecoveryKinetics(profileWithCalibrations, 48);
      expect(res.effectiveRecoveryHours).toBe(60);
      expect(res.appliedRecord?.id).toBe('delayed_recovery_kinetics');
    });

    it('does not let an unvalidated fast-recovery record shorten the general prior', () => {
      const unsafeProfile: AthleteEvidenceProfile = {
        ...profileWithCalibrations,
        records: [{ ...profileWithCalibrations.records[2], parameters: { scalarMultiplier: 0.75 } }],
      };
      const res = applyAthleteRecoveryKinetics(unsafeProfile, 48);
      expect(res.effectiveRecoveryHours).toBe(48);
      expect(res.appliedRecord).toBeUndefined();
    });
  });

  describe('resolveAthleteTissueTolerance', () => {
    it('applies a scoped restriction when the current region intersects', () => {
      const res = resolveAthleteTissueTolerance(profileWithCalibrations, { activeBodyRegions: ['Achilles'] });
      expect(res.additionalRestrictedModalities).toContain('Running');
      expect(res.appliedRecords).toHaveLength(1);
    });

    it('does not apply a scoped Achilles restriction to an explicitly unrelated current region', () => {
      const res = resolveAthleteTissueTolerance(profileWithCalibrations, { activeBodyRegions: ['shoulder'] });
      expect(res.additionalRestrictedModalities).not.toContain('Running');
      expect(res.appliedRecords).toHaveLength(0);
    });

    it('returns typed movement-pattern restrictions as well as modalities', () => {
      const movementProfile: AthleteEvidenceProfile = {
        ...profileWithCalibrations,
        records: [{
          ...profileWithCalibrations.records[3],
          id: 'landing_pattern_restriction',
          domain: 'movement_contraindication',
          parameters: { contraindicatedMovementPatterns: ['max_depth_drop_jump'] },
        }],
      };
      const res = resolveAthleteTissueTolerance(movementProfile);
      expect(res.contraindicatedMovementPatterns).toEqual(['max_depth_drop_jump']);
    });
  });

  describe('assertSafetyMonotonicity', () => {
    const baseEnvelope: SafetyEnvelope = {
      clinicalFlagActive: true,
      redFlagActive: true,
      clinicalEscalationRequired: true,
      redFlagCategories: ['neurological'],
      restrictedModalities: ['Running'],
    };

    it('passes when refined envelope preserves all safety constraints', () => {
      const validRefined: SafetyEnvelope = {
        ...baseEnvelope,
        restrictedModalities: ['Running', 'Strength'],
      };
      expect(() => assertSafetyMonotonicity(baseEnvelope, validRefined)).not.toThrow();
    });

    it('throws when clinical or red-flag authority is weakened', () => {
      expect(() => assertSafetyMonotonicity({ ...baseEnvelope }, { ...baseEnvelope, clinicalFlagActive: false })).toThrow('clinicalFlagActive was disabled');
      expect(() => assertSafetyMonotonicity({ ...baseEnvelope }, { ...baseEnvelope, redFlagActive: false })).toThrow('redFlagActive was disabled');
      expect(() => assertSafetyMonotonicity({ ...baseEnvelope }, { ...baseEnvelope, clinicalEscalationRequired: false })).toThrow('clinicalEscalationRequired was disabled');
    });

    it('throws when a restricted modality or red-flag category is removed', () => {
      expect(() => assertSafetyMonotonicity(baseEnvelope, { ...baseEnvelope, restrictedModalities: [] })).toThrow('restricted modality "Running" was removed');
      expect(() => assertSafetyMonotonicity(baseEnvelope, { ...baseEnvelope, redFlagCategories: [] })).toThrow('red flag category "neurological" was removed');
    });
  });
});
