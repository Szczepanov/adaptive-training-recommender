/**
 * Consecutive morning exports (spec 2c): the window moves one day each morning, so removal is
 * decided by each item's selection date against the current bound, not by an equal scope string.
 */
import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import type { LedgerExportRecords } from '../inputs.ts';
import { fullInput, fullRecords } from '../ledgerExportFixtures.testSupport.ts';
import type { LedgerExport } from '../schema.ts';
import { mergeCheckpoint, type PreviousContext, userContextCheckpoint } from './previousContext.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';

const DAY_1 = '2026-11-20';
const DAY_2 = '2026-11-21';
const DAY_3 = '2026-11-22';

function morning(asOfDate: string, edit: (records: LedgerExportRecords) => LedgerExportRecords = r => r): LedgerExport {
    return buildLedgerExport(fullInput({ purpose: 'morning', asOfDate, records: edit(fullRecords()) }));
}

/** Confirming an export stores its checkpoint merged onto the prior one. */
const confirm = (ledger: LedgerExport, prior?: PreviousContext): PreviousContext =>
    mergeCheckpoint(prior, userContextCheckpoint(ledger), ledger.asOfDate);

const userContext = (ledger: LedgerExport, previous: PreviousContext) => {
    const out = renderLedgerExportCompact(ledger, { previousContext: previous });
    return out.slice(out.indexOf('## User context'), out.indexOf('## Coaching history'));
};

const withoutIntentBlock = (records: LedgerExportRecords): LedgerExportRecords => ({ ...records, intentBlocks: [] });

/** A schedule window on day 1's window start (2026-11-19): in day 1's window, before day 2's. */
const withEarlyWindow = (records: LedgerExportRecords): LedgerExportRecords => ({
    ...records,
    scheduleWindows: [...(records.scheduleWindows ?? []), { id: 'win-0', date: '2026-11-19', startLocal: '07:00', endLocal: '08:00' }],
});

describe('consecutive morning exports', () => {
    it('an event deleted while still in the forward window is removed on the next morning', () => {
        const confirmed = confirm(morning(DAY_1));
        const out = userContext(morning(DAY_2, withoutIntentBlock), confirmed);
        expect(out).toContain('removed: events/block-ib-1');
        expect(out).not.toContain('out of scope now');
    });

    it('an item whose date fell before the new window start is out of scope once, then dropped', () => {
        const confirmed = confirm(morning(DAY_1, withEarlyWindow));
        expect(confirmed.itemHashes['availability/window-win-0']).toBeDefined();
        const day2 = morning(DAY_2, withEarlyWindow);
        const out = userContext(day2, confirmed);
        expect(out).toContain('out of scope now: availability/window-win-0');
        expect(out).not.toContain('removed:');
        const reconfirmed = confirm(day2, confirmed);
        expect(reconfirmed.itemHashes['availability/window-win-0']).toBeUndefined();
        expect(userContext(day2, reconfirmed)).not.toContain('availability/window-win-0');
        expect(userContext(morning(DAY_3, withEarlyWindow), reconfirmed)).not.toContain('availability/window-win-0');
    });

    it('an incomplete read on the next morning reports not readable now, never removed', () => {
        const confirmed = confirm(morning(DAY_1));
        const day2 = morning(DAY_2, withoutIntentBlock);
        day2.userContext.events.droppedUndated = 1;
        const out = userContext(day2, confirmed);
        expect(out).not.toContain('removed:');
        expect(out).toContain('not readable now: events/block-ib-1 (incomplete)');
    });

    it('an item changed under a partial read and changed back prints in full the third time', () => {
        const key = 'availability/window-win-1';
        const confirmed = confirm(morning(DAY_1));
        const partial = morning(DAY_2, records => ({
            ...records,
            scheduleWindows: (records.scheduleWindows ?? []).map(row => ({ ...row, endLocal: '08:00' })),
        }));
        partial.userContext.availability.droppedUndated = 1;
        expect(userContext(partial, confirmed)).toContain('endLocal: 08:00');
        const afterPartial = confirm(partial, confirmed);
        const reverted = morning(DAY_3);
        const out = userContext(reverted, afterPartial);
        expect(out).not.toMatch(new RegExp(`unchanged since.*${key}`));
        expect(out).toContain('endLocal: 07:30');
    });
});
