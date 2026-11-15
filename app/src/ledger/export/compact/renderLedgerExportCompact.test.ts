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
        expect(out).toContain('missing: weightKg (missing); bodyFatPct (unavailable)');
        rec.fields.bodyFatPct = { value: null, source: 'garmin', state: 'missing' };
        rec.fields.stressAvg = { value: null, source: 'garmin', state: 'measured' };
        // Names are grouped by state, each state printed once; a measured null stays explicit.
        expect(renderLedgerExportCompact(ledger)).toContain('missing: stressAvg (measured, null); weightKg, bodyFatPct (missing)');
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
        expect(renderLedgerExportCompact(ledger)).toContain('guardrails: missing 6 fields — avoid_high_impact, avoid_heavy_lower_body, avoid_overhead_pressing, avoid_heavy_spinal_loading, since, revisions (not_recorded)');
        // The group heading keeps the record's source visible (#1260 review).
        expect(renderLedgerExportCompact(ledger)).toContain('### guardrails (athlete)\nguardrails: missing 6 fields');
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
        expect(out).toContain('illness_anomaly: inactive 2026-11-18…2026-11-19');
        expect(out).toContain('recovery_beyond_baseline: unknown (unavailable) 2026-11-19');
        expect(out).toContain('#### illness_risk_symptom (2026-11-20)');
        expect(out).toContain('sessionRef: s-1');
        expect(out).toContain('threshold: any');
        expect(out).toContain('fever: 38 C');
    });

    it('does not imply unevaluated days or span an active day in flag ranges', () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.flags = [
            flag('illness_anomaly', '2026-11-18'), flag('illness_anomaly', '2026-11-20'),
            flag('recovery_beyond_baseline', '2026-11-18'),
            flag('recovery_beyond_baseline', '2026-11-19', { active: true }),
            flag('recovery_beyond_baseline', '2026-11-20'),
        ];
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('illness_anomaly: inactive 2026-11-18\n');
        expect(out).not.toContain('2026-11-18…2026-11-20');
        expect(out).toContain('recovery_beyond_baseline: inactive 2026-11-18\n');
        expect(out).toContain('#### recovery_beyond_baseline (2026-11-19)');
    });

    it("summarises today's flags only under Today and keeps active detail", () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.flags = [flag('illness_anomaly', '2026-11-19'), flag('illness_anomaly', '2026-11-20'),
            flag('recovery_beyond_baseline', '2026-11-20', { active: true, threshold: 't' })];
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('flags: illness_anomaly inactive; recovery_beyond_baseline active');
        expect(out).not.toContain('illness_anomaly: inactive 2026-11-20');
        expect(out).toContain('#### recovery_beyond_baseline (2026-11-20)');
        ledger.flags = [flag('illness_anomaly', '2026-11-20')];
        expect(renderLedgerExportCompact(ledger)).toContain('flags: only 2026-11-20 evaluated (see Today)');
    });

    it("lists every flag evaluated today in Today, inactive ones not repeated in Flags", () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.flags = [flag('illness_anomaly', '2026-11-20'),
            flag('recovery_beyond_baseline', '2026-11-20', { active: true, threshold: 't' }),
            flag('illness_risk_symptom', '2026-11-20', { active: null, state: 'unavailable' })];
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('flags: illness_anomaly inactive; recovery_beyond_baseline active; illness_risk_symptom unknown (unavailable)');
        expect(out).not.toContain('illness_anomaly: inactive');
    });

    it('prints not recorded for a measured but empty yesterday value', () => {
        const ledger = buildLedgerExport(fullInput());
        const fields = ledger.facts.performedTraining.items[0].fields;
        fields.workSets = { value: null, source: 'adaptive', state: 'measured' };
        fields.executedDefinitions = { value: [], source: 'adaptive', state: 'measured' };
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('work sets: not recorded');
        expect(out).toContain('executedDefinition: not recorded');
        expect(out).not.toContain('work sets: measured');
    });

    it('labels totalSteps as D-1', () => {
        const out = renderLedgerExportCompact(buildLedgerExport(fullInput()));
        expect(out).toContain('totalSteps: 0 steps (D-1)');
        expect(out).not.toMatch(/totalSteps: 0 steps$/m);
    });

    it('keeps flag state visible instead of folding it into inactive or measured', () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.flags = [
            flag('illness_anomaly', '2026-11-19', { state: 'stale' }),
            flag('illness_risk_symptom', '2026-11-19', { active: null, state: 'measured' }),
            flag('recovery_beyond_baseline', '2026-11-19', { active: true, state: 'stale' }),
        ];
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('illness_anomaly: inactive (stale) 2026-11-19');
        expect(out).toContain('illness_risk_symptom: unknown (measured) 2026-11-19');
        expect(out).toMatch(/#### recovery_beyond_baseline \(2026-11-19\)\nstate: stale/);
    });

    it('marks a measured-but-null value as null in the missing line', () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.facts.recovery.items[0].fields.weightKg = { value: null, source: 'garmin', state: 'measured' };
        expect(renderLedgerExportCompact(ledger)).toContain('weightKg (measured, null)');
    });

    it('keeps the record date on a collapsed record line', () => {
        const ledger = buildLedgerExport(fullInput());
        const rec = ledger.facts.recovery.items[0];
        for (const value of Object.values(rec.fields)) { value.value = null; value.state = 'missing'; }
        expect(renderLedgerExportCompact(ledger)).toMatch(new RegExp(String.raw`^${rec.id} \(${rec.observedOn}\): missing 11 fields — [\w, ]+ \(missing\)$`, 'm'));
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
        expect(out).toMatch(/placements: \w+, no rows, droppedUndated: 2, placements outside window: 3/);
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

    it('keeps the heading count when every row of a collection was printed above', () => {
        const out = renderLedgerExportCompact(buildLedgerExport(fullInput({ purpose: 'morning' })));
        expect(out).toContain('plannedToPerformed: 1 shown above');
    });
});
