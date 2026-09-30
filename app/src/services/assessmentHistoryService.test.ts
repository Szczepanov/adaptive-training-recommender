import { describe, expect, it, vi } from 'vitest';
import { AssessmentHistoryService } from './assessmentHistoryService';
import type { AssessmentAttemptService } from './assessmentAttemptService';
import type { MetricObservationService } from './metricObservationService';
import type { AssessmentTrialService } from './assessmentTrialService';
import type { MeasurementProtocolService } from './measurementProtocolService';
import type { RecoverySnapshotService } from './recoverySnapshotService';
import type { AnthropometryService } from './anthropometryService';
import { STANDING_BROAD_JUMP_PROTOCOL } from '../observations/physicalCapitalProtocols';
import type { AssessmentAttempt, MetricObservationHead, MetricObservationRevision } from '../observations/models';

describe('AssessmentHistoryService', () => {
    it('uses bounded queries and makes ZERO trial reads for loadAssessmentHistory (D5)', async () => {
        const attempt: AssessmentAttempt = {
            id: 'att-1',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 },
            scheduledDate: '2026-10-20',
            state: 'completed',
            purpose: 'baseline',
            completedAt: '2026-10-20T10:15:00.000Z',
        };

        const head: MetricObservationHead = {
            observationKey: 'att-1:standing_broad_jump_distance_cm',
            assessmentAttemptId: 'att-1',
            metricId: 'standing_broad_jump_distance_cm',
            headRevision: 1,
            createdAt: '2026-10-20T10:15:00.000Z',
            updatedAt: '2026-10-20T10:15:00.000Z',
        };

        const revision: MetricObservationRevision = {
            observationKey: 'att-1:standing_broad_jump_distance_cm',
            revision: 1,
            metricId: 'standing_broad_jump_distance_cm',
            value: 235,
            unit: 'cm',
            observedAt: '2026-10-20T10:15:00.000Z',
            source: 'derived',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-1' }],
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 },
            comparisonSeriesKey: 'series-1',
            comparisonCanonicalizationVersion: 'ov-series-v1',
            assessmentAttemptId: 'att-1',
            validity: 'valid',
            context: {},
            createdAt: '2026-10-20T10:15:00.000Z',
        };

        const mockAttemptService = {
            listAttemptsForProtocolWithDiagnostics: vi.fn(async (_uid: string, protocolId: string) => {
                if (protocolId === STANDING_BROAD_JUMP_PROTOCOL.id) {
                    return { attempts: [attempt], unreadableCount: 0 };
                }
                return { attempts: [], unreadableCount: 0 };
            }),
        } as unknown as AssessmentAttemptService;

        const mockObservationService = {
            listCurrentRevisionsForMetricWithDiagnostics: vi.fn(async (_uid: string, metricId: string) => {
                if (metricId === 'standing_broad_jump_distance_cm') {
                    return { revisions: [revision], unreadableCount: 0 };
                }
                return { revisions: [], unreadableCount: 0 };
            }),
            getHead: vi.fn(async (_uid: string, key: string) => {
                if (key === head.observationKey) return head;
                return null;
            }),
        } as unknown as MetricObservationService;

        const mockTrialService = {
            listTrialsForAttempt: vi.fn(),
        } as unknown as AssessmentTrialService;

        const mockProtocolService = {} as MeasurementProtocolService;
        const mockSnapshotService = {
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue({ snapshots: [] }),
        } as unknown as RecoverySnapshotService;
        const mockAnthroService = {
            getEntriesInRange: vi.fn().mockResolvedValue([]),
        } as unknown as AnthropometryService;

        const service = new AssessmentHistoryService(
            mockAttemptService,
            mockObservationService,
            mockTrialService,
            mockProtocolService,
            mockSnapshotService,
            mockAnthroService,
        );

        const history = await service.loadAssessmentHistory('user-123');

        expect(history.tests.length).toBeGreaterThan(0);
        const broadJump = history.tests.find(t => t.protocolId === STANDING_BROAD_JUMP_PROTOCOL.id);
        expect(broadJump?.activeSeries?.observations).toHaveLength(1);
        expect(broadJump?.activeSeries?.observations[0].value).toBe(235);

        // Crucial invariant: listTrialsForAttempt must NOT be called for history loading!
        expect(mockTrialService.listTrialsForAttempt).not.toHaveBeenCalled();
    });

    it('loads trials and revision history lazily only in loadAttemptDetail (D5)', async () => {
        const attempt: AssessmentAttempt = {
            id: 'att-1',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 },
            scheduledDate: '2026-10-20',
            state: 'completed',
            purpose: 'baseline',
            completedAt: '2026-10-20T10:15:00.000Z',
        };

        const head: MetricObservationHead = {
            observationKey: 'att-1:standing_broad_jump_distance_cm',
            assessmentAttemptId: 'att-1',
            metricId: 'standing_broad_jump_distance_cm',
            headRevision: 1,
            createdAt: '2026-10-20T10:15:00.000Z',
            updatedAt: '2026-10-20T10:15:00.000Z',
        };

        const revision: MetricObservationRevision = {
            observationKey: 'att-1:standing_broad_jump_distance_cm',
            revision: 1,
            metricId: 'standing_broad_jump_distance_cm',
            value: 235,
            unit: 'cm',
            observedAt: '2026-10-20T10:15:00.000Z',
            source: 'derived',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-1' }],
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 2 },
            comparisonSeriesKey: 'series-1',
            comparisonCanonicalizationVersion: 'ov-series-v1',
            assessmentAttemptId: 'att-1',
            validity: 'valid',
            context: {},
            createdAt: '2026-10-20T10:15:00.000Z',
        };

        const trial = {
            id: 'trial-1',
            assessmentAttemptId: 'att-1',
            ordinal: 1,
            correctionIndex: 0,
            validity: 'valid' as const,
            values: { distance_cm: 235 },
            createdAt: '2026-10-20T10:10:00.000Z',
        };

        const mockTrialService = {
            listTrialsForAttempt: vi.fn().mockResolvedValue([trial]),
        } as unknown as AssessmentTrialService;

        const mockObservationService = {
            getHead: vi.fn().mockResolvedValue(head),
            listRevisionsForObservation: vi.fn().mockResolvedValue([revision]),
        } as unknown as MetricObservationService;

        const mockProtocolService = {
            getRevision: vi.fn().mockResolvedValue({ ...STANDING_BROAD_JUMP_PROTOCOL, revision: 2 }),
        } as unknown as MeasurementProtocolService;

        const service = new AssessmentHistoryService(
            {} as AssessmentAttemptService,
            mockObservationService,
            mockTrialService,
            mockProtocolService,
            {} as RecoverySnapshotService,
            {} as AnthropometryService,
        );

        const detail = await service.loadAttemptDetail('user-123', attempt);
        expect(detail).not.toBeNull();
        expect(detail?.trials).toHaveLength(1);
        expect(detail?.trials[0].id).toBe('trial-1');
        expect(mockTrialService.listTrialsForAttempt).toHaveBeenCalledTimes(1);
        expect(mockObservationService.listRevisionsForObservation).toHaveBeenCalledTimes(1);
    });
});
