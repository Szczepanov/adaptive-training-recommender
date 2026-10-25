import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import {
    activity,
    AS_OF,
    constraint,
    fullInput,
    fullRecords,
    recoverySnapshot,
    withExtra,
} from './ledgerExportFixtures.testSupport.ts';
import { STATE_SEVERITY, worstState } from './ledgerValue.ts';
import { LEDGER_STATES, type LedgerPurpose } from './schema.ts';
import { isLocalDate, PURPOSE_BOUNDS } from './window.ts';

const D_MINUS_1 = '2026-11-19';

function manyActivities(count: number, segments: number, dates: string[]) {
    return Array.from({ length: count }, (_, i) => activity(i + 1, segments, dates[i % dates.length]));
}

function segmentLength(value: unknown): number {
    return (value as unknown[]).length;
}

describe('windows', () => {
    it('derives the morning window as today + D-1 and the planning window as 14 days', () => {
        const morning = buildLedgerExport(fullInput({ purpose: 'morning' }));
        expect(morning.window).toEqual({ startDate: D_MINUS_1, endDate: AS_OF, days: 2 });
        expect(morning.facts.recovery.items.map(item => item.id)).toEqual(['recovery-2026-11-19', 'recovery-2026-11-20']);
        expect(morning.facts.assessments.items).toEqual([]);
        expect(buildLedgerExport(fullInput()).window).toEqual({ startDate: '2026-11-07', endDate: AS_OF, days: 14 });
    });

    it('honours a caller window only for diagnostic, and only narrows the other presets', () => {
        const window = { startDate: '2026-10-01', endDate: AS_OF };
        expect(buildLedgerExport(fullInput({ purpose: 'diagnostic', window })).window).toMatchObject({ startDate: '2026-10-01', days: 51 });
        expect(buildLedgerExport(fullInput({ purpose: 'planning', window })).window.startDate).toBe('2026-11-07');
    });

    it('rejects impossible dates by round-trip (L1)', () => {
        expect(isLocalDate('2026-02-30')).toBe(false);
        expect(isLocalDate('2026-13-01')).toBe(false);
        expect(isLocalDate('2026-02-28')).toBe(true);
        expect(() => buildLedgerExport(fullInput({ asOfDate: '2026-02-30' }))).toThrow(/asOfDate/);
        expect(() => buildLedgerExport(fullInput({ asOfDate: '20-11-2026' }))).toThrow(/asOfDate/);
        expect(() => buildLedgerExport(fullInput({ purpose: 'diagnostic', window: { startDate: '2026-02-30', endDate: AS_OF } })))
            .toThrow(/window.startDate/);
    });

    it('drops undated and unparsable rows and counts them (M6)', () => {
        const bad = recoverySnapshot('2026-02-30');
        const garbage = recoverySnapshot('not-a-date');
        const result = buildLedgerExport(fullInput({
            records: { recovery: [recoverySnapshot('2026-11-20'), bad, garbage], activities: [activity(1, 1, 'soon')] },
        }));
        expect(result.facts.recovery.items).toHaveLength(1);
        expect(result.facts.recovery.droppedUndated).toBe(2);
        expect(result.facts.activities).toMatchObject({ items: [], droppedUndated: 1, totalInWindow: 0 });
    });

    it('does not count an out-of-window dated row as undated', () => {
        const result = buildLedgerExport(fullInput({ records: { recovery: [recoverySnapshot('2025-01-01')] } }));
        expect(result.facts.recovery).toMatchObject({ items: [], droppedUndated: 0 });
    });
});

describe('activity caps per purpose (H2, M5)', () => {
    const wideDates = ['2026-11-20', '2026-11-19', '2026-11-18', '2026-11-17'];

    it.each([
        ['planning', 12, 20],
        ['diagnostic', 30, 100],
    ] as [LedgerPurpose, number, number][])('%s keeps at most %i activities and %i segments each', (purpose, activityCap, segmentCap) => {
        const activities = manyActivities(activityCap + 5, segmentCap + 10, wideDates);
        const result = buildLedgerExport(fullInput({ purpose, records: { activities } }));
        const collection = result.facts.activities;
        expect(collection.items).toHaveLength(activityCap);
        expect(collection).toMatchObject({ truncated: true, totalInWindow: activityCap + 5 });
        const first = collection.items[0].fields;
        expect(segmentLength(first.segments.value)).toBe(segmentCap);
        expect(first.segmentCountTotal.value).toBe(segmentCap + 10);
        expect(first.segmentsTruncated.value).toBe(true);
        const dates = collection.items.map(item => item.observedOn!);
        expect([...dates].sort().reverse()).toEqual(dates);
    });

    it('keeps at most six activity rows for morning, with segment detail only for D-1', () => {
        const activities = manyActivities(8, 30, [AS_OF, D_MINUS_1]);
        const result = buildLedgerExport(fullInput({ purpose: 'morning', records: { activities } }));
        const collection = result.facts.activities;
        expect(collection.items).toHaveLength(6);
        expect(collection).toMatchObject({ truncated: true, totalInWindow: 8 });
        for (const item of collection.items) {
            if (item.observedOn === D_MINUS_1) {
                expect(segmentLength(item.fields.segments.value)).toBe(20);
            } else {
                expect(item.fields.segments).toMatchObject({ value: null, state: 'not_applicable' });
                expect(item.fields.segmentCountTotal.value).toBe(30);
            }
        }
        expect(collection.items.some(item => item.observedOn === D_MINUS_1)).toBe(true);
    });

    it('reports truncated false when nothing was withheld', () => {
        const result = buildLedgerExport(fullInput());
        expect(result.facts.activities).toMatchObject({ truncated: false, totalInWindow: 2, droppedUndated: 0 });
    });

    it('matches the documented purpose bounds', () => {
        expect(PURPOSE_BOUNDS.morning).toMatchObject({ activityCap: 6, segmentCap: 20, segmentDetailOnlyDMinus1: true });
        expect(PURPOSE_BOUNDS.planning).toMatchObject({ activityCap: 12, segmentCap: 20 });
        expect(PURPOSE_BOUNDS.diagnostic).toMatchObject({ activityCap: 30, segmentCap: 100 });
    });
});

