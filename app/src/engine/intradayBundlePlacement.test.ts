import { describe, expect, it } from 'vitest';
import type { FixedActivity, ScheduleWindow } from './models';
import type { DailyLedgerResult } from './dailyLedger';
import {
    LEGACY_SINGLE_SLOT_WINDOW_ID,
    confirmBundlePlacement,
    dropOptionalBundleMember,
    proposeBundlePlacement,
    type IntradayBundleMember,
} from './intradayBundlePlacement';

const DATE = '2026-09-10';

function ledger(overrides: Partial<DailyLedgerResult> = {}): DailyLedgerResult {
    return { remainingMinutes: 200, remainingSystemicCost: 1, unresolvedEntries: [], ...overrides };
}

function window(overrides: Partial<ScheduleWindow> = {}): ScheduleWindow {
    return {
        id: 'w', userId: 'u1', date: DATE, startLocal: '06:00', endLocal: '07:00',
        revision: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

function member(overrides: Partial<IntradayBundleMember> = {}): IntradayBundleMember {
    return {
        sessionId: 's', order: 0, priority: 'key',
        requestedWindow: { startLocal: '06:00', endLocal: '07:00' },
        estimatedMinutes: 45, estimatedSystemicCost: 0.2, started: false,
        ...overrides,
    };
}

describe('proposeBundlePlacement', () => {
    it('places a two-member AM/PM bundle into two distinct real windows', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const pm = window({ id: 'pm', startLocal: '17:00', endLocal: '18:00' });
        const members = [
            member({ sessionId: 's1', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '07:00' }, estimatedMinutes: 45 }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '17:00', endLocal: '18:00' }, estimatedMinutes: 45 }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], [], new Set(), ledger());
        expect(result.outcome).toBe('placed');
        expect(result.bindings?.map(b => b.windowId)).toEqual(['am', 'pm']);
    });

    it('is infeasible for a two-member bundle on a legacy date with no real windows -- never fabricates an AM/PM pair', () => {
        const members = [
            member({ sessionId: 's1', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '07:00' } }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '17:00', endLocal: '18:00' } }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [], [], new Set(), ledger());
        expect(result.outcome).toBe('infeasible');
    });

    it('places a single-member bundle onto the legacy single slot when no real windows exist', () => {
        const members = [member({ sessionId: 's1', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '07:00' } })];
        const result = proposeBundlePlacement('b1', DATE, members, [], [], new Set(), ledger());
        expect(result.outcome).toBe('placed');
        expect(result.bindings?.[0].windowId).toBe(LEGACY_SINGLE_SLOT_WINDOW_ID);
    });

    it('is infeasible when the date is an authored rest date -- rest closes every window by default', () => {
        const members = [member()];
        const result = proposeBundlePlacement('b1', DATE, members, [window()], [], new Set([DATE]), ledger());
        expect(result.outcome).toBe('infeasible');
        expect(result.reason).toMatch(/rest/i);
    });

    it('is infeasible when the requested window does not fit the session duration in the real window', () => {
        const tight = window({ id: 'tight', startLocal: '06:00', endLocal: '06:20' });
        const members = [member({ requestedWindow: { startLocal: '06:00', endLocal: '06:20' }, estimatedMinutes: 45 })];
        const result = proposeBundlePlacement('b1', DATE, members, [tight], [], new Set(), ledger());
        expect(result.outcome).toBe('infeasible');
    });

    it('blocks only the window a known-clock-time fixed activity actually overlaps', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const pm = window({ id: 'pm', startLocal: '17:00', endLocal: '18:00' });
        const fixed: FixedActivity[] = [{
            id: 'f1', userId: 'u1', title: 'Match', date: DATE, startTime: '06:30', durationMin: 60,
            fixed: true, environment: 'outdoor', equipment: [], isCompleted: false,
            createdAt: '', updatedAt: '',
        }];
        const members = [member({ sessionId: 's1', requestedWindow: { startLocal: '17:00', endLocal: '18:00' } })];
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], fixed, new Set(), ledger());
        expect(result.outcome).toBe('placed');
        expect(result.bindings?.[0].windowId).toBe('pm');

        const blockedMembers = [member({ sessionId: 's1', requestedWindow: { startLocal: '06:00', endLocal: '07:00' } })];
        const blocked = proposeBundlePlacement('b1', DATE, blockedMembers, [am, pm], fixed, new Set(), ledger());
        expect(blocked.outcome).toBe('infeasible');
    });

    it('blocks the whole date when a fixed activity has no resolvable clock time', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const fixed: FixedActivity[] = [{
            id: 'f1', userId: 'u1', title: 'Unknown-time errand', date: DATE, durationMin: 60,
            fixed: true, environment: 'outdoor', equipment: [], isCompleted: false,
            createdAt: '', updatedAt: '',
        }];
        const result = proposeBundlePlacement('b1', DATE, [member()], [am], fixed, new Set(), ledger());
        expect(result.outcome).toBe('infeasible');
    });

    it('a completed fixed activity does not block placement', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const fixed: FixedActivity[] = [{
            id: 'f1', userId: 'u1', title: 'Done already', date: DATE, durationMin: 60,
            fixed: true, environment: 'outdoor', equipment: [], isCompleted: true,
            createdAt: '', updatedAt: '',
        }];
        const result = proposeBundlePlacement('b1', DATE, [member()], [am], fixed, new Set(), ledger());
        expect(result.outcome).toBe('placed');
    });

    it('a 90-minute daily ceiling with a 60-minute AM completion leaves at most 30 for PM even if both windows individually offer 90', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:30' }); // 90 min window
        const pm = window({ id: 'pm', startLocal: '17:00', endLocal: '18:30' }); // 90 min window
        const members = [
            member({ sessionId: 's1', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '07:30' }, estimatedMinutes: 60 }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '17:00', endLocal: '18:30' }, estimatedMinutes: 40 }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], [], new Set(), ledger({ remainingMinutes: 90 }));
        expect(result.outcome).toBe('infeasible');
    });

    it('admits a PM member whose minutes fit the remaining daily ceiling after AM consumption', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:30' });
        const pm = window({ id: 'pm', startLocal: '17:00', endLocal: '18:30' });
        const members = [
            member({ sessionId: 's1', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '07:30' }, estimatedMinutes: 60 }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '17:00', endLocal: '18:30' }, estimatedMinutes: 30 }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], [], new Set(), ledger({ remainingMinutes: 90 }));
        expect(result.outcome).toBe('placed');
    });

    it('is infeasible when spare minutes remain but daily systemic-cost capacity is exhausted', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const members = [member({ estimatedMinutes: 30, estimatedSystemicCost: 0.5 })];
        const result = proposeBundlePlacement('b1', DATE, members, [am], [], new Set(), ledger({ remainingMinutes: 200, remainingSystemicCost: 0 }));
        expect(result.outcome).toBe('infeasible');
    });

    it('is infeasible when a dependent starts less than the required separation after its predecessor ends', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const pm = window({ id: 'pm', startLocal: '07:10', endLocal: '08:00' });
        const members = [
            member({ sessionId: 'pred', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '07:00' }, estimatedMinutes: 60 }),
            member({
                sessionId: 'dep', order: 1, requestedWindow: { startLocal: '07:10', endLocal: '08:00' }, estimatedMinutes: 30,
                afterSessionId: 'pred', minimumSeparationMinutes: 60,
            }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], [], new Set(), ledger());
        expect(result.outcome).toBe('infeasible');
        expect(result.reason).toMatch(/separat|minute/i);
    });

    it('places a dependent whose gap after its predecessor meets the required separation', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const pm = window({ id: 'pm', startLocal: '09:00', endLocal: '10:00' });
        const members = [
            member({ sessionId: 'pred', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '07:00' }, estimatedMinutes: 60 }),
            member({
                sessionId: 'dep', order: 1, requestedWindow: { startLocal: '09:00', endLocal: '10:00' }, estimatedMinutes: 30,
                afterSessionId: 'pred', minimumSeparationMinutes: 60,
            }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], [], new Set(), ledger());
        expect(result.outcome).toBe('placed');
    });

    it('preserves a started member\'s existing binding unchanged and excludes its window from the remaining pool', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const pm = window({ id: 'pm', startLocal: '17:00', endLocal: '18:00' });
        const existingBinding = {
            sessionId: 's1', windowId: 'am', boundStartLocal: '06:00', boundEndLocal: '07:00',
            startInstant: '2026-09-10T04:00:00.000Z', endInstant: '2026-09-10T05:00:00.000Z',
        };
        const members = [
            member({ sessionId: 's1', order: 0, started: true, existingBinding }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '06:00', endLocal: '07:00' } }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], [], new Set(), ledger());
        // s1 keeps its exact existing binding; s2 cannot reuse the now-consumed 'am' window
        // and has no real window left matching its own (identical) requested interval.
        expect(result.outcome).toBe('infeasible');

        const members2 = [
            member({ sessionId: 's1', order: 0, started: true, existingBinding }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '17:00', endLocal: '18:00' } }),
        ];
        const placed = proposeBundlePlacement('b1', DATE, members2, [am, pm], [], new Set(), ledger());
        expect(placed.outcome).toBe('placed');
        expect(placed.bindings?.find(b => b.sessionId === 's1')).toEqual(existingBinding);
        expect(placed.bindings?.find(b => b.sessionId === 's2')?.windowId).toBe('pm');
    });

    it('is infeasible when a started member is missing its existing binding', () => {
        const result = proposeBundlePlacement('b1', DATE, [member({ started: true })], [window()], [], new Set(), ledger());
        expect(result.outcome).toBe('infeasible');
    });

    it('is infeasible when the bound window falls on a nonexistent Warsaw spring-forward local time', () => {
        const gapDate = '2026-03-29';
        const spanningWindow = window({ id: 'w', date: gapDate, startLocal: '01:30', endLocal: '03:30' });
        const members = [member({ requestedWindow: { startLocal: '02:00', endLocal: '03:00' }, estimatedMinutes: 30 })];
        const result = proposeBundlePlacement('b1', gapDate, members, [spanningWindow], [], new Set(), ledger());
        expect(result.outcome).toBe('infeasible');
    });

    it('does not let a movable (non-fixed) activity block placement', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:00' });
        const movable: FixedActivity[] = [{
            id: 'f1', userId: 'u1', title: 'Movable placeholder', date: DATE, startTime: '06:00', durationMin: 60,
            fixed: false, environment: 'outdoor', equipment: [], isCompleted: false,
            createdAt: '', updatedAt: '',
        }];
        const result = proposeBundlePlacement('b1', DATE, [member()], [am], movable, new Set(), ledger());
        expect(result.outcome).toBe('placed');
    });

    it('excludes a started member\'s occupied interval even when the current schedule now uses a different window id for it', () => {
        // The window the member actually started in was 'old-am'; the athlete's schedule
        // has since been edited so the current ScheduleWindow set only has 'new-am'
        // covering the same 06:00-07:00 interval under a different id.
        const newAm = window({ id: 'new-am', startLocal: '06:00', endLocal: '07:00' });
        const pm = window({ id: 'pm', startLocal: '17:00', endLocal: '18:00' });
        const existingBinding = {
            sessionId: 's1', windowId: 'old-am', boundStartLocal: '06:00', boundEndLocal: '07:00',
            startInstant: '2026-09-10T04:00:00.000Z', endInstant: '2026-09-10T05:00:00.000Z',
        };
        const members = [
            member({ sessionId: 's1', order: 0, started: true, existingBinding }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '06:00', endLocal: '07:00' } }),
        ];
        // 's2' requests the same interval as the started member's occupied interval,
        // which must stay excluded by interval even though its window id changed.
        const result = proposeBundlePlacement('b1', DATE, members, [newAm, pm], [], new Set(), ledger());
        expect(result.outcome).toBe('infeasible');

        const members2 = [
            member({ sessionId: 's1', order: 0, started: true, existingBinding }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '17:00', endLocal: '18:00' } }),
        ];
        const placed = proposeBundlePlacement('b1', DATE, members2, [newAm, pm], [], new Set(), ledger());
        expect(placed.outcome).toBe('placed');
        expect(placed.bindings?.find(b => b.sessionId === 's2')?.windowId).toBe('pm');
    });

    it('debits a started member\'s own consumption from the ledger before admitting later members', () => {
        const am = window({ id: 'am', startLocal: '06:00', endLocal: '07:30' });
        const pm = window({ id: 'pm', startLocal: '17:00', endLocal: '18:30' });
        const existingBinding = {
            sessionId: 's1', windowId: 'am', boundStartLocal: '06:00', boundEndLocal: '07:00',
            startInstant: '2026-09-10T04:00:00.000Z', endInstant: '2026-09-10T05:00:00.000Z',
        };
        const members = [
            member({ sessionId: 's1', order: 0, started: true, existingBinding, estimatedMinutes: 60 }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '17:00', endLocal: '18:30' }, estimatedMinutes: 40 }),
        ];
        // 90-minute daily ceiling: the started 60-minute member must be charged first,
        // leaving only 30 for the second member's 40-minute request.
        const result = proposeBundlePlacement('b1', DATE, members, [am, pm], [], new Set(), ledger({ remainingMinutes: 90 }));
        expect(result.outcome).toBe('infeasible');
    });

    it('backtracks an earlier member off its best-overlap window when that is the only way the whole bundle fits', () => {
        // s1 (order 0) requests 06:00-08:00 and fits either 'a' (06:00-07:00, its best
        // overlap) or 'b' (07:00-08:00). s2 (order 1) can only use 'a'. A greedy choice
        // of 'a' for s1 would strand s2; the correct assignment swaps s1 onto 'b'.
        const a = window({ id: 'a', startLocal: '06:00', endLocal: '07:00' });
        const b = window({ id: 'b', startLocal: '07:00', endLocal: '08:00' });
        const members = [
            member({ sessionId: 's1', order: 0, requestedWindow: { startLocal: '06:00', endLocal: '08:00' }, estimatedMinutes: 30 }),
            member({ sessionId: 's2', order: 1, requestedWindow: { startLocal: '06:00', endLocal: '07:00' }, estimatedMinutes: 30 }),
        ];
        const result = proposeBundlePlacement('b1', DATE, members, [a, b], [], new Set(), ledger());
        expect(result.outcome).toBe('placed');
        expect(result.bindings?.find(binding => binding.sessionId === 's1')?.windowId).toBe('b');
        expect(result.bindings?.find(binding => binding.sessionId === 's2')?.windowId).toBe('a');
    });
});

