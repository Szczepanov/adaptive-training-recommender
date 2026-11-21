import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import type { ActivityCollection, LedgerRecord, LedgerState } from '../schema.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';

const morning = () => buildLedgerExport(fullInput({ purpose: 'morning' }));

describe('compact provenance (spec 2a)', () => {
    it('declares the measured default and per-group source in the header', () => {
        const out = renderLedgerExportCompact(morning());
        expect(out.split('\n').slice(0, 5)).toContain('states: measured unless noted; source shown per group');
    });

    it('prints the source once on each record group line', () => {
        const out = renderLedgerExportCompact(morning());
        expect(out).toContain('### recovery (daily_recovery_snapshots; garmin)');
        expect(out).toContain('### checkins (daily_subjective_checkins; athlete)');
        expect(out).toContain('recovery (daily_recovery_snapshots; garmin):');
        expect(out).toContain('### equipment (athlete)');
        expect(out).toContain('### placements (external_plan_placements; adaptive)');
    });

    it('does not repeat the group source on every field', () => {
        const out = renderLedgerExportCompact(morning());
        expect(out).not.toMatch(/^(?:sleepScore|2026-11-19): [^\n]*garmin/m);
        expect(out).toContain('2026-11-19: sleep 81 (7.5h), rhr 48 bpm, hrv 62 ms (BALANCED), resp 14, bb 70, steps 0 (D-1), stress 25\n');
        expect(out).toContain('readiness: 7 score_1_10\n');
    });

    it('adds a field-level source only when it differs from the group', () => {
        const ledger = morning();
        const row = ledger.facts.recovery.items.find(item => item.observedOn === '2026-11-19')!;
        row.fields.stressAvg = { ...row.fields.stressAvg, source: 'manual_entry' };
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('stressAvg: 25 score (source manual_entry)');
        expect(out).toContain('sleepScore: 81 score\n');
    });

    it('keeps state, source exception and stale observation date together', () => {
        const ledger = morning();
        const row = ledger.facts.recovery.items.find(item => item.observedOn === '2026-11-19')!;
        row.fields.stressAvg = { value: 25, unit: 'score', source: 'manual_entry', state: 'stale', observedOn: '2026-11-17' };
        row.fields.restingHr = { ...row.fields.restingHr, state: 'stale', observedOn: '2026-11-18' };
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('stressAvg: 25 score (manual_entry, stale, 2026-11-17)');
        expect(out).toContain('restingHr: 48 bpm (stale, 2026-11-18)');
    });

    it('prints a non-measured collection state in its group line', () => {
        const ledger = morning();
        ledger.facts.nutrition.state = 'stale';
        expect(renderLedgerExportCompact(ledger)).toMatch(/### nutrition \(nutrition_days; garmin\)\nstate: stale\n/);
    });

    it('names the collection of an unreadable one-line collection', () => {
        const ledger = buildLedgerExport(fullInput({ purpose: 'morning', records: {} }));
        ledger.facts.recovery.state = 'unavailable';
        expect(renderLedgerExportCompact(ledger)).toContain('recovery: unavailable, no rows (daily_recovery_snapshots)');
    });
});

describe('compact Sources section and omissions (spec 2a)', () => {
    it('abbreviates successful sources but keeps every failed or partial one with its reason', () => {
        const ledger = morning();
        const partial: LedgerState = 'stale';
        ledger.sources = ledger.sources.map((source, index) => (index === 0
            ? { ...source, state: partial, reason: 'read cut off', newestObservedOn: '2026-11-18' }
            : source));
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain(`${ledger.sources[0].source}: stale; newestObservedOn 2026-11-18; reason read cut off`);
        expect(out).toContain('flag_evaluations: unavailable');
        expect(out).not.toContain('session_responses: measured');
    });

    it('shows activities truncation with the exported count', () => {
        const ledger = morning();
        const activities = ledger.facts.activities as ActivityCollection<LedgerRecord>;
        activities.truncated = true;
        activities.totalInWindow = 90;
        expect(renderLedgerExportCompact(ledger)).toContain('truncated: true; totalInWindow: 90; exported: 1');
    });

    it('shows truncation even when the truncated collection has no rows', () => {
        const ledger = morning();
        const activities = ledger.facts.activities as ActivityCollection<LedgerRecord>;
        activities.items = [];
        activities.truncated = true;
        activities.totalInWindow = 12;
        expect(renderLedgerExportCompact(ledger)).toMatch(/activities: [^\n]*truncated: true; totalInWindow: 12; exported: 0/);
    });

    it('keeps omission counts even when all rows of the collection are shown above', () => {
        const ledger = morning();
        ledger.coachingHistory.plannedToPerformed.droppedUndated = 2;
        expect(renderLedgerExportCompact(ledger)).toContain('plannedToPerformed: 1 shown above; droppedUndated: 2');
    });
});
