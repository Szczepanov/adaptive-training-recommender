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
    subjective.metrics.readiness_delta28d = num(-1.2);
    biometric.metrics.sleepScore28dAvg = num(75);
    biometric.metrics.sleepScore_delta28d = num(6);
    biometric.metrics.hrv28dAvg = num(64);
    biometric.metrics.hrvOvernightAvg_delta28d = num(-2);
    return ledger;
}

const build = (purpose: 'morning' | 'planning' = 'morning') => buildLedgerExport(fullInput({ purpose }));

describe('renderTodaySections', () => {
    it('prints check-in value with 28d baseline and delta', () => {
        const ledger = withBaselines(build());
        ledger.facts.checkins.items.find(row => row.observedOn === '2026-11-20')!.fields.readiness.value = 6;
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('## Today (2026-11-20)');
        expect(lines).toContain('readiness: 6 score_1_10 (28d 7.2, −1.2)');
        expect(lines).toContain('sleepScore: 81 (28d 75, +6)');
        expect(lines).toContain('hrvOvernightAvg: 62 ms (28d 64, −2)');
    });

    it('keeps the check-in scale unit', () => {
        const { lines } = renderTodaySections(withBaselines(build()));
        expect(lines.some(line => /^readiness: \d+ score_1_10 \(28d/.test(line))).toBe(true);
    });

    it('labels a non-measured baseline with its state and prints the delta leaf state', () => {
        const ledger = withBaselines(build());
        const metrics = ledger.derived.find(metric => metric.id === 'subjective_baselines')!.metrics!;
        metrics.readiness_longAvg = { value: 7.2, source: 'adaptive', state: 'stale' };
        metrics.readiness_delta28d = { value: null, source: 'adaptive', state: 'stale' };
        ledger.facts.checkins.items.find(row => row.observedOn === '2026-11-20')!.fields.readiness.value = 6;
        expect(renderTodaySections(ledger).lines).toContain('readiness: 6 score_1_10 (28d 7.2 (stale), delta: stale)');
    });

    it('reads the delta from the JSON leaf instead of computing it', () => {
        const ledger = withBaselines(build());
        const metrics = ledger.derived.find(metric => metric.id === 'biometric_baselines')!.metrics!;
        metrics.sleepScore_delta28d = num(4.25);
        delete metrics.hrvOvernightAvg_delta28d;
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('sleepScore: 81 (28d 75, +4.3)');
        expect(lines).toContain('hrvOvernightAvg: 62 ms (28d 64, delta: unavailable)');
    });

    it('prints missing baseline state without a delta', () => {
        const { lines } = renderTodaySections(build());
        expect(lines).toContain('readiness: 7 score_1_10 (28d baseline: missing)');
        expect(lines.some(line => line.startsWith('readiness: 7 ') && line.includes('−'))).toBe(false);
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

    it("renders yesterday's session line with validated set counts and the linked sRPE", () => {
        const ledger = build();
        const occ = ledger.facts.performedTraining.items[0];
        occ.fields.executedDefinitions = { value: [{ executionId: 'e1', executedDefinition: 'reduced' }], source: 'adaptive', state: 'measured' };
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('## Yesterday (2026-11-19)');
        expect(lines).toContain('Cycling · 60 min · 4/5 work sets (+1 warm-up) · sRPE 6 (source athlete) · reduced · planned: Endurance ride (plan-1@2:s1 → occ-1)');
        expect(lines).toContain('detail: copy the session report from History');
    });

    it('keeps a missing denominator and missing warm-ups explicit', () => {
        const ledger = build();
        const fields = ledger.facts.performedTraining.items[0].fields;
        fields.plannedSets = { value: null, source: 'adaptive', state: 'unavailable' };
        fields.warmupSets = { value: null, source: 'adaptive', state: 'invalid' };
        const line = renderTodaySections(ledger).lines.find(row => row.startsWith('Cycling'))!;
        expect(line).toContain('4 work sets (planned: unavailable; warm-up: invalid)');
        fields.workSets = { value: null, source: 'adaptive', state: 'unavailable' };
        const noWork = renderTodaySections(ledger).lines;
        expect(noWork.find(row => row.startsWith('Cycling'))).toContain('work sets: unavailable');
        expect(noWork).not.toContain('detail: copy the session report from History');
    });

    it('prints no ratio when the planned denominator is unavailable', () => {
        const ledger = build();
        ledger.facts.performedTraining.items[0].fields.plannedSets = { value: null, source: 'adaptive', state: 'unavailable' };
        const line = renderTodaySections(ledger).lines.find(row => row.startsWith('Cycling'))!;
        expect(line).toContain('· 4 work sets (+1 warm-up) (planned: unavailable) ·');
        expect(line).not.toMatch(/\d+\/\d+ work sets/);
    });

    it('takes sRPE only from a response linked through the structured source ref', () => {
        const ledger = build();
        const fields = ledger.facts.performedTraining.items[0].fields;
        fields.linkedResponseIds = { value: [], source: 'adaptive', state: 'measured' };
        // resp-1 still names occ-1 as its planning occurrenceId; that is not a link.
        expect(renderTodaySections(ledger).lines.find(row => row.startsWith('Cycling'))).toContain('sRPE: not recorded');
        fields.linkedResponseIds = { value: null, source: 'adaptive', state: 'unavailable' };
        expect(renderTodaySections(ledger).lines.find(row => row.startsWith('Cycling'))).toContain('sRPE: unavailable');
    });

    it('prints absent yesterday parts with their states', () => {
        const ledger = build();
        for (const key of ['plannedSets', 'workSets', 'warmupSets'] as const) {
            ledger.facts.performedTraining.items[0].fields[key] = { value: null, source: 'adaptive', state: 'not_applicable' };
        }
        const { lines } = renderTodaySections(ledger);
        expect(lines).toContain('Cycling · 60 min · work sets: not_applicable · sRPE 6 (source athlete) · executedDefinition: unavailable · planned: Endurance ride (plan-1@2:s1 → occ-1)');
        expect(lines).not.toContain('detail: copy the session report from History');
    });

    it('lists upcoming placements in date order with notes and fallback', () => {
        const ledger = build();
        const placements = ledger.coachingHistory.placements;
        const copy = { ...placements.items.find(row => row.id.endsWith(':s3'))!, id: 'plan-1@2:s5', observedOn: '2026-11-21' };
        copy.fields = { ...copy.fields, title: { value: 'Earlier ride', source: 'adaptive', state: 'measured' } };
        placements.items = [...placements.items, copy].reverse();
        const { lines } = renderTodaySections(ledger);
        const upcoming = lines.slice(lines.indexOf('## Upcoming (2026-11-21…2026-11-27)'));
        expect(upcoming.indexOf('2026-11-21 Earlier ride [key] (planned) plan-1@2:s5')).toBeGreaterThan(0);
        expect(upcoming.indexOf('2026-11-21 Earlier ride [key] (planned) plan-1@2:s5')).toBeLessThan(upcoming.indexOf('2026-11-22 Tempo intervals [key] (planned) plan-1@2:s3'));
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
        expect(lines).toContain('2026-11-22 (planned) plan-1@2:s3');
        expect(lines.filter(line => line === 'content: invalid').length).toBeGreaterThan(0);
    });

    it("shows today's placement under Today only", () => {
        const out = renderLedgerExportCompact(build());
        const todayBlock = out.slice(out.indexOf('## Today'), out.indexOf('## Yesterday'));
        expect(todayBlock).toContain('2026-11-20 Openers [support] (planned) plan-1@2:s4');
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
        expect(lines.some(line => line.includes('4/5 work sets') && line.includes('executedDefinition: unavailable'))).toBe(true);
    });

    it('is pure and does not mutate the ledger', () => {
        const ledger = build();
        const before = JSON.stringify(ledger);
        expect(renderTodaySections(ledger)).toEqual(renderTodaySections(ledger));
        expect(JSON.stringify(ledger)).toBe(before);
    });
});