describe('coaching history bounds (M6)', () => {
    const output = buildLedgerExport(fullInput());

    it('exports only the latest and in-window-referenced plan revisions', () => {
        expect(output.coachingHistory.planRevisions.items.map(item => item.id)).toEqual(['plan-1@2']);
        const referencesOld = fullRecords();
        const result = buildLedgerExport(fullInput({
            records: {
                ...referencesOld,
                placements: [{ planId: 'plan-1', revision: 1, assignments: [{ sessionId: 's9', date: '2026-11-10', status: 'completed' }] }],
            },
        }));
        expect(result.coachingHistory.planRevisions.items.map(item => item.id)).toEqual(['plan-1@1', 'plan-1@2']);
    });

    it('bounds placements, overrides and links to the window', () => {
        const result = buildLedgerExport(fullInput({
            records: {
                ...fullRecords(),
                placements: [{
                    planId: 'plan-1',
                    revision: 2,
                    assignments: [
                        { sessionId: 'old', date: '2026-09-01', status: 'dropped' },
                        { sessionId: 'now', date: '2026-11-19', status: 'moved' },
                    ],
                }],
                plannedToPerformed: [
                    { planId: 'plan-1', sessionId: 'old', date: '2026-09-01', performedOccurrenceId: 'occ-0' },
                    { planId: 'plan-1', sessionId: 'now', date: '2026-11-19', performedOccurrenceId: 'occ-1' },
                ],
            },
        }));
        expect(result.coachingHistory.placements.items.map(item => item.fields.sessionId.value)).toEqual(['now']);
        expect(result.coachingHistory.overrides.items.map(item => item.fields.sessionId.value)).toEqual(['now']);
        expect(result.coachingHistory.plannedToPerformed.items.map(item => item.fields.sessionId.value)).toEqual(['now']);
    });
});

describe('current goals, constraints and events (M6, M7)', () => {
    it('exports only active goals and active constraints', () => {
        const goals = [
            ...fullRecords().goals!,
            { id: 'paused', title: 'Paused', domain: 'speed', status: 'paused' as const, priority: 2 },
        ];
        const result = buildLedgerExport(fullInput({
            records: { goals, constraints: [constraint, withExtra({ ...constraint, key: 'old', isActive: false }, {})] },
        }));
        expect(result.userContext.goals.items.map(item => item.id)).toEqual(['goal-1']);
        expect(result.userContext.constraints.items.map(item => item.id)).toEqual(['no_barbell']);
    });

    it('excludes cancelled and completed events and carries the lifecycle', () => {
        const base = fullRecords().goals![0];
        const goals = [
            base,
            { ...base, id: 'cancelled', eventLifecycle: 'cancelled' as const },
            { ...base, id: 'done', eventLifecycle: 'completed' as const },
            { ...base, id: 'dns', eventLifecycle: 'DNS' as const },
            { ...base, id: 'inactive', status: 'archived' as const },
        ];
        const result = buildLedgerExport(fullInput({ records: { goals, intentBlocks: fullRecords().intentBlocks } }));
        const events = result.userContext.events.items.filter(item => item.id.startsWith('goal-'));
        expect(events.map(item => item.id)).toEqual(['goal-dns', 'goal-goal-1']);
        expect(events.find(item => item.id === 'goal-goal-1')!.fields.lifecycle).toMatchObject({ value: 'scheduled', state: 'measured' });
        expect(events.find(item => item.id === 'goal-dns')!.fields.lifecycle.value).toBe('DNS');
        const block = result.userContext.events.items.find(item => item.id === 'block-ib-1')!;
        expect(block.fields.lifecycle.state).toBe('not_applicable');
    });
});

describe('worst-state combination (M4)', () => {
    it('orders states by a defined severity and picks the worst', () => {
        expect([...STATE_SEVERITY].sort()).toEqual([...LEDGER_STATES].sort());
        expect(worstState([])).toBe('measured');
        expect(worstState(['measured', 'stale'])).toBe('stale');
        expect(worstState(['unavailable', 'invalid', 'measured'])).toBe('unavailable');
        expect(worstState(['missing', 'not_recorded'])).toBe('missing');
        expect(worstState(['invalid', 'missing'])).toBe('invalid');
        for (const a of LEDGER_STATES) {
            for (const b of LEDGER_STATES) expect(worstState([a, b])).toBe(worstState([b, a]));
        }
    });

    it('reports the worst source state for merged availability, whatever the order', () => {
        const fixedFirst = buildLedgerExport(fullInput({
            sources: { fixed_activities: { state: 'unavailable', readAt: null }, schedule_windows: { state: 'stale', readAt: null } },
        }));
        const windowsFirst = buildLedgerExport(fullInput({
            sources: { fixed_activities: { state: 'stale', readAt: null }, schedule_windows: { state: 'unavailable', readAt: null } },
        }));
        expect(fixedFirst.userContext.availability.state).toBe('unavailable');
        expect(windowsFirst.userContext.availability.state).toBe('unavailable');
    });

    it('does not let a measured source mask an unread one', () => {
        const unreadGoals = buildLedgerExport(fullInput({ records: { intentBlocks: fullRecords().intentBlocks } }));
        expect(unreadGoals.userContext.events.state).toBe('unavailable');
    });
});
