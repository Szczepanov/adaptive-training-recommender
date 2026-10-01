import { describe, expect, it, vi } from 'vitest';
import { AssessmentHistoryService } from './assessmentHistoryService';
import type { AssessmentAttemptService } from './assessmentAttemptService';
import type { MetricObservationService } from './metricObservationService';
import type { AssessmentTrialService } from './assessmentTrialService';
import type { MeasurementProtocolService } from './measurementProtocolService';
import type { RecoverySnapshotService } from './recoverySnapshotService';
import type { AnthropometryService } from './anthropometryService';
import { STANDING_BROAD_JUMP_PROTOCOL } from '../observations/physicalCapitalProtocols';
import { PERFORMANCE_TEST_DEFINITIONS } from '../observations/performanceTestingCatalog';
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
            listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (_uid: string, metricId: string) => {
                if (metricId === 'standing_broad_jump_distance_cm') {
                    return { observations: [{ head, revision }], unreadableCount: 0 };
                }
                return { observations: [], unreadableCount: 0 };
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
            getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue({ status: 'MISSING' }),
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
        const distanceMetric = broadJump?.metrics.find(metric => metric.metricId === 'standing_broad_jump_distance_cm');
        expect(distanceMetric?.activeSeries?.observations).toHaveLength(1);
        expect(distanceMetric?.activeSeries?.observations[0].value).toBe(235);

        // Crucial invariant: listTrialsForAttempt must NOT be called for history loading!
        expect(mockTrialService.listTrialsForAttempt).not.toHaveBeenCalled();
        expect(mockObservationService.getHead).not.toHaveBeenCalled();
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

    it('reads the provider lookback and refuses to substitute manual weight after a failed provider read (D8)', async () => {
        const bench = PERFORMANCE_TEST_DEFINITIONS.find(definition => definition.id === 'strength-bench-press-1rm-r2')!;
        const attempt: AssessmentAttempt = {
            id: 'att-bench',
            protocolRef: { id: bench.protocol.id, revision: bench.protocol.revision },
            scheduledDate: '2026-10-20',
            startedAt: '2026-10-20T09:00:00.000Z',
            completedAt: '2026-10-20T10:15:00.000Z',
            state: 'completed',
            purpose: 'baseline',
        };
        const key = 'att-bench:strength_1rm_kg';
        const head: MetricObservationHead = {
            observationKey: key, assessmentAttemptId: attempt.id, metricId: 'strength_1rm_kg', headRevision: 1,
            createdAt: '2026-10-20T10:15:00.000Z', updatedAt: '2026-10-20T10:15:00.000Z',
        };
        const revision: MetricObservationRevision = {
            observationKey: key, revision: 1, metricId: 'strength_1rm_kg', value: 100, unit: 'kg',
            observedAt: '2026-10-20T10:15:00.000Z', source: 'derived',
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: attempt.id, trialId: 'trial-3' }],
            algorithmVersion: 'assessment-reducer-v1',
            protocolRef: attempt.protocolRef, comparisonSeriesKey: 'series-bench', comparisonCanonicalizationVersion: 'comparison-series-v1',
            assessmentAttemptId: attempt.id, validity: 'valid', context: {}, createdAt: '2026-10-20T10:15:00.000Z',
        };
        const manualEntry = {
            id: 'm1', userId: 'user-123', date: '2026-10-20', observedAt: '2026-10-20T05:00:00.000Z',
            protocol: 'home_anthropometry@1', context: { morningPostVoidPreIntake: true, trainingBeforeMeasurement: false },
            measurements: [{ metricId: 'body_mass_kg', unit: 'kg', readings: [80], value: 80 }],
            schemaVersion: 1, revision: 1, createdAt: '2026-10-20T05:00:00.000Z', updatedAt: '2026-10-20T05:00:00.000Z',
        };

        const relativeContextFor = async (snapshotState: unknown) => {
            const snapshotService = {
                getRecoverySnapshotsInRangeState: vi.fn().mockResolvedValue(snapshotState),
            } as unknown as RecoverySnapshotService;
            const service = new AssessmentHistoryService(
                {
                    listAttemptsForProtocolWithDiagnostics: vi.fn(async (_uid: string, protocolId: string) => (
                        { attempts: protocolId === bench.protocol.id ? [attempt] : [], unreadableCount: 0 })),
                } as unknown as AssessmentAttemptService,
                {
                    listCurrentObservationsForMetricWithDiagnostics: vi.fn(async (_uid: string, metricId: string) => (
                        { observations: metricId === 'strength_1rm_kg' ? [{ head, revision }] : [], unreadableCount: 0 })),
                } as unknown as MetricObservationService,
                {} as AssessmentTrialService,
                {} as MeasurementProtocolService,
                snapshotService,
                { getEntriesInRange: vi.fn().mockResolvedValue([manualEntry]) } as unknown as AnthropometryService,
            );
            const history = await service.loadAssessmentHistory('user-123', [bench]);
            const row = history.tests[0].metrics[0].activeSeries!.observations[0];
            return { context: row.relativeContext, snapshotService };
        };

        const failed = await relativeContextFor({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        expect(failed.context).toEqual({});
        // 28-day provider-series lookback before the earliest test date, end exclusive.
        expect(failed.snapshotService.getRecoverySnapshotsInRangeState).toHaveBeenCalledWith('user-123', '2026-09-23', '2026-10-21');

        const noProviderSeries = await relativeContextFor({ status: 'MISSING' });
        expect(noProviderSeries.context).toMatchObject({ bodyMassSource: 'manual', relativeValue: 1.25, relativeUnit: 'kg/kg' });
    });
});
