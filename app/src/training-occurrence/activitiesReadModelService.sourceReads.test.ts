/** #895 WP5: the read model must keep absent, unreadable and unresolved sources distinct. */
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

const execution = {
    userId: 'user-1', executionId: 'exec-1', sessionSource: { kind: 'catalog', workoutId: 'w', catalogVersion: '1' },
    date: '2026-08-26', startedAt: '2026-08-26T06:52:00.000Z', completedAt: '2026-08-26T07:32:00.000Z',
    updatedAt: '2026-08-26T07:32:00.000Z', state: 'completed', schemaVersion: 1,
} as never;
const definition = { schemaVersion: 1, id: 'w', revision: 1, title: 'Heavy Squat Day', intent: 'training', blocks: [] } as never;
const garminRef = { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' } as const;
const garminActivity = {
    activityId: 'act-1', date: '2026-08-26', type: 'strength_training', durationMin: 40, trainingEffectAerobic: null,
    trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate',
};
const read = async () => (await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27'))[0];

function availableExecution() {
    vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
    vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: execution, revision: null });
    vi.mocked(resolveSessionDefinition).mockResolvedValue({ status: 'AVAILABLE', data: definition, revision: null });
    vi.mocked(sessionExecutionService.getEntries).mockResolvedValue([]);
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
    vi.mocked(sessionExecutionService.getRestEvents).mockResolvedValue([]);
    vi.mocked(sessionExecutionService.getDiaryReceipts).mockReturnValue([]);
});

