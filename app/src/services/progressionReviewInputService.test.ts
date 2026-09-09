import { beforeEach, describe, expect, it, vi } from 'vitest';

const facts = vi.hoisted(() => ({ getPerformedTrainingFactsInRange: vi.fn() }));
vi.mock('../training-occurrence/performedTrainingFactsService', () => facts);

const repository = vi.hoisted(() => ({ performedTrainingOccurrenceRepository: { getById: vi.fn() } }));
vi.mock('../training-occurrence/repository', () => repository);

const outcomes = vi.hoisted(() => ({ sessionOutcomeReportService: { buildReport: vi.fn() } }));
vi.mock('./sessionOutcomeReportService', () => outcomes);

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

beforeEach(() => {
    vi.clearAllMocks();
    facts.getPerformedTrainingFactsInRange.mockResolvedValue({ asOfDate: 'x', windowDays: 0, revision: 'x', exposures: [], coverageCredits: [] });
    outcomes.sessionOutcomeReportService.buildReport.mockResolvedValue([]);
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

    it('classifies an exact-credit exposure within tolerance as matched_current_target', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit()],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures).toHaveLength(1);
        expect(result.linkedExposures[0].prescription.status).toBe('matched_current_target');
        expect(result.linkedExposures[0].prescription.value).toBe(90);
    });

    it('classifies an exact-credit exposure far from the contract value as partial', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure({ durationMin: 40 })], coverageCredits: [credit()],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('partial');
    });

    it('classifies a semantic-confident credit as partial', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit({ creditKind: 'semantic_confident' })],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('partial');
    });

    it('classifies real work credited to a different role as mismatch', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit({ coverageKey: 'recovery_spin' })],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('mismatch');
    });

    it('classifies an exposure with no coverage credits at all as unknown', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [],
        });
        const result = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-20');
        expect(result.linkedExposures[0].prescription.status).toBe('unknown');
    });

    it('joins a structured-execution exposure to its SessionOutcome by resolved execution id', async () => {
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 1, revision: 'x',
            exposures: [exposure()], coverageCredits: [credit()],
        });
        repository.performedTrainingOccurrenceRepository.getById.mockResolvedValueOnce({
            performedOccurrenceId: 'occ-1',
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        });
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

    it('feeds a fully-populated assembly straight into evaluateProgressionReview and does not hold on missing data', async () => {
        const exposures = ['2026-09-05', '2026-09-08', '2026-09-12'].map(localDate => exposure({ performedOccurrenceId: `occ-${localDate}`, localDate }));
        facts.getPerformedTrainingFactsInRange.mockResolvedValueOnce({
            asOfDate: 'x', windowDays: 14, revision: 'x',
            exposures,
            coverageCredits: exposures.map(item => credit({ performedOccurrenceId: item.performedOccurrenceId })),
        });

        // Must be on/after reviewSchedule.nextReviewDate (2026-09-15 in the fixture), or the
        // evaluator holds as "not yet due" before ever counting evidence.
        const input = await assembleProgressionReviewInput(USER_ID, block(), '2026-09-15');
        const result = evaluateProgressionReview(input);

        expect(result.reasons).not.toContain('missing_progression_contract');
        expect(result.evidenceAudit.candidateExposureCount).toBe(3);
        expect(['advance_proposal', 'hold', 'reduce_proposal', 'redirect']).toContain(result.action);
    });
});
