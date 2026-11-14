import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import type { LedgerFlag } from '../schema.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';

function flag(id: LedgerFlag['id'], observedOn: string, over: Partial<LedgerFlag> = {}): LedgerFlag {
    return { id, observedOn, evaluatedAt: null, definitionVersion: null, active: false, state: 'measured',
        inputs: [], threshold: null, ...over };
}

describe('renderLedgerExportCompact', () => {
    it('renders morning compact golden', async () => {
        const out = renderLedgerExportCompact(buildLedgerExport(fullInput({ purpose: 'morning' })));
        await expect(out).toMatchFileSnapshot('./morning.golden.md');
    });

    it('renders planning compact golden', async () => {
        const out = renderLedgerExportCompact(buildLedgerExport(fullInput({ purpose: 'planning' })));
        await expect(out).toMatchFileSnapshot('./planning.golden.md');
    });

    it('lists missing fields on one line and never prints 0 for null', () => {
        const ledger = buildLedgerExport(fullInput());
        const rec = ledger.facts.recovery.items[0];
        rec.fields.weightKg = { value: null, source: 'garmin', state: 'missing' };
        rec.fields.bodyFatPct = { value: null, source: 'garmin', state: 'unavailable' };
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('missing: weightKg (missing), bodyFatPct (unavailable)');
        expect(out).not.toMatch(/weightKg: (0|false)/);
        expect(out).toContain('totalSteps: 0 steps');
    });

    it('collapses an all-missing record to one line', () => {
        const ledger = buildLedgerExport(fullInput());
        for (const value of Object.values(ledger.userContext.guardrails.fields)) {
            value.value = null;
            value.state = 'not_recorded';
        }
        ledger.userContext.guardrails.since = { value: null, source: 'athlete', state: 'not_recorded' };
        ledger.userContext.guardrails.revisions = { value: null, source: 'athlete', state: 'not_recorded' };
        expect(renderLedgerExportCompact(ledger)).toContain('guardrails: missing 6 fields (not_recorded x6)');
    });

    it('summarises inactive flags per id with date ranges', () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.flags = [
            flag('illness_anomaly', '2026-11-18'), flag('illness_anomaly', '2026-11-19'), flag('illness_anomaly', '2026-11-20'),
            flag('recovery_beyond_baseline', '2026-11-19', { active: null, state: 'unavailable' }),
            flag('illness_risk_symptom', '2026-11-20', { active: true, sessionRef: 's-1', threshold: 'any',
                inputs: [{ name: 'fever', value: { value: 38, unit: 'C', source: 'athlete', state: 'measured' } }] }),
        ];
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('illness_anomaly: inactive 2026-11-18…2026-11-20');
        expect(out).toContain('recovery_beyond_baseline: unavailable 2026-11-19');
        expect(out).toContain('#### illness_risk_symptom (2026-11-20)');
        expect(out).toContain('sessionRef: s-1');
        expect(out).toContain('threshold: any');
        expect(out).toContain('fever: 38 C');
    });

    it('prints only non-measured sources', () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.sources = ledger.sources.map(source => ({ ...source, state: 'measured' }));
        expect(renderLedgerExportCompact(ledger)).toContain('sources: all measured');
        ledger.sources[0] = { ...ledger.sources[0], state: 'stale' };
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain(`${ledger.sources[0].source}: stale`);
        expect(out).not.toContain('sources: all measured');
    });

    it('renders empty or unread collections as one line and counts drops', () => {
        const ledger = buildLedgerExport(fullInput({ records: {} }));
        ledger.facts.recovery.state = 'unavailable';
        ledger.coachingHistory.placements.droppedOutOfWindow = 3;
        ledger.coachingHistory.placements.droppedUndated = 2;
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('recovery: unavailable, no rows');
        expect(out).toMatch(/placements: \w+, no rows, droppedUndated: 2, droppedOutOfWindow: 3/);
    });

    it('escapes markdown in values', () => {
        const ledger = buildLedgerExport(fullInput());
        const hostile = 'line\n## injected | <script>\u0000`[link](https://example.com)';
        ledger.facts.checkins.items[0].fields.notes.value = hostile;
        ledger.userContext.equipment.revisions = {
            value: [{ note: hostile }], source: 'athlete', state: 'measured',
        };
        const out = renderLedgerExportCompact(ledger);
        expect(out).not.toContain('\n## injected');
        expect(out).not.toContain('<script>');
        expect(out).not.toContain('\u0000');
        expect(out).not.toContain('[link](https://example.com)');
        expect(out).toContain('&#124;');
        expect(out.split('\n').filter(l => l.includes('injected'))).toHaveLength(2);
    });

    it('is deterministic and does not mutate the ledger', () => {
        const ledger = buildLedgerExport(fullInput());
        const before = JSON.stringify(ledger);
        expect(renderLedgerExportCompact(ledger)).toBe(renderLedgerExportCompact(ledger));
        expect(JSON.stringify(ledger)).toBe(before);
    });
});
