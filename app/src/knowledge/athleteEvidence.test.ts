import { describe, expect, it } from 'vitest';
import {
  type AthleteEvidenceProfile,
  type AthleteEvidenceRecord,
  validateAthleteEvidenceProfile,
  validateAthleteEvidenceRecord,
} from './athleteEvidence';
import { KNOWLEDGE_CLAIM_IDS, SPORTS_KNOWLEDGE_CLAIMS } from './sportsKnowledgeRegistry';

describe('Athlete-Specific Evidence Contracts & Validation (SKR4)', () => {
  const registeredClaimIds = new Set(SPORTS_KNOWLEDGE_CLAIMS.map(c => c.id));

  const validRecord: AthleteEvidenceRecord = {
    id: 'achilles_delayed_irritability',
    userId: 'user-athlete-01',
    domain: 'tissue_tolerance',
    status: 'active',
    version: 1,
    baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.tissueResponseSeverityPolicy,
    refinementType: 'tighten_constraint',
    parameters: {
      enforcedMinimumRecoveryHours: 48,
      additionalRestrictedModalities: ['Running'],
      contraindicatedMovementPatterns: ['high_eccentric_plyometrics'],
      applicableBodyRegions: ['achilles'],
      customNote: 'Right Achilles irritable 24-48h post high-speed running',
    },
    sampleSize: 6,
    observationWindowDays: 60,
    confidence: 'high',
    firstObservedDate: '2026-06-01',
    lastObservedDate: '2026-08-15',
    reviewedAt: '2026-08-20',
    rationale: 'Longitudinal flare-up pattern after consecutive running sessions within 36h.',
  };

  const validProfile: AthleteEvidenceProfile = {
    userId: 'user-athlete-01',
    schemaVersion: 1,
    updatedAt: '2026-09-02T10:00:00Z',
    records: [validRecord],
  };

  it('validates a compliant athlete evidence record successfully', () => {
    const res = validateAthleteEvidenceRecord(validRecord, registeredClaimIds);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('validates a compliant athlete evidence profile successfully', () => {
    const res = validateAthleteEvidenceProfile(validProfile, registeredClaimIds);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects an invalid base knowledge claim id that is not registered', () => {
    const invalid = { ...validRecord, baseKnowledgeClaimId: 'non_existent_claim' };
    const res = validateAthleteEvidenceRecord(invalid, registeredClaimIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('does not exist in the Sports Knowledge Registry'))).toBe(true);
  });

  it('enforces scalar bounds and blocks negative subjective de-escalation', () => {
    const excessiveOffset: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'excessive_offset',
      domain: 'subjective_calibration',
      baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.modeThresholdsPolicy,
      refinementType: 'calibrate_scalar',
      parameters: { scalarOffset: 3.5 },
    };
    const res = validateAthleteEvidenceRecord(excessiveOffset, registeredClaimIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('violates safety bounds [-2.0, +2.0]'))).toBe(true);

    const deEscalatingOffset: AthleteEvidenceRecord = {
      ...excessiveOffset,
      id: 'negative_subjective_offset',
      parameters: { scalarOffset: -1 },
    };
    const resNegative = validateAthleteEvidenceRecord(deEscalatingOffset, registeredClaimIds);
    expect(resNegative.valid).toBe(false);
    expect(resNegative.errors.some(e => e.includes('D-SUBJFLOOR'))).toBe(true);

    const validOffset: AthleteEvidenceRecord = {
      ...excessiveOffset,
      id: 'valid_offset',
      parameters: { scalarOffset: 1.5 },
    };
    expect(validateAthleteEvidenceRecord(validOffset, registeredClaimIds).valid).toBe(true);
  });

  it('enforces recovery bounds and tighten-only recovery semantics', () => {
    const tooLow: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'too_low_multiplier',
      domain: 'recovery_kinetics',
      baseKnowledgeClaimId: KNOWLEDGE_CLAIM_IDS.strenuousLowerBodyResidualFatigue,
      refinementType: 'tighten_constraint',
      parameters: { scalarMultiplier: 0.75 },
    };
    const res = validateAthleteEvidenceRecord(tooLow, registeredClaimIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('cannot shorten recovery'))).toBe(true);

    const tooHigh: AthleteEvidenceRecord = {
      ...tooLow,
      id: 'too_high_multiplier',
      parameters: { scalarMultiplier: 2.5 },
    };
    expect(validateAthleteEvidenceRecord(tooHigh, registeredClaimIds).valid).toBe(false);

    const validRecovery: AthleteEvidenceRecord = {
      ...tooLow,
      id: 'valid_recovery_multiplier',
      parameters: { scalarMultiplier: 1.25, enforcedMinimumRecoveryHours: 54 },
    };
    expect(validateAthleteEvidenceRecord(validRecovery, registeredClaimIds).valid).toBe(true);
  });

  it('enforces bounds on enforcedMinimumRecoveryHours [0, 168]', () => {
    expect(validateAthleteEvidenceRecord({
      ...validRecord,
      id: 'neg_rec',
      parameters: { enforcedMinimumRecoveryHours: -1 },
    }).valid).toBe(false);
    expect(validateAthleteEvidenceRecord({
      ...validRecord,
      id: 'excess_rec',
      parameters: { enforcedMinimumRecoveryHours: 200 },
    }).valid).toBe(false);
  });

  it('validates modality and scoped string lists rather than accepting arbitrary arrays', () => {
    const invalid = {
      ...validRecord,
      parameters: {
        additionalRestrictedModalities: ['Teleporting'],
        contraindicatedMovementPatterns: ['valid_pattern', 42],
        applicableBodyRegions: ['Achilles', 'achilles'],
      },
    };
    const res = validateAthleteEvidenceRecord(invalid, registeredClaimIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('not an allowed value'))).toBe(true);
    expect(res.errors.some(e => e.includes('must be a non-empty string'))).toBe(true);
    expect(res.errors.some(e => e.includes('duplicate value'))).toBe(true);
  });

  it('rejects date chronology anomalies and stale review confirmation', () => {
    const reversedDates: AthleteEvidenceRecord = {
      ...validRecord,
      firstObservedDate: '2026-08-01',
      lastObservedDate: '2026-06-01',
    };
    expect(validateAthleteEvidenceRecord(reversedDates).errors.some(e => e.includes('cannot be after lastObservedDate'))).toBe(true);

    const staleReview: AthleteEvidenceRecord = {
      ...validRecord,
      lastObservedDate: '2026-08-15',
      reviewedAt: '2026-08-01',
    };
    expect(validateAthleteEvidenceRecord(staleReview).errors.some(e => e.includes('cannot be before lastObservedDate'))).toBe(true);
  });

  it('rejects invalid profile updatedAt timestamps', () => {
    const invalid = { ...validProfile, updatedAt: '2026-09-02' };
    const res = validateAthleteEvidenceProfile(invalid, registeredClaimIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('ISO/RFC3339'))).toBe(true);
  });

  it('rejects record userId mismatch against profile userId', () => {
    const mismatchedProfile: AthleteEvidenceProfile = {
      ...validProfile,
      records: [{ ...validRecord, userId: 'different-user' }],
    };
    const res = validateAthleteEvidenceProfile(mismatchedProfile);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('does not match profile userId'))).toBe(true);
  });

  it('rejects duplicate record IDs within a single profile', () => {
    const duplicateProfile: AthleteEvidenceProfile = {
      ...validProfile,
      records: [validRecord, { ...validRecord, version: 2 }],
    };
    const res = validateAthleteEvidenceProfile(duplicateProfile);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('Duplicate record ID'))).toBe(true);
  });
});
