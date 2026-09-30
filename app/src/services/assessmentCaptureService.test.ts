import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssessmentCaptureService } from './assessmentCaptureService';
import type { AssessmentAttempt, AssessmentTrial, ComparisonContext, MetricObservationRevision } from '../observations/models';
import {
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
} from '../observations/physicalCapitalProtocols';
import type { AssessmentTrialService } from './assessmentTrialService';
import type { AssessmentAttemptService } from './assessmentAttemptService';
import type { MetricObservationService } from './metricObservationService';

function makeAttempt(overrides: Partial<AssessmentAttempt> = {}): AssessmentAttempt {
    return {
        id: 'att-1',
        protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
        scheduledDate: '2026-10-20',
        state: 'in_progress',
        purpose: 'baseline',
        ...overrides,
    };
}

function makeTrial(ordinal: number, distanceCm: number, overrides: Partial<AssessmentTrial> = {}): AssessmentTrial {
    return {
        id: `trial-${ordinal}`,
        assessmentAttemptId: 'att-1',
        ordinal,
        correctionIndex: 0,
        validity: 'valid',
        values: { distance_cm: distanceCm },
        context: { test_environment: 'indoor-gym-floor' },
        createdAt: '2026-10-20T10:00:00.000Z',
        ...overrides,
    };
}

