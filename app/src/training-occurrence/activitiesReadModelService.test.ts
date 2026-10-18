import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformedTrainingOccurrence } from './models';

vi.mock('./repository', async () => {
    const actual = await vi.importActual<typeof import('./repository')>('./repository');
    return { ...actual, performedTrainingOccurrenceRepository: { queryActiveInDateWindow: vi.fn() } };
});
vi.mock('../services/activityService', () => ({ activityService: { getActivitiesInRange: vi.fn() } }));
vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: { getExecution: vi.fn(), getEntries: vi.fn(), getRestEvents: vi.fn(), getDiaryReceipts: vi.fn() },
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
    vi.mocked(sessionExecutionService.getDiaryReceipts).mockReturnValue([]);
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
        expect(view.structured?.performedRest).toBe('not_recorded');
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

    it('observes FIT workout identity from the execution and Garmin documents, not the link copies (ADR-0051 D7)', async () => {
        const fingerprint = 'fit-workout-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1, fitWorkoutFingerprint: fingerprint, fitWorkoutFingerprintKind: 'semantic_definition' },
            revision: null,
        });
        // The definition read fails: the execution was still read, so its identity still counts.
        vi.mocked(resolveSessionDefinition).mockResolvedValue({ status: 'MISSING' } as never);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
            status: 'AVAILABLE',
            data: [{ activityId: 'act-1', date: '2026-08-26', type: 'cycling', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate', fitWorkoutFingerprint: fingerprint, fitWorkoutFingerprintKind: 'semantic_definition' }],
            revision: null,
        });

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.sourceReads.structured).toEqual({ status: 'definition_unresolved', definition: 'MISSING' });
        expect(view.fitWorkoutIdentity).toEqual({ status: 'semantic_match' });
    });

    it('reports a failed execution read as not observable FIT identity, not as an absent fingerprint', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'UNAVAILABLE' } as never);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.fitWorkoutIdentity).toEqual({ status: 'not_observable', reason: 'execution_unread' });
    });

    it('reports unreadable activities as not observable FIT identity on the provider side', async () => {
        const fingerprint = 'fit-workout-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1, fitWorkoutFingerprint: fingerprint, fitWorkoutFingerprintKind: 'semantic_definition' }, revision: null });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({ status: 'MISSING' } as never);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'UNAVAILABLE' } as never);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.sourceReads.provider).not.toBe('available');
        expect(view.fitWorkoutIdentity).toEqual({ status: 'not_observable', reason: 'provider_unread' });
    });

    it('lets a fingerprinted execution document beat a conflicting source-link copy', async () => {
        const fingerprint = 'fit-workout-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1', fitWorkoutFingerprint: 'fit-workout-v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', fitWorkoutFingerprintKind: 'semantic_definition' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1, fitWorkoutFingerprint: fingerprint, fitWorkoutFingerprintKind: 'semantic_definition' }, revision: null });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: { schemaVersion: 1, id: 'w', revision: 1, title: 'Ride', intent: 'training', blocks: [] },
            revision: null,
        });
        vi.mocked(sessionExecutionService.getEntries).mockRejectedValue(new Error('unavailable'));
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [{ activityId: 'act-1', date: '2026-08-26', type: 'cycling', durationMin: 40, trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate', fitWorkoutFingerprint: fingerprint, fitWorkoutFingerprintKind: 'semantic_definition' }], revision: null });

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        // entries_unavailable still carries the execution document's identity.
        expect(view.sourceReads.structured).toEqual({ status: 'entries_unavailable' });
        expect(view.fitWorkoutIdentity).toEqual({ status: 'semantic_match' });
    });

    it('reports a structured-only occurrence as not applicable for FIT workout identity', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' } as never);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.fitWorkoutIdentity).toEqual({ status: 'not_applicable', reason: 'no_provider_source' });
        expect(view.singleSourceFitEvidence).toBeUndefined();
    });

    it('keeps a single-source row\'s own FIT identity for the unlinked-pair count', async () => {
        const fingerprint = 'fit-workout-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', fitWorkoutFingerprint: fingerprint, fitWorkoutFingerprintKind: 'semantic_definition' }],
        })]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'UNAVAILABLE' } as never);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        // The execution read failed, so the link copy is the evidence.
        expect(view.singleSourceFitEvidence).toEqual({
            side: 'structured',
            localDate: '2026-08-26',
            evidence: { fingerprint, kind: 'semantic_definition' },
        });
    });

    it('preserves structured set semantics and rest across late Garmin HR enrichment and refresh (#895)', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
            status: 'AVAILABLE',
            data: { userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' }, date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z', updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1 },
            revision: null,
        });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({
            status: 'AVAILABLE',
            data: { schemaVersion: 1, id: 'w', revision: 1, title: 'Heavy Squat Day', intent: 'training', blocks: [{ id: 'b1', role: 'main', steps: [{ id: 'squat', kind: 'exercise', title: 'Back Squat', exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' }, dose: { kind: 'repetition', sets: 3, reps: 5 }, rest: 180 }] }] } as never,
            revision: null,
        });
        vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([{
            id: 'warmup', executionId: 'exec-1', stepId: 'squat', completedAt: '2026-08-26T06:55:00.000Z', createdAt: '2026-08-26T06:55:00.000Z', updatedAt: '2026-08-26T06:55:00.000Z',
            payload: { kind: 'repetition', setIndex: 0, reps: 8, weightKg: 40, isWarmup: true },
        }, {
            id: 'e1', executionId: 'exec-1', stepId: 'squat', completedAt: '2026-08-26T07:00:00.000Z', createdAt: '2026-08-26T07:00:00.000Z', updatedAt: '2026-08-26T07:00:00.000Z',
            payload: { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 100, isWarmup: false, gauge: { scale: 'rir', value: 2 } },
        }]);
        vi.mocked(sessionExecutionService.getRestEvents).mockResolvedValue([{
            id: 'rest-1', executionId: 'exec-1', afterEntryId: 'e1', prescribedSeconds: 180, startedAt: '2026-08-26T07:00:00.000Z', endedAt: '2026-08-26T07:03:20.000Z', actualSeconds: 200, endReason: 'next_set_started', createdAt: '2026-08-26T07:03:20.000Z', updatedAt: '2026-08-26T07:03:20.000Z',
        }]);

        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(view.structured?.performedRest).toBe('recorded');
        expect(view.structured?.steps[0].sets[1].rest).toEqual({ prescribedSeconds: 180, actualSeconds: 200, endReason: 'next_set_started' });
        expect(view.structured?.steps[0].sets.map(set => ({ entryId: set.entryId, isWarmup: set.isWarmup, payload: set.payload }))).toEqual([
            { entryId: 'warmup', isWarmup: true, payload: { kind: 'repetition', setIndex: 0, reps: 8, weightKg: 40, isWarmup: true } },
            { entryId: 'e1', isWarmup: false, payload: { kind: 'repetition', setIndex: 1, reps: 5, weightKg: 100, isWarmup: false, gauge: { scale: 'rir', value: 2 } } },
        ]);
        expect(view.structured?.comparison).toMatchObject({
            completedStepsCount: 0,
            missingRequiredStepsCount: 1,
            stepComparisons: [{ stepId: 'squat', completedSets: 1, isComplete: false }],
        });
        expect(view.garmin).toBeUndefined();
        const originalStructured = structuredClone(view.structured);

        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            ],
            reconciliation: { state: 'matched', matcherVersion: 'matcher-v1', confidence: 0.9 },
        })]);
        for (const averageHr of [120, 126]) {
            vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
                status: 'AVAILABLE',
                data: [{
                    activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 45,
                    trainingEffectAerobic: 2, trainingEffectAnaerobic: 1, averageHr, maxHr: 158,
                    activityTrainingLoad: 90, intensityTag: 'moderate',
                    exerciseSets: [{ setOrder: 0, setType: 'active', exerciseName: 'wrong_exercise_guess', repetitionCount: 99, weightKg: 3 }],
                }],
                revision: null,
            });
            const enriched = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');
            expect(enriched).toHaveLength(1);
            expect(enriched[0].performedOccurrenceId).toBe(view.performedOccurrenceId);
            expect(enriched[0].sourceBadge).toEqual({ hasStructured: true, hasProvider: true, providers: ['garmin'] });
            expect(enriched[0].garmin).toMatchObject({ activityId: 'act-1', averageHr, maxHr: 158 });
            expect(enriched[0].garmin?.exerciseSets?.[0]).toMatchObject({ exerciseName: 'wrong_exercise_guess', repetitionCount: 99, weightKg: 3 });
            expect(enriched[0].garminExerciseSetsAreDiagnosticOnly).toBe(true);
            expect(enriched[0].structured).toEqual(originalStructured);
        }
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
        expect(view.structured?.performedRest).toBe('unavailable');
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
