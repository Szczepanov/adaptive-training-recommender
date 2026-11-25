import { describe, expect, it } from 'vitest';
import type { PlacementAssignment, PlacementEvent } from '../../ledger/placementHistory.ts';
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import { assembleDEvalBlockInput, type DEvalAssemblyOptions, type DEvalRawLedgerData } from './dEvalAssembly.ts';
import {
    AS_OF_POST,
    BLOCK_END,
    BLOCK_START,
    emptyRaw,
    makeAllFlags,
    makeFlagsForDate,
    makeOccurrence,
    makePlanExec,
    makeRevision,
} from './dEvalAssemblyFixtures.testSupport.ts';
import { evaluateDEvalBlock } from './dEvalReadout.ts';

function evaluate(raw: Partial<DEvalRawLedgerData>, options: Partial<DEvalAssemblyOptions> = {}) {
    return evaluateDEvalBlock(assembleDEvalBlockInput(emptyRaw(raw), {
        blockStartDate: BLOCK_START,
        blockEndDate: BLOCK_END,
        asOfDate: AS_OF_POST,
        rollbackState: 'unused',
        ...options,
    }));
}

const outcomesOf = (result: ReturnType<typeof evaluate>) =>
    result.c1.block.outcomes.map(item => [item.sessionKey, item.outcome]);

function event(changedOn: string, previous: PlacementAssignment[], assignments: PlacementAssignment[]): PlacementEvent {
    return {
        userId: 'u1', planId: 'p1', revision: 1, changedOn, recordedAt: `${changedOn}T08:00:00.000Z`,
        previous, assignments, successors: {},
    };
}

const session = (id: string, authoredDate: string) => ({ id, authoredDate, gating: { intensity: 'easy' as const } });

describe('C1 denominator when the overlay records only departures from the plan', () => {
    it('counts authored sessions without a recorded placement as unknown instead of dropping them', () => {
        // Ten moved and done, eleven authored and never touched: the misses must not vanish into a pass.
        const movedDates = Array.from({ length: 10 }, (_, i) => addDaysToLocalDateString(BLOCK_START, i + 1));
        const untouched = Array.from({ length: 11 }, (_, i) => session(`u${i}`, addDaysToLocalDateString(BLOCK_START, i)));
        const result = evaluate({
            planRevisions: [makeRevision([...movedDates.map((d, i) => session(`m${i}`, d)), ...untouched])],
            placements: [{
                planId: 'p1', revision: 1,
                assignments: movedDates.map((d, i) => ({ sessionId: `m${i}`, date: d, status: 'moved' as const })),
            }],
            executions: movedDates.map((d, i) => makePlanExec(`e${i}`, d, 'p1', 1, `m${i}`)),
            performedOccurrences: movedDates.map((d, i) => makeOccurrence(`o${i}`, d, `e${i}`)),
        });
        expect(result.c1.block).toMatchObject({ planned: 21, moved: 10, unknown: 11 });
        expect(result.c1.status).toBe('inconclusive');
        expect(result.knownLimits.join(' ')).toContain('11 authored plan session(s)');
    });

    it('keeps a late move or drop of an untouched session on its authored due date', () => {
        const moved: PlacementAssignment = { sessionId: 'late-move', date: '2026-11-30', status: 'moved', movedFrom: '2026-11-25' };
        const dropped: PlacementAssignment = { sessionId: 'late-drop', date: '2026-11-26', status: 'dropped' };
        const result = evaluate({
            planRevisions: [makeRevision([session('late-move', '2026-11-25'), session('late-drop', '2026-11-26')])],
            placements: [{ planId: 'p1', revision: 1, assignments: [moved, dropped] }],
            placementHistory: [event('2026-11-27', [], [moved]), event('2026-11-28', [moved], [moved, dropped])],
        });
        expect(outcomesOf(result)).toEqual([
            ['p1@1:late-move@2026-11-25', 'unknown'],
            ['p1@1:late-drop@2026-11-26', 'unknown'],
        ]);
    });

    it('does not count a session moved out of the block on or before its authored date', () => {
        const moved: PlacementAssignment = { sessionId: 's', date: '2026-12-30', status: 'moved', movedFrom: '2026-12-10' };
        const result = evaluate({
            planRevisions: [makeRevision([session('s', '2026-12-10')])],
            placements: [{ planId: 'p1', revision: 1, assignments: [moved] }],
            placementHistory: [event('2026-12-08', [], [moved])],
        });
        expect(result.c1.block.planned).toBe(0);
    });

    it('attributes authored sessions only to the revision governing their date, as imported by then', () => {
        const result = evaluate({
            planRevisions: [
                makeRevision([session('old-before', '2026-11-26'), session('old-after', '2026-12-05')]),
                makeRevision([session('new-before', '2026-11-27'), session('new-after', '2026-12-06')], {
                    revision: 2, contentHash: 'h2', importedAt: '2026-11-30T08:00:00.000Z',
                    horizon: { effectiveFrom: '2026-11-25', startDate: BLOCK_START, endDate: BLOCK_END },
                }),
            ],
        });
        expect(outcomesOf(result)).toEqual([
            ['p1@1:old-before@2026-11-26', 'unknown'],
            ['p1@2:new-after@2026-12-06', 'unknown'],
        ]);
    });

    it('does not call a leftover assignment of a no-longer-governing revision missed', () => {
        const result = evaluate({
            planRevisions: [
                makeRevision([session('s', '2026-12-01')]),
                makeRevision([], {
                    revision: 2, contentHash: 'h2', importedAt: '2026-11-28T08:00:00.000Z',
                    horizon: { effectiveFrom: '2026-12-01', startDate: BLOCK_START, endDate: BLOCK_END },
                }),
            ],
            placements: [{ planId: 'p1', revision: 1, assignments: [{ sessionId: 's', date: '2026-12-03', status: 'moved' }] }],
        });
        expect(result.c1.block).toMatchObject({ planned: 1, missed: 0, unknown: 1 });
    });

    it('does not call a session missed while its +1-day completion window is still open', () => {
        const raw = {
            planRevisions: [makeRevision([session('s', '2026-12-02')])],
            placements: [{ planId: 'p1', revision: 1, assignments: [{ sessionId: 's', date: '2026-12-02', status: 'planned' as const }] }],
        };
        expect(evaluate(raw, { asOfDate: '2026-12-02' }).c1.block).toMatchObject({ missed: 0, unknown: 1 });
        expect(evaluate(raw, { asOfDate: '2026-12-03' }).c1.block).toMatchObject({ missed: 0, unknown: 1 });
        expect(evaluate(raw, { asOfDate: '2026-12-04' }).c1.block).toMatchObject({ missed: 1, unknown: 0 });
    });
});

