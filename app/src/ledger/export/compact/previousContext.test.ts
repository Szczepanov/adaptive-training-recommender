import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import {
    CHECKPOINT_FORMAT_VERSION,
    mergeCheckpoint,
    type PreviousContext,
    userContextCheckpoint,
    userContextItemHashes,
} from './previousContext.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';

const build = (purpose: 'morning' | 'planning' = 'morning') => buildLedgerExport(fullInput({ purpose }));
/** What confirming this export would store: the checkpoint merged onto nothing. */
const previousOf = (ledger = build()): PreviousContext => mergeCheckpoint(undefined, userContextCheckpoint(ledger), '2026-11-13');
const userContext = (out: string) => out.slice(out.indexOf('## User context'), out.indexOf('## Coaching history'));
const withHash = (previous: PreviousContext, key: string): PreviousContext =>
    ({ ...previous, itemHashes: { ...previous.itemHashes, [key]: 'deadbeef' } });

describe('previousContext', () => {
    it('hash is stable across key order', () => {
        const a = build();
        const b = build();
        const fields = b.userContext.guardrails.fields;
        b.userContext.guardrails.fields = Object.fromEntries(Object.entries(fields).reverse()) as typeof fields;
        expect(userContextItemHashes(b)).toEqual(userContextItemHashes(a));
        expect(userContextItemHashes(a)['injuries/injury-001']).toMatch(/^[0-9a-f]{8}$/);
        expect(Object.keys(userContextItemHashes(a))).toEqual(expect.arrayContaining(['equipment', 'trainingDislikes']));
    });

    it('unchanged items collapse into one line', () => {
        const ledger = build();
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previousOf(ledger) }));
        const lines = out.split('\n').filter(line => line.startsWith('unchanged since'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^unchanged since 2026-11-13: \d+ items \(.*equipment.*injuries\/injury-001.*\)$/);
        expect(out).not.toContain('region: knee');
        expect(out).not.toContain('### equipment');
    });

    it('a changed field prints the item in full', () => {
        const ledger = build();
        const previous = previousOf(ledger);
        ledger.userContext.injuries.items[0].fields.severity.value = 'avoid';
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).toContain('#### injury-001');
        expect(out).toContain('severity: avoid');
        expect(out).not.toMatch(/unchanged since.*injuries\/injury-001/);
        expect(out).toMatch(/unchanged since.*equipment/);
    });

    it('a new id prints in full even if another item shares its hash', () => {
        const ledger = build();
        const previous = previousOf(ledger);
        const source = ledger.userContext.injuries.items[0];
        ledger.userContext.injuries.items.push({ ...structuredClone(source), id: 'injury-002' });
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).toContain('#### injury-002');
        expect(out).not.toContain('#### injury-001');
        expect(out).toMatch(/unchanged since.*injuries\/injury-001/);
    });

    it('removed: only after a complete read in the same scope', () => {
        const ledger = build();
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: withHash(previousOf(ledger), 'goals/gone-9') }));
        expect(out).toContain('removed: goals/gone-9');
    });

    it('a failed read reports not readable now, never removed, and abbreviates nothing from it', () => {
        const ledger = build();
        const previous = previousOf(ledger);
        ledger.userContext.injuries.items = [];
        ledger.userContext.injuries.state = 'unavailable';
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).not.toContain('removed:');
        expect(out).toContain('not readable now: injuries/injury-001 (unavailable)');
        expect(out).not.toMatch(/unchanged since.*injuries\//);
        expect(out).toMatch(/unchanged since.*equipment/);
    });

    it('a truncated read (rows omitted) reports not readable now, never removed', () => {
        const ledger = build();
        const previous = withHash(previousOf(ledger), 'goals/gone-9');
        ledger.userContext.goals.droppedUndated = 1;
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).not.toContain('removed:');
        expect(out).toContain('not readable now: goals/gone-9 (incomplete)');
    });

    it('a moving window reports out of scope now, never removed', () => {
        const ledger = build();
        const previous = withHash(previousOf(ledger), 'availability/fixed-old');
        const moved: PreviousContext = {
            ...previous,
            collections: { ...previous.collections, availability: { scope: 'from:2026-11-01', complete: true } },
        };
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: moved }));
        expect(out).not.toContain('removed:');
        expect(out).toContain('out of scope now: availability/fixed-old');
    });

    it.each([
        ['another format version', { formatVersion: CHECKPOINT_FORMAT_VERSION + 1 }],
        ['no format version (legacy)', { formatVersion: undefined }],
    ])('%s gives full context', (_name, patch) => {
        const ledger = build();
        const previous = { ...previousOf(ledger), ...patch } as PreviousContext;
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).not.toContain('unchanged since');
        expect(out).toContain('region: knee');
        expect(renderLedgerExportCompact(ledger, { previousContext: previous })).toBe(renderLedgerExportCompact(ledger));
    });

    it('without previousContext everything prints in full', () => {
        const out = userContext(renderLedgerExportCompact(build()));
        expect(out).not.toContain('unchanged since');
        expect(out).toContain('region: knee');
    });

    it('morning compact with matching previousContext is <= 8,145 chars and without it <= 13,032 chars', () => {
        const ledger = build();
        expect(renderLedgerExportCompact(ledger, { previousContext: previousOf(ledger) }).length).toBeLessThanOrEqual(8145);
        expect(renderLedgerExportCompact(ledger).length).toBeLessThanOrEqual(13032);
    });
});
