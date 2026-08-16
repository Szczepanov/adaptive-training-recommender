import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA } from '../engine/models';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { computeContentHash, ExternalPlanService } from './externalPlanService';

function plan(overrides: Record<string, unknown> = {}) {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'autumn-block', revision: 1, title: '4-week block',
        startDate: '2026-08-17', weekCount: 4,
        sessions: [{
            id: 'w1-a', title: 'Threshold', priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: { summary: '3x12.' },
        }],
        ...overrides,
    };
}

/** Records which document path each write targeted, in order. */
function writtenPaths(): string[] {
    return firestore.setDoc.mock.calls.map(call => (call[0] as { path: string }).path);
}

describe('ExternalPlanService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.getDoc.mockResolvedValue({ exists: () => false });
        firestore.setDoc.mockResolvedValue(undefined);
    });

    it('stores the revision before the header, so a header never points at a missing revision', async () => {
        const result = await new ExternalPlanService().import('u1', plan());

        expect(result.status).toBe('AVAILABLE');
        expect(writtenPaths()).toEqual([
            'users/u1/external_plans/autumn-block/revisions/1',
            'users/u1/external_plans/autumn-block',
        ]);
    });

    it('writes nothing at all when the plan does not satisfy the contract', async () => {
        const result = await new ExternalPlanService().import('u1', plan({ startDate: '2026-08-18' }));

        expect(result.status).toBe('INVALID');
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('reports every field-level error rather than the first', async () => {
        const result = await new ExternalPlanService().import('u1', plan({ weekCount: 99, planId: 'Not A Slug' }));

        expect(result.status).toBe('INVALID');
        if (result.status !== 'INVALID') throw new Error('unreachable');
        expect(result.issues.map(issue => issue.field)).toEqual(expect.arrayContaining(['planId', 'weekCount']));
    });

    it('refuses a revision that does not advance the stored one', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ revision: 3 }) });

        const same = await new ExternalPlanService().import('u1', plan({ revision: 3 }));
        expect(same.status).toBe('INVALID');
        if (same.status !== 'INVALID') throw new Error('unreachable');
        expect(same.issues[0].code).toBe('revision-not-newer');
        expect(firestore.setDoc).not.toHaveBeenCalled();

        const newer = await new ExternalPlanService().import('u1', plan({ revision: 4 }));
        expect(newer.status).toBe('AVAILABLE');
    });

    it('records the supersession date on the header without touching earlier revisions', async () => {
        const result = await new ExternalPlanService().import('u1', plan({ revision: 1 }), '2026-08-20');

        expect(result.status).toBe('AVAILABLE');
        if (result.status !== 'AVAILABLE') throw new Error('unreachable');
        expect(result.data.header.supersededFrom).toBe('2026-08-20');
        // Only this revision's own document is written; prior revisions are immutable.
        expect(writtenPaths().filter(path => path.includes('/revisions/'))).toEqual(
            ['users/u1/external_plans/autumn-block/revisions/1'],
        );
    });

    it('supersedes forward only, touching nothing a previously adjudicated day depends on', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ revision: 1 }) });

        const result = await new ExternalPlanService().import('u1', plan({ revision: 2 }), '2026-08-20');
        expect(result.status).toBe('AVAILABLE');

        // Two writes, both additive: the new revision and the header pointer. Nothing under
        // recommendations/ and no earlier revision is rewritten, so yesterday's persisted
        // recommendation and its audit are byte-identical after this import.
        expect(writtenPaths()).toEqual([
            'users/u1/external_plans/autumn-block/revisions/2',
            'users/u1/external_plans/autumn-block',
        ]);
        expect(writtenPaths().some(path => path.includes('/recommendations/'))).toBe(false);
        expect(writtenPaths().some(path => path.endsWith('/revisions/1'))).toBe(false);
    });

    it('re-validates a stored revision on read instead of trusting it', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => plan({ startDate: '2026-08-18' }) });

        const state = await new ExternalPlanService().getRevisionState('u1', 'autumn-block', 1);
        expect(state.status).toBe('INVALID');
    });

    it('reports a foreign-owned header as INVALID rather than returning it', async () => {
        firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ userId: 'someone-else', planId: 'autumn-block' }) });

        const state = await new ExternalPlanService().getHeaderState('u1', 'autumn-block');
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues[0].code).toBe('owner-mismatch');
    });

    it('distinguishes a permission denial from a retryable outage', async () => {
        firestore.getDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        const denied = await new ExternalPlanService().getHeaderState('u1', 'autumn-block');
        expect(denied).toMatchObject({ status: 'UNAVAILABLE', retryable: false });

        firestore.getDoc.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
        const offline = await new ExternalPlanService().getHeaderState('u1', 'autumn-block');
        expect(offline).toMatchObject({ status: 'UNAVAILABLE', retryable: true });
    });

    it('validates the placement overlay on read, the only part rules cannot inspect', async () => {
        // firestore.rules can bound the assignment list's size but cannot iterate it, so
        // without this the mutable half of the plan is validated at no layer at all.
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ userId: 'u1', planId: 'autumn-block', revision: 1, updatedAt: 'now', assignments: [{ sessionId: 'a', date: 'not-a-date', status: 'planned' }] }),
        });

        const state = await new ExternalPlanService().getPlacementState('u1', 'autumn-block');
        expect(state.status).toBe('INVALID');
    });

    it('refuses to write an invalid placement overlay', async () => {
        await expect(new ExternalPlanService().savePlacement('u1', {
            planId: 'autumn-block', revision: 1,
            assignments: [{ sessionId: 'a', date: '2026-08-18', status: 'bogus' as never }],
        })).rejects.toThrow(/Invalid placement overlay/);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('rejects two assignments claiming the same session', async () => {
        await expect(new ExternalPlanService().savePlacement('u1', {
            planId: 'autumn-block', revision: 1,
            assignments: [
                { sessionId: 'a', date: '2026-08-18', status: 'planned' },
                { sessionId: 'a', date: '2026-08-19', status: 'moved' },
            ],
        })).rejects.toThrow(/at most one assignment/);
    });
});

describe('computeContentHash', () => {
    it('is stable across key ordering, so a Firestore round-trip does not change it', async () => {
        const ordered = plan();
        const reordered = { sessions: ordered.sessions, weekCount: 4, startDate: '2026-08-17', title: '4-week block', revision: 1, planId: 'autumn-block', schema: EXTERNAL_PLAN_SCHEMA };

        expect(await computeContentHash(reordered as never)).toBe(await computeContentHash(ordered as never));
    });

    it('changes when any session content changes, which is what makes replay verifiable', async () => {
        const edited = plan();
        edited.sessions[0].title = 'Threshold (edited)';

        expect(await computeContentHash(edited as never)).not.toBe(await computeContentHash(plan() as never));
    });
});
