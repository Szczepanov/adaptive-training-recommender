import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { fullInput, fullRecords } from './ledgerExportFixtures.testSupport.ts';
import type { LedgerExportRecords } from './inputs.ts';

type Assignment = NonNullable<LedgerExportRecords['placements']>[number]['assignments'][number];

const reasons = (assignments: Assignment[], extra: Partial<LedgerExportRecords> = {}, asOfDate?: string) => Object.fromEntries(
    buildLedgerExport(fullInput({
        ...(asOfDate ? { asOfDate } : {}),
        records: { ...fullRecords(), placements: [{ planId: 'plan-1', revision: 2, assignments }], ...extra },
    })).coachingHistory.overrides.items
        .filter(item => !item.id.startsWith('choice:'))
        .map(item => [item.fields.sessionId.value as string, { value: item.fields.reason.value, state: item.fields.reason.state }]),
);

describe('drop/move reasons in the ledger export (Phase 3C)', () => {
    it('keeps legacy, blank and recorded reasons distinct', () => {
        const result = reasons([
            { sessionId: 'legacy', date: '2026-11-18', status: 'dropped' },
            { sessionId: 'blank', date: '2026-11-18', status: 'dropped', reason: null },
            { sessionId: 'coded', date: '2026-11-19', status: 'moved', reason: { code: 'travel', note: 'Away until Friday' } },
        ]);
        expect(result.legacy).toEqual({ value: null, state: 'not_yet_supported' });
        expect(result.blank).toEqual({ value: null, state: 'not_recorded' });
        expect(result.coded).toEqual({ value: { code: 'travel', note: 'Away until Friday' }, state: 'measured' });
    });

    it('reads the reason as of the export date from the immutable event, not a later overlay', () => {
        const result = reasons(
            [{ sessionId: 's9', date: '2026-11-19', status: 'dropped', reason: { code: 'pain' } }],
            {
                placementHistory: [
                    {
                        userId: 'u', planId: 'plan-1', revision: 2, changedOn: '2026-11-15', recordedAt: '2026-11-15T08:00:00Z', successors: {},
                        previous: [], assignments: [{ sessionId: 's9', date: '2026-11-19', status: 'dropped', reason: { code: 'time' } }],
                    },
                    {
                        userId: 'u', planId: 'plan-1', revision: 2, changedOn: '2026-11-21', recordedAt: '2026-11-21T08:00:00Z', successors: {},
                        previous: [{ sessionId: 's9', date: '2026-11-19', status: 'dropped', reason: { code: 'time' } }],
                        assignments: [{ sessionId: 's9', date: '2026-11-19', status: 'dropped', reason: { code: 'pain' } }],
                    },
                ],
            },
        );
        expect(result.s9).toEqual({ value: { code: 'time' }, state: 'measured' });
    });
});
