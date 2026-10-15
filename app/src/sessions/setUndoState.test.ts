import { describe, expect, it } from 'vitest';
import type { SessionEntry } from './models';
import {
    afterEntryRemoved, afterLoggedOfferExpired, afterRestoreDone, afterRestoreRefused, afterSetLogged,
    INITIAL_SET_UNDO_STATE, isRestoreOffered, nextRepetitionSetIndex, planRestore,
    RESTORE_REFUSED_DUPLICATE_REASON, restoreWouldDuplicateSetIndex, sameExerciseRef,
} from './setUndoState';
import type { SetUndoState } from './setUndoState';

const at = '2026-10-05T08:00:00.000Z';
const squat = { kind: 'catalog', exerciseId: 'squat' } as const;
const set = (id: string, setIndex: number, extra: Partial<SessionEntry> = {}): SessionEntry => ({
    id, executionId: 'exec-1', stepId: 'step-squat', exerciseRef: squat, completedAt: at, createdAt: at, updatedAt: at,
    payload: { kind: 'repetition', setIndex, reps: 5 }, ...extra,
});

/** Mirrors the hook's wiring using only the pure transitions, so the sequences below fail if a rule regresses. */
class Model {
    live: SessionEntry[] = [];
    removed: SessionEntry | null = null;
    state: SetUndoState = INITIAL_SET_UNDO_STATE;
    private seq = 0;

    log(nowMs = 0): SessionEntry {
        const entry = set(`s${++this.seq}`, nextRepetitionSetIndex(this.live, 'step-squat', squat));
        this.live = [...this.live, entry];
        this.state = afterSetLogged(this.state, this.removed, entry.id, nowMs);
        return entry;
    }
    remove(id: string): void {
        const target = this.live.find(entry => entry.id === id)!;
        this.removed = target;
        this.live = this.live.filter(entry => entry.id !== id);
        this.state = afterEntryRemoved(this.state);
    }
    restore(terminalInFlight = false) {
        const plan = planRestore({ removed: this.removed, dismissedRemovedIds: this.state.dismissedRemovedIds, liveEntries: this.live, terminalInFlight });
        if (plan.kind === 'refuse') this.state = afterRestoreRefused(this.state, this.removed!.id, plan.reason);
        if (plan.kind === 'restore') {
            this.removed = null;
            this.live = [...this.live, plan.entry];
            this.state = afterRestoreDone(this.state);
        }
        return plan;
    }
    get restoreOffered() { return isRestoreOffered(this.removed, this.state.dismissedRemovedIds); }
    get loggedOffer() { return this.state.recentLogged?.id ?? null; }
}

describe('nextRepetitionSetIndex', () => {
    it('numbers after the highest live set, not the live count', () => {
        expect(nextRepetitionSetIndex([], 'step-squat', squat)).toBe(1);
        expect(nextRepetitionSetIndex([set('a', 1), set('b', 2)], 'step-squat', squat)).toBe(3);
        expect(nextRepetitionSetIndex([set('b', 2)], 'step-squat', squat)).toBe(3);
    });

    it('ignores tombstones, other steps, other exercises and non-repetition entries', () => {
        const entries = [
            set('a', 4, { deletedAt: at }), set('b', 9, { stepId: 'other' }),
            set('c', 8, { exerciseRef: { kind: 'catalog', exerciseId: 'bench' } }),
            set('d', 1, { payload: { kind: 'duration', seconds: 30 } }),
        ];
        expect(nextRepetitionSetIndex(entries, 'step-squat', squat)).toBe(1);
    });
});

describe('sameExerciseRef', () => {
    it('matches catalog ids and free-text names, never across kinds', () => {
        expect(sameExerciseRef(squat, { kind: 'catalog', exerciseId: 'squat' })).toBe(true);
        expect(sameExerciseRef(squat, { kind: 'catalog', exerciseId: 'bench' })).toBe(false);
        expect(sameExerciseRef({ kind: 'unresolved_free_text', name: 'x' }, { kind: 'unresolved_free_text', name: 'x' })).toBe(true);
        expect(sameExerciseRef(squat, { kind: 'unresolved_free_text', name: 'squat' })).toBe(false);
        expect(sameExerciseRef(undefined, undefined)).toBe(true);
        expect(sameExerciseRef(squat, undefined)).toBe(false);
    });
});

describe('restoreWouldDuplicateSetIndex', () => {
    it('detects a live clash and ignores other steps, exercises and tombstones', () => {
        const stale = set('s3', 3);
        expect(restoreWouldDuplicateSetIndex([set('x', 3)], stale)).toBe(true);
        expect(restoreWouldDuplicateSetIndex([set('x', 3, { stepId: 'row' })], stale)).toBe(false);
        expect(restoreWouldDuplicateSetIndex([set('x', 3, { exerciseRef: { kind: 'catalog', exerciseId: 'bench' } })], stale)).toBe(false);
        expect(restoreWouldDuplicateSetIndex([set('x', 3, { deletedAt: at })], stale)).toBe(false);
        expect(restoreWouldDuplicateSetIndex([set('x', 2)], stale)).toBe(false);
    });
});

