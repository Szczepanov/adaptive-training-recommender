import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../sessions/fixtures/01-full-body-maintenance.json';
import { EXTERNAL_PLAN_SCHEMA_V6 } from '../sessions/externalPlanV6';
import { buildLedgerExport } from '../ledger/export/buildLedgerExport';
import { fullRecords } from '../ledger/export/ledgerExportFixtures.testSupport';
import type { PlacementEvent } from '../ledger/placementHistory';

/** #1172: successor links recorded when a revision declaring replacements is imported. */
const firestore = vi.hoisted(() => {
    const committedDocs = new Map<string, unknown>();
    const transactions: Array<{ stagedWrites: Array<{ path: string; data: unknown }> }> = [];
    let eventCounter = 0;
    return {
        committedDocs,
        transactions,
        resetEvents() { eventCounter = 0; },
        nextEventId() { eventCounter += 1; return `event-${String(eventCounter).padStart(3, '0')}`; },
        collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
        doc: vi.fn(),
        getDoc: vi.fn(async (ref: { path: string }) => ({
            exists: () => committedDocs.has(ref.path),
            data: () => committedDocs.get(ref.path),
        })),
        getDocs: vi.fn(async (ref: { path: string }) => ({
            docs: [...committedDocs.entries()]
                .filter(([path]) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/'))
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([path, data]) => ({ id: path.split('/').at(-1), data: () => data })),
        })),
        query: vi.fn((ref: unknown) => ref),
        startAfter: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn(),
        documentId: vi.fn(),
        runTransaction: vi.fn(async (_db: unknown, callback: (transaction: unknown) => Promise<unknown>) => {
            const stagedWrites: Array<{ path: string; data: unknown }> = [];
            const tx = {
                // Firestore rejects a transactional read after a write; the fake does too.
                get: vi.fn(async (ref: { path: string }) => {
                    if (stagedWrites.length > 0) throw new Error('Transactions require all reads to be executed before all writes.');
                    return { exists: () => committedDocs.has(ref.path), data: () => committedDocs.get(ref.path) };
                }),
                set: vi.fn((ref: { path: string }, data: unknown) => { stagedWrites.push({ path: ref.path, data }); }),
            };
            const result = await callback(tx);
            transactions.push({ stagedWrites });
            for (const write of stagedWrites) committedDocs.set(write.path, write.data);
            return result;
        }),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

/** Non-transactional reads the import makes once it knows the replaced revision. */
const context = vi.hoisted(() => ({ occurrences: vi.fn(), fixed: vi.fn() }));
vi.mock('./sessionOccurrenceService', () => ({ sessionOccurrenceService: { getOccurrencesInRangeState: context.occurrences } }));
vi.mock('./fixedActivityService', () => ({ fixedActivityService: { getActivitiesInRangeState: context.fixed } }));

import { ExternalPlanService } from './externalPlanService';

const PLAN_PATH = 'users/u1/external_plans/v6-block';
const REV1_PLACEMENT = `${PLAN_PATH}/revisions/1/placement/current`;
const REV1_HISTORY = `${PLAN_PATH}/revisions/1/placement_history`;

function session(id: string, preferredDay: string, extra: Record<string, unknown> = {}) {
    return {
        id, title: `Session ${id}`, priority: 'key',
        placement: { week: 1, preferredDay, flexibility: 'preferred', ifMissed: 'drop' },
        gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 60, environment: 'either', equipment: [] },
        definition: fixture,
        ...extra,
    };
}

/** Week 1 starts Monday 2026-11-09, inside the ledger fixture's planning window. */
function v6Plan(revision: number, sessions: unknown[]) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA_V6,
        planId: 'v6-block', revision, title: 'V6 block', startDate: '2026-11-09', weekCount: 2,
        sessions, restDays: [],
    };
}

const revision1 = () => v6Plan(1, [session('old-a', 'tuesday'), session('old-b', 'thursday')]);
const revision2 = (replaces: Record<string, string> = { 'new-a': 'old-a' }) => v6Plan(2, [
    ...Object.entries(replaces).map(([id, replacesSessionId]) => session(id, 'wednesday', { replacesSessionId })),
    session('old-b', 'thursday'),
]);

function writesOf(transactionIndex: number): string[] {
    return firestore.transactions[transactionIndex].stagedWrites.map(write => write.path.replace(/event-\d+$/, 'event'));
}