describe('AssessmentCaptureService', () => {
    let mockTrialService: AssessmentTrialService;
    let mockAttemptService: AssessmentAttemptService;
    let mockObservationService: MetricObservationService;
    let service: AssessmentCaptureService;

    beforeEach(() => {
        mockTrialService = {
            createTrials: vi.fn().mockImplementation(async (_u, _p, _id, trials) => trials),
            createTrial: vi.fn().mockImplementation(async (_u, _p, trial) => trial),
            listTrialsForAttempt: vi.fn().mockResolvedValue([]),
            getTrial: vi.fn().mockResolvedValue(null),
        } as unknown as AssessmentTrialService;

        mockAttemptService = {
            getAttempt: vi.fn().mockImplementation(async (_u, id) => makeAttempt({ id })),
            completeAttempt: vi.fn().mockResolvedValue(undefined),
            startAttempt: vi.fn().mockResolvedValue(undefined),
            abandonAttempt: vi.fn().mockResolvedValue(undefined),
            findOpenAttempt: vi.fn().mockResolvedValue(null),
            listAttemptsForProtocol: vi.fn().mockResolvedValue([]),
        } as unknown as AssessmentAttemptService;

        mockObservationService = {
            createInitialRevision: vi.fn().mockImplementation(async (_u, rev) => rev),
            appendCorrection: vi.fn().mockImplementation(async (_u, rev) => rev),
            getCurrentRevision: vi.fn().mockResolvedValue(null),
            getHead: vi.fn().mockResolvedValue(null),
            getRevision: vi.fn().mockResolvedValue(null),
            listRevisionsForObservation: vi.fn().mockResolvedValue([]),
        } as unknown as MetricObservationService;

        service = new AssessmentCaptureService(mockTrialService, mockAttemptService, mockObservationService);
    });

    it('orchestrates save in strict order: trials -> list -> derive -> initial observations -> complete attempt', async () => {
        const attempt = makeAttempt();
        const trials = [makeTrial(1, 230), makeTrial(2, 240)];
        vi.mocked(mockTrialService.listTrialsForAttempt).mockResolvedValue(trials);

        const executionOrder: string[] = [];
        vi.mocked(mockTrialService.createTrials).mockImplementation(async () => {
            executionOrder.push('createTrials');
            return trials;
        });
        vi.mocked(mockTrialService.listTrialsForAttempt).mockImplementation(async () => {
            executionOrder.push('listTrials');
            return trials;
        });
        vi.mocked(mockObservationService.createInitialRevision).mockImplementation(async (_u, rev) => {
            executionOrder.push('createInitialRevision');
            return rev;
        });
        vi.mocked(mockAttemptService.completeAttempt).mockImplementation(async () => {
            executionOrder.push('completeAttempt');
        });

        const result = await service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials,
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
            sourceRef: 'execution:exec-1',
        });

        expect(executionOrder).toEqual(['createTrials', 'listTrials', 'createInitialRevision', 'completeAttempt']);
        expect(result.observations).toHaveLength(1);
        expect(result.observations[0].value).toBe(240);
        expect(result.observations[0].derivedFromEvidenceRefs).toEqual([
            { kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-2' },
        ]);
        expect(result.missingMetricIds).toHaveLength(0);
    });

    it('requires confirmation when missingMetricIds is non-empty and does not complete attempt without confirmation', async () => {
        const attempt = makeAttempt();
        const invalidTrials = [
            makeTrial(1, 230, { validity: 'invalid', invalidReason: 'Fell backward' }),
        ];
        vi.mocked(mockTrialService.listTrialsForAttempt).mockResolvedValue(invalidTrials);

        // First attempt: without allowMissingBenchmark
        const partialResult = await service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials: invalidTrials,
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
            allowMissingBenchmark: false,
        });

        expect(partialResult.missingMetricIds).toEqual(['standing_broad_jump_distance_cm']);
        expect(partialResult.observations).toHaveLength(0);
        expect(mockObservationService.createInitialRevision).not.toHaveBeenCalled();
        expect(mockAttemptService.completeAttempt).not.toHaveBeenCalled();

        // Second attempt: with allowMissingBenchmark
        const confirmedResult = await service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials: invalidTrials,
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
            allowMissingBenchmark: true,
        });

        expect(confirmedResult.missingMetricIds).toEqual(['standing_broad_jump_distance_cm']);
        expect(mockAttemptService.completeAttempt).toHaveBeenCalledWith(
            'user-1',
            'att-1',
            '2026-10-20T10:15:00.000Z',
            expect.stringContaining('Completed without benchmarks for: standing_broad_jump_distance_cm'),
        );
    });

    it('idempotently converges on retry if observations or trials were partially saved', async () => {
        const attempt = makeAttempt();
        const trials = [makeTrial(1, 230)];
        vi.mocked(mockTrialService.listTrialsForAttempt).mockResolvedValue(trials);

        // First call fails at completeAttempt
        vi.mocked(mockAttemptService.completeAttempt).mockRejectedValueOnce(new Error('Network error on complete'));

        await expect(service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials,
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
        })).rejects.toThrow('Network error on complete');

        // Retry converges
        const retryResult = await service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trials,
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
        });

        expect(retryResult.observations).toHaveLength(1);
        expect(mockAttemptService.completeAttempt).toHaveBeenCalled();
    });

    it('fails closed when a resubmission drops a trial that an interrupted save already stored', async () => {
        const stored = [makeTrial(1, 230), makeTrial(2, 240)];
        vi.mocked(mockTrialService.listTrialsForAttempt).mockResolvedValue(stored);

        await expect(service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt: makeAttempt(),
            trials: [makeTrial(1, 230)],
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
        })).rejects.toThrow(/trial-2.*cannot be removed/);
        expect(mockObservationService.createInitialRevision).not.toHaveBeenCalled();
        expect(mockAttemptService.completeAttempt).not.toHaveBeenCalled();
    });

    it('refuses save on an abandoned attempt', async () => {
        const abandonedAttempt = makeAttempt({ state: 'abandoned' });
        await expect(service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt: abandonedAttempt,
            trials: [makeTrial(1, 230)],
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
        })).rejects.toThrow(/abandoned/);
    });

    it('handles post-completion trial correction, re-deriving and updating only changed metrics', async () => {
        const attempt = makeAttempt({
            state: 'completed',
            completedAt: '2026-10-20T10:15:00.000Z',
            protocolRef: { id: CYCLING_6S_SEATED_SPRINT_PROTOCOL.id, revision: 1 },
        });
        vi.mocked(mockAttemptService.getAttempt).mockResolvedValue(attempt);

        // Protocol with two metrics: 1s peak and 5s mean
        const trial1: AssessmentTrial = {
            id: 'trial-1',
            assessmentAttemptId: 'att-1',
            ordinal: 1,
            correctionIndex: 0,
            validity: 'valid',
            values: { peak_power_1s_w: 1200, mean_power_5s_w: 1100 },
            context: {
                power_source_id: 'assioma-duo',
                bike_setup_id: 'kickr-v6',
                test_environment: 'indoor-trainer',
                start_mode: 'seated-rolling',
                warmup_revision: 'cycling-sprint-warmup-r1',
            },
            createdAt: '2026-10-20T10:00:00.000Z',
        };
        const trial2: AssessmentTrial = {
            id: 'trial-2',
            assessmentAttemptId: 'att-1',
            ordinal: 2,
            correctionIndex: 0,
            validity: 'valid',
            values: { peak_power_1s_w: 1250, mean_power_5s_w: 1050 },
            context: {
                power_source_id: 'assioma-duo',
                bike_setup_id: 'kickr-v6',
                test_environment: 'indoor-trainer',
                start_mode: 'seated-rolling',
                warmup_revision: 'cycling-sprint-warmup-r1',
            },
            createdAt: '2026-10-20T10:05:00.000Z',
        };

        // Initially: 1s peak comes from trial-2 (1250 W), 5s mean comes from trial-1 (1100 W)
        const peakRev1: MetricObservationRevision = {
            observationKey: 'att-1:cycling_sprint_1s_peak_power_w',
            revision: 1,
            metricId: 'cycling_sprint_1s_peak_power_w',
            value: 1250,
            unit: 'W',
            observedAt: '2026-10-20T10:15:00.000Z',
            source: 'derived',
            protocolRef: { id: CYCLING_6S_SEATED_SPRINT_PROTOCOL.id, revision: 1 },
            comparisonSeriesKey: 'series-sprint',
            comparisonCanonicalizationVersion: 'comparison-series-v1',
            assessmentAttemptId: 'att-1',
            validity: 'valid',
            context: trial1.context,
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-2' }],
            algorithmVersion: 'assessment-reducer-v1',
            createdAt: '2026-10-20T10:15:00.000Z',
        };
        const meanRev1: MetricObservationRevision = {
            observationKey: 'att-1:cycling_sprint_5s_mean_power_w',
            revision: 1,
            metricId: 'cycling_sprint_5s_mean_power_w',
            value: 1100,
            unit: 'W',
            observedAt: '2026-10-20T10:15:00.000Z',
            source: 'derived',
            protocolRef: { id: CYCLING_6S_SEATED_SPRINT_PROTOCOL.id, revision: 1 },
            comparisonSeriesKey: 'series-sprint',
            comparisonCanonicalizationVersion: 'comparison-series-v1',
            assessmentAttemptId: 'att-1',
            validity: 'valid',
            context: trial1.context,
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-1' }],
            algorithmVersion: 'assessment-reducer-v1',
            createdAt: '2026-10-20T10:15:00.000Z',
        };

        vi.mocked(mockObservationService.getCurrentRevision).mockImplementation(async (_u, key) => {
            if (key.includes('1s_peak')) return peakRev1;
            if (key.includes('5s_mean')) return meanRev1;
            return null;
        });

        // Athlete corrects trial 2: peak power was misread as 1250 W, was actually 1220 W.
        // 1s peak changes from 1250 W to 1220 W (still from trial 2).
        // 5s mean power is still 1100 W from trial 1 (unchanged!).
        const trial2Correction: AssessmentTrial = {
            id: 'trial-2-c1',
            assessmentAttemptId: 'att-1',
            ordinal: 2,
            correctionIndex: 1,
            supersedesTrialId: 'trial-2',
            correctionReason: 'Misread screen on trial 2: actual peak was 1220 W',
            validity: 'valid',
            values: { peak_power_1s_w: 1220, mean_power_5s_w: 1050 },
            context: trial1.context,
            createdAt: '2026-10-20T10:30:00.000Z',
        };

        vi.mocked(mockTrialService.listTrialsForAttempt).mockResolvedValue([trial1, trial2, trial2Correction]);

        const correctResult = await service.correctTrial({
            userId: 'user-1',
            protocol: CYCLING_6S_SEATED_SPRINT_PROTOCOL,
            attempt,
            trial: trial2Correction,
            context: trial1.context as ComparisonContext,
            observedAt: '2026-10-20T10:15:00.000Z',
        });

        // appendCorrection should be called for 1s peak (value changed from 1250 to 1220),
        // but NOT for 5s mean (value is still 1100, source trial is still trial-1)!
        expect(mockObservationService.appendCorrection).toHaveBeenCalledTimes(1);
        expect(correctResult.updatedObservations).toHaveLength(1);
        expect(correctResult.updatedObservations[0].metricId).toBe('cycling_sprint_1s_peak_power_w');
        expect(correctResult.updatedObservations[0].value).toBe(1220);
        expect(correctResult.updatedObservations[0].revision).toBe(2);
        expect(correctResult.updatedObservations[0].supersedesRevision).toBe(1);
    });

    it('fails closed when a correction would leave a previously benchmarked metric without any valid trial', async () => {
        const attempt = makeAttempt({ state: 'completed', completedAt: '2026-10-20T10:15:00.000Z' });
        vi.mocked(mockAttemptService.getAttempt).mockResolvedValue(attempt);

        const trial1 = makeTrial(1, 230);
        const existingObs: MetricObservationRevision = {
            observationKey: 'att-1:standing_broad_jump_distance_cm',
            revision: 1,
            metricId: 'standing_broad_jump_distance_cm',
            value: 230,
            unit: 'cm',
            observedAt: '2026-10-20T10:15:00.000Z',
            source: 'derived',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
            comparisonSeriesKey: 'series-1',
            comparisonCanonicalizationVersion: 'comparison-series-v1',
            assessmentAttemptId: 'att-1',
            validity: 'valid',
            context: { test_environment: 'indoor-gym-floor' },
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-1' }],
            algorithmVersion: 'assessment-reducer-v1',
            createdAt: '2026-10-20T10:15:00.000Z',
        };
        vi.mocked(mockObservationService.getCurrentRevision).mockResolvedValue(existingObs);

        // Correcting trial 1 to invalid -> leaves no valid trial for the metric!
        const trial1Correction: AssessmentTrial = {
            id: 'trial-1-c1',
            assessmentAttemptId: 'att-1',
            ordinal: 1,
            correctionIndex: 1,
            supersedesTrialId: 'trial-1',
            correctionReason: 'Realized athlete stepped on line',
            validity: 'invalid',
            invalidReason: 'Stepped over line',
            values: { distance_cm: 230 },
            context: { test_environment: 'indoor-gym-floor' },
            createdAt: '2026-10-20T10:30:00.000Z',
        };
        // Stored state before the correction: only the original trial.
        vi.mocked(mockTrialService.listTrialsForAttempt).mockResolvedValue([trial1]);

        await expect(service.correctTrial({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trial: trial1Correction,
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
        })).rejects.toThrow(/without any valid trial/);

        // Fail closed BEFORE any write: no orphaned superseding trial contradicts the benchmark.
        expect(mockTrialService.createTrial).not.toHaveBeenCalled();
        expect(mockObservationService.appendCorrection).not.toHaveBeenCalled();
    });

    it('persists a superseding trial only after the corrected derivation succeeds', async () => {
        const attempt = makeAttempt({ state: 'completed', completedAt: '2026-10-20T10:15:00.000Z' });
        vi.mocked(mockAttemptService.getAttempt).mockResolvedValue(attempt);
        const trial1 = makeTrial(1, 230);
        const existingObs: MetricObservationRevision = {
            observationKey: 'att-1:standing_broad_jump_distance_cm',
            revision: 1,
            metricId: 'standing_broad_jump_distance_cm',
            value: 230,
            unit: 'cm',
            observedAt: '2026-10-20T10:15:00.000Z',
            source: 'derived',
            protocolRef: { id: STANDING_BROAD_JUMP_PROTOCOL.id, revision: 1 },
            comparisonSeriesKey: 'series-1',
            comparisonCanonicalizationVersion: 'comparison-series-v1',
            assessmentAttemptId: 'att-1',
            validity: 'valid',
            context: { test_environment: 'indoor-gym-floor' },
            derivedFromEvidenceRefs: [{ kind: 'assessment_trial', assessmentAttemptId: 'att-1', trialId: 'trial-1' }],
            algorithmVersion: 'assessment-reducer-v1',
            sourceRef: 'execution:exec-1',
            createdAt: '2026-10-20T10:15:00.000Z',
        };
        vi.mocked(mockObservationService.getCurrentRevision).mockResolvedValue(existingObs);
        vi.mocked(mockTrialService.listTrialsForAttempt).mockResolvedValue([trial1]);

        const order: string[] = [];
        vi.mocked(mockTrialService.createTrial).mockImplementation(async (_u, _p, trial) => {
            order.push('createTrial');
            return trial;
        });
        vi.mocked(mockObservationService.appendCorrection).mockImplementation(async (_u, rev) => {
            order.push('appendCorrection');
            return rev;
        });

        const correction = makeTrial(1, 236, {
            id: 'trial-1-c1',
            correctionIndex: 1,
            supersedesTrialId: 'trial-1',
            correctionReason: 'Tape misread',
        });
        const result = await service.correctTrial({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt,
            trial: correction,
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
        });

        expect(order).toEqual(['createTrial', 'appendCorrection']);
        // No sourceRef supplied: the correction keeps the superseded revision's provenance.
        expect(result.updatedObservations[0].sourceRef).toBe('execution:exec-1');
        expect(result.trials.map(trial => trial.id)).toEqual(['trial-1', 'trial-1-c1']);
        expect(result.updatedObservations[0]).toMatchObject({ value: 236, revision: 2, supersedesRevision: 1 });
    });

    it('refuses to record trials on an attempt that has not started', async () => {
        vi.mocked(mockAttemptService.getAttempt).mockResolvedValue(makeAttempt({ state: 'scheduled' }));

        await expect(service.saveTrialAssessment({
            userId: 'user-1',
            protocol: STANDING_BROAD_JUMP_PROTOCOL,
            attempt: makeAttempt({ state: 'scheduled' }),
            trials: [makeTrial(1, 230)],
            context: { test_environment: 'indoor-gym-floor' },
            observedAt: '2026-10-20T10:15:00.000Z',
        })).rejects.toThrow(/before the assessment attempt has started/);
        expect(mockTrialService.createTrials).not.toHaveBeenCalled();
        expect(mockAttemptService.completeAttempt).not.toHaveBeenCalled();
    });
});
