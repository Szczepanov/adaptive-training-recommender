import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import { type PreviousContext, userContextItemHashes } from './previousContext.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';

const build = (purpose: 'morning' | 'planning' = 'morning') => buildLedgerExport(fullInput({ purpose }));
const previousOf = (ledger = build()): PreviousContext => ({ exportedOn: '2026-11-13', itemHashes: userContextItemHashes(ledger) });
const userContext = (out: string) => out.slice(out.indexOf('## User context'), out.indexOf('## Coaching history'));

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

    it('ignores observedOn and exportedAt-like volatile keys', () => {
        const a = build();
        const b = build();
        b.userContext.injuries.items[0].observedOn = '2020-01-01';
        expect(userContextItemHashes(b)).toEqual(userContextItemHashes(a));
    });

    it('unchanged items collapse into one line', () => {
        const ledger = build();
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previousOf(ledger) }));
        const lines = out.split('\n').filter(line => line.startsWith('unchanged since'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^unchanged since 2026-11-13: \d+ items \(.*equipment.*injuries\/injury-001.*trainingDislikes.*\)$/);
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

    it('removed keys are listed', () => {
        const ledger = build();
        const previous: PreviousContext = { ...previousOf(ledger), itemHashes: { ...previousOf(ledger).itemHashes, 'injuries/gone-9': 'deadbeef' } };
        expect(userContext(renderLedgerExportCompact(ledger, { previousContext: previous }))).toContain('removed: injuries/gone-9');
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