describe('C3 and C4 fail-closed inputs', () => {
    const FLAG_DAY = '2026-11-28';
    const flags = makeAllFlags(BLOCK_START, BLOCK_END, date => (date === FLAG_DAY ? { illness_anomaly: { active: true } } : {}));
    const garminOccurrence = makeOccurrence('occ', FLAG_DAY, undefined, {
        sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'g-1' }],
    });
    const activities = [{ activityId: 'g-1', date: FLAG_DAY, intensityTag: 'easy' }] as never;

    it('does not trust a Garmin tag when athlete overrides could not be read', () => {
        const readable = evaluate({ flagEvaluations: flags, performedOccurrences: [garminOccurrence], activities, activityOverridesState: 'measured' });
        expect(readable.c3.status).toBe('pass');
        const unreadable = evaluate({ flagEvaluations: flags, performedOccurrences: [garminOccurrence], activities, activityOverridesState: 'invalid' });
        expect(unreadable.c3.status).toBe('inconclusive');
        expect(unreadable.c3.incompleteFollowUps).toContain('unknown_intensity:occ');
    });

    it('does not fall back to a Garmin tag when the structured execution is absent', () => {
        const result = evaluate({
            flagEvaluations: flags,
            performedOccurrences: [makeOccurrence('occ', FLAG_DAY, undefined, {
                sourceRefs: [
                    { kind: 'structured_execution', executionId: 'gone' },
                    { kind: 'provider_activity', provider: 'garmin', activityId: 'g-1' },
                ],
            })],
            activities,
        });
        expect(result.c3.incompleteFollowUps).toContain('unknown_intensity:occ');
    });

    it('keeps a flag that was active earlier that date although a later capture cleared it', () => {
        const anomaly = makeFlagsForDate(FLAG_DAY).find(flag => flag.id === 'illness_anomaly')!;
        const cleared = [
            ...makeAllFlags(BLOCK_START, BLOCK_END).filter(flag => flag.revisionId !== anomaly.revisionId),
            { ...anomaly, active: true, evaluatedAt: `${FLAG_DAY}T05:00:00.000Z`, revisionId: 'flag-a' },
            { ...anomaly, active: false, evaluatedAt: `${FLAG_DAY}T18:00:00.000Z`, revisionId: 'flag-b' },
        ];
        const input = assembleDEvalBlockInput(emptyRaw({ flagEvaluations: cleared }), {
            blockStartDate: BLOCK_START, blockEndDate: BLOCK_END, asOfDate: AS_OF_POST, rollbackState: 'unused',
        });
        const day = input.c3.flags.filter(flag => flag.observedOn === FLAG_DAY && flag.id === 'illness_anomaly');
        expect(day.map(flag => flag.active).sort()).toEqual([false, true]);
    });

    it('cannot pass C4 while the rollback setting is on but usage was reported as unused', () => {
        const result = evaluate({ engineRecommendationsEnabled: true });
        expect(result.c4).toMatchObject({ status: 'inconclusive', rollbackState: 'non_safety' });
        expect(result.c4.reason).toContain('engineRecommendationsEnabled');
        expect(result.c2.status).toBe('inconclusive');
        expect(result.overall).toBe('EXTEND');
    });
});
