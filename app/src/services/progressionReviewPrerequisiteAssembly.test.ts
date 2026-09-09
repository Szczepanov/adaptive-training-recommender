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

import type { IntentBlock } from '../engine/blockIntent';
import { evaluateProgressionReview } from '../engine/progressionReview';
import { assembleProgressionReviewInput } from './progressionReviewInputService';

const USER_ID = 'u-prereq';
const REVIEW_DATE = '2026-09-15';

function block(entryPrerequisites: NonNullable<IntentBlock['objectives'][number]['entryPrerequisites']>): IntentBlock {
    return {
        id: 'block-prereq',
        revision: 1,
        sourcePlanId: 'block-prereq',
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
            entryPrerequisites,
        }],
        reviewSchedule: { reviewCadenceDays: 14, nextReviewDate: REVIEW_DATE },
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
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    facts.getPerformedTrainingFactsInRange.mockResolvedValue({
        asOfDate: 'x', windowDays: 0, revision: 'facts', exposures: [], coverageCredits: [],
    });
    outcomes.sessionOutcomeReportService.buildReport.mockResolvedValue([]);
    repository.performedTrainingOccurrenceRepository.getById.mockResolvedValue(null);
    executions.sessionExecutionService.getExecution.mockResolvedValue({ status: 'MISSING' });
    prescriptions.executionPrescriptionService.getPrescription.mockResolvedValue({ status: 'MISSING' });
    checkins.checkinService.getCheckinsInRange.mockResolvedValue([]);
    settings.trainingSettingsService.peekTrainingSettingsState.mockResolvedValue({ status: 'MISSING' });
});

describe('H5c prerequisite evidence assembly', () => {
    it('does not turn an arbitrary lookback range or old exposure into baseline-duration evidence', async () => {
        const input = await assembleProgressionReviewInput(
            USER_ID,
            block({ minBaselineDays: 30 }),
            REVIEW_DATE,
        );

        expect(input.prerequisiteEvidence).toEqual({});
        expect(input.prerequisiteEvidence?.baselineDays).toBeUndefined();
        const result = evaluateProgressionReview(input);
        expect(result.action).toBe('hold');
        expect(result.reasons).toContain('required_baseline_duration_evidence_missing');
    });

    it('treats no check-in tissue responses as missing prerequisite evidence, not a clean result', async () => {
        const input = await assembleProgressionReviewInput(
            USER_ID,
            block({ prohibitedTissueSeverities: ['limit'] }),
            REVIEW_DATE,
        );

        expect(input.prerequisiteEvidence?.observedTissueSeverities).toBeUndefined();
        const result = evaluateProgressionReview(input);
        expect(result.action).toBe('hold');
        expect(result.reasons).toContain('required_tissue_prerequisite_evidence_missing');
    });

    it('passes through real interpretable tissue evidence so prohibited severity still fails closed', async () => {
        checkins.checkinService.getCheckinsInRange.mockResolvedValueOnce([{
            tissueResponses: { knee: { region: 'knee', morningState: 'moderate' } },
        }]);

        const input = await assembleProgressionReviewInput(
            USER_ID,
            block({ prohibitedTissueSeverities: ['limit'] }),
            REVIEW_DATE,
        );

        expect(input.prerequisiteEvidence?.observedTissueSeverities).toContain('limit');
        const result = evaluateProgressionReview(input);
        expect(result.action).toBe('hold');
        expect(result.reasons).toContain('prohibited_tissue_severity_present: limit');
    });
});
