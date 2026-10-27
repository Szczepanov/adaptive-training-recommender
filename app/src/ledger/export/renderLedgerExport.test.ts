import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { activity, fullInput, recoverySnapshot } from './ledgerExportFixtures.testSupport.ts';
import { renderLedgerExport } from './renderLedgerExport.ts';
import { LEDGER_STATES } from './schema.ts';

describe('renderLedgerExport', () => {
    it('matches the five-layer planning golden export', async () => {
        const ledger = buildLedgerExport(fullInput());
        await expect(renderLedgerExport(ledger)).toMatchFileSnapshot('./renderLedgerExport.golden.md');
    });

    it('preserves measured zeros, units, provenance, stale dates and unsupported history', () => {
        const ledger = buildLedgerExport(fullInput({ records: {
            ...fullInput().records,
            recovery: [recoverySnapshot('2026-11-20', {}, { sleep: '2026-11-18' })],
        } }));
        const markdown = renderLedgerExport(ledger);
        expect(markdown).toContain('| totalSteps | 0 | steps | garmin | measured | 2026-11-19 |');
        expect(markdown).toContain('| sleepScore | 81 | score | garmin | stale | 2026-11-18 |');
        expect(markdown).toContain('| since | Not recorded |');
        expect(markdown).toContain('| revisions | Not recorded |');
        expect(markdown).toContain('not_yet_supported');
        expect(markdown).toContain('readAt: 2026-11-20T06:12:00Z');
        expect(markdown).toContain('newestObservedOn: 2026-11-20');
    });

    it.each(LEDGER_STATES)('keeps %s missingness explicit instead of claiming none', state => {
        const ledger = buildLedgerExport(fullInput({ records: {} }));
        ledger.facts.recovery.state = state;
        ledger.userContext.trainingDislikes = { value: null, source: 'athlete', state };
        const markdown = renderLedgerExport(ledger);
        expect(markdown).toContain(`state: ${state}; source: daily_recovery_snapshots`);
        expect(markdown).toContain(`| trainingDislikes | Not recorded | Not specified | athlete | ${state} | Not recorded |`);
        expect(markdown).toContain('No rows exported');
        expect(markdown.toLowerCase()).not.toContain('none');
    });

    it('includes future travel and venue restrictions in planning, including since and revisions', () => {
        const ledger = buildLedgerExport(fullInput());
        const markdown = renderLedgerExport(ledger);
        expect(markdown).toContain('### travel');
        expect(markdown).toContain('| startDate | 2026-11-25 |');
        expect(markdown).toContain('| since | 2026-11-25 |');
        expect(markdown).toContain('### venueRestrictions');
        expect(markdown).toContain('| title | Hotel gym |');
        expect(markdown).toContain('| environment | indoor |');
        expect(markdown).toContain('| revisions | Not recorded |');
    });

    it('reports capped activity detail and dropped undated rows', () => {
        const ledger = buildLedgerExport(fullInput({ records: {
            activities: [...Array.from({ length: 15 }, (_, index) => activity(index)), { ...activity(50), date: '', startedAt: undefined }],
        } }));
        const markdown = renderLedgerExport(ledger);
        expect(markdown).toContain('droppedUndated: 1');
        expect(markdown).toContain('truncated: true; totalInWindow: 15; exported: 12');
    });

    it('renders persisted flag evidence and derived definitions without recomputation', () => {
        const ledger = buildLedgerExport(fullInput({ flagEvaluations: [{
            id: 'injury_constraint_touches_session', observedOn: '2026-11-18',
            evaluatedAt: '2026-11-18T05:00:00Z', definitionVersion: 'injury-touch@3',
            sessionRef: 'session-7', active: null, state: 'missing',
            threshold: 'loaded knee', baselineWindow: '28d',
            inputs: [{ name: 'severity', value: { value: null, source: 'athlete', state: 'missing' } }],
        }] }));
        const markdown = renderLedgerExport(ledger);
        for (const evidence of ['injury-touch@3', 'session-7', '2026-11-18T05:00:00Z', 'loaded knee', '28d', 'severity']) {
            expect(markdown).toContain(evidence);
        }
        expect(markdown).toContain('active: Not recorded; state: missing');
        for (const metric of ledger.derived) {
            expect(markdown).toContain(metric.definition);
            expect(markdown).toContain(`window: ${metric.window}`);
        }
    });

    it('escapes text and embedded JSON without injecting Markdown structure or controls', () => {
        const ledger = buildLedgerExport(fullInput());
        const hostile = 'line\n## injected | <script>\u0000`[link](https://example.com)';
        ledger.facts.checkins.items[0].fields.notes.value = hostile;
        ledger.userContext.equipment.revisions = {
            value: [{ note: hostile, nested: { count: 0, enabled: false } }], source: 'athlete', state: 'measured',
        };
        const markdown = renderLedgerExport(ledger);
        expect(markdown).not.toContain('\n## injected');
        expect(markdown).not.toContain('<script>');
        expect(markdown).not.toContain('\u0000');
        expect(markdown).not.toContain('[link](https://example.com)');
        expect(markdown).toContain('&#124;');
        expect(markdown).toContain('count');
        expect(markdown).toContain('false');
        const noteRow = markdown.split('\n').find(line => line.startsWith('| notes |'))!;
        expect(noteRow.split('|')).toHaveLength(8);
    });

    it('distinguishes an explicitly recorded empty string from an absent value', () => {
        const ledger = buildLedgerExport(fullInput());
        ledger.facts.checkins.items[0].fields.notes.value = '';
        expect(renderLedgerExport(ledger)).toContain('| notes | "" | Not specified | athlete | measured |');
    });

    it('is deterministic and leaves the input unchanged; only export time changes with exportedAt', () => {
        const ledger = buildLedgerExport(fullInput());
        const before = JSON.stringify(ledger);
        const first = renderLedgerExport(ledger);
        expect(renderLedgerExport(ledger)).toBe(first);
        expect(JSON.stringify(ledger)).toBe(before);
        const later = { ...ledger, exportedAt: '2030-01-01T00:00:00Z' };
        expect(renderLedgerExport(later).replace(later.exportedAt, ledger.exportedAt)).toBe(first);
    });

    it('omits legacy engine opinions unless supplied and clearly labels an included layer', () => {
        expect(renderLedgerExport(buildLedgerExport(fullInput()))).not.toContain('Legacy engine');
        const markdown = renderLedgerExport(buildLedgerExport(fullInput({ legacyEngine: {
            policyVersion: '1.2.3', recommendation: { modality: 'cycling' },
        } })));
        expect(markdown).toContain('## Legacy engine (opt-in opinions)');
        expect(markdown).toContain('policyVersion');
        expect(markdown).toContain('1.2.3');
        expect(markdown).toContain('cycling');
    });
});
