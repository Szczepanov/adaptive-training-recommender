import { beforeEach, describe, expect, it, vi } from 'vitest';

const facts = vi.hoisted(() => ({ getPerformedTrainingFactsInRange: vi.fn() }));
vi.mock('../training-occurrence/performedTrainingFactsService', () => facts);

const repository = vi.hoisted(() => ({ performedTrainingOccurrenceRepository: { getById: vi.fn() } }));
vi.mock('../training-occurrence/repository', () => repository);

const outcomes = vi.hoisted(() => ({ sessionOutcomeReportService: { buildReport: vi.fn() } }));
vi.mock('./sessionOutcomeReportService', () => outcomes);

const executions = vi.hoisted(() => ({ sessionExecutionService: { getExecution: vi.fn() } }));
vi.mock('./sessionExecutionService', () => executions);

const prescriptions = vi.hoisted(() => ({ executionPrescriptionService: { getPrescription: vi.fn() } }));
vi.mock('./executionPrescriptionService', () => prescriptions);

const checkins = vi.hoisted(() => ({ checkinService: { getCheckinsInRange: vi.fn() } }));
vi.mock('./checkinService', () => checkins);

const settings = vi.hoisted(() => ({ trainingSettingsService: { peekTrainingSettingsState: vi.fn() } }));
vi.mock('./trainingSettingsService', () => settings);

import { assembleProgressionReviewInput } from './progressionReviewInputService';
import { evaluateProgressionReview } from '../engine/progressionReview';
import type { IntentBlock } from '../engine/blockIntent';
import type { PerformedExposureFact, CoverageCreditFact } from '../engine/performedTrainingFacts';

const USER_ID = 'u1';

function block(overrides: Partial<IntentBlock> = {}): IntentBlock {
    return {
        id: 'block_1',
        revision: 1,
        sourcePlanId: 'block_1',
        sourcePlanRevision: 1,
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        objectives: [{
            id: 'obj_1',
            sport: 'cycling',
            adaptationScope: 'threshold_quality',
            coverageKey: 'sustained_quality',
            intent: 'develop',
            priority: 'must_have',
            doseEnvelope: { min: 60, target: 90, max: 120, unit: 'minutes', floorSemantics: 'hard_floor' },
            knowledgeLineage: ['athlete-authored-manual-v1'],
            successCriteria: { minCompletedExposures: 3 },
        }],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: '2026-09-15' },
        progressionContract: {
            targetBinding: { objectiveId: 'obj_1' },
            variable: 'duration_min',
            unit: 'minutes',
            currentValue: 90,
            permittedRange: { min: 60, max: 120 },
            increment: 10,
            knowledgeLineage: ['policy_progression_duration_v1'],
            observationWindowDays: 14,
            minCompletedExposures: 3,
            requiredFollowUpCoveragePct: 66,
            reviewCadenceDays: 14,
            reductionAlternative: { decrement: 10, trigger: 'adverse_response' },
        },
        ...overrides,
    };
}

function externalPlanBlock(): IntentBlock {
    const result = block({ sourcePlanId: 'plan-1' });
    result.progressionContract = {
        ...result.progressionContract!,
        targetBinding: { objectiveId: 'obj_1', sessionId: 'session-1' },
    };
    return result;
}

function exposure(overrides: Partial<PerformedExposureFact> = {}): PerformedExposureFact {
    return {
        performedOccurrenceId: 'occ-1',
        localDate: '2026-09-05',
        durationMin: 90,
        modality: 'Cycling',
        confidence: 'high',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'exact',
        ...overrides,
    } as PerformedExposureFact;
}

function credit(overrides: Partial<CoverageCreditFact> = {}): CoverageCreditFact {
    return {
        performedOccurrenceId: 'occ-1',
        coverageSetId: 'evergreen_general' as CoverageCreditFact['coverageSetId'],
        coverageKey: 'sustained_quality',
        creditKind: 'exact',
        confidence: 1,
        reasonCode: 'exact_workout_identity',
        sourceKinds: ['structured_execution'],
        ...overrides,
    };
}

