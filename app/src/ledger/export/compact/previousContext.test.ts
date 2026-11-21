import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from '../buildLedgerExport.ts';
import { fullInput } from '../ledgerExportFixtures.testSupport.ts';
import {
    CHECKPOINT_FORMAT_VERSION,
    contextDelta,
    mergeCheckpoint,
    morningOmittedRevisionKeys,
    type PreviousContext,
    userContextCheckpoint,
    userContextItemHashes,
    userContextStates,
} from './previousContext.ts';
import { renderLedgerExportCompact } from './renderLedgerExportCompact.ts';

const build = (purpose: 'morning' | 'planning' = 'morning') => buildLedgerExport(fullInput({ purpose }));
/** What confirming this export would store: the checkpoint merged onto nothing. */
const previousOf = (ledger = build()): PreviousContext => mergeCheckpoint(undefined, userContextCheckpoint(ledger), '2026-11-13');
const userContext = (out: string) => out.slice(out.indexOf('## User context'), out.indexOf('## Coaching history'));
const withHash = (previous: PreviousContext, key: string): PreviousContext =>
    ({ ...previous, itemHashes: { ...previous.itemHashes, [key]: 'deadbeef' } });

describe('previousContext', () => {
    it('hash is stable across key order', () => {
        const a = build();
        const b = build();
        const fields = b.userContext.guardrails.fields;
        b.userContext.guardrails.fields = Object.fromEntries(Object.entries(fields).reverse()) as typeof fields;
        expect(userContextItemHashes(b)).toEqual(userContextItemHashes(a));
        expect(userContextItemHashes(a)['injuries/injury-001']).toMatch(/^[0-9a-f]{8}$/);
        expect(Object.keys(userContextItemHashes(a))).toEqual(expect.arrayContaining(['equipment', 'trainingDislikes']));
    });

    it('unchanged items collapse into one line', () => {
        const ledger = build();
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previousOf(ledger) }));
        const lines = out.split('\n').filter(line => line.startsWith('unchanged since'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^unchanged since 2026-11-13: \d+ items \(.*equipment.*injuries\/injury-001.*\)$/);
        expect(out).not.toContain('region: knee');
        expect(out).not.toContain('### equipment');
    });

    it('the planning (new-chat refresh) export ignores a checkpoint and prints full context', () => {
        const ledger = build('planning');
        const out = renderLedgerExportCompact(ledger, { previousContext: previousOf(ledger) });
        expect(out).toContain('use: refresh export for starting a new chat');
        expect(userContext(out)).not.toContain('unchanged since');
        expect(userContext(out)).toContain('#### injury-001');
        expect(out).toBe(renderLedgerExportCompact(ledger));
        expect(renderLedgerExportCompact(build())).not.toContain('use: refresh export');
    });

    it('a changed field prints the item in full', () => {
        const ledger = build();
        const previous = previousOf(ledger);
        ledger.userContext.injuries.items[0].fields.severity.value = 'avoid';
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).toContain('#### injury-001');
        expect(out).toContain('severity: avoid');
        expect(out).not.toMatch(/unchanged since.*injuries\/injury-001/);
        expect(out).toMatch(/unchanged since.*equipment/);
    });

    it('a new id prints in full even if another item shares its hash', () => {
        const ledger = build();
        const previous = previousOf(ledger);
        const source = ledger.userContext.injuries.items[0];
        ledger.userContext.injuries.items.push({ ...structuredClone(source), id: 'injury-002' });
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).toContain('#### injury-002');
        expect(out).not.toContain('#### injury-001');
        expect(out).toMatch(/unchanged since.*injuries\/injury-001/);
    });

    it('removed: only after a complete read in the same scope', () => {
        const ledger = build();
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: withHash(previousOf(ledger), 'goals/gone-9') }));
        expect(out).toContain('removed: goals/gone-9');
    });

    it('a failed read reports not readable now, never removed, and abbreviates nothing from it', () => {
        const ledger = build();
        const previous = previousOf(ledger);
        ledger.userContext.injuries.items = [];
        ledger.userContext.injuries.state = 'unavailable';
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).not.toContain('removed:');
        expect(out).toContain('not readable now: injuries/injury-001 (unavailable)');
        expect(out).not.toMatch(/unchanged since.*injuries\//);
        expect(out).toMatch(/unchanged since.*equipment/);
    });

    it('a truncated read (rows omitted) reports not readable now, never removed', () => {
        const ledger = build();
        const previous = withHash(previousOf(ledger), 'goals/gone-9');
        ledger.userContext.goals.droppedUndated = 1;
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).not.toContain('removed:');
        expect(out).toContain('not readable now: goals/gone-9 (incomplete)');
    });

    it('a moving window reports an item dated before the new window start out of scope now, never removed', () => {
        const ledger = build();
        const previous = withHash(previousOf(ledger), 'availability/fixed-old');
        const moved: PreviousContext = {
            ...previous,
            selectionDates: { ...previous.selectionDates, 'availability/fixed-old': '2026-11-02' },
            collections: { ...previous.collections, availability: { scope: 'from:2026-11-01', complete: true, from: '2026-11-01' } },
        };
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: moved }));
        expect(out).not.toContain('removed:');
        expect(out).toContain('out of scope now: availability/fixed-old');
    });

    it.each([
        ['another format version', { formatVersion: CHECKPOINT_FORMAT_VERSION + 1 }],
        ['format version 2', { formatVersion: 2 }],
        ['format version 1', { formatVersion: 1 }],
        ['no format version (legacy)', { formatVersion: undefined }],
    ])('%s gives full context', (_name, patch) => {
        const ledger = build();
        const previous = { ...previousOf(ledger), ...patch } as PreviousContext;
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previous }));
        expect(out).not.toContain('unchanged since');
        expect(out).toContain('region: knee');
        expect(renderLedgerExportCompact(ledger, { previousContext: previous })).toBe(renderLedgerExportCompact(ledger));
    });

    it('a user-context collection whose items are all unchanged says so, never "shown above"', () => {
        const ledger = build();
        const out = userContext(renderLedgerExportCompact(ledger, { previousContext: previousOf(ledger) }));
        expect(out).not.toContain('shown above');
        expect(out).toContain(`availability: ${ledger.userContext.availability.items.length} unchanged (listed above)`);
        expect(out).toContain('injuries: 1 unchanged (listed above)');
    });

    it('without previousContext everything prints in full', () => {
        const out = userContext(renderLedgerExportCompact(build()));
        expect(out).not.toContain('unchanged since');
        expect(out).toContain('region: knee');
    });

    it('morning compact with matching previousContext is <= 8,145 chars and without it <= 13,032 chars', () => {
        const ledger = build();
        expect(renderLedgerExportCompact(ledger, { previousContext: previousOf(ledger) }).length).toBeLessThanOrEqual(8145);
        expect(renderLedgerExportCompact(ledger).length).toBeLessThanOrEqual(13032);
    });

    it('checkpoints unchanged planRevisions on morning while keeping new revisions and full planning history', () => {
        const ledger = build();
        const previous = previousOf(ledger);
        const unchangedOut = renderLedgerExportCompact(ledger, { previousContext: previous });
        const history = unchangedOut.slice(unchangedOut.indexOf('## Coaching history'));
        expect(history).toContain('planRevisions: 1 unchanged since 2026-11-13');
        expect(history).not.toContain('Build aerobic base first.');
        expect(userContext(unchangedOut)).not.toContain('planRevisions');

        // A new revision renders in full while leaving the earlier unchanged revision counted.
        const second = structuredClone(ledger.coachingHistory.planRevisions.items[0]);
        second.id = 'plan-1@3';
        second.fields.revision = { value: 3, source: 'adaptive', state: 'measured' };
        second.fields.importedAt = { value: '2026-11-20T08:00:00Z', source: 'adaptive', state: 'measured' };
        second.fields.authorRationale = { value: 'Updated progression block.', source: 'adaptive', state: 'measured' };
        ledger.coachingHistory.planRevisions.items.push(second);
        const mixedOut = renderLedgerExportCompact(ledger, { previousContext: previous });
        const mixedRevisions = mixedOut.slice(mixedOut.indexOf('### planRevisions'), mixedOut.indexOf('### placements'));
        expect(mixedRevisions).toContain('#### plan-1@3');
        expect(mixedRevisions).toContain('authorRationale: Updated progression block.');
        expect(mixedRevisions).toContain('unchanged since 2026-11-13: 1 revision');
        expect(mixedRevisions).not.toContain('#### plan-1@2');

        // Planning exports always ignore the checkpoint for planRevisions as well.
        const planning = build('planning');
        expect(renderLedgerExportCompact(planning, { previousContext: previous })).toContain('authorRationale: Build aerobic base first.');

        // Diagnostic exports also retain full planRevisions when passed a checkpoint.
        const diagnostic = buildLedgerExport(fullInput({ purpose: 'diagnostic' }));
        expect(renderLedgerExportCompact(diagnostic, { previousContext: previous })).toContain('authorRationale: Build aerobic base first.');

        // An older revision omitted on Day 1 morning is not in the checkpoint and renders in full once referenced on Day 2.
        const day1 = build();
        const older = structuredClone(day1.coachingHistory.planRevisions.items[0]);
        older.id = 'old-plan@1';
        older.fields.planId = { value: 'old-plan', source: 'adaptive', state: 'measured' };
        older.fields.revision = { value: 1, source: 'adaptive', state: 'measured' };
        older.fields.importedAt = { value: '2026-09-01T08:00:00Z', source: 'adaptive', state: 'measured' };
        older.fields.authorRationale = { value: 'Older omitted rationale.', source: 'adaptive', state: 'measured' };
        day1.coachingHistory.planRevisions.items.push(older);
        const day1Cp = mergeCheckpoint(undefined, userContextCheckpoint(day1), '2026-11-20');
        expect(day1Cp.itemHashes['planRevisions/old-plan@1']).toBeUndefined();

        const day2 = structuredClone(day1);
        const refPlacement = structuredClone(day2.coachingHistory.placements.items[0]);
        refPlacement.id = 'old-plan@1:s1';
        refPlacement.fields.planId = { value: 'old-plan', source: 'adaptive', state: 'measured' };
        refPlacement.fields.revision = { value: 1, source: 'adaptive', state: 'measured' };
        day2.coachingHistory.placements.items.push(refPlacement);
        const day2Revisions = renderLedgerExportCompact(day2, { previousContext: day1Cp })
            .slice(0);
        expect(day2Revisions).toContain('#### old-plan@1');
        expect(day2Revisions).toContain('authorRationale: Older omitted rationale.');
        expect(day2Revisions).toContain('unchanged since 2026-11-20: 1 revision');

        // Markdown punctuation in removed revision keys is escaped.
        const hostilePrior = {
            ...previous,
            itemHashes: { ...previous.itemHashes, 'planRevisions/rev|[bad]': 'deadbeef' },
        };
        const hostileOut = renderLedgerExportCompact(ledger, { previousContext: hostilePrior });
        expect(hostileOut).toContain('removed: planRevisions/rev&#124;&#91;bad&#93;');
    });

    it('treats morning-omitted existing revisions as out of scope once, not removed, and prints removed only when deleted', () => {
        const day1 = build();
        const rev1 = structuredClone(day1.coachingHistory.planRevisions.items[0]);
        rev1.id = 'a@1';
        rev1.observedOn = '2026-11-19';
        rev1.fields.planId = { value: 'a', source: 'adaptive', state: 'measured' };
        rev1.fields.revision = { value: 1, source: 'adaptive', state: 'measured' };
        rev1.fields.importedAt = { value: '2026-11-19T08:00:00Z', source: 'adaptive', state: 'measured' };
        rev1.fields.authorRationale = { value: 'Initial a@1 block.', source: 'adaptive', state: 'measured' };
        day1.coachingHistory.planRevisions.items.push(rev1);
        const day1Cp = previousOf(day1);
        expect(day1Cp.itemHashes['planRevisions/a@1']).toBeDefined();

        // Day 2: a@2 becomes latest and rotates unreferenced a@1 out of morning scope while a@1 remains in the ledger.
        const day2 = structuredClone(day1);
        const rev2 = structuredClone(rev1);
        rev2.id = 'a@2';
        rev2.observedOn = '2026-11-20';
        rev2.fields.revision = { value: 2, source: 'adaptive', state: 'measured' };
        rev2.fields.importedAt = { value: '2026-11-20T08:00:00Z', source: 'adaptive', state: 'measured' };
        rev2.fields.authorRationale = { value: 'Updated a@2 block.', source: 'adaptive', state: 'measured' };
        day2.coachingHistory.planRevisions.items.push(rev2);

        const day2History = renderLedgerExportCompact(day2, { previousContext: day1Cp })
            .slice(renderLedgerExportCompact(day2, { previousContext: day1Cp }).indexOf('## Coaching history'));
        expect(day2History).toContain('out of scope now: planRevisions/a@1');
        expect(day2History).not.toContain('removed: planRevisions/a@1');
        expect(day2History).toContain('#### a@2');

        // Confirming Day 2 drops a@1 from the stored checkpoint; referencing a@1 on Day 3 prints it in full.
        const day2Cp = mergeCheckpoint(day1Cp, userContextCheckpoint(day2), '2026-11-20');
        expect(day2Cp.itemHashes['planRevisions/a@1']).toBeUndefined();
        const day3 = structuredClone(day2);
        const refPlacement = structuredClone(day3.coachingHistory.placements.items[0]);
        refPlacement.id = 'a@1:s1';
        refPlacement.fields.planId = { value: 'a', source: 'adaptive', state: 'measured' };
        refPlacement.fields.revision = { value: 1, source: 'adaptive', state: 'measured' };
        day3.coachingHistory.placements.items.push(refPlacement);
        const day3History = renderLedgerExportCompact(day3, { previousContext: day2Cp })
            .slice(renderLedgerExportCompact(day3, { previousContext: day2Cp }).indexOf('## Coaching history'));
        expect(day3History).toContain('#### a@1');
        expect(day3History).toContain('authorRationale: Initial a@1 block.');
        expect(day3History).not.toContain('out of scope now: planRevisions/a@1');
        expect(day3History).toContain('unchanged since 2026-11-20: 2 revisions');

        // Genuinely deleting a@1 from planRevisions.items on a complete read reports removed.
        const deleted = structuredClone(day2);
        deleted.coachingHistory.planRevisions.items = deleted.coachingHistory.planRevisions.items.filter(row => row.id !== 'a@1');
        const deletedHistory = renderLedgerExportCompact(deleted, { previousContext: day1Cp })
            .slice(renderLedgerExportCompact(deleted, { previousContext: day1Cp }).indexOf('## Coaching history'));
        expect(deletedHistory).toContain('removed: planRevisions/a@1');
        expect(deletedHistory).not.toContain('out of scope now: planRevisions/a@1');

        // Helper returns omitted keys only on morning exports, and incomplete reads stay unreadable.
        expect([...morningOmittedRevisionKeys(day2)]).toEqual(['planRevisions/a@1']);
        expect([...morningOmittedRevisionKeys({ ...day2, purpose: 'planning' })]).toEqual([]);
        const incomplete = structuredClone(day2);
        incomplete.coachingHistory.planRevisions.droppedUndated = 1;
        const incompleteDelta = contextDelta(
            userContextCheckpoint(incomplete),
            day1Cp,
            userContextStates(incomplete),
            morningOmittedRevisionKeys(incomplete),
        );
        expect(incompleteDelta.unreadable).toContainEqual({ key: 'planRevisions/a@1', reason: 'incomplete' });
        expect(incompleteDelta.outOfScope).not.toContain('planRevisions/a@1');
    });
});
