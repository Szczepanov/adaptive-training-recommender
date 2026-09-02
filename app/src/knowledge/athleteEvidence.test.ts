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

  it('enforces safety bounds on scalarOffset [-2.0, +2.0]', () => {
    const excessiveOffset: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'excessive_offset',
      domain: 'subjective_calibration',
      parameters: { scalarOffset: 3.5 },
    };
    const res = validateAthleteEvidenceRecord(excessiveOffset, registeredClaimIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('violates safety bounds [-2.0, +2.0]'))).toBe(true);

    const validOffset: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'valid_offset',
      domain: 'subjective_calibration',
      parameters: { scalarOffset: 1.5 },
    };
    const resValid = validateAthleteEvidenceRecord(validOffset, registeredClaimIds);
    expect(resValid.valid).toBe(true);
  });

  it('enforces safety bounds on scalarMultiplier [0.75, 2.0]', () => {
    const tooLow: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'too_low_multiplier',
      domain: 'recovery_kinetics',
      parameters: { scalarMultiplier: 0.5 },
    };
    const res = validateAthleteEvidenceRecord(tooLow, registeredClaimIds);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('violates safety bounds [0.75, 2.0]'))).toBe(true);

    const tooHigh: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'too_high_multiplier',
      domain: 'recovery_kinetics',
      parameters: { scalarMultiplier: 2.5 },
    };
    const resHigh = validateAthleteEvidenceRecord(tooHigh, registeredClaimIds);
    expect(resHigh.valid).toBe(false);
    expect(resHigh.errors.some(e => e.includes('violates safety bounds [0.75, 2.0]'))).toBe(true);
  });

  it('enforces bounds on enforcedMinimumRecoveryHours [0, 168]', () => {
    const neg: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'neg_rec',
      parameters: { enforcedMinimumRecoveryHours: -1 },
    };
    expect(validateAthleteEvidenceRecord(neg).valid).toBe(false);

    const excess: AthleteEvidenceRecord = {
      ...validRecord,
      id: 'excess_rec',
      parameters: { enforcedMinimumRecoveryHours: 200 },
    };
    expect(validateAthleteEvidenceRecord(excess).valid).toBe(false);
  });

  it('rejects date chronology anomalies (firstObservedDate > lastObservedDate)', () => {
    const reversedDates: AthleteEvidenceRecord = {
      ...validRecord,
      firstObservedDate: '2026-08-01',
      lastObservedDate: '2026-06-01',
    };
    const res = validateAthleteEvidenceRecord(reversedDates);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('cannot be after lastObservedDate'))).toBe(true);
  });

  it('rejects record userId mismatch against profile userId', () => {
    const mismatchedProfile: AthleteEvidenceProfile = {
      ...validProfile,
      userId: 'user-athlete-01',
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
