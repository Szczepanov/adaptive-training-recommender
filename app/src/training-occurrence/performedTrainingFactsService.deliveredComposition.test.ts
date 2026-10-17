import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPerformedTrainingFactsInRange } from './performedTrainingFactsService';
import { performedTrainingOccurrenceRepository as repository } from './repository';
import type { PerformedTrainingOccurrence } from './models';
import { activityService } from '../services/activityService';
import { activityOverrideService } from '../services/activityOverrideService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import type { SessionEntry, SessionExecution } from '../sessions/models';

// Issue #813 / #803: delivered unilateral work is export-only provenance. The brief path
// (`includeDisplayProvenance`) reads the execution's logged sets; the default decision path
// must neither read them nor carry the field, so decision snapshots and hashes are unchanged.

vi.mock('./repository', () => ({
    performedTrainingOccurrenceRepository: { queryActiveInDateWindow: vi.fn() },
}));
vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: { getExecution: vi.fn(), getEntries: vi.fn() },
}));
vi.mock('../services/activityService', () => ({
    activityService: { getActivitiesInRange: vi.fn() },
}));
vi.mock('../services/activityOverrideService', () => ({
    activityOverrideService: { getOverridesSinceState: vi.fn() },
}));
vi.mock('../services/recommendationService', () => ({
    recommendationService: {
        getRecommendationsInRange: vi.fn().mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null }),
    },
}));
vi.mock('../sessions/sessionDefinitionResolver', () => ({
    resolveSessionDefinition: vi.fn().mockResolvedValue({ status: 'MISSING' }),
}));

const DAY = '2026-10-15';
const EXPORT = { includeDisplayProvenance: true, includeDeliveredComposition: true } as const;

const occurrence: PerformedTrainingOccurrence = {
    schemaVersion: 1,
    performedOccurrenceId: 'pto-1',
    userId: 'user-1',
    status: 'active',
    localDate: DAY,
    modality: 'Strength',
    sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
    reconciliation: { state: 'single_source' },
    createdAt: `${DAY}T06:00:00.000Z`,
    updatedAt: `${DAY}T07:00:00.000Z`,
};

const execution: SessionExecution = {
    userId: 'user-1',
    executionId: 'exec-1',
    sessionSource: { kind: 'manual', definitionId: 'def', revision: 1, contentHash: 'a'.repeat(64) },
    date: DAY,
    startedAt: `${DAY}T06:00:00.000Z`,
    completedAt: `${DAY}T06:45:00.000Z`,
    updatedAt: `${DAY}T06:45:00.000Z`,
    state: 'completed',
    schemaVersion: 1,
};

const unilateralSet: SessionEntry = {
    id: 'e1', executionId: 'exec-1', stepId: 'split-squat', compositionPatterns: ['unilateral_lower_body'],
    completedAt: `${DAY}T06:10:00.000Z`, createdAt: `${DAY}T06:10:00.000Z`, updatedAt: `${DAY}T06:10:00.000Z`,
    payload: { kind: 'repetition', setIndex: 1, reps: 8, weightKg: 16 },
};

describe('getPerformedTrainingFactsInRange delivered composition (#803)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occurrence]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        vi.mocked(activityOverrideService.getOverridesSinceState).mockResolvedValue({ status: 'AVAILABLE', data: {}, revision: null });
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: execution, revision: null });
        vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([unilateralSet]);
    });

    it('attaches logged unilateral working sets on the export path', async () => {
        const snapshot = await getPerformedTrainingFactsInRange('user-1', DAY, '2026-10-16', EXPORT);
        expect(sessionExecutionService.getEntries).toHaveBeenCalledWith('user-1', 'exec-1');
        expect(snapshot.exposures[0].deliveredUnilateralLowerBody).toEqual({ workingSets: 1, stepIds: ['split-squat'] });
        expect(snapshot.exposures[0].deliveredCompositionUnavailable).toBeUndefined();
    });

    it('reports an unreadable entry list as unknown on the export path', async () => {
        vi.mocked(sessionExecutionService.getEntries).mockRejectedValue(new Error('offline'));
        const snapshot = await getPerformedTrainingFactsInRange('user-1', DAY, '2026-10-16', EXPORT);
        expect(snapshot.exposures[0].deliveredCompositionUnavailable).toBe(true);
        expect(snapshot.exposures[0].deliveredUnilateralLowerBody).toBeUndefined();
    });

    it('skips the entry reads for an export that does not render the ledger', async () => {
        const snapshot = await getPerformedTrainingFactsInRange('user-1', DAY, '2026-10-16', { includeDisplayProvenance: true });
        expect(sessionExecutionService.getEntries).not.toHaveBeenCalled();
        expect(snapshot.exposures[0]).not.toHaveProperty('deliveredUnilateralLowerBody');
    });

    it('leaves the default decision path untouched', async () => {
        const snapshot = await getPerformedTrainingFactsInRange('user-1', DAY, '2026-10-16');
        expect(sessionExecutionService.getEntries).not.toHaveBeenCalled();
        expect(snapshot.exposures[0]).not.toHaveProperty('deliveredUnilateralLowerBody');
        expect(snapshot.exposures[0]).not.toHaveProperty('deliveredCompositionUnavailable');
    });
});
