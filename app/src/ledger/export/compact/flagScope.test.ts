import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import type { LedgerFlag } from '../schema.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';

function flag(id: LedgerFlag['id'], observedOn: string, over: Partial<LedgerFlag> = {}): LedgerFlag {
    return { id, observedOn, evaluatedAt: null, definitionVersion: null, active: false, state: 'measured',
        inputs: [], threshold: null, ...over };
}

function render(flags: LedgerFlag[]): string {
    const ledger = buildLedgerExport(fullInput());
    ledger.flags = flags;
    return renderLedgerExportCompact(ledger);
}

describe('compact flag ranges respect scope and version (spec 2a)', () => {
    it('collapses contiguous dates with the same state, version and session scope', () => {
        const out = render([flag('illness_anomaly', '2026-11-17', { definitionVersion: 'v2' }),
            flag('illness_anomaly', '2026-11-18', { definitionVersion: 'v2' })]);
        expect(out).toContain('illness_anomaly: inactive 2026-11-17…2026-11-18 (definition v2)');
    });

    it('breaks a range on a definitionVersion change', () => {
        const out = render([flag('illness_anomaly', '2026-11-17', { definitionVersion: 'v1' }),
            flag('illness_anomaly', '2026-11-18', { definitionVersion: 'v2' })]);
        expect(out).toContain('illness_anomaly: inactive 2026-11-17 (definition v1)');
        expect(out).toContain('illness_anomaly: inactive 2026-11-18 (definition v2)');
        expect(out).not.toContain('2026-11-17…2026-11-18');
    });

    it('breaks a range on a sessionRef change', () => {
        const out = render([flag('injury_constraint_touches_session', '2026-11-17', { sessionRef: 's-1' }),
            flag('injury_constraint_touches_session', '2026-11-18', { sessionRef: 's-2' })]);
        expect(out).toContain('injury_constraint_touches_session: inactive 2026-11-17 (session s-1)');
        expect(out).toContain('injury_constraint_touches_session: inactive 2026-11-18 (session s-2)');
        expect(out).not.toContain('2026-11-17…2026-11-18');
    });

    it('shows both same-day evaluations with different states', () => {
        const out = render([
            flag('illness_anomaly', '2026-11-18', { evaluatedAt: '2026-11-18T06:00:00Z' }),
            flag('illness_anomaly', '2026-11-18', { evaluatedAt: '2026-11-18T18:00:00Z', active: null, state: 'unavailable' }),
        ]);
        expect(out).toContain('illness_anomaly: inactive 2026-11-18 (evaluated 06:00:00Z)');
        expect(out).toContain('illness_anomaly: unknown (unavailable) 2026-11-18 (evaluated 18:00:00Z)');
    });

    it('keeps two same-day evaluations with the same state apart, distinguished by evaluatedAt', () => {
        const out = render([
            flag('illness_anomaly', '2026-11-18', { evaluatedAt: '2026-11-18T06:00:00.000Z' }),
            flag('illness_anomaly', '2026-11-18', { evaluatedAt: '2026-11-18T18:00:00Z' }),
        ]);
        expect(out.match(/illness_anomaly: inactive 2026-11-18/g)).toHaveLength(2);
        expect(out).toContain('(evaluated 06:00:00Z)');
        expect(out).toContain('(evaluated 18:00:00Z)');

        // Sub-second repeats stay distinct and keep fractional seconds.
        const subSecond = render([
            flag('illness_anomaly', '2026-11-18', { evaluatedAt: '2026-11-18T06:00:00.100Z' }),
            flag('illness_anomaly', '2026-11-18', { evaluatedAt: '2026-11-18T06:00:00.900Z' }),
            flag('illness_risk_symptom', '2026-11-18', { evaluatedAt: '2026-11-18T06:00:00.500Z' }),
            flag('illness_risk_symptom', '2026-11-18', { evaluatedAt: '2026-11-18T06:00:00.900Z' }),
        ]);
        expect(subSecond).toContain('illness_anomaly: inactive 2026-11-18 (evaluated 06:00:00.100Z)');
        expect(subSecond).toContain('illness_risk_symptom: inactive 2026-11-18 (evaluated 06:00:00.500Z)');
        expect(subSecond).toContain('illness_anomaly, illness_risk_symptom: inactive 2026-11-18 (evaluated 06:00:00.900Z)');
    });

    it('never merges unavailable dates into inactive', () => {
        const out = render([flag('illness_anomaly', '2026-11-17'),
            flag('illness_anomaly', '2026-11-18', { active: null, state: 'unavailable' }),
            flag('illness_anomaly', '2026-11-19')]);
        expect(out).toContain('illness_anomaly: inactive 2026-11-17\n');
        expect(out).toContain('illness_anomaly: unknown (unavailable) 2026-11-18\n');
        expect(out).toContain('illness_anomaly: inactive 2026-11-19\n');
    });

    it('prints version and shortened same-day evaluation time on an active flag, while keeping cross-day evaluatedAt in full', () => {
        const sameDay = render([flag('recovery_beyond_baseline', '2026-11-19', {
            active: true, threshold: 't', definitionVersion: 'v3', evaluatedAt: '2026-11-19T06:03:08.555Z' })]);
        expect(sameDay).toContain('definition: v3');
        expect(sameDay).toContain('evaluatedAt: 06:03:08Z');

        const crossDay = render([flag('recovery_beyond_baseline', '2026-11-19', {
            active: true, threshold: 't', definitionVersion: 'v3', evaluatedAt: '2026-11-20T06:03:08.555Z' })]);
        expect(crossDay).toContain('evaluatedAt: 2026-11-20T06:03:08.555Z');
    });
});