describe('dropOptionalBundleMember', () => {
    it('removes an optional, not-yet-started member', () => {
        const members = [member({ sessionId: 's1', priority: 'optional' }), member({ sessionId: 's2' })];
        const remaining = dropOptionalBundleMember(members, 's1');
        expect(remaining.map(m => m.sessionId)).toEqual(['s2']);
    });

    it('throws when the target session is not part of the bundle', () => {
        expect(() => dropOptionalBundleMember([member({ sessionId: 's1' })], 'missing')).toThrow(/not part of this bundle/);
    });

    it('throws when the target member is not optional', () => {
        expect(() => dropOptionalBundleMember([member({ sessionId: 's1', priority: 'key' })], 's1')).toThrow(/not optional/);
    });

    it('throws when the target member has already started', () => {
        expect(() => dropOptionalBundleMember([member({ sessionId: 's1', priority: 'optional', started: true })], 's1')).toThrow(/already started/);
    });
});

describe('confirmBundlePlacement', () => {
    it('returns the bindings of a placed proposal', () => {
        const proposal = proposeBundlePlacement('b1', DATE, [member()], [window()], [], new Set(), ledger());
        expect(confirmBundlePlacement(proposal)).toHaveLength(1);
    });

    it('throws for an infeasible proposal rather than confirming a partial placement', () => {
        const proposal = proposeBundlePlacement('b1', DATE, [member()], [window()], [], new Set([DATE]), ledger());
        expect(() => confirmBundlePlacement(proposal)).toThrow(/infeasible/);
    });
});
