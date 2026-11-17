import { describe, expect, it } from 'vitest';
import { buildLedgerExport } from './buildLedgerExport.ts';
import { fullInput, fullRecords } from './ledgerExportFixtures.testSupport.ts';
import type { LedgerExportRecords } from './inputs.ts';

type Records = LedgerExportRecords;

const outcomes = (records: Records, sources = fullInput().sources) => Object.fromEntries(
    buildLedgerExport(fullInput({ records, sources })).coachingHistory.placements.items
        .map(item => [item.fields.sessionId.value as string, { value: item.fields.outcome.value, state: item.fields.outcome.state }]),
);
const withPlacements = (assignments: NonNullable<Records['placements']>[number]['assignments'], extra: Partial<Records> = {}): Records => ({
    ...fullRecords(),
    placements: [{ planId: 'plan-1', revision: 2, assignments }],
    plannedToPerformed: [],
    planExecutions: [],
    ...extra,
});

describe('placement outcome in the ledger export (Phase 3)', () => {
    it('classifies past placements and leaves today and later not_applicable', () => {
        const result = outcomes(withPlacements([
            { sessionId: 'past', date: '2026-11-18', status: 'planned' },
            { sessionId: 'today', date: '2026-11-20', status: 'planned' },
            { sessionId: 'later', date: '2026-11-22', status: 'planned' },
        ]));
        expect(result.past).toEqual({ value: 'missed', state: 'measured' });
        expect(result.today).toEqual({ value: null, state: 'not_applicable' });
        expect(result.later).toEqual({ value: null, state: 'not_applicable' });
    });

    it('is unknown, never missed, when plan executions were not read', () => {
        const records = withPlacements([{ sessionId: 'past', date: '2026-11-18', status: 'planned' }]);
        delete (records as { planExecutions?: unknown }).planExecutions;
        expect(outcomes(records).past.value).toBe('unknown');
    });

    it('is unknown when a source behind the evidence was not read completely', () => {
        const records = withPlacements([{ sessionId: 'past', date: '2026-11-18', status: 'planned' }]);
        const sources = { ...fullInput().sources, planned_to_performed: { state: 'unavailable' as const, readAt: null } };
        expect(outcomes(records, sources).past.value).toBe('unknown');
    });

    it('matches executions and links by plan, revision and session, not by title', () => {
        const result = outcomes(withPlacements([
            { sessionId: 'linked', date: '2026-11-17', status: 'planned' },
            { sessionId: 'unlinked', date: '2026-11-17', status: 'planned' },
            { sessionId: 'started', date: '2026-11-18', status: 'dropped' },
            { sessionId: 'other-revision', date: '2026-11-18', status: 'planned' },
        ], {
            plannedToPerformed: [{ planId: 'plan-1', revision: 2, sessionId: 'linked', date: '2026-11-17', performedOccurrenceId: 'occ-9' }],
            planExecutions: [
                { planId: 'plan-1', revision: 2, sessionId: 'unlinked', state: 'completed' },
                { planId: 'plan-1', revision: 2, sessionId: 'started', state: 'abandoned' },
                { planId: 'plan-1', revision: 1, sessionId: 'other-revision', state: 'completed' },
            ],
        }));
        expect(result.linked.value).toBe('performed');
        expect(result.unlinked.value).toBe('done_unlinked');
        expect(result.started.value).toBe('started_not_completed');
        // Work on the same session under another revision may be this placement's: not provably missed.
        expect(result['other-revision'].value).toBe('unknown');
    });

    it('is unknown when a newer revision was imported on or before the placement date', () => {
        const records = withPlacements([
            { sessionId: 'before', date: '2026-11-14', status: 'planned' },
            { sessionId: 'after', date: '2026-11-17', status: 'planned' },
        ]);
        records.planRevisions = [...(records.planRevisions ?? []),
            { planId: 'plan-1', revision: 3, contentHash: 'sha256:new', importedAt: '2026-11-16T08:00:00Z', schema: 'adaptive-training-recommender/external-plan@6' }];
        const result = outcomes(records);
        expect(result.before.value).toBe('missed');
        expect(result.after.value).toBe('unknown');
    });

    it('is unknown for a moved session, whose authored date (and any attempt on it) is never recorded', () => {
        const moved = withPlacements([
            { sessionId: 'moved-in', date: '2026-11-18', status: 'moved' },
            { sessionId: 'moved-out', date: '2026-11-18', status: 'moved' },
            { sessionId: 'no-history', date: '2026-11-18', status: 'moved' },
        ], {
            placementHistory: [{
                userId: 'u', planId: 'plan-1', revision: 2, changedOn: '2026-11-15', recordedAt: '2026-11-15T08:00:00Z', successors: {},
                previous: [
                    { sessionId: 'moved-in', date: '2026-11-16', status: 'planned' },
                    { sessionId: 'moved-out', date: '2026-11-01', status: 'planned' },
                    { sessionId: 'no-history', date: '2026-11-18', status: 'moved' },
                ],
                assignments: [
                    { sessionId: 'moved-in', date: '2026-11-18', status: 'moved' },
                    { sessionId: 'moved-out', date: '2026-11-18', status: 'moved' },
                    { sessionId: 'no-history', date: '2026-11-18', status: 'moved' },
                ],
            }],
        });
        const result = outcomes(moved);
        expect(result['moved-in'].value).toBe('unknown');
        expect(result['moved-out'].value).toBe('unknown');

        const bare = withPlacements([{ sessionId: 'no-history', date: '2026-11-18', status: 'moved' }], { placementHistory: [] });
        expect(outcomes(bare)['no-history'].value).toBe('unknown');
    });

    it('classifies a moved session once every move records the date it moved from (authored date included)', () => {
        const event = (changedOn: string, assignments: Record<string, unknown>[], previous: Record<string, unknown>[] = []) => ({
            userId: 'u', planId: 'plan-1', revision: 2, changedOn, recordedAt: `${changedOn}T08:00:00Z`, successors: {},
            previous, assignments,
        }) as unknown as NonNullable<LedgerExportRecords['placementHistory']>[number];
        const placed = (sessionId: string, movedFrom?: string) =>
            ({ sessionId, date: '2026-11-18', status: 'moved' as const, ...(movedFrom ? { movedFrom } : {}) });

        // First move from the authored 11-16 (inside the window): absence is provable, so missed.
        const recorded = withPlacements([placed('s', '2026-11-16')], { placementHistory: [event('2026-11-15', [placed('s', '2026-11-16')])] });
        expect(outcomes(recorded).s.value).toBe('missed');

        // Authored date before the window start: an attempt could lie outside the read.
        const early = withPlacements([placed('s', '2026-11-01')], { placementHistory: [event('2026-11-01', [placed('s', '2026-11-01')])] });
        expect(outcomes(early).s.value).toBe('unknown');

        // A second move records the first move's date; the first move's own from-date must also exist.
        const twoMoves = withPlacements([placed('s', '2026-11-17')], { placementHistory: [
            event('2026-11-15', [{ ...placed('s', '2026-11-16'), date: '2026-11-17' }]),
            event('2026-11-17', [placed('s', '2026-11-17')], [{ ...placed('s', '2026-11-16'), date: '2026-11-17' }]),
        ] });
        expect(outcomes(twoMoves).s.value).toBe('missed');
        const legacyFirst = withPlacements([placed('s', '2026-11-17')], { placementHistory: [
            event('2026-11-15', [{ sessionId: 's', date: '2026-11-17', status: 'moved' }]),
            event('2026-11-17', [placed('s', '2026-11-17')], [{ sessionId: 's', date: '2026-11-17', status: 'moved' }]),
        ] });
        expect(outcomes(legacyFirst).s.value).toBe('unknown');

        // From-date on the row but no history, or truncated history: the move chain cannot be checked.
        expect(outcomes(withPlacements([placed('s', '2026-11-16')], { placementHistory: [] })).s.value).toBe('unknown');
        // Truncated history exports only an overlay written on or before the as-of date; its move chain is unverifiable.
        const truncated = withPlacements([placed('s', '2026-11-16')], {
            placements: [{ planId: 'plan-1', revision: 2, updatedAt: '2026-11-15T08:00:00Z', assignments: [placed('s', '2026-11-16')] }],
            placementHistory: [],
            placementHistoryUnavailable: [{ planId: 'plan-1', revision: 2 }],
        });
        expect(outcomes(truncated).s.value).toBe('unknown');

        // A save over a corrupt overlay hides the prior state, so a move before it is unverifiable.
        const overCorrupt = withPlacements([placed('s', '2026-11-16')], { placementHistory: [
            { ...event('2026-11-15', [placed('s', '2026-11-16')]), previousState: 'invalid' } as NonNullable<LedgerExportRecords['placementHistory']>[number],
        ] });
        expect(outcomes(overCorrupt).s.value).toBe('unknown');

        // A dropped session that was moved earlier without a from-date stays unknown too.
        const droppedAfterLegacyMove = withPlacements([{ sessionId: 's', date: '2026-11-18', status: 'dropped' }], { placementHistory: [
            event('2026-11-15', [{ sessionId: 's', date: '2026-11-18', status: 'moved' }]),
            event('2026-11-18', [{ sessionId: 's', date: '2026-11-18', status: 'dropped' }], [{ sessionId: 's', date: '2026-11-18', status: 'moved' }]),
        ] });
        expect(outcomes(droppedAfterLegacyMove).s.value).toBe('unknown');
    });

    it('is unknown for a past placement after the end of a window that ends before the as-of date', () => {
        const records = withPlacements([
            { sessionId: 'inside', date: '2026-11-15', status: 'planned' },
            { sessionId: 'outside', date: '2026-11-18', status: 'planned' },
        ]);
        const built = buildLedgerExport(fullInput({ records, window: { startDate: '2026-11-07', endDate: '2026-11-16' } }));
        const outcome = (id: string) => built.coachingHistory.placements.items.find(item => item.fields.sessionId.value === id)?.fields.outcome.value;
        expect(outcome('inside')).toBe('missed');
        expect(outcome('outside')).toBe('unknown');
    });

    it('is unknown for a placement with unverifiable link or execution evidence', () => {
        const result = outcomes(withPlacements([{ sessionId: 'past', date: '2026-11-18', status: 'planned' }], {
            unverifiedPlanEvidence: [{ planId: 'plan-1', revision: 2, sessionId: 'past' }],
        }));
        expect(result.past.value).toBe('unknown');
    });
});
