import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedTrainingOccurrence } from './models';

vi.mock('./repository', async () => {
    const actual = await vi.importActual<typeof import('./repository')>('./repository');
    return {
        ...actual,
        performedTrainingOccurrenceRepository: {
            getById: vi.fn(),
            queryActiveInDateWindow: vi.fn(),
            updateProjection: vi.fn(),
        },
    };
});
vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: { getExecution: vi.fn() },
}));
vi.mock('../services/activityService', () => ({
    activityService: { getActivitiesInRange: vi.fn() },
}));

const { performedTrainingOccurrenceRepository: repo } = await import('./repository');
const { sessionExecutionService } = await import('../services/sessionExecutionService');
const { activityService } = await import('../services/activityService');
const { rebuildOccurrence, rebuildDateRangeForUser } = await import('./rebuildService');

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-08-26',
        modality: 'strength',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source', manualDecision: { decision: 'keep_separate', actor: 'athlete-1', decidedAt: '2026-08-26T08:00:00.000Z' } },
        createdAt: '2026-08-26T06:00:00.000Z',
        updatedAt: '2026-08-26T06:00:00.000Z',
        ...overrides,
    };
}

function sessionExecution(overrides: Partial<import('../sessions/models').SessionExecution> = {}): import('../sessions/models').SessionExecution {
    return {
        userId: 'user-1',
        executionId: 'exec-1',
        sessionSource: { kind: 'catalog', workoutId: 'w-1', catalogVersion: '1' },
        date: '2026-08-26',
        startedAt: '2026-08-26T06:52:00.000Z',
        completedAt: '2026-08-26T07:32:00.000Z',
        updatedAt: '2026-08-26T07:32:00.000Z',
        state: 'completed',
        schemaVersion: 1,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('rebuildOccurrence', () => {
    it('returns null when the occurrence does not exist', async () => {
        vi.mocked(repo.getById).mockResolvedValue(null);
        const result = await rebuildOccurrence('user-1', 'pto-missing');
        expect(result).toBeNull();
        expect(repo.updateProjection).not.toHaveBeenCalled();
    });

    it('leaves a merged (tombstoned) occurrence untouched', async () => {
        const merged = occurrence({ status: 'merged', mergedIntoOccurrenceId: 'pto-survivor' });
        vi.mocked(repo.getById).mockResolvedValue(merged);
        const result = await rebuildOccurrence('user-1', merged.performedOccurrenceId);
        expect(result).toBe(merged);
        expect(repo.updateProjection).not.toHaveBeenCalled();
    });

    it('recomputes the projection from a still-valid structured execution source', async () => {
        vi.mocked(repo.getById).mockResolvedValue(occurrence());
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: sessionExecution(),
            revision: null,
        });
        vi.mocked(repo.updateProjection).mockImplementation(async (_userId, _id, projection) => ({ ...occurrence(), ...projection }));

        await rebuildOccurrence('user-1', 'pto-1');

        expect(repo.updateProjection).toHaveBeenCalledWith('user-1', 'pto-1', expect.objectContaining({ startedAt: '2026-08-26T06:52:00.000Z', endedAt: '2026-08-26T07:32:00.000Z' }));
    });

    it('survives a removed structured source by falling back to a remaining valid Garmin source', async () => {
        const matched = occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-deleted' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        });
        vi.mocked(repo.getById).mockResolvedValue(matched);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [{ activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate', startedAt: '2026-08-26T06:53:00.000Z', endedAt: '2026-08-26T07:30:00.000Z' }],
            revision: null,
        });
        vi.mocked(repo.updateProjection).mockImplementation(async (_userId, _id, projection) => ({ ...matched, ...projection }));

        const result = await rebuildOccurrence('user-1', 'pto-1');

        expect(result).not.toBeNull();
        expect(repo.updateProjection).toHaveBeenCalledWith('user-1', 'pto-1', expect.objectContaining({ startedAt: '2026-08-26T06:53:00.000Z' }));
    });

    it('leaves the occurrence unchanged when no attached source can be recovered at all', async () => {
        vi.mocked(repo.getById).mockResolvedValue(occurrence());
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });

        const result = await rebuildOccurrence('user-1', 'pto-1');

        expect(result).toEqual(occurrence());
        expect(repo.updateProjection).not.toHaveBeenCalled();
    });

    it('never includes reconciliation/manualDecision in the projection update, so a rebuild can never discard a sticky manual decision', async () => {
        vi.mocked(repo.getById).mockResolvedValue(occurrence());
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: sessionExecution(),
            revision: null,
        });
        vi.mocked(repo.updateProjection).mockResolvedValue(occurrence());

        await rebuildOccurrence('user-1', 'pto-1');

        const [, , projectionArg] = vi.mocked(repo.updateProjection).mock.calls[0];
        expect(projectionArg).not.toHaveProperty('reconciliation');
        expect(projectionArg).not.toHaveProperty('sourceRefs');
        expect(projectionArg).not.toHaveProperty('status');
    });
});

describe('rebuildDateRangeForUser', () => {
    it('rebuilds every active occurrence in the window and returns the count', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({ performedOccurrenceId: 'pto-a' }), occurrence({ performedOccurrenceId: 'pto-b' })]);
        vi.mocked(repo.getById).mockImplementation(async (_userId, id) => occurrence({ performedOccurrenceId: id }));
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });

        const count = await rebuildDateRangeForUser('user-1', '2026-08-25', '2026-08-27');

        expect(count).toBe(2);
        expect(repo.getById).toHaveBeenCalledWith('user-1', 'pto-a');
        expect(repo.getById).toHaveBeenCalledWith('user-1', 'pto-b');
    });
});