describe('getCompletedWorkoutsInRange sourceReads (#895 WP5)', () => {
    it('keeps an absent execution document, an unreadable one and an unresolved definition distinct', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);

        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        const missing = await read();
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'UNAVAILABLE', operation: 'getExecution', retryable: true });
        const unavailable = await read();
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: execution, revision: null });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({ status: 'UNAVAILABLE', operation: 'getPrescription', retryable: true });
        const unresolved = await read();

        // The legacy DTO field collapses all three into `undefined`; sourceReads must not.
        expect([missing.structured, unavailable.structured, unresolved.structured]).toEqual([undefined, undefined, undefined]);
        expect(missing.sourceReads.structured).toEqual({ status: 'execution_missing' });
        expect(unavailable.sourceReads.structured).toEqual({ status: 'execution_unavailable' });
        expect(unresolved.sourceReads.structured).toEqual({ status: 'definition_unresolved', definition: 'UNAVAILABLE' });
    });

    it('reports an invalid execution document', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'INVALID', issues: [] });
        expect((await read()).sourceReads.structured).toEqual({ status: 'execution_invalid' });
    });

    it.each(['MISSING', 'INVALID', 'UNAVAILABLE'] as const)('records which way the definition was unresolved: %s', async (status) => {
        availableExecution();
        vi.mocked(resolveSessionDefinition).mockResolvedValue(
            status === 'MISSING' ? { status }
                : status === 'INVALID' ? { status, issues: [] }
                    : { status, operation: 'x', retryable: true },
        );
        expect((await read()).sourceReads.structured).toEqual({ status: 'definition_unresolved', definition: status });
    });

    it('marks a successful structured hydration available', async () => {
        availableExecution();
        const view = await read();
        expect(view.structured?.title).toBe('Heavy Squat Day');
        expect(view.sourceReads.structured).toEqual({ status: 'available' });
    });

    it('records an entries read failure without blanking the rest of the window', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([
            occurrence({ performedOccurrenceId: 'pto-bad', startedAt: '2026-08-26T06:00:00.000Z' }),
            occurrence({ performedOccurrenceId: 'pto-ok', sourceRefs: [garminRef], startedAt: '2026-08-25T06:00:00.000Z' }),
        ]);
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: execution, revision: null });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({ status: 'AVAILABLE', data: definition, revision: null });
        vi.mocked(sessionExecutionService.getEntries).mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'unavailable' }));

        const views = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(views.map(v => v.performedOccurrenceId)).toEqual(['pto-bad', 'pto-ok']);
        expect(views[0].sourceReads.structured).toEqual({ status: 'entries_unavailable' });
        expect(views[0].structured).toBeUndefined();
    });

    it('lets a permission-denied failure fail the whole window rather than being swallowed per row', async () => {
        availableExecution();
        vi.mocked(sessionExecutionService.getEntries).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        await expect(read()).rejects.toThrow('denied');
    });

    it('reads the device-local diary receipts for the linked execution', async () => {
        availableExecution();
        const mutation = { id: 'm', executionId: 'exec-1' } as never;
        vi.mocked(sessionExecutionService.getDiaryReceipts).mockReturnValue([
            { mutation, state: 'queued' }, { mutation, state: 'queued' }, { mutation, state: 'failed' },
        ]);
        const view = await read();
        expect(sessionExecutionService.getDiaryReceipts).toHaveBeenCalledWith('user-1', 'exec-1');
        expect(view.sourceReads.outbox).toEqual({ status: 'read', queued: 2, failed: 1 });
    });

    it('reports unreadable receipts instead of a depth of zero', async () => {
        availableExecution();
        vi.mocked(sessionExecutionService.getDiaryReceipts).mockImplementation(() => { throw new Error('Invalid diary receipt.'); });
        expect((await read()).sourceReads.outbox).toEqual({ status: 'unreadable' });
    });

    it('does not read receipts for a provider-only occurrence', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({ sourceRefs: [garminRef] })]);
        const view = await read();
        expect(sessionExecutionService.getDiaryReceipts).not.toHaveBeenCalled();
        expect(view.sourceReads.outbox).toEqual({ status: 'not_linked' });
        expect(view.sourceReads.structured).toEqual({ status: 'not_linked' });
    });

    it('classifies the provider read: not linked / found / outside the window / unreadable / non-Garmin', async () => {
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });

        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        expect((await read()).sourceReads.provider).toBe('not_linked');

        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({ sourceRefs: [garminRef] })]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [garminActivity], revision: null });
        expect((await read()).sourceReads.provider).toBe('available');

        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        const missing = await read();
        expect(missing.sourceReads.provider).toBe('activity_not_in_read_window');
        expect(missing.garmin).toBeUndefined();

        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'UNAVAILABLE', operation: 'getActivitiesInRange', retryable: true });
        const unreadable = await read();
        expect(unreadable.sourceReads.provider).toBe('activities_unreadable');
        expect(unreadable.garmin).toBeUndefined();

        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'polar', activityId: 'act-1' }] })]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [garminActivity], revision: null });
        expect((await read()).sourceReads.provider).toBe('non_garmin_only');
    });

    it('treats preloaded activities as a readable provider window', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({ sourceRefs: [garminRef] })]);
        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27', []);
        expect(view.sourceReads.provider).toBe('activity_not_in_read_window');
    });

    it('stamps the reconciliation sweep status, defaulting to not_run', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({ sourceRefs: [garminRef] })]);
        expect((await read()).sourceReads.reconciliationSweep).toBe('not_run');
        const [swept] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27', undefined, { reconciliationSweep: 'failed' });
        expect(swept.sourceReads.reconciliationSweep).toBe('failed');
    });
});

