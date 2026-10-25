import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import {
    activity,
    AS_OF,
    FAKE_ACCOUNT_ID,
    FAKE_EMAIL,
    FAKE_USER_ID,
    fullInput,
    fullRecords,
    recoverySnapshot,
} from './ledgerExportFixtures.testSupport.ts';
import { ENVELOPE_SCALARS, resolvePath } from './ledgerExportPaths.testSupport.ts';
import { LEDGER_EXPORT_FIELDS, LEDGER_FLAG_IDS, LEDGER_STATES } from './schema.ts';

describe('buildLedgerExport completeness', () => {
    const output = buildLedgerExport(fullInput());

    it.each(LEDGER_EXPORT_FIELDS.map(path => [path]))('promised field %s is present with a state', path => {
        const nodes = resolvePath(output, path);
        expect(nodes.length, `no element at ${path}`).toBeGreaterThan(0);
        for (const node of nodes) {
            expect(node, path).not.toBeUndefined();
            if (ENVELOPE_SCALARS.has(path)) continue;
            // `flags[].state` resolves to the state itself; everything else to a state-bearing node.
            const state = typeof node === 'string' ? node : (node as { state: string }).state;
            expect(LEDGER_STATES, path).toContain(state);
        }
    });

    it('still promises every field when no records were read at all', () => {
        const empty = buildLedgerExport(fullInput({ records: {} }));
        for (const path of LEDGER_EXPORT_FIELDS.filter(p => !p.includes('[]') && !ENVELOPE_SCALARS.has(p))) {
            const [node] = resolvePath(empty, path);
            expect((node as { state: string }).state, path).toBeDefined();
        }
        expect(empty.facts.recovery).toMatchObject({ state: 'unavailable', items: [] });
        expect(empty.userContext.equipment.fields.free_weights.state).toBe('unavailable');
    });

    it('reports one SourceState per source read, unread ones unavailable', () => {
        const byName = new Map(output.sources.map(source => [source.source, source]));
        expect(byName.get('daily_recovery_snapshots')).toEqual({
            source: 'daily_recovery_snapshots',
            state: 'measured',
            readAt: '2026-11-20T06:12:00Z',
            newestObservedOn: '2026-11-20',
        });
        const empty = buildLedgerExport(fullInput({ records: {} }));
        expect(empty.sources.every(source => source.state === 'unavailable')).toBe(true);
    });
});

