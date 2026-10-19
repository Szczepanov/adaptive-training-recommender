import { describe, expect, it, vi } from 'vitest';
import { AssessmentHistoryService } from './assessmentHistoryService';
import type { AssessmentAttemptService } from './assessmentAttemptService';
import type { MetricObservationService } from './metricObservationService';
import type { AssessmentTrialService } from './assessmentTrialService';
import type { MeasurementProtocolService } from './measurementProtocolService';
import type { RecoverySnapshotService } from './recoverySnapshotService';
import type { AnthropometryService } from './anthropometryService';
import type { AssessmentAttempt, MetricObservationRevision } from '../observations/models';
import { BACK_SQUAT_1RM_PROTOCOL as PROTOCOL } from '../observations/physicalCapitalProtocols';

function setup() {
    const attempt: AssessmentAttempt = { id: 'a', state: 'completed', purpose: 'baseline', protocolRef: { id: PROTOCOL.id, revision: PROTOCOL.revision }, completedAt: '2026-08-01T10:00:00Z' };
    const revision: MetricObservationRevision = {
        observationKey: 'a:strength_1rm_kg', assessmentAttemptId: 'a', revision: 2,
        metricId: 'strength_1rm_kg', value: 150, unit: 'kg', protocolRef: attempt.protocolRef,
        comparisonSeriesKey: 's', comparisonCanonicalizationVersion: 'ov-series-v1', validity: 'valid',
        source: 'manual', context: {}, observedAt: attempt.completedAt!, createdAt: attempt.completedAt!,
    };
    const head = { observationKey: revision.observationKey, assessmentAttemptId: 'a', metricId: revision.metricId, headRevision: 2, createdAt: revision.createdAt, updatedAt: revision.createdAt };
    const attempts = {
        listAttemptsForProtocolWithDiagnostics: vi.fn().mockResolvedValue({ attempts: [attempt], unreadableCount: 0, truncated: false }),
        listCompletedAttemptsWithDiagnostics: vi.fn().mockResolvedValue({ attempts: [], unreadableCount: 0, truncated: false }),
    };
    const observations = { getHead: vi.fn().mockResolvedValue(head), getRevision: vi.fn().mockResolvedValue(revision), listCurrentObservationsForMetricWithDiagnostics: vi.fn(), listRevisionsForObservation: vi.fn() };
    const trials = { listTrialsForAttempt: vi.fn() };
    const snapshots = { getRecoverySnapshotsInRangeState: vi.fn() };
    const anthro = { getEntriesInRange: vi.fn() };
    const service = new AssessmentHistoryService(attempts as unknown as AssessmentAttemptService,
        observations as unknown as MetricObservationService, trials as unknown as AssessmentTrialService,
        {} as MeasurementProtocolService, snapshots as unknown as RecoverySnapshotService, anthro as unknown as AnthropometryService);
    const binding = { protocolId: PROTOCOL.id, metricId: revision.metricId };
    return { service, binding, attempt, head, revision, attempts, observations, trials, snapshots, anthro };
}