describe('getCompletedWorkoutsInRange multi-source and ambiguity caveats (#895 WP5 review)', () => {
    const second = { ...garminActivity, activityId: 'act-2' };

    it('reports several Garmin refs as multiple_available only when every one hydrated', async () => {
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence({
            sourceRefs: [garminRef, { kind: 'provider_activity', provider: 'garmin', activityId: 'act-2' }],
        })]);
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [garminActivity, second], revision: null });
        expect((await read()).sourceReads.provider).toBe('multiple_available');

        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [garminActivity], revision: null });
        expect((await read()).sourceReads.provider).toBe('multiple_incomplete');
    });

    it('flags a single-source row as the possible counterpart of an opposite-kind ambiguous occurrence', async () => {
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([
            occurrence({ performedOccurrenceId: 'pto-structured', localDate: '2026-08-26' }),
            occurrence({ performedOccurrenceId: 'pto-garmin-ambiguous', localDate: '2026-08-27', sourceRefs: [garminRef], reconciliation: { state: 'ambiguous' } }),
            occurrence({ performedOccurrenceId: 'pto-far', localDate: '2026-08-21', sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-far' }] }),
            occurrence({ performedOccurrenceId: 'pto-same-kind', localDate: '2026-08-26', sourceRefs: [garminRef, { kind: 'provider_activity', provider: 'garmin', activityId: 'act-9' }] }),
        ]);
        const views = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-28');
        const flag = (id: string) => views.find(view => view.performedOccurrenceId === id)!.sourceReads.ambiguousCounterpart;

        expect(flag('pto-structured')).toBe(true);
        expect(flag('pto-garmin-ambiguous')).toBe(false); // the ambiguous side is state 7 itself
        expect(flag('pto-far')).toBe(false); // more than a day away cannot be its candidate
        expect(flag('pto-same-kind')).toBe(false); // the matcher only pairs opposite source kinds
    });

    it('also sees an ambiguous partner one local day OUTSIDE the displayed window', async () => {
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        const inWindowFirstDay = occurrence({ performedOccurrenceId: 'pto-first-day', localDate: '2026-08-20' });
        const inWindowLastDay = occurrence({ performedOccurrenceId: 'pto-last-day', localDate: '2026-08-26' });
        const ambiguousBefore = occurrence({ performedOccurrenceId: 'pto-before', localDate: '2026-08-19', sourceRefs: [garminRef], reconciliation: { state: 'ambiguous' } });
        const ambiguousAfter = occurrence({ performedOccurrenceId: 'pto-after', localDate: '2026-08-27', sourceRefs: [garminRef], reconciliation: { state: 'ambiguous' } });
        vi.mocked(repo.queryActiveInDateWindow).mockImplementation(async (_user, from, to) => {
            if (from === '2026-08-19' && to === '2026-08-19') return [ambiguousBefore];
            if (from === '2026-08-27' && to === '2026-08-27') return [ambiguousAfter];
            return [inWindowFirstDay, inWindowLastDay];
        });

        const views = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');

        expect(views.map(view => view.performedOccurrenceId).sort()).toEqual(['pto-first-day', 'pto-last-day']);
        expect(views.every(view => view.sourceReads.ambiguousCounterpart)).toBe(true);
    });

    it('does not flag a middle-of-window row because of an ambiguous partner outside the window', async () => {
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        const ambiguousBefore = occurrence({ performedOccurrenceId: 'pto-before', localDate: '2026-08-19', sourceRefs: [garminRef], reconciliation: { state: 'ambiguous' } });
        vi.mocked(repo.queryActiveInDateWindow).mockImplementation(async (_user, from, to) => (
            from === '2026-08-19' && to === '2026-08-19' ? [ambiguousBefore] : [occurrence({ localDate: '2026-08-23' })]
        ));
        const [view] = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');
        expect(view.sourceReads.ambiguousCounterpart).toBe(false);
    });

    it('treats an unreadable edge as an unknown counterpart for edge-day rows only', async () => {
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        vi.mocked(repo.queryActiveInDateWindow).mockImplementation(async (_user, from, to) => {
            if (from === to) throw new Error('edge read failed');
            return [
                occurrence({ performedOccurrenceId: 'pto-edge', localDate: '2026-08-20' }),
                occurrence({ performedOccurrenceId: 'pto-middle', localDate: '2026-08-23' }),
            ];
        });
        const views = await getCompletedWorkoutsInRange('user-1', '2026-08-20', '2026-08-27');
        const flag = (id: string) => views.find(view => view.performedOccurrenceId === id)!.sourceReads.ambiguousCounterpart;
        expect(flag('pto-edge')).toBe(true);
        expect(flag('pto-middle')).toBe(false);
    });

    it('does not mark anything when nothing is ambiguous', async () => {
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        vi.mocked(repo.queryActiveInDateWindow).mockResolvedValue([occurrence()]);
        expect((await read()).sourceReads.ambiguousCounterpart).toBe(false);
    });
});
