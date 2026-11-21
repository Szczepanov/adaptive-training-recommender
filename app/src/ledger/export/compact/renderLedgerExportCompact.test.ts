import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import type { LedgerFlag } from '../schema.ts';
import { mergeCheckpoint, userContextCheckpoint } from './previousContext.ts';
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
        expect(out).toContain('illness_anomaly, recovery_beyond_baseline: inactive 2026-11-18\n');
        expect(out).not.toContain('2026-11-18…2026-11-20');
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

describe('morning export deduplication and shortening', () => {
    const num = (value: number, unit: string, source: string, state: 'measured' | 'stale' = 'measured') => ({
        value, unit, source, state, observedOn: '2026-11-20',
    });
    const miss = (source: string, state: 'missing' | 'not_recorded' = 'missing') => ({
        value: null, source, state, observedOn: '2026-11-20',
    });

    it('compacts Derived baselines, shortens floats, preserves missing/state, and deduplicates 28d deltas only when Today rendered them', () => {
        const ledger = buildLedgerExport(fullInput({ purpose: 'morning' }));
        const bio = ledger.derived.find(m => m.id === 'biometric_baselines')!;
        bio.metrics = {
            sleepScore7dAvg: num(86.94, 'score', 'daily_recovery_snapshots'),
            sleepScore28dAvg: miss('daily_recovery_snapshots'),
            sleepScore28dStdev: num(8.51, 'score', 'daily_recovery_snapshots'),
            restingHr7dAvg: num(43.4, 'bpm', 'daily_recovery_snapshots'),
            restingHr28dAvg: num(42.6, 'bpm', 'daily_recovery_snapshots', 'stale'),
            restingHr28dStdev: num(1.2, 'bpm', 'daily_recovery_snapshots'),
            hrv7dAvg: num(63, 'ms', 'daily_recovery_snapshots'),
            hrv28dAvg: num(65.4, 'ms', 'daily_recovery_snapshots'),
            hrv28dStdev: num(4.8, 'ms', 'daily_recovery_snapshots'),
            respiration7dAvg: num(12.1, 'breaths/min', 'daily_recovery_snapshots'),
            respiration28dAvg: num(12, 'breaths/min', 'daily_recovery_snapshots'),
            respiration28dMad: num(0.3, 'breaths/min', 'daily_recovery_snapshots'),
            sleepScore_delta28d: num(-12.7, 'score', 'daily_recovery_snapshots'),
            restingHr_delta28d: num(1.4, 'bpm', 'daily_recovery_snapshots'),
        };
        const subj = ledger.derived.find(m => m.id === 'subjective_baselines')!;
        subj.metrics = {
            readiness_recentAvg: num(7.333333333333333, '1-10', 'daily_subjective_checkins'),
            readiness_longAvg: num(7.518518518518518, '1-10', 'daily_subjective_checkins'),
            readiness_variability: num(1.007516333980403, '1-10', 'daily_subjective_checkins'),
            recentRecordedDays: num(6, 'days', 'daily_subjective_checkins'),
            longRecordedDays: num(27, 'days', 'daily_subjective_checkins'),
            readiness_delta28d: num(-1.519, 'score_1_10', 'daily_subjective_checkins'),
        };

        const withToday = renderLedgerExportCompact(ledger);
        expect(withToday).toContain('readiness: 7 score_1_10 (7d 7.3 · 28d 7.5 ±1, −1.5)');
        expect(withToday).toContain('sleepScore: 81 (7d 86.9 ±8.5, 28d baseline: missing)');
        expect(withToday).toContain('restingHr: 48 bpm (7d 43.4 · 28d 42.6 (stale) ±1.2, +1.4)');
        expect(withToday).toContain('hrvOvernightAvg: 62 ms (7d 63 · 28d 65.4 ±4.8, delta: unavailable)');
        expect(withToday).toContain('respirationAvg: 14 breaths/min (7d 12.1 · 28d 12 ±0.3, delta: unavailable)');
        expect(withToday).toContain('biometric_baselines: shown in Today above; missing: sleepScore28dAvg (missing)');
        expect(withToday).toContain('subjective_baselines: shown in Today above (recordedDays: 7d 6, 28d 27)');
        expect(withToday).toContain('not_yet_supported: d_minus_1_step_normalization, rolling_performed_training_load');
        expect(withToday).not.toContain('sleepScore_delta28d');
        expect(withToday).not.toContain('readiness_delta28d');
        expect(withToday).not.toContain('value (not_applicable)');

        // Removing Today's recovery and check-in rows keeps full Derived triplets and *_delta28d, and value (unavailable) stays visible.
        ledger.facts.recovery.items = ledger.facts.recovery.items.filter(r => r.observedOn !== ledger.asOfDate);
        ledger.facts.checkins.items = ledger.facts.checkins.items.filter(c => c.observedOn !== ledger.asOfDate);
        bio.value = { value: null, source: 'daily_recovery_snapshots', state: 'unavailable' };
        const withoutToday = renderLedgerExportCompact(ledger);
        expect(withoutToday).toContain('sleepScore: 7d 86.9 (sd 8.5) score');
        expect(withoutToday).toContain('restingHr: 7d 43.4 · 28d 42.6 (stale, 2026-11-20) (sd 1.2) bpm');
        expect(withoutToday).toContain('hrv: 7d 63 · 28d 65.4 (sd 4.8) ms');
        expect(withoutToday).toContain('respiration: 7d 12.1 · 28d 12 (mad 0.3) breaths/min');
        expect(withoutToday).toContain('readiness: 7d 7.3 · 28d 7.5 (var 1) 1-10');
        expect(withoutToday).toContain('recordedDays: 7d 6, 28d 27');
        expect(withoutToday).toContain('sleepScore_delta28d: -12.7 score');
        expect(withoutToday).toContain('readiness_delta28d: -1.5 score_1_10');
        expect(withoutToday).toContain('missing: value (unavailable); sleepScore28dAvg (missing)');
    });

    it('groups standard schedule_window availability by date while keeping non-standard windows in full', () => {
        const ledger = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: {
                ...fullInput().records,
                scheduleWindows: [
                    { id: 'w-pm', date: '2026-11-23', startLocal: '11:30', endLocal: '15:00' },
                    { id: 'w-am', date: '2026-11-23', startLocal: '06:00', endLocal: '08:30' },
                    { id: 'w-next', date: '2026-11-24', startLocal: '06:00', endLocal: '08:30' },
                    { id: 'w-env', date: '2026-11-25', startLocal: '07:00', endLocal: '08:00', environment: 'indoor' },
                ],
            },
        }));
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('2026-11-23: 06:00–08:30, 11:30–15:00\n2026-11-24: 06:00–08:30\nschedule_window missing:');
        expect(out).toContain('#### window-w-env (2026-11-25)');
        expect(out).toContain('environment: indoor');
        expect(out).not.toContain('#### window-w-pm');

        // Differing missingness across compact windows keeps date-qualified missing lines.
        ledger.userContext.availability.items.find(row => row.id === 'window-w-next')!.fields.title.state = 'not_applicable';
        const diffMissingOut = renderLedgerExportCompact(ledger);
        expect(diffMissingOut).toContain('schedule_window missing (2026-11-23):');
        expect(diffMissingOut).toContain('schedule_window missing (2026-11-24):');
    });

    it('deduplicates goal-* events against rendered goals and keeps them when goals were abbreviated as unchanged', () => {
        const ledger = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: {
                ...fullInput().records,
                intentBlocks: [],
                goals: [
                    ...fullInput().records.goals!,
                    { id: 'goal-2', title: 'Autumn TT', domain: 'endurance', status: 'active', priority: 2, targetDate: '2027-09-12', eventCategory: 'race' },
                ],
            },
        }));
        const fullOut = renderLedgerExportCompact(ledger);
        expect(fullOut).toContain('events: 2 shown in goals above');
        expect(fullOut).not.toContain('#### goal-goal-1');

        // Also check mixed intentBlocks + goals renders the remaining block and the count note.
        const mixedLedger = buildLedgerExport(fullInput({ purpose: 'morning' }));
        const mixedOut = renderLedgerExportCompact(mixedLedger);
        expect(mixedOut).toContain('### events (goals+intent_blocks; athlete)\n1 goal event shown in goals above\n#### block-ib-1');
        expect(mixedOut).not.toContain('#### goal-goal-1');

        // When one goal is rendered and the other event was unchanged in previousContext, both skip counts stay distinct.
        const mixedSkipPrior = { ...userContextCheckpoint(ledger), exportedOn: '2026-11-19' };
        mixedSkipPrior.itemHashes = {
            ...mixedSkipPrior.itemHashes,
            'goals/goal-1': 'deadbeef',
            'events/goal-goal-1': 'deadbeef',
        };
        const mixedSkipOut = renderLedgerExportCompact(ledger, { previousContext: mixedSkipPrior });
        expect(mixedSkipOut).toContain('events: 1 unchanged (listed above); 1 shown in goals above');

        // If goals are unchanged in previousContext but events are not, events must print in full.
        const prior = { ...userContextCheckpoint(ledger), exportedOn: '2026-11-19' };
        prior.itemHashes = { ...prior.itemHashes, 'events/goal-goal-1': 'deadbeef' };
        const partialOut = renderLedgerExportCompact(ledger, { previousContext: prior });
        expect(partialOut).toContain('#### goal-goal-1 (2027-04-18)');
        expect(partialOut).toMatch(/unchanged since.*events\/goal-goal-2/);
        expect(partialOut).not.toContain('#### goal-goal-2');
    });

    it('lifts default since/revisions once under User context while keeping exceptions', () => {
        const out = renderLedgerExportCompact(buildLedgerExport(fullInput({ purpose: 'morning' })));
        const uc = out.slice(out.indexOf('## User context'), out.indexOf('## Coaching history'));
        expect(uc).toContain('note: since, revisions are not_yet_supported (ledger) unless noted');
        expect(uc).toContain('since: 2026-11-25');
        expect(uc).toContain('missing: restrictedModalities, since (not_recorded); resolvedAt (not_applicable)');
        expect(uc).not.toContain('not_yet_supported, ledger');
    });

    it('collapses older unreferenced planRevisions on morning while keeping referenced, latest, and planning full', () => {
        const ledger = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: {
                ...fullInput().records,
                planRevisions: [
                    {
                        planId: 'old-a', revision: 1,
                        contentHash: '6a02cf2a0cebfc803a53e9429ffa85008fa23ff4dc251c6fcaac6ccf7f16a1b9',
                        importedAt: '2026-08-26T10:14:38.448Z',
                        schema: 'adaptive-training-recommender/external-plan@2',
                        notes: 'Old block.',
                    },
                    {
                        planId: 'old-b', revision: 1,
                        contentHash: 'e235ab42f356154031c5d5a09678d2e013669856d1e70155c62ef7005e9178e3',
                        importedAt: '2026-09-14T10:46:52.075Z',
                        schema: 'adaptive-training-recommender/external-plan@3',
                        notes: 'Bridge block.',
                    },
                    {
                        planId: 'plan-1', revision: 2,
                        contentHash: '24e6ff568f32feb5ff665541b0d53ca4960a18c6680fd295c66559761483a8ae',
                        importedAt: '2026-11-10T08:00:00Z',
                        schema: 'adaptive-training-recommender/external-plan@6',
                        notes: 'Build aerobic base first.',
                        sessions: fullInput().records.planRevisions![1].sessions,
                    },
                    {
                        planId: 'newest-unref', revision: 1,
                        contentHash: '063b5d22f356154031c5d5a09678d2e013669856d1e70155c62ef7005e9178e3',
                        importedAt: '2026-11-19T08:00:00Z',
                        schema: 'adaptive-training-recommender/external-plan@6',
                        notes: 'Newest imported block.',
                    },
                ],
            },
        }));

        const morningOut = renderLedgerExportCompact(ledger);
        const morningRevisions = morningOut.slice(morningOut.indexOf('### planRevisions'), morningOut.indexOf('### placements'));
        expect(morningRevisions).toContain('#### plan-1@2 (2026-11-10)');
        expect(morningRevisions).toContain('contentHash: 24e6ff568f32…');
        expect(morningRevisions).not.toContain('planId:');
        expect(morningRevisions).not.toContain('revision:');
        expect(morningRevisions).toContain('#### newest-unref@1 (2026-11-19)');
        expect(morningRevisions).toContain('older revisions (2): old-a@1 (2026-08-26), old-b@1 (2026-09-14)');
        expect(morningRevisions).not.toContain('Old block.');

        const planningLedger = buildLedgerExport({ ...fullInput({ purpose: 'planning' }), records: {
            ...fullInput().records,
            planRevisions: [
                {
                    planId: 'old-a', revision: 1,
                    contentHash: '6a02cf2a0cebfc803a53e9429ffa85008fa23ff4dc251c6fcaac6ccf7f16a1b9',
                    importedAt: '2026-08-26T10:14:38.448Z',
                    schema: 'adaptive-training-recommender/external-plan@2',
                    notes: 'Old block.',
                },
                ...fullInput().records.planRevisions!,
            ],
        } });
        const planningOut = renderLedgerExportCompact(planningLedger);
        expect(planningOut).toContain('#### old-a@1 (2026-08-26)');
        expect(planningOut).toContain('Old block.');
        expect(planningOut).not.toContain('older revisions');
    });

    it('keeps the previousContext checkpoint test helper clean', () => {
        const ledger = buildLedgerExport(fullInput({ purpose: 'morning' }));
        const prev = mergeCheckpoint(undefined, userContextCheckpoint(ledger), '2026-11-19');
        expect(renderLedgerExportCompact(ledger, { previousContext: prev })).not.toContain('note: since, revisions');
    });

    it('keeps a baseline triplet in Derived when that specific Today field is missing/not_recorded', () => {
        const ledger = buildLedgerExport(fullInput({ purpose: 'morning' }));
        // Fixture Today check-in has soreness = null (not_recorded); ensure non-missing soreness baseline still renders in Derived.
        const subj = ledger.derived.find(m => m.id === 'subjective_baselines')!;
        subj.metrics = {
            ...subj.metrics!,
            soreness_recentAvg: num(3, '1-10', 'daily_subjective_checkins'),
            soreness_longAvg: num(2.44, '1-10', 'daily_subjective_checkins'),
            soreness_variability: num(1, '1-10', 'daily_subjective_checkins'),
        };
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('### subjective_baselines (daily_subjective_checkins)');
        expect(out).toContain('soreness: 7d 3 · 28d 2.4 (var 1) 1-10');
        expect(out).not.toContain('subjective_baselines: shown in Today above');
    });

    it('compacts recovery_beyond_baseline triggers and groups identical inactive flags', () => {
        const ledger = buildLedgerExport(fullInput({ purpose: 'morning' }));
        ledger.flags = [
            flag('illness_anomaly', '2026-11-19', { active: null, state: 'not_recorded', definitionVersion: 'illness_anomaly-v1' }),
            flag('illness_risk_symptom', '2026-11-19', { active: null, state: 'not_recorded', definitionVersion: 'illness_risk_symptom-v1' }),
            flag('recovery_beyond_baseline', '2026-11-20', {
                active: true,
                definitionVersion: 'recovery_beyond_baseline-v1',
                threshold: 'band check',
                inputs: [
                    { name: 'hrv', value: { value: 55, unit: 'ms', source: 'daily_recovery_snapshot', state: 'measured' } },
                    { name: 'rhr', value: { value: 44, unit: 'bpm', source: 'daily_recovery_snapshot', state: 'measured' } },
                    { name: 'sleep', value: { value: 74, unit: 'pts', source: 'daily_recovery_snapshot', state: 'measured' } },
                    { name: 'hrv_delta7d', value: { value: -8, unit: 'ms', source: 'daily_recovery_snapshots', state: 'measured' } },
                    { name: 'hrv_band', value: { value: 4.8, unit: 'ms', source: 'daily_recovery_snapshots', state: 'measured' } },
                    { name: 'rhr_delta7d', value: { value: 0.6, unit: 'bpm', source: 'daily_recovery_snapshots', state: 'measured' } },
                    { name: 'rhr_band', value: { value: 1.5, unit: 'bpm', source: 'daily_recovery_snapshots', state: 'measured' } },
                    { name: 'sleep_delta7d', value: { value: -12.9, unit: 'pts', source: 'daily_recovery_snapshots', state: 'measured' } },
                    { name: 'sleep_band', value: { value: 8.5, unit: 'pts', source: 'daily_recovery_snapshots', state: 'measured' } },
                    { name: 'source_revision', value: { value: 'dde8183ef145aff4eb9299c4febf6df5e73985b9597308902fd11168e9e40a61', source: 'flag_capture', state: 'measured' } },
                ],
            }),
        ];
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('illness_anomaly, illness_risk_symptom: unknown (not_recorded) 2026-11-19 (definition v1)');
        expect(out).toContain('triggers: hrv 55 ms (7d −8 vs band 4.8) · rhr 44 bpm (7d +0.6 vs band 1.5) · sleep 74 pts (7d −12.9 vs band 8.5)');
        expect(out).toContain('source_revision: dde8183ef145… (source flag_capture)');
    });

    it('groups empty measured collections per section while keeping non-measured ones separate', () => {
        const ledger = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: {
                ...fullInput().records,
                performedOccurrences: [],
                sessionResponses: [],
                planBlocks: [],
                fixedActivities: [],
                scheduleWindows: [],
                placements: [],
                plannedToPerformed: [],
                choiceOverrides: [],
            },
        }));
        ledger.userContext.injuries.items = [];
        ledger.userContext.injuries.state = 'unavailable';
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('no rows (measured): performedTraining, sessionResponses, assessments, bodyComposition, events');
        expect(out).toContain('injuries: unavailable, no rows (training_settings)');
        expect(out).toContain('no rows (measured): travel, venueRestrictions, availability');
        expect(out).toContain('no rows (measured): placements, overrides, plannedToPerformed');
    });

    it('compacts equipment, guardrails, preferences, constraints, and goals (sharing or separating missingness)', () => {
        const ledger = buildLedgerExport(fullInput({
            purpose: 'morning',
            records: {
                ...fullInput().records,
                trainingSettings: {
                    ...fullInput().records.trainingSettings!,
                    guardrails: {
                        avoid_high_impact: false,
                        avoid_heavy_lower_body: false,
                        avoid_overhead_pressing: false,
                        avoid_heavy_spinal_loading: false,
                    },
                },
                goals: [
                    { id: 'g1', title: 'Race A', domain: 'endurance', status: 'active', priority: 2, targetDate: '2027-05-09', eventCategory: 'cycling_event', eventLifecycle: 'scheduled' },
                    { id: 'g2', title: 'Race B', domain: 'endurance', status: 'active', priority: 4, targetDate: '2027-06-20', eventCategory: 'cycling_event', eventLifecycle: 'scheduled' },
                ],
                constraints: [
                    { ...fullInput().records.constraints![0], key: 'c1', label: 'No Barbell', value: true, severity: 'soft', category: 'equipment', description: 'No Barbell' },
                    { ...fullInput().records.constraints![0], key: 'c2', label: 'Free Weights', value: false, severity: 'hard', category: 'equipment', description: 'Access to dumbbells' },
                ],
            },
        }));
        const out = renderLedgerExportCompact(ledger);
        expect(out).toContain('### equipment (athlete)\nyes: free_weights, indoor_bike · no: cable_machine, treadmill, pullup_bar');
        expect(out).toContain('### guardrails (athlete)\nnone active');
        expect(out).toContain('modalities: preferred: Cycling (none deprioritized/avoided)');
        expect(out).toContain('c1: true [soft, equipment] — No Barbell\n');
        expect(out).toContain('c2: false [hard, equipment] — Free Weights; Access to dumbbells\n');
        expect(out).toContain('g1 (2027-05-09): Race A [P2, cycling_event, scheduled, endurance]');
        expect(out).toContain('g2 (2027-06-20): Race B [P4, cycling_event, scheduled, endurance]');
        expect(out).toContain('goals missing: description, performanceTarget, targetMetric, targetValue, targetUnit, targetOutcome, timing (not_recorded)');

        // Differing goal missingness switches from shared `goals missing:` to per-goal `missing:`.
        ledger.userContext.goals.items[1].fields.description = { value: 'National champs', source: 'athlete', state: 'measured' };
        const diffGoalsOut = renderLedgerExportCompact(ledger);
        expect(diffGoalsOut).not.toContain('goals missing:');
        expect(diffGoalsOut).toContain('description: National champs');
    });
});
