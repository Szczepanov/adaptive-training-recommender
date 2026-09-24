import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedTrainingOccurrence } from './models';

vi.mock('./repository', async () => {
    const actual = await vi.importActual<typeof import('./repository')>('./repository');
    return { ...actual, performedTrainingOccurrenceRepository: { queryActiveInDateWindow: vi.fn() } };
});
vi.mock('../services/activityService', () => ({ activityService: { getActivitiesInRange: vi.fn() } }));
vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: { getExecution: vi.fn(), getEntries: vi.fn(), getRestEvents: vi.fn() },
}));
vi.mock('../sessions/sessionDefinitionResolver', () => ({ resolveSessionDefinition: vi.fn() }));

const { performedTrainingOccurrenceRepository: repo } = await import('./repository');
const { activityService } = await import('../services/activityService');
const { sessionExecutionService } = await import('../services/sessionExecutionService');
const { resolveSessionDefinition } = await import('../sessions/sessionDefinitionResolver');
const { getCompletedWorkoutsInRange } = await import('./activitiesReadModelService');

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-08-26',
        modality: 'strength',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T06:52:00.000Z',
        updatedAt: '2026-08-26T06:52:00.000Z',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
    vi.mocked(sessionExecutionService.getRestEvents).mockResolvedValue([]);
});

describe('getCompletedWorkoutsInRange', () => {
    it('hydrates a structured-only occurrence with the resolved definition + comparison', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1 },
            revision: null,
        });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: { schemaVersion: 1, id: 'w', revision: 1, title: 'Heavy Squat Day', intent: 'training', blocks: [] },
            revision: null,
        });
        vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([]);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.structured?.title).toBe('Heavy Squat Day');
        expect(view.garmin).toBeUndefined();
        expect(view.garminExerciseSetsAreDiagnosticOnly).toBe(true);
        expect(view.sourceBadge).toEqual({ hasStructured: true, hasProvider: false, providers: [] });
    });

    it('hydrates a matched occurrence with both structured detail and the Garmin activity', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1 },
            revision: null,
        });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: { schemaVersion: 1, id: 'w', revision: 1, title: 'Heavy Squat Day', intent: 'training', blocks: [] },
            revision: null,
        });
        vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [{ activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' }],
            revision: null,
        });

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.structured?.title).toBe('Heavy Squat Day');
        expect(view.garmin?.activityId).toBe('act-1');
        expect(view.garminExerciseSetsAreDiagnosticOnly).toBe(true);
    });

    it('attaches per-set rows and durable performed rest to the structured detail', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1 },
            revision: null,
        });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: { schemaVersion: 1, id: 'w', revision: 1, title: 'Heavy Squat Day', intent: 'training', blocks: [{ id: 'b1', role: 'main', steps: [{ id: 'squat', kind: 'exercise', title: 'Back Squat', dose: { kind: 'repetition', sets: 1, reps: 5 }, rest: 180 }] }] } as never,
            revision: null,
        });
        vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([{
            id: 'e1', executionId: 'exec-1', stepId: 'squat', completedAt: '2026-08-26T07:00:00.000Z', createdAt: '2026-08-26T07:00:00.000Z', updatedAt: '2026-08-26T07:00:00.000Z',
            payload: { kind: 'repetition', setIndex: 0, reps: 5, weightKg: 100 },
        }]);
        vi.mocked(sessionExecutionService.getRestEvents).mockResolvedValue([{
            id: 'rest-1', executionId: 'exec-1', afterEntryId: 'e1', prescribedSeconds: 180, startedAt: '2026-08-26T07:00:00.000Z', endedAt: '2026-08-26T07:03:20.000Z', actualSeconds: 200, endReason: 'next_set_started', createdAt: '2026-08-26T07:03:20.000Z', updatedAt: '2026-08-26T07:03:20.000Z',
        }]);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.structured?.hasPerformedRest).toBe(true);
        expect(view.structured?.steps[0].sets[0].rest).toEqual({ prescribedSeconds: 180, actualSeconds: 200, endReason: 'next_set_started' });
    });

    it('still renders sets when the performed-rest read fails', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1 },
            revision: null,
        });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: { schemaVersion: 1, id: 'w', revision: 1, title: 'Heavy Squat Day', intent: 'training', blocks: [] },
            revision: null,
        });
        vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([]);
        vi.mocked(sessionExecutionService.getRestEvents).mockRejectedValue(new Error('permission-denied'));

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.structured?.title).toBe('Heavy Squat Day');
        expect(view.structured?.hasPerformedRest).toBe(false);
    });

    it('marks a Garmin-only occurrence so its own exercise sets are NOT diagnostic-only', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }] })]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [{ activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' }],
            revision: null,
        });

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.structured).toBeUndefined();
        expect(view.garmin?.activityId).toBe('act-1');
        expect(view.garminExerciseSetsAreDiagnosticOnly).toBe(false);
    });

    it('hydrates an attached provider activity from an adjacent local day without widening canonical rows', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            localDate: '2026-08-20',
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-adjacent' }],
        })]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [{ activityId: 'act-adjacent', date: '2026-08-19', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' }],
            revision: null,
        });

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(repo.queryActiveInDateWindow).toHaveBeenCalledWith('user-1', '2026-08-20', '2026-08-26');
        expect(activityService.getActivitiesInRange).toHaveBeenCalledWith('user-1', '2026-08-19', '2026-08-28');
        expect(view.localDate).toBe('2026-08-20');
        expect(view.garmin?.activityId).toBe('act-adjacent');
    });

    it('skips its own Activities fetch entirely when preloadedActivities is supplied', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-preloaded' }],
        })]);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27', [
            { activityId: 'act-preloaded', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate' },
        ]);

        expect(activityService.getActivitiesInRange).not.toHaveBeenCalled();
        expect(view.garmin?.activityId).toBe('act-preloaded');
    });

    it('sorts results by most-recent first', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([
            occurrence({ performedOccurrenceId: 'pto-early', startedAt: '2026-08-24T06:00:00.000Z' }),
            occurrence({ performedOccurrenceId: 'pto-late', startedAt: '2026-08-26T06:00:00.000Z' }),
        ]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });

        const views = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(views.map(v => v.performedOccurrenceId)).toEqual(['pto-late', 'pto-early']);
    });
});