function bindPinnedExternalPrescription(occurrenceId = 'occ-1', executionId = 'exec-1'): void {
    const sessionSource = {
        kind: 'external_plan' as const,
        planId: 'plan-1',
        revision: 1,
        sessionId: 'session-1',
        contentHash: 'content-1',
    };
    repository.performedTrainingOccurrenceRepository.getById.mockResolvedValueOnce({
        performedOccurrenceId: occurrenceId,
        sourceRefs: [{ kind: 'structured_execution', executionId, prescriptionHash: 'rx-1' }],
    });
    executions.sessionExecutionService.getExecution.mockResolvedValueOnce({
        status: 'AVAILABLE',
        data: {
            userId: USER_ID,
            executionId,
            sessionSource,
            prescriptionHash: 'rx-1',
            date: '2026-09-05',
            startedAt: '2026-09-05T08:00:00.000Z',
            completedAt: '2026-09-05T09:30:00.000Z',
            updatedAt: '2026-09-05T09:30:00.000Z',
            state: 'completed',
            schemaVersion: 1,
        },
        revision: null,
    });
    prescriptions.executionPrescriptionService.getPrescription.mockResolvedValueOnce({
        status: 'AVAILABLE',
        data: {
            schemaVersion: 1,
            prescriptionHash: 'rx-1',
            sessionSource,
            definitionHash: 'definition-1',
            blocks: [],
            displayMetadata: {
                title: 'Threshold quality',
                intent: 'training',
                duration: { min: 90, max: 90 },
            },
            createdAt: '2026-09-01T00:00:00.000Z',
        },
        revision: null,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    facts.getPerformedTrainingFactsInRange.mockResolvedValue({
        asOfDate: 'x', windowDays: 0, revision: 'x', exposures: [], coverageCredits: [],
    });
    outcomes.sessionOutcomeReportService.buildReport.mockResolvedValue([]);
    executions.sessionExecutionService.getExecution.mockResolvedValue({ status: 'MISSING' });
    prescriptions.executionPrescriptionService.getPrescription.mockResolvedValue({ status: 'MISSING' });
    checkins.checkinService.getCheckinsInRange.mockResolvedValue([]);
    settings.trainingSettingsService.peekTrainingSettingsState.mockResolvedValue({ status: 'MISSING' });
    repository.performedTrainingOccurrenceRepository.getById.mockResolvedValue(null);
});

describe('assembleProgressionReviewInput', () => {
    it('returns empty linked exposures and no prerequisite evidence when there is no progression contract', async () => {
        const result = await assembleProgressionReviewInput(USER_ID, block({ progressionContract: undefined }), '2026-09-20');
        expect(result.linkedExposures).toEqual([]);
        expect(result.prerequisiteEvidence).toBeUndefined();
    });

    it('does not manufacture a current-prescription match from exact coverage and performed duration alone', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit()],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures).toHaveLength(1);
        expect(result.linkedExposures[0].prescription.status).toBe('partial');
        expect(Number.isNaN(result.linkedExposures[0].prescription.value)).toBe(true);
    });

    it('matches only when exact coverage, source revision, immutable prescription and delivered dose all match', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit()],
        });
        bindPinnedExternalPrescription();

        const result = await assembleProgressionReviewInput(USER_ID, externalPlanBlock(), '2026-09-20');
        expect(result.linkedExposures[0].prescription).toMatchObject({
            status: 'matched_current_target',
            sourcePlanRevision: 1,
            sessionId: 'session-1',
            variable: 'duration_min',
            unit: 'minutes',
            value: 90,
        });
    });

    it('classifies a pinned prescription at the wrong source-plan revision as mismatch', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit()],
        });
        const sessionSource = {
            kind: 'external_plan' as const,
            planId: 'plan-1', revision: 2, sessionId: 'session-1', contentHash: 'content-2',
        };
        repository.performedTrainingOccurrenceRepository.getById.mockResolvedValueOnce({
            performedOccurrenceId: 'occ-1',
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', prescriptionHash: 'rx-2' }],
        });
        executions.sessionExecutionService.getExecution.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: {
                userId: USER_ID, executionId: 'exec-1', sessionSource, prescriptionHash: 'rx-2',
                date: '2026-09-05', startedAt: '2026-09-05T08:00:00.000Z',
                completedAt: '2026-09-05T09:30:00.000Z', updatedAt: '2026-09-05T09:30:00.000Z',
                state: 'completed', schemaVersion: 1,
            },
            revision: null,
        });
        prescriptions.executionPrescriptionService.getPrescription.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: {
                schemaVersion: 1, prescriptionHash: 'rx-2', sessionSource, definitionHash: 'definition-2', blocks: [],
                displayMetadata: { title: 'Threshold quality', intent: 'training', duration: { min: 90, max: 90 } },
                createdAt: '2026-09-01T00:00:00.000Z',
            },
            revision: null,
        });

        const result = await assembleProgressionReviewInput(USER_ID, externalPlanBlock(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('mismatch');
        expect(result.linkedExposures[0].prescription.sourcePlanRevision).toBe(2);
    });

    it('keeps a matching prescription partial when delivered duration is materially short', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure({ durationMin: 40 })], coverageCredits: [credit()],
        });
        bindPinnedExternalPrescription();
        const result = await assembleProgressionReviewInput(USER_ID, externalPlanBlock(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('partial');
        expect(result.linkedExposures[0].prescription.value).toBe(90);
    });

    it('classifies a semantic-confident credit as partial even with real performed work', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit({ creditKind: 'semantic_confident' })],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('partial');
    });

    it('classifies real work credited only to a different role as mismatch', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit({ coverageKey: 'recovery_spin' })],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('mismatch');
    });

    it('classifies an exposure with no coverage credits at all as unknown', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x', exposures: [exposure()], coverageCredits: [],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('unknown');
    });

    it('joins a structured-execution exposure to its SessionOutcome by resolved execution id', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x', exposures: [exposure()], coverageCredits: [credit()],
        });
        repository.performedTrainingOccurrenceRepository.getById.mockResolvedValueOnce({
            performedOccurrenceId: 'occ-1', sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        });
        executions.sessionExecutionService.getExecution.mockResolvedValueOnce({ status: 'MISSING' });
        const sessionOutcome = { sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-09-05' }, response: 'unknown' };
        outcomes.sessionOutcomeReportService.buildReport.mockResolvedValueOnce([sessionOutcome]);

        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].outcome).toEqual(sessionOutcome);
    });

    it('does not attempt an occurrence lookup for a non-structured-execution exposure', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure({ sourceKinds: ['provider_activity'] })], coverageCredits: [],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(repository.performedTrainingOccurrenceRepository.getById).not.toHaveBeenCalled();
        expect(result.linkedExposures[0].outcome).toBeUndefined();
    });

    it('derives observedTissueSeverities from check-in tissue responses via deriveTissueSeverity', async () => {
        checkins.checkinService.getCheckinsInRange.mockResolvedValueOnce([{
            tissueResponses: { knee: { region: 'knee', morningState: 'moderate' } },
        }]);
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.prerequisiteEvidence?.observedTissueSeverities).toContain('limit');
    });

    it('derives activeRestrictions from active (non-expired) injury constraints', async () => {
        settings.trainingSettingsService.peekTrainingSettingsState.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: { injuries: [{ severity: 'exclude', region: 'shoulder', reviewBy: '2026-12-01' }] },
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.activeRestrictions).toEqual({ hasAdverseTissue: true, prohibitedRegions: ['shoulder'] });
    });

    it('excludes an injury constraint that already expired before asOfDate', async () => {
        settings.trainingSettingsService.peekTrainingSettingsState.mockResolvedValueOnce({
            status: 'AVAILABLE',
            data: { injuries: [{ severity: 'exclude', region: 'shoulder', reviewBy: '2026-09-01' }] },
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.activeRestrictions).toEqual({ hasAdverseTissue: false });
    });

    it('feeds real-but-unpinned exposure evidence to the evaluator without accidentally authorizing progression', async () => {
        const exposures = ['2026-09-05', '2026-09-08', '2026-09-12']
            .map(localDate => exposure({ performedOccurrenceId: `occ-${localDate}`, localDate }));
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 14, revision: 'x',
            exposures,
            coverageCredits: exposures.map(item => credit({ performedOccurrenceId: item.performedOccurrenceId })),
        });

        const input = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-15');
        const result = evaluateProgressionReview(input);

        expect(result.evidenceAudit.candidateExposureCount).toBe(3);
        expect(result.evidenceAudit.exposuresObserved).toBe(0);
        expect(result.action).toBe('hold');
    });
});
