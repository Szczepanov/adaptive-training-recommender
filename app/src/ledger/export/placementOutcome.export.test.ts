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
