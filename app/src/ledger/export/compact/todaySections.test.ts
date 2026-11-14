import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import type { LedgerExport, LedgerValue } from '../schema.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';
import { renderTodaySections } from './todaySections.ts';

const num = (value: number): LedgerValue<number> => ({ value, source: 'adaptive', state: 'measured' });

function withBaselines(ledger: LedgerExport): LedgerExport {
    const subjective = ledger.derived.find(metric => metric.id === 'subjective_baselines');
    const biometric = ledger.derived.find(metric => metric.id === 'biometric_baselines');
    if (!subjective?.metrics || !biometric?.metrics) throw new Error('fixture lacks baseline metrics');
    subjective.metrics.readiness_longAvg = num(7.2);
    biometric.metrics.sleepScore28dAvg = num(75);
    biometric.metrics.hrv28dAvg = num(64);
    return ledger;
}

const build = (purpose: 'morning' | 'planning' = 'morning') => buildLedgerExport(fullInput({ purpose }));

describe('renderTodaySections', () => {
    it('prints check-in value with 28d baseline and delta', () => {
        const ledger = withBaselines(build());
        ledger.facts.checkins.items.find(row => row.observedOn === '2026-11-20')!.fields.readiness.value = 6;
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('## Today (2026-11-20)');
        expect(lines).toContain('readiness: 6 (28d 7.2, −1.2)');
        expect(lines).toContain('sleepScore: 81 (28d 75, +6)');
        expect(lines).toContain('hrvOvernightAvg: 62 ms (28d 64, −2)');
    });

    it('prints missing baseline state without a delta', () => {
        const { lines } = renderTodaySections(build());
        expect(lines).toContain('readiness: 7 (28d baseline: missing)');
        expect(lines.some(line => line.startsWith('readiness: 7') && line.includes('−'))).toBe(false);
    });

    it('prints a missing value as its state and keeps it in the missing line', () => {
        const { lines } = renderTodaySections(build());
        expect(lines).toContain('soreness: not_recorded');
        expect(lines.some(line => line.startsWith('missing:') && line.includes('soreness (not_recorded)'))).toBe(true);
    });

    it('says explicitly when today has no check-in or recovery record', () => {
        const ledger = build();
        ledger.facts.checkins.items = ledger.facts.checkins.items.filter(row => row.observedOn !== '2026-11-20');
        ledger.facts.recovery.items = [];
        ledger.facts.recovery.state = 'unavailable';
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('check-in: no record for 2026-11-20 (measured)');
        expect(lines).toContain('recovery: no record for 2026-11-20 (unavailable)');
    });

    it("renders yesterday's session line with sRPE from responses", () => {
        const ledger = build();
        const occ = ledger.facts.performedTraining.items[0];
        occ.fields.structuredEntries = { value: { exerciseCount: 5, setCount: 15 }, source: 'adaptive', state: 'measured' };
        occ.fields.executedDefinitions = { value: [{ executionId: 'e1', executedDefinition: 'reduced' }], source: 'adaptive', state: 'measured' };
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('## Yesterday (2026-11-19)');
        expect(lines).toContain('Cycling · 60 min · 5 exercises / 15 sets · sRPE 6 · reduced · planned: Endurance ride');
        expect(lines).toContain('detail: copy the session report from History');
    });

    it('prints absent yesterday parts as not recorded', () => {
        const { lines } = renderTodaySections(build());
        expect(lines).toContain('Cycling · 60 min · structuredEntries: not_yet_supported · sRPE 6 · executedDefinition: unavailable · planned: Endurance ride');
        expect(lines).not.toContain('detail: copy the session report from History');
    });

    it('lists upcoming placements in date order with notes and fallback', () => {
        const ledger = build();
        const placements = ledger.coachingHistory.placements;
        const copy = { ...placements.items.find(row => row.id.endsWith(':s3'))!, id: 'plan-1@2:s5', observedOn: '2026-11-21' };
        copy.fields = { ...copy.fields, title: { value: 'Earlier ride', source: 'x', state: 'measured' } };
        placements.items = [...placements.items, copy].reverse();
        const { lines } = renderTodaySections(ledger);
        const upcoming = lines.slice(lines.indexOf('## Upcoming (2026-11-21…2026-11-27)'));
        expect(upcoming.indexOf('2026-11-21 Earlier ride [key] (planned)')).toBeGreaterThan(0);
        expect(upcoming.indexOf('2026-11-21 Earlier ride [key] (planned)')).toBeLessThan(upcoming.indexOf('2026-11-22 Tempo intervals [key] (planned)'));
        expect(upcoming).toContain('summary: 3x10 min at tempo');
        expect(upcoming).toContain('note: Stay seated');
        expect(upcoming).toContain('note: Cadence 90');
        expect(upcoming).toContain('fallback: Easy 45 min spin');
    });

    it('prints invalid or unavailable placement content as a content state line', () => {
        const ledger = build();
        for (const row of ledger.coachingHistory.placements.items) {
            for (const key of ['title', 'priority', 'summary', 'stepNotes', 'fallback'] as const) {
                row.fields[key] = { value: null, source: 'x', state: 'invalid' };
            }
        }
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('2026-11-22 (planned)');
        expect(lines.filter(line => line === 'content: invalid').length).toBeGreaterThan(0);
    });

    it("shows today's placement under Today only", () => {
        const out = renderLedgerExportCompact(build());
        const todayBlock = out.slice(out.indexOf('## Today'), out.indexOf('## Yesterday'));
        expect(todayBlock).toContain('2026-11-20 Openers [support] (planned)');
        expect(out.split('Openers').length - 1).toBe(1);
    });

    it('records consumed ids so later sections do not repeat them', () => {
        const ledger = build();
        const { consumedIds } = renderTodaySections(ledger);
        expect([...consumedIds]).toEqual(expect.arrayContaining([
            'checkin-2026-11-20', 'recovery-2026-11-20', 'plan-1@2:s3', 'plan-1@2:s4', 'plan-1@2:s1:occ-1',
        ]));
        const out = renderLedgerExportCompact(ledger);
        expect(out).not.toContain('#### checkin-2026-11-20');
        expect(out).not.toContain('#### plan-1@2:s3');
        expect(out).toContain('#### checkin-2026-11-19');
        expect(out).toContain('#### plan-1@2:s1 (2026-11-19)');
    });

    it('prints the outside-window count once, in Facts, even when every placement is consumed', () => {
        const ledger = build();
        ledger.coachingHistory.placements.items = ledger.coachingHistory.placements.items.filter(row => row.observedOn! >= '2026-11-20');
        ledger.coachingHistory.placements.droppedOutOfWindow = 4;
        const out = renderLedgerExportCompact(ledger);
        expect(out.match(/outside window: 4/g)).toHaveLength(1);
        expect(out.indexOf('outside window: 4')).toBeGreaterThan(out.indexOf('## Coaching history'));
        expect(renderTodaySections(ledger).lines.join(' ')).not.toContain('outside window');
    });

    it('keeps statusHistory for consumed placements, measured or missing, on both paths', () => {
        const ledger = build();
        const [today, upcoming] = ['s4', 's3'].map(id => ledger.coachingHistory.placements.items.find(row => row.id.endsWith(`:${id}`))!);
        today.fields.statusHistory = { value: [{ changedOn: '2026-11-18' }, { changedOn: '2026-11-19' }], source: 'x', state: 'measured' };
        for (const key of ['title', 'priority', 'summary', 'stepNotes', 'fallback'] as const) {
            upcoming.fields[key] = { value: null, source: 'x', state: 'unavailable' };
        }
        const lines = renderTodaySections(ledger).lines;
        expect(lines).toContain('history: 2 recorded changes, latest 2026-11-19');
        const afterContent = lines.slice(lines.indexOf('content: unavailable'));
        expect(afterContent[1]).toBe('missing: statusHistory (not_yet_supported)');
    });

    it('prints the real state for absent yesterday parts', () => {
        const { lines } = renderTodaySections(build());
        expect(lines.some(line => line.includes('structuredEntries: not_yet_supported') && line.includes('executedDefinition: unavailable'))).toBe(true);
    });

    it('is pure and does not mutate the ledger', () => {
        const ledger = build();
        const before = JSON.stringify(ledger);
        expect(renderTodaySections(ledger)).toEqual(renderTodaySections(ledger));
        expect(JSON.stringify(ledger)).toBe(before);
    });
});