describe('bounded planning assessment reads', () => {
    it('reads current canonical revisions selectively, deduplicates protocol reads and keeps an old baseline without detail/body mass', async () => {
        const s = setup();
        const { sources } = await s.service.loadPlanningAssessmentSources('u1', [s.binding, { ...s.binding, protocolRevision: PROTOCOL.revision }], '2026-10-11');
        expect(sources[0].observations[0].revision.value).toBe(150);
        expect(sources[0].observations[0].revision.revision).toBe(2);
        expect(s.attempts.listAttemptsForProtocolWithDiagnostics).toHaveBeenCalledExactlyOnceWith('u1', PROTOCOL.id, 100);
        expect(s.observations.getHead).toHaveBeenCalledExactlyOnceWith('u1', 'a:strength_1rm_kg');
        expect(s.observations.getRevision).toHaveBeenCalledExactlyOnceWith('u1', 'a:strength_1rm_kg', 2);
        expect(s.observations.listCurrentObservationsForMetricWithDiagnostics).not.toHaveBeenCalled();
        expect(s.observations.listRevisionsForObservation).not.toHaveBeenCalled();
        expect(s.trials.listTrialsForAttempt).not.toHaveBeenCalled();
        expect(s.snapshots.getRecoverySnapshotsInRangeState).not.toHaveBeenCalled();
        expect(s.anthro.getEntriesInRange).not.toHaveBeenCalled();
    });

    it('skips ineligible and future attempts before observation IO and enforces returned protocol identity', async () => {
        const s = setup();
        s.attempts.listAttemptsForProtocolWithDiagnostics.mockResolvedValue({ attempts: [
            { ...s.attempt, purpose: 'familiarization' }, { ...s.attempt, id: 'abandoned', state: 'abandoned' },
            { ...s.attempt, id: 'future', completedAt: '2026-10-11T22:30:00Z' },
            { ...s.attempt, id: 'bench', protocolRef: { id: 'strength-bench-press-1rm', revision: 2 } },
        ], unreadableCount: 0, truncated: false });
        const { sources } = await s.service.loadPlanningAssessmentSources('u1', [s.binding], '2026-10-11');
        expect(sources[0].observations).toEqual([]);
        expect(s.observations.getHead).not.toHaveBeenCalled();
    });

    it('distinguishes an empty source, query failure, missing current revision and head identity mismatch', async () => {
        const s = setup();
        s.observations.getHead.mockResolvedValueOnce(null);
        expect((await s.service.loadPlanningAssessmentSources('u1', [s.binding], '2026-10-11')).sources[0]).toMatchObject({ unavailable: false, unreadableCount: 0, observations: [] });
        s.observations.getRevision.mockResolvedValueOnce(null);
        expect((await s.service.loadPlanningAssessmentSources('u1', [s.binding], '2026-10-11')).sources[0].unreadableCount).toBe(1);
        s.observations.getHead.mockResolvedValueOnce({ ...s.head, assessmentAttemptId: 'unknown' });
        expect((await s.service.loadPlanningAssessmentSources('u1', [s.binding], '2026-10-11')).sources[0].unreadableCount).toBe(1);
        s.attempts.listAttemptsForProtocolWithDiagnostics.mockRejectedValueOnce(new Error('offline'));
        expect((await s.service.loadPlanningAssessmentSources('u1', [s.binding], '2026-10-11')).sources[0].unavailable).toBe(true);
    });

    it('carries attempt truncation and unreadable counts and bounds callers before querying', async () => {
        const s = setup();
        s.attempts.listAttemptsForProtocolWithDiagnostics.mockResolvedValue({ attempts: [s.attempt], unreadableCount: 3, truncated: true });
        const { sources } = await s.service.loadPlanningAssessmentSources('u1', [s.binding], '2026-10-11');
        expect(sources[0]).toMatchObject({ unreadableCount: 3, truncated: true });
        const bindings = Array.from({ length: 30 }, (_, i) => ({ protocolId: `p-${i}`, metricId: 'strength_1rm_kg' }));
        expect((await s.service.loadPlanningAssessmentSources('u1', bindings, '2026-10-11')).sources).toHaveLength(12);
    });

    it('auto-discovers completed attempts when explicit bindings are fewer than 12', async () => {
        const s = setup();
        s.attempts.listCompletedAttemptsWithDiagnostics.mockResolvedValue({
            attempts: [
                {
                    id: 'completed-jump',
                    protocolRef: { id: 'field-standing-broad-jump', revision: 2 },
                    state: 'completed',
                    purpose: 'baseline',
                    completedAt: '2026-10-10T10:00:00Z',
                },
            ],
            unreadableCount: 0,
            truncated: false,
        });
        const { sources } = await s.service.loadPlanningAssessmentSources('u1', [], '2026-10-11');
        expect(s.attempts.listCompletedAttemptsWithDiagnostics).toHaveBeenCalledWith('u1', 100);
        expect(sources.map(src => src.binding.protocolId)).toContain('field-standing-broad-jump');
    });

    it.each(['failed', 'truncated', 'unreadable'] as const)('reports %s completed-attempt discovery even without bindings', async kind => {
        const s = setup();
        if (kind === 'failed') s.attempts.listCompletedAttemptsWithDiagnostics.mockRejectedValueOnce(new Error('offline'));
        else s.attempts.listCompletedAttemptsWithDiagnostics.mockResolvedValueOnce({ attempts: [], unreadableCount: kind === 'unreadable' ? 1 : 0, truncated: kind === 'truncated' });
        const result = await s.service.loadPlanningAssessmentSources('u1', [], '2026-10-11');
        expect(result).toMatchObject({ sources: [], relevanceState: kind === 'failed' ? 'unavailable' : 'incomplete' });
        expect(result.relevanceNotes?.join(' ')).toContain('Completed assessment discovery');
    });

    it('does not let an explicit historical revision hide the current completed protocol', async () => {
        const s = setup();
        s.attempts.listCompletedAttemptsWithDiagnostics.mockResolvedValueOnce({ attempts: [{ ...s.attempt, protocolRef: { ...s.attempt.protocolRef, revision: 2 } }], unreadableCount: 0, truncated: false });
        const result = await s.service.loadPlanningAssessmentSources('u1', [{ ...s.binding, protocolRevision: 1 }], '2026-10-11');
        expect(result.sources.map(source => source.binding)).toEqual([
            { ...s.binding, protocolRevision: 1 }, s.binding,
        ]);
    });

    it('deduplicates a discovered current protocol already pinned explicitly', async () => {
        const s = setup();
        s.attempts.listCompletedAttemptsWithDiagnostics.mockResolvedValueOnce({ attempts: [{ ...s.attempt, protocolRef: { ...s.attempt.protocolRef, revision: 2 } }], unreadableCount: 0, truncated: false });
        const result = await s.service.loadPlanningAssessmentSources('u1', [{ ...s.binding, protocolRevision: 2 }], '2026-10-11');
        expect(result.sources).toHaveLength(1);
    });

});