describe('buildLedgerExport states', () => {
    const output = buildLedgerExport(fullInput());

    it('marks fields with no backing record not_yet_supported, never null with measured', () => {
        expect(output.userContext.trainingDislikes).toMatchObject({ value: null, state: 'not_yet_supported' });
        const placement = output.coachingHistory.placements.items[0];
        expect(placement.fields.statusHistory.state).toBe('not_yet_supported');
        const override = output.coachingHistory.overrides.items[0];
        expect(override.fields.reason.state).toBe('not_yet_supported');
        expect(output.userContext.injuries.items[0].since.state).toBe('not_yet_supported');
        expect(output.userContext.injuries.items[0].revisions.state).toBe('not_yet_supported');
    });

    it('never emits a measured value that is null, anywhere in the export', () => {
        const offenders: string[] = [];
        const walk = (node: unknown, path: string): void => {
            if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`));
            else if (node && typeof node === 'object') {
                const candidate = node as Record<string, unknown>;
                if (candidate.state === 'measured' && 'value' in candidate && candidate.value === null) offenders.push(path);
                Object.entries(candidate).forEach(([key, nested]) => walk(nested, `${path}.${key}`));
            }
        };
        walk(output, '$');
        expect(offenders).toEqual([]);
    });

    it('keeps a measured zero measured with value 0', () => {
        const recovery = output.facts.recovery.items[0].fields;
        expect(recovery.restingHr).toMatchObject({ value: 0, state: 'measured' });
        expect(output.facts.checkins.items[0].fields.fatigue).toMatchObject({ value: 0, state: 'measured' });
        expect(output.facts.nutrition.items[0].fields.proteinG).toMatchObject({ value: 0, state: 'measured' });
    });

    it('marks an absent value missing or not_recorded, not measured', () => {
        expect(output.facts.recovery.items[0].fields.weightKg).toMatchObject({ value: null, state: 'missing' });
        expect(output.facts.checkins.items[0].fields.soreness).toMatchObject({ value: null, state: 'not_recorded' });
        expect(output.userContext.environment.fields.weekendMaxMinutes.state).toBe('not_recorded');
    });

    it('retains the dated value of a stale metric and its semantic date', () => {
        const stale = recoverySnapshot('2026-11-20', {});
        (stale.source as { metricDates?: Record<string, string> }).metricDates = { sleep: '2026-11-18', steps: '2026-11-19' };
        const result = buildLedgerExport(fullInput({ records: { recovery: [stale] } }));
        const fields = result.facts.recovery.items[0].fields;
        expect(fields.sleepScore).toMatchObject({ value: 81, state: 'stale', observedOn: '2026-11-18' });
        expect(fields.totalSteps).toMatchObject({ value: 9000, state: 'measured', observedOn: '2026-11-19' });
        expect(fields.restingHr.observedOn).toBe('2026-11-20');
    });

    it('dates totalSteps to D-1 when the snapshot reports no metric date (I3)', () => {
        expect(output.facts.recovery.items[1].fields.totalSteps.observedOn).toBe('2026-11-19');
    });

    it('does not infer duration for an occurrence without both instants', () => {
        const records = fullRecords();
        const open = { ...records.performedOccurrences![0], endedAt: undefined };
        const result = buildLedgerExport(fullInput({ records: { performedOccurrences: [open] } }));
        expect(result.facts.performedTraining.items[0].fields.durationMin).toMatchObject({ value: null, state: 'missing' });
        expect(output.facts.performedTraining.items[0].fields.durationMin).toMatchObject({ value: 60, state: 'measured' });
    });

    it('renders a merged occurrence zero times', () => {
        const merged = { ...fullRecords().performedOccurrences![0], status: 'merged' };
        const result = buildLedgerExport(fullInput({ records: { performedOccurrences: [merged] } }));
        expect(result.facts.performedTraining.items).toEqual([]);
        expect(result.facts.performedTraining.state).toBe('measured');
    });

    it('lists all four flags unevaluated and the derived layer unsupported', () => {
        expect(output.flags.map(flag => flag.id)).toEqual([...LEDGER_FLAG_IDS]);
        for (const flag of output.flags) {
            expect(flag).toMatchObject({ active: null, state: 'not_yet_supported', evaluatedAt: null });
        }
        expect(output.derived.length).toBeGreaterThan(0);
        expect(output.derived.every(metric => metric.value.state === 'not_yet_supported')).toBe(true);
    });

    it('keeps travel and venue restrictions in the user context with the block start as since', () => {
        const [travel] = output.userContext.travel.items;
        expect(travel.fields.startDate.value).toBe('2026-11-25');
        expect(travel.since).toMatchObject({ value: '2026-11-25', state: 'measured' });
        expect(output.userContext.venueRestrictions.items[0].fields.environment.value).toBe('indoor');
    });

    it('exports dropped placements as overrides without a reason', () => {
        expect(output.coachingHistory.overrides.items.map(item => item.fields.kind.value)).toEqual(['dropped']);
        expect(output.coachingHistory.planRevisions.items[0].fields.authorRationale.value).toBe('Build aerobic base first.');
    });
});

describe('buildLedgerExport legacyEngine (OD4)', () => {
    it('is null unless requested', () => {
        expect(buildLedgerExport(fullInput()).legacyEngine).toBeNull();
    });

    it('carries the opaque layer when requested, stripped of identity keys', () => {
        const result = buildLedgerExport(fullInput({
            legacyEngine: { policyVersion: '1.2.3', plan: { userId: FAKE_USER_ID, phase: 'build' } },
        }));
        expect(result.legacyEngine).toEqual({ policyVersion: '1.2.3', plan: { phase: 'build' } });
    });
});

describe('buildLedgerExport bounds (OD1/OD2)', () => {
    it('derives the morning window as today + D-1', () => {
        const result = buildLedgerExport(fullInput({ purpose: 'morning' }));
        expect(result.window).toEqual({ startDate: '2026-11-19', endDate: AS_OF, days: 2 });
        expect(result.facts.recovery.items.map(item => item.id)).toEqual(['2026-11-19', '2026-11-20']);
        expect(result.facts.assessments.items).toEqual([]);
    });

    it('derives the planning window as 14 days', () => {
        const result = buildLedgerExport(fullInput({ purpose: 'planning' }));
        expect(result.window).toEqual({ startDate: '2026-11-07', endDate: AS_OF, days: 14 });
    });

    it('honours a caller window only for diagnostic, and only narrows the other presets', () => {
        const window = { startDate: '2026-10-01', endDate: AS_OF };
        expect(buildLedgerExport(fullInput({ purpose: 'diagnostic', window })).window).toMatchObject({ startDate: '2026-10-01', days: 51 });
        expect(buildLedgerExport(fullInput({ purpose: 'planning', window })).window.startDate).toBe('2026-11-07');
    });

    it('caps planning activities at the newest 12 with at most 20 segments each', () => {
        const activities = Array.from({ length: 15 }, (_, i) => activity(i + 1, 30));
        const result = buildLedgerExport(fullInput({ records: { activities } }));
        expect(result.facts.activities.items).toHaveLength(12);
        const dates = result.facts.activities.items.map(item => item.observedOn!);
        expect([...dates].sort().reverse()).toEqual(dates);
        const first = result.facts.activities.items[0].fields;
        expect((first.segments.value as unknown[]).length).toBe(20);
        expect(first.segmentCountTotal.value).toBe(30);
        expect(first.segmentsTruncated.value).toBe(true);
    });

    it('does not cap diagnostic activity detail', () => {
        const activities = Array.from({ length: 15 }, (_, i) => activity(i + 1, 30));
        const result = buildLedgerExport(fullInput({ purpose: 'diagnostic', records: { activities } }));
        expect(result.facts.activities.items).toHaveLength(15);
        expect((result.facts.activities.items[0].fields.segments.value as unknown[]).length).toBe(30);
    });

    it('rejects a malformed asOfDate', () => {
        expect(() => buildLedgerExport(fullInput({ asOfDate: '20-11-2026' }))).toThrow(/asOfDate/);
    });
});

describe('buildLedgerExport privacy and determinism', () => {
    it('never serializes a user id, e-mail field or provider account id', () => {
        const serialized = JSON.stringify(buildLedgerExport(fullInput({
            legacyEngine: { owner: { email: FAKE_EMAIL, userId: FAKE_USER_ID, accountId: FAKE_ACCOUNT_ID } },
        })));
        expect(serialized).not.toContain(FAKE_USER_ID);
        expect(serialized).not.toContain(FAKE_ACCOUNT_ID);
        expect(serialized).not.toContain(FAKE_EMAIL);
        expect(serialized).not.toContain('"email"');
        expect(serialized).toContain('Contact me at [redacted]');
    });

    it('gives identical output for identical inputs apart from exportedAt', () => {
        const first = buildLedgerExport(fullInput());
        const second = buildLedgerExport(fullInput({ exportedAt: '2030-01-01T00:00:00Z' }));
        expect({ ...second, exportedAt: first.exportedAt }).toEqual(first);
        expect(JSON.stringify(buildLedgerExport(fullInput()))).toBe(JSON.stringify(first));
    });

    it('does not mutate its inputs', () => {
        const input = fullInput();
        const before = JSON.stringify(input);
        buildLedgerExport(input);
        expect(JSON.stringify(input)).toBe(before);
    });
});