describe('undo offer sequences (#724)', () => {
    it('log -> undo -> log -> restore: the stale removal is gone and the new set offers its own Undo', () => {
        const m = new Model();
        const first = m.log(0);
        m.remove(first.id);
        expect(m.restoreOffered).toBe(true);
        const second = m.log(1_000);
        expect(m.restoreOffered).toBe(false);
        expect(m.loggedOffer).toBe(second.id);
        expect(m.restore().kind).toBe('ignore');
        expect(m.live.map(entry => entry.id)).toEqual([second.id]);
    });

    it('s1(1), s2(2); remove s1; log s3 -> 3; remove s3 -> restore is valid (no silent refusal)', () => {
        const m = new Model();
        const s1 = m.log();
        const s2 = m.log();
        m.remove(s1.id);
        const s3 = m.log();
        expect(s3.payload).toMatchObject({ setIndex: 3 });
        m.remove(s3.id);
        expect(m.restoreOffered).toBe(true);
        const plan = m.restore();
        expect(plan.kind).toBe('restore');
        const indices = m.live.map(entry => (entry.payload as { setIndex: number }).setIndex).sort();
        expect(indices).toEqual([2, 3]);
        expect(new Set(indices).size).toBe(indices.length);
        expect(m.live.map(entry => entry.id).sort()).toEqual([s2.id, s3.id].sort());
    });

    it('a newer removal beats an older logged-set banner: log s3, delete s2 -> restore of s2 is offered, logged Undo retired', () => {
        const m = new Model();
        m.log(); const s2 = m.log(); m.log(1_000);
        expect(m.loggedOffer).not.toBeNull();
        m.remove(s2.id);
        expect(m.loggedOffer).toBeNull();
        expect(m.restoreOffered).toBe(true);
        expect(m.removed?.id).toBe(s2.id);
        expect(m.restore().kind).toBe('restore');
    });

    it('undoing the logged set retires its offer and makes that removal the restorable one', () => {
        const m = new Model();
        const s1 = m.log();
        m.remove(s1.id);
        expect(m.loggedOffer).toBeNull();
        expect(m.removed?.id).toBe(s1.id);
        expect(m.restoreOffered).toBe(true);
    });

    it('a resumed session with an older deletion still gets the new set Undo, and logging dismisses the old restore', () => {
        const m = new Model();
        m.removed = set('old', 2, { deletedAt: at });
        expect(m.restoreOffered).toBe(true);
        const fresh = m.log();
        expect(m.restoreOffered).toBe(false);
        expect(m.loggedOffer).toBe(fresh.id);
    });

    it('refuses a clashing restore with an on-screen reason, keeps state otherwise, and does not loop', () => {
        const m = new Model();
        m.removed = set('gone', 1);
        m.live = [set('dup', 1)];
        const plan = m.restore();
        expect(plan).toEqual({ kind: 'refuse', reason: RESTORE_REFUSED_DUPLICATE_REASON });
        expect(m.state.notice).toBe(RESTORE_REFUSED_DUPLICATE_REASON);
        expect(m.live.map(entry => entry.id)).toEqual(['dup']);
        expect(m.restoreOffered).toBe(false);
        expect(m.restore().kind).toBe('ignore');
    });

    it('ignores a restore while a terminal transition is in flight, without dismissing it', () => {
        const m = new Model();
        const s1 = m.log();
        m.remove(s1.id);
        expect(m.restore(true).kind).toBe('ignore');
        expect(m.restoreOffered).toBe(true);
    });

    it('clears the notice on the next log, removal or restore, and expiry only retires the logged offer', () => {
        const refused = afterRestoreRefused(INITIAL_SET_UNDO_STATE, 'x', 'why');
        expect(afterSetLogged(refused, null, 'n', 0).notice).toBeNull();
        expect(afterEntryRemoved(refused).notice).toBeNull();
        expect(afterRestoreDone(refused).notice).toBeNull();
        const logged = afterSetLogged(INITIAL_SET_UNDO_STATE, null, 'n', 0);
        expect(afterLoggedOfferExpired(logged).recentLogged).toBeNull();
        expect(afterLoggedOfferExpired(INITIAL_SET_UNDO_STATE)).toBe(INITIAL_SET_UNDO_STATE);
    });

    it('never offers a restore for a choice entry', () => {
        expect(isRestoreOffered({ ...set('c', 1), payload: { kind: 'choice', choiceId: 'c', optionId: 'o' } }, new Set())).toBe(false);
        expect(isRestoreOffered(null, new Set())).toBe(false);
    });
});
