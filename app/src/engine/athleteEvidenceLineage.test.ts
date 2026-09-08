import { describe, expect, it } from 'vitest';
import type { AthleteEvidenceRecord } from '../knowledge/athleteEvidence';
import {
  compareAthleteEvidenceLineage,
  MAX_ATHLETE_EVIDENCE_LINEAGE_REFS,
  snapshotAthleteEvidenceLineage,
} from './knowledgeLineage';

describe('Athlete Evidence Lineage Snapshot & Replay Comparison (SKR4)', () => {
  const sampleRecord: AthleteEvidenceRecord = {
    id: 'conservative_subjective_calibration',
    userId: 'user-01',
    domain: 'subjective_calibration',
    status: 'active',
    version: 1,
    baseKnowledgeClaimId: 'policy.readiness.subjective_mode_thresholds_v2',
    refinementType: 'calibrate_scalar',
    parameters: { scalarOffset: 1 },
    sampleSize: 10,
    observationWindowDays: 30,
    confidence: 'high',
    firstObservedDate: '2026-07-01',
    lastObservedDate: '2026-08-01',
    rationale: 'Repeated evidence supports conservative subjective escalation.',
  };

  it('snapshots empty or undefined records as undefined', () => {
    expect(snapshotAthleteEvidenceLineage(undefined)).toBeUndefined();
    expect(snapshotAthleteEvidenceLineage([])).toBeUndefined();
  });

  it('snapshots active records into deterministic compact lineage refs', () => {
    const second = { ...sampleRecord, id: 'z_recovery_record' };
    const snapshot = snapshotAthleteEvidenceLineage([second, sampleRecord]);
    expect(snapshot?.map(ref => ref.recordId)).toEqual(['conservative_subjective_calibration', 'z_recovery_record']);
    expect(snapshot?.[0]).toEqual({
      recordId: 'conservative_subjective_calibration',
      version: 1,
      domain: 'subjective_calibration',
      refinementType: 'calibrate_scalar',
      baseKnowledgeClaimId: 'policy.readiness.subjective_mode_thresholds_v2',
    });
  });

  it('rejects inactive, mixed-user, duplicate, or excessive snapshots', () => {
    expect(() => snapshotAthleteEvidenceLineage([{ ...sampleRecord, status: 'revoked' }])).toThrow('only active records');
    expect(() => snapshotAthleteEvidenceLineage([sampleRecord, { ...sampleRecord, id: 'foreign', userId: 'user-02' }])).toThrow('multiple users');
    expect(() => snapshotAthleteEvidenceLineage([sampleRecord, { ...sampleRecord }])).toThrow('duplicate record id');
    const excessive = Array.from({ length: MAX_ATHLETE_EVIDENCE_LINEAGE_REFS + 1 }, (_, idx) => ({ ...sampleRecord, id: `record_${idx}` }));
    expect(() => snapshotAthleteEvidenceLineage(excessive)).toThrow('exceeds 16 records');
  });

  describe('compareAthleteEvidenceLineage', () => {
    it('returns lineage_unavailable when persisted lineage is undefined', () => {
      expect(compareAthleteEvidenceLineage(undefined, [sampleRecord])).toEqual({ status: 'lineage_unavailable', drift: [] });
    });

    it('returns matches_current when record identity, definition, status, and version match', () => {
      const snapshot = snapshotAthleteEvidenceLineage([sampleRecord])!;
      expect(compareAthleteEvidenceLineage(snapshot, [sampleRecord])).toEqual({ status: 'matches_current', drift: [] });
    });

    it('detects missing, inactive, version, and same-version definition drift', () => {
      const snapshot = snapshotAthleteEvidenceLineage([sampleRecord])!;
      expect(compareAthleteEvidenceLineage(snapshot, []).drift[0].status).toBe('missing');
      expect(compareAthleteEvidenceLineage(snapshot, [{ ...sampleRecord, status: 'revoked' }]).drift[0].status).toBe('inactive');
      expect(compareAthleteEvidenceLineage(snapshot, [{ ...sampleRecord, version: 2 }]).drift[0].status).toBe('version_mismatch');
      expect(compareAthleteEvidenceLineage(snapshot, [{ ...sampleRecord, baseKnowledgeClaimId: 'policy.readiness.mode_thresholds_v1' }]).drift[0].status).toBe('definition_mismatch');
    });

    it('rejects a mixed-user current-record set rather than matching by id across identities', () => {
      const snapshot = snapshotAthleteEvidenceLineage([sampleRecord])!;
      expect(() => compareAthleteEvidenceLineage(snapshot, [sampleRecord, { ...sampleRecord, id: 'foreign', userId: 'user-02' }])).toThrow('multiple users');
    });
  });
});
