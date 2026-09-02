import { describe, expect, it } from 'vitest';
import type { AthleteEvidenceRecord } from '../knowledge/athleteEvidence';
import {
  compareAthleteEvidenceLineage,
  MAX_ATHLETE_EVIDENCE_LINEAGE_REFS,
  snapshotAthleteEvidenceLineage,
} from './knowledgeLineage';

describe('Athlete Evidence Lineage Snapshot & Replay Comparison (SKR4)', () => {
  const sampleRecord: AthleteEvidenceRecord = {
    id: 'habitual_high_soreness_baseline',
    userId: 'user-01',
    domain: 'subjective_calibration',
    status: 'active',
    version: 1,
    baseKnowledgeClaimId: 'policy.readiness.subjective_mode_thresholds_v2',
    refinementType: 'calibrate_scalar',
    parameters: { scalarOffset: -1.0 },
    sampleSize: 10,
    observationWindowDays: 30,
    confidence: 'high',
    firstObservedDate: '2026-07-01',
    lastObservedDate: '2026-08-01',
    rationale: 'Habitual 3/10 soreness during normal training.',
  };

  it('snapshots empty or undefined records as undefined', () => {
    expect(snapshotAthleteEvidenceLineage(undefined)).toBeUndefined();
    expect(snapshotAthleteEvidenceLineage([])).toBeUndefined();
  });

  it('snapshots active records into compact lineage refs', () => {
    const snapshot = snapshotAthleteEvidenceLineage([sampleRecord]);
    expect(snapshot).toHaveLength(1);
    expect(snapshot![0]).toEqual({
      recordId: 'habitual_high_soreness_baseline',
      version: 1,
      domain: 'subjective_calibration',
      refinementType: 'calibrate_scalar',
      baseKnowledgeClaimId: 'policy.readiness.subjective_mode_thresholds_v2',
    });
  });

  it('enforces maximum lineage ref cap', () => {
    const excessive = Array.from({ length: MAX_ATHLETE_EVIDENCE_LINEAGE_REFS + 1 }, (_, idx) => ({
      ...sampleRecord,
      id: `record_${idx}`,
    }));
    expect(() => snapshotAthleteEvidenceLineage(excessive)).toThrow('exceeds 16 records');
  });

  describe('compareAthleteEvidenceLineage', () => {
    it('returns lineage_unavailable when persisted lineage is undefined', () => {
      const res = compareAthleteEvidenceLineage(undefined, [sampleRecord]);
      expect(res.status).toBe('lineage_unavailable');
      expect(res.drift).toHaveLength(0);
    });

    it('returns matches_current when records and versions match', () => {
      const snapshot = snapshotAthleteEvidenceLineage([sampleRecord])!;
      const res = compareAthleteEvidenceLineage(snapshot, [sampleRecord]);
      expect(res.status).toBe('matches_current');
      expect(res.drift).toHaveLength(0);
    });

    it('detects missing record drift when a persisted record no longer exists', () => {
      const snapshot = snapshotAthleteEvidenceLineage([sampleRecord])!;
      const res = compareAthleteEvidenceLineage(snapshot, []);
      expect(res.status).toBe('drifted');
      expect(res.drift).toHaveLength(1);
      expect(res.drift[0].recordId).toBe('habitual_high_soreness_baseline');
      expect(res.drift[0].status).toBe('missing');
    });

    it('detects version mismatch drift when record version changed', () => {
      const snapshot = snapshotAthleteEvidenceLineage([sampleRecord])!;
      const updatedRecord: AthleteEvidenceRecord = { ...sampleRecord, version: 2 };
      const res = compareAthleteEvidenceLineage(snapshot, [updatedRecord]);
      expect(res.status).toBe('drifted');
      expect(res.drift).toHaveLength(1);
      expect(res.drift[0].recordedVersion).toBe(1);
      expect(res.drift[0].currentVersion).toBe(2);
      expect(res.drift[0].status).toBe('version_mismatch');
    });
  });
});