function historyEvents(): PlacementEvent[] {
    return [...firestore.committedDocs.entries()]
        .filter(([path]) => path.startsWith(`${REV1_HISTORY}/`))
        .map(([, data]) => data as PlacementEvent);
}

describe('ExternalPlanService import records declared session replacements (#1172)', () => {
    let service: ExternalPlanService;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-10T09:00:00.000Z'));
        firestore.committedDocs.clear();
        firestore.transactions.length = 0;
        firestore.resetEvents();
        firestore.doc.mockImplementation((first: { path?: string }, ...segments: string[]) => ({
            path: segments.length ? segments.join('/') : `${first.path}/${firestore.nextEventId()}`,
        }));
        context.occurrences.mockResolvedValue({ status: 'AVAILABLE', data: [] });
        context.fixed.mockResolvedValue({ status: 'AVAILABLE', data: [] });
        service = new ExternalPlanService();
        await expect(service.import('u1', revision1())).resolves.toMatchObject({ status: 'AVAILABLE' });
        firestore.transactions.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('supersedes the declared session on the previous revision in the activating transaction', async () => {
        await expect(service.import('u1', revision2())).resolves.toMatchObject({ status: 'AVAILABLE' });

        expect(firestore.runTransaction).toHaveBeenCalledTimes(2);
        expect(writesOf(0)).toEqual([
            REV1_PLACEMENT,
            `${REV1_HISTORY}/event`,
            `${PLAN_PATH}/revisions/2`,
            `${PLAN_PATH}/activations/2`,
            PLAN_PATH,
        ]);
        expect(firestore.committedDocs.get(REV1_PLACEMENT)).toMatchObject({
            userId: 'u1', planId: 'v6-block', revision: 1,
            // Untouched sessions get no assignment; the replaced one keeps its default date.
            assignments: [{ sessionId: 'old-a', date: '2026-11-10', status: 'superseded' }],
            successors: { 'old-a': { revision: 2, sessionId: 'new-a' } },
        });
        expect(historyEvents()).toEqual([expect.objectContaining({
            revision: 1, changedOn: '2026-11-10', previous: [],
            assignments: [{ sessionId: 'old-a', date: '2026-11-10', status: 'superseded' }],
            successors: { 'old-a': { revision: 2, sessionId: 'new-a' } },
        })]);
        await expect(service.getPlacementHistoryState('u1', 'v6-block', 1)).resolves.toMatchObject({ status: 'AVAILABLE' });
    });

    it('rejects replacing a session before the activation date without writing', async () => {
        await expect(service.import('u1', revision2(), '2026-11-16')).resolves.toMatchObject({
            status: 'INVALID', issues: [{ code: 'replaced-session-before-effective-date' }],
        });
        expect(writesOf(0)).toEqual([]);
        expect(firestore.committedDocs.has(REV1_PLACEMENT)).toBe(false);
    });

    it('rejects a moved session before the activation date even when its authored date is later', async () => {
        await service.savePlacement('u1', { planId: 'v6-block', revision: 1, assignments: [
            { sessionId: 'old-b', date: '2026-11-10', status: 'moved' },
        ] });
        firestore.transactions.length = 0;
        await expect(service.import('u1', v6Plan(2, [session('new-b', 'wednesday', { replacesSessionId: 'old-b' })]), '2026-11-11'))
            .resolves.toMatchObject({ status: 'INVALID', issues: [{ code: 'replaced-session-before-effective-date' }] });
        expect(writesOf(0)).toEqual([]);
    });

    it('uses the moved date when checking the activation boundary', async () => {
        await service.savePlacement('u1', { planId: 'v6-block', revision: 1, assignments: [
            { sessionId: 'old-a', date: '2026-11-16', status: 'moved' },
        ] });
        await expect(service.import('u1', revision2(), '2026-11-16')).resolves.toMatchObject({ status: 'AVAILABLE' });
        expect(firestore.committedDocs.get(REV1_PLACEMENT)).toMatchObject({ assignments: [
            { sessionId: 'old-a', date: '2026-11-16', status: 'superseded' },
        ] });
    });

    it('keeps the moved date and leaves other assignments unchanged', async () => {
        await service.savePlacement('u1', { planId: 'v6-block', revision: 1, assignments: [
            { sessionId: 'old-a', date: '2026-11-11', status: 'moved' },
            { sessionId: 'old-b', date: '2026-11-12', status: 'dropped' },
        ] });

        await expect(service.import('u1', revision2())).resolves.toMatchObject({ status: 'AVAILABLE' });

        expect(firestore.committedDocs.get(REV1_PLACEMENT)).toMatchObject({ assignments: [
            { sessionId: 'old-a', date: '2026-11-11', status: 'superseded' },
            { sessionId: 'old-b', date: '2026-11-12', status: 'dropped' },
        ] });
        expect(historyEvents().at(-1)).toMatchObject({
            previous: [
                { sessionId: 'old-a', date: '2026-11-11', status: 'moved' },
                { sessionId: 'old-b', date: '2026-11-12', status: 'dropped' },
            ],
            successors: { 'old-a': { revision: 2, sessionId: 'new-a' } },
        });
    });

    it('writes no placement for a revision without declarations, even with lookalike titles', async () => {
        const lookalike = v6Plan(2, [{ ...session('new-a', 'tuesday'), title: 'Session old-a' }, session('old-b', 'thursday')]);
        await expect(service.import('u1', lookalike)).resolves.toMatchObject({ status: 'AVAILABLE' });

        expect(writesOf(0)).toEqual([`${PLAN_PATH}/revisions/2`, `${PLAN_PATH}/activations/2`, PLAN_PATH]);
        expect(firestore.committedDocs.has(REV1_PLACEMENT)).toBe(false);
    });

    it('makes an identical retry a no-op instead of a second event or a successor conflict', async () => {
        await service.import('u1', revision2());
        const before = historyEvents().length;

        await expect(service.import('u1', revision2())).resolves.toMatchObject({ status: 'AVAILABLE' });

        expect(writesOf(1)).toEqual([]);
        expect(historyEvents()).toHaveLength(before);
    });

    it('rejects a declaration naming a session the previous revision does not have, writing nothing', async () => {
        const result = await service.import('u1', revision2({ 'new-a': 'ghost' }));

        expect(result).toEqual({ status: 'INVALID', issues: [{
            code: 'replaced-session-not-found', field: 'sessions[0].replacesSessionId', documentPath: `${PLAN_PATH}/revisions/1`,
        }] });
        expect(writesOf(0)).toEqual([]);
    });

    it('rejects a declaration on the first revision of a plan', async () => {
        firestore.committedDocs.clear();
        const first = v6Plan(1, [session('new-a', 'tuesday', { replacesSessionId: 'old-a' })]);

        await expect(service.import('u1', first)).resolves.toEqual({ status: 'INVALID', issues: [{
            code: 'replacement-previous-revision-missing', field: 'sessions[0].replacesSessionId', documentPath: PLAN_PATH,
        }] });
        expect(firestore.committedDocs.size).toBe(0);
    });

    it('fails closed when the previous overlay claims another owner', async () => {
        firestore.committedDocs.set(REV1_PLACEMENT, { userId: 'intruder', planId: 'v6-block', revision: 1, assignments: [], updatedAt: '2026-11-09T00:00:00.000Z' });

        await expect(service.import('u1', revision2())).resolves.toEqual({ status: 'INVALID', issues: [{
            code: 'replaced-placement-owner-mismatch', documentPath: REV1_PLACEMENT,
        }] });
        expect(writesOf(0)).toEqual([]);
        expect(firestore.committedDocs.get(REV1_PLACEMENT)).toMatchObject({ userId: 'intruder' });
    });

    it('rejects a replacement over an unreadable previous overlay and leaves the overlay as it was', async () => {
        const corrupt = { userId: 'u1', planId: 'v6-block', revision: 1, assignments: 'broken', updatedAt: '2026-11-09T00:00:00.000Z' };
        firestore.committedDocs.set(REV1_PLACEMENT, corrupt);

        await expect(service.import('u1', revision2())).resolves.toEqual({ status: 'INVALID', issues: [{
            code: 'replaced-placement-unreadable', documentPath: REV1_PLACEMENT,
        }] });

        expect(writesOf(0)).toEqual([]);
        expect(firestore.committedDocs.get(REV1_PLACEMENT)).toBe(corrupt);
        expect(historyEvents()).toEqual([]);
    });

    it('still imports a revision without declarations over an unreadable previous overlay', async () => {
        firestore.committedDocs.set(REV1_PLACEMENT, { userId: 'u1', planId: 'v6-block', revision: 1, assignments: 'broken', updatedAt: '2026-11-09T00:00:00.000Z' });

        await expect(service.import('u1', v6Plan(2, [session('old-b', 'thursday')]))).resolves.toMatchObject({ status: 'AVAILABLE' });

        expect(writesOf(0)).toEqual([`${PLAN_PATH}/revisions/2`, `${PLAN_PATH}/activations/2`, PLAN_PATH]);
    });

    it('reads a legacy overlay of the previous revision as the prior state', async () => {
        firestore.committedDocs.set(`${PLAN_PATH}/placement/current`, { userId: 'u1', planId: 'v6-block', revision: 1,
            assignments: [{ sessionId: 'old-a', date: '2026-11-13', status: 'moved' }], updatedAt: '2026-11-09T00:00:00.000Z' });

        await service.import('u1', revision2());

        expect(firestore.committedDocs.get(REV1_PLACEMENT)).toMatchObject({ assignments: [
            { sessionId: 'old-a', date: '2026-11-13', status: 'superseded' },
        ] });
        expect(firestore.committedDocs.get(`${PLAN_PATH}/placement/current`)).toMatchObject({ assignments: [{ status: 'moved' }] });
    });

    it('refuses to supersede a completed session', async () => {
        await service.savePlacement('u1', { planId: 'v6-block', revision: 1, assignments: [
            { sessionId: 'old-a', date: '2026-11-10', status: 'completed' },
        ] });
        firestore.transactions.length = 0;

        await expect(service.import('u1', revision2())).resolves.toEqual({ status: 'INVALID', issues: [{
            code: 'replaced-session-completed', field: 'sessions[0].replacesSessionId', documentPath: REV1_PLACEMENT,
        }] });
        expect(writesOf(0)).toEqual([]);
    });

    const occurrence = (state: string, ref: Record<string, unknown> = {}) => ({
        userId: 'u1', occurrenceId: `occ-${state}`, date: '2026-11-10', authority: 'external_plan', state,
        externalPlanRef: { planId: 'v6-block', revision: 1, sessionId: 'old-a', contentHash: 'hash', ...ref },
        createdAt: '2026-11-10T07:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z',
    });

    it.each(['active', 'completed', 'abandoned'])('refuses to supersede a session whose occurrence is %s, writing nothing', async state => {
        context.occurrences.mockResolvedValue({ status: 'AVAILABLE', data: [occurrence(state)] });

        await expect(service.import('u1', revision2())).resolves.toEqual({ status: 'INVALID', issues: [{
            code: 'replaced-session-completed', field: 'sessions[0].replacesSessionId', documentPath: REV1_PLACEMENT,
        }] });
        expect(writesOf(0)).toEqual([]);
        expect(context.occurrences).toHaveBeenCalledWith('u1', '2026-11-09', '2026-11-22');
    });

    it.each([
        ['a scheduled occurrence', occurrence('scheduled')],
        ['a skipped occurrence', occurrence('skipped')],
        ['another revision', occurrence('completed', { revision: 2 })],
        ['another session', occurrence('completed', { sessionId: 'old-b' })],
        ['another plan', occurrence('completed', { planId: 'other-plan' })],
    ])('does not treat %s as performed work', async (_label, item) => {
        context.occurrences.mockResolvedValue({ status: 'AVAILABLE', data: [item] });

        await expect(service.import('u1', revision2())).resolves.toMatchObject({ status: 'AVAILABLE' });
    });

    it('fails closed without writing when the occurrence read is unavailable', async () => {
        context.occurrences.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read session occurrences', retryable: true });

        await expect(service.import('u1', revision2())).resolves.toMatchObject({ status: 'UNAVAILABLE', retryable: true });
        expect(firestore.committedDocs.has(REV1_PLACEMENT)).toBe(false);
        expect(firestore.committedDocs.has(`${PLAN_PATH}/revisions/2`)).toBe(false);
    });

    it('supersedes an unassigned session on the date the plan view resolves it to, not its authored date', async () => {
        // A fixed activity on Tuesday pushes old-a to Wednesday in the plan view.
        context.fixed.mockResolvedValue({ status: 'AVAILABLE', data: [{
            id: 'fixed-1', userId: 'u1', title: 'Class', date: '2026-11-10', durationMin: 60,
            fixed: true, isCompleted: false, environment: 'indoor', equipment: [],
        }] });

        await expect(service.import('u1', revision2(), '2026-11-11')).resolves.toMatchObject({ status: 'AVAILABLE' });

        // The plan view's window: Warsaw today (2026-11-10) through today + 6.
        expect(context.fixed).toHaveBeenCalledWith('u1', '2026-11-10', '2026-11-16');
        expect(firestore.committedDocs.get(REV1_PLACEMENT)).toMatchObject({ assignments: [
            { sessionId: 'old-a', date: '2026-11-11', status: 'superseded' },
        ] });
    });

    describe('with past fixed activities the plan view no longer loads', () => {
        // Review probe: Monday and Tuesday are booked, today is Wednesday 2026-11-11. The plan
        // view loads only today..today+6, so it shows A on Monday and B on Wednesday.
        const booked = ['2026-11-09', '2026-11-10'].map(date => ({
            id: `fixed-${date}`, userId: 'u1', title: 'Class', date, durationMin: 60,
            fixed: true, isCompleted: false, environment: 'indoor', equipment: [],
        }));

        beforeEach(async () => {
            firestore.committedDocs.clear();
            vi.setSystemTime(new Date('2026-11-11T09:00:00.000Z'));
            context.fixed.mockImplementation(async (_userId: string, start: string, end: string) => ({
                status: 'AVAILABLE', data: booked.filter(item => item.date >= start && item.date <= end),
            }));
            await service.import('u1', v6Plan(1, [session('old-a', 'monday'), session('old-b', 'wednesday')]));
            firestore.transactions.length = 0;
        });

        it('rejects replacing a session the plan view shows before the activation date', async () => {
            const next = v6Plan(2, [session('new-a', 'thursday', { replacesSessionId: 'old-a' }), session('old-b', 'wednesday')]);

            await expect(service.import('u1', next, '2026-11-11')).resolves.toMatchObject({
                status: 'INVALID', issues: [{ code: 'replaced-session-before-effective-date' }],
            });
            expect(context.fixed).toHaveBeenCalledWith('u1', '2026-11-11', '2026-11-17');
            expect(writesOf(0)).toEqual([]);
        });

        it('supersedes a session on the date the plan view shows', async () => {
            const next = v6Plan(2, [session('old-a', 'monday'), session('new-b', 'thursday', { replacesSessionId: 'old-b' })]);

            await expect(service.import('u1', next, '2026-11-11')).resolves.toMatchObject({ status: 'AVAILABLE' });
            expect(firestore.committedDocs.get(REV1_PLACEMENT)).toMatchObject({ assignments: [
                { sessionId: 'old-b', date: '2026-11-11', status: 'superseded' },
            ] });
        });
    });

    it('refuses to overwrite a different recorded successor', async () => {
        firestore.committedDocs.set(REV1_PLACEMENT, { userId: 'u1', planId: 'v6-block', revision: 1,
            assignments: [{ sessionId: 'old-a', date: '2026-11-10', status: 'superseded' }],
            successors: { 'old-a': { revision: 5, sessionId: 'elsewhere' } }, updatedAt: '2026-11-09T00:00:00.000Z' });

        await expect(service.import('u1', revision2())).resolves.toEqual({ status: 'INVALID', issues: [{
            code: 'replaced-session-successor-conflict', field: 'sessions[0].replacesSessionId', documentPath: REV1_PLACEMENT,
        }] });
        expect(writesOf(0)).toEqual([]);
    });

    it('exports the successor in the replaced placement statusHistory', async () => {
        await service.import('u1', revision2());
        const placement = await service.getPlacementState('u1', 'v6-block', 1);
        const history = await service.getPlacementHistoryState('u1', 'v6-block', 1);
        if (placement.status !== 'AVAILABLE' || history.status !== 'AVAILABLE') throw new Error('placement reads failed');

        const records = fullRecords();
        records.placements = [{ planId: 'v6-block', revision: 1, updatedAt: placement.data.updatedAt, assignments: placement.data.assignments }];
        records.placementHistory = history.data;
        const result = buildLedgerExport({ records, asOfDate: '2026-11-20', purpose: 'planning', exportedAt: '2026-11-20T12:00:00Z' });

        const row = result.coachingHistory.placements.items.find(item => item.id === 'v6-block@1:old-a');
        expect(row?.fields.status.value).toBe('superseded');
        expect(row?.fields.statusHistory.value).toEqual([{
            changedOn: '2026-11-10', recordedAt: '2026-11-10T09:00:00.000Z', previousState: 'recorded', previousStateReason: null,
            previous: null, assignment: { sessionId: 'old-a', date: '2026-11-10', status: 'superseded' },
            successor: { revision: 2, sessionId: 'new-a' },
        }]);
        expect(result.coachingHistory.placements.items.some(item => item.id === 'v6-block@1:old-b')).toBe(false);
    });
});
