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
    makeCheckin,
    makeFlagsForDate,
    makeOccurrence,
    makePlanExec,
    makeRevision,
} from './dEvalAssemblyFixtures.testSupport.ts';
import { createPlanGovernance } from './dEvalPlanGovernance.ts';
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

const session = (id: string, authoredDate: string, floating = false) =>
    ({ id, authoredDate, floating, gating: { intensity: 'easy' as const } });

describe('C1 denominator when the overlay records only departures from the plan', () => {
    it('counts authored sessions without a recorded placement as unknown instead of dropping them', () => {
        // Ten moved and done, eleven authored and never touched: the misses must not vanish into a pass.
        const movedDates = Array.from({ length: 10 }, (_, i) => addDaysToLocalDateString(BLOCK_START, i + 1));
        const movedAssignments = movedDates.map((d, i) => ({ sessionId: `m${i}`, date: d, status: 'moved' as const }));
        const untouched = Array.from({ length: 11 }, (_, i) => session(`u${i}`, addDaysToLocalDateString(BLOCK_START, i)));
        const result = evaluate({
            planRevisions: [makeRevision([...movedDates.map((d, i) => session(`m${i}`, d)), ...untouched])],
            placements: [{
                planId: 'p1', revision: 1,
                assignments: movedAssignments,
            }],
            placementHistory: [event(BLOCK_START, [], movedAssignments)],
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

    it('keeps confirmed misses of floating sessions moved on the day they were shown', () => {
        // Week of Mon 2026-11-23 (before the Tuesday block start), shown and moved on Thu 2026-11-26, never done.
        const ids = ['f0', 'f1', 'f2'];
        const missed = ids.map(id => ({ sessionId: id, date: '2026-11-27', status: 'moved' as const, movedFrom: '2026-11-26' }));
        const doneDates = Array.from({ length: 8 }, (_, i) => addDaysToLocalDateString('2026-12-01', i));
        const done = doneDates.map((d, i) => ({ sessionId: `m${i}`, date: d, status: 'moved' as const, movedFrom: d }));
        const result = evaluate({
            planRevisions: [makeRevision([
                ...ids.map(id => session(id, '2026-11-23', true)),
                ...doneDates.map((d, i) => session(`m${i}`, d)),
            ])],
            placements: [{ planId: 'p1', revision: 1, assignments: [...missed, ...done] }],
            placementHistory: [event('2026-11-26', [], [...missed, ...done])],
            executions: doneDates.map((d, i) => makePlanExec(`e${i}`, d, 'p1', 1, `m${i}`)),
            performedOccurrences: doneDates.map((d, i) => makeOccurrence(`o${i}`, d, `e${i}`)),
        });
        expect(result.c1.block).toMatchObject({ planned: 11, moved: 8, missed: 3, unknown: 0 });
        expect(result.c1.status).toBe('fail');
    });

    it('counts a floating session moved or replaced in time exactly once, through its recorded placement', () => {
        const moved: PlacementAssignment = { sessionId: 'mv', date: '2026-12-04', status: 'moved', movedFrom: '2026-12-03' };
        const superseded: PlacementAssignment = { sessionId: 'old', date: '2026-12-03', status: 'superseded' };
        const successors = { old: { revision: 2, sessionId: 'new' } };
        const result = evaluate({
            planRevisions: [
                makeRevision([session('mv', '2026-11-30', true), session('old', '2026-11-30', true)]),
                makeRevision([session('new', '2026-12-25')], {
                    revision: 2,
                    contentHash: 'h2',
                    horizon: { effectiveFrom: '2026-12-25', startDate: '2026-12-25', endDate: '2026-12-31' },
                }),
            ],
            placements: [{ planId: 'p1', revision: 1, assignments: [moved, superseded], successors }],
            placementHistory: [
                { ...event('2026-12-02', [], [superseded]), successors },
                { ...event('2026-12-03', [superseded], [moved, superseded]), successors },
            ],
            executions: [makePlanExec('e', '2026-12-04', 'p1', 1, 'mv')],
            performedOccurrences: [makeOccurrence('o', '2026-12-04', 'e')],
        });
        expect(outcomesOf(result)).toEqual([['p1@1:mv@2026-12-04', 'moved']]);
    });

    it('emits a late-moved floating session on the date it was shown, not its week start', () => {
        const moved: PlacementAssignment = { sessionId: 'f', date: '2026-12-06', status: 'moved', movedFrom: '2026-12-03' };
        const result = evaluate({
            planRevisions: [makeRevision([session('f', '2026-11-30', true)])],
            placements: [{ planId: 'p1', revision: 1, assignments: [moved] }],
            placementHistory: [event('2026-12-05', [], [moved])],
        });
        expect(outcomesOf(result)).toEqual([['p1@1:f@2026-12-03', 'unknown']]);
    });

    it('keeps untouched floating sessions unknown around a mid-week block start or import', () => {
        const straddling = evaluate({ planRevisions: [makeRevision([session('f', '2026-11-23', true)])] });
        expect(outcomesOf(straddling)).toEqual([['p1@1:f@2026-11-24', 'unknown']]);
        const importedMidWeek = evaluate({
            planRevisions: [makeRevision([session('f', '2026-11-30', true), session('monday', '2026-11-30')], {
                importedAt: '2026-12-02T08:00:00.000Z',
                horizon: { effectiveFrom: '2026-11-30', startDate: '2026-11-30', endDate: BLOCK_END },
            })],
        });
        expect(outcomesOf(importedMidWeek)).toEqual([['p1@1:f@2026-12-02', 'unknown']]);
    });

    it('keeps a session whose recorded move an overlay reset removed before it came due', () => {
        const move = (id: string, date: string, movedFrom: string): PlacementAssignment => ({ sessionId: id, date, status: 'moved', movedFrom });
        const first = [move('x1', '2026-12-15', '2026-12-14'), move('x2', '2026-12-10', '2026-11-26'), move('x3', '2026-11-25', '2026-11-30')];
        const reset: PlacementEvent = {
            ...event('2026-11-28', [], []), previousState: 'invalid', previousStateReason: 'current-schema-invalid',
        };
        const planRevisions = [makeRevision([session('x1', '2026-12-14'), session('x2', '2026-11-26'), session('x3', '2026-11-30')])];
        const placements = [{ planId: 'p1', revision: 1, assignments: [] }];
        // x1 returns to its plan date; x2's plan date had passed, so it stays on its recorded date;
        // x3 came due on its recorded date before the reset.
        const expected = [
            ['p1@1:x3@2026-11-25', 'unknown'],
            ['p1@1:x2@2026-12-10', 'unknown'],
            ['p1@1:x1@2026-12-14', 'unknown'],
        ];
        expect(outcomesOf(evaluate({ planRevisions, placements, placementHistory: [event('2026-11-20', [], first), reset] }))).toEqual(expected);
        expect(outcomesOf(evaluate({ planRevisions, placements, placementHistory: [event('2026-11-20', first, first), reset] }))).toEqual(expected);

        // A move made only after the reset and after the plan date is late, not an on-time move.
        const lateAgain = [move('x1', '2026-12-18', '2026-12-14')];
        const late = evaluate({
            planRevisions,
            placements: [{ planId: 'p1', revision: 1, assignments: lateAgain }],
            placementHistory: [event('2026-11-20', [], first), reset, event('2026-12-16', [], lateAgain)],
        });
        expect(outcomesOf(late)).toEqual(expected);
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
        const assignments: PlacementAssignment[] = [{ sessionId: 's', date: '2026-12-03', status: 'moved' }];
        const result = evaluate({
            planRevisions: [
                makeRevision([session('s', '2026-12-01')]),
                makeRevision([], {
                    revision: 2, contentHash: 'h2', importedAt: '2026-11-28T08:00:00.000Z',
                    horizon: { effectiveFrom: '2026-12-01', startDate: BLOCK_START, endDate: BLOCK_END },
                }),
            ],
            placements: [{ planId: 'p1', revision: 1, assignments }],
            placementHistory: [event('2026-11-25', [], assignments)],
        });
        expect(result.c1.block).toMatchObject({ planned: 1, missed: 0, unknown: 1 });
    });

    it('does not call a session missed while its +1-day completion window is still open', () => {
        const assignments: PlacementAssignment[] = [{ sessionId: 's', date: '2026-12-02', status: 'planned' }];
        const raw = {
            planRevisions: [makeRevision([session('s', '2026-12-02')])],
            placements: [{ planId: 'p1', revision: 1, assignments }],
            placementHistory: [event('2026-12-01', [], assignments)],
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

describe('PR #1287 review findings regression checks', () => {
    it('does not allow incomplete observation reads to produce a C2 pass even when surviving observations pass', () => {
        const base = emptyRaw();
        const afterAtt = {
            id: 'att-after-bench',
            protocolRef: { id: 'strength-bench-press-1rm', revision: 1 },
            state: 'completed' as const,
            purpose: 'post_block' as const,
            completedAt: '2027-02-01T10:00:00.000Z',
        };
        const afterObs = {
            head: {
                observationKey: 'att-after-bench:strength_1rm_kg',
                assessmentAttemptId: 'att-after-bench',
                metricId: 'strength_1rm_kg',
                headRevision: 1,
                createdAt: '2027-02-01T10:00:00.000Z',
                updatedAt: '2027-02-01T10:00:00.000Z',
            },
            revision: {
                observationKey: 'att-after-bench:strength_1rm_kg',
                revision: 1,
                metricId: 'strength_1rm_kg',
                value: 102,
                unit: 'kg',
                protocolRef: { id: 'strength-bench-press-1rm', revision: 1 },
                assessmentAttemptId: 'att-after-bench',
                source: 'manual' as const,
                validity: 'valid' as const,
                observedAt: '2027-02-01T10:00:00.000Z',
                comparisonSeriesKey: 'strength-bench-press-1rm:series-1',
                comparisonCanonicalizationVersion: '1',
                context: {},
                createdAt: '2027-02-01T10:00:00.000Z',
            },
        };
        const surviving = {
            observations: [...base.observations, afterObs],
            attempts: [...(base.attempts ?? []), afterAtt],
        };
        const complete = evaluate({ observationsState: 'measured', ...surviving }, { asOfDate: '2027-07-01' });
        expect(complete.c2.protocols.find(p => p.protocolId === 'strength-bench-press-1rm')?.status).toBe('pass');

        const result = evaluate({
            observationsState: 'invalid',
            unreadableObservationsCount: 1,
            ...surviving,
        }, { asOfDate: '2027-07-01' });

        expect(result.c2.status).toBe('inconclusive');
        expect(result.c2.reasons).toContain('observation_records_incomplete');
        expect(result.overall).toBe('EXTEND');
    });

    it('excludes response completion fractions edited after a date-only as-of cutoff', () => {
        const assignment: PlacementAssignment = { sessionId: 's1', date: '2026-11-28', status: 'planned' };
        const raw: Partial<DEvalRawLedgerData> = {
            planRevisions: [makeRevision([session('s1', '2026-11-28')])],
            placements: [{ planId: 'p1', revision: 1, assignments: [assignment] }],
            placementHistory: [event('2026-11-27', [], [assignment])],
            executions: [makePlanExec('exec-1', '2026-11-28', 'p1', 1, 's1', 'h1', {
                completionEvidence: undefined,
            })],
            performedOccurrences: [makeOccurrence('occ-1', '2026-11-28', 'exec-1')],
            responses: [{
                responseId: 'r1',
                window: 'immediate',
                date: '2026-11-28',
                sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-11-28' },
                completedFraction: 1,
                createdAt: '2026-11-28T11:00:00.000Z',
                updatedAt: '2026-12-01T10:00:00.000Z',
            }],
        };

        expect(outcomesOf(evaluate(raw, { asOfDate: '2026-11-30' }))).toEqual([['p1@1:s1@2026-11-28', 'unknown']]);
        expect(outcomesOf(evaluate(raw, { asOfDate: '2026-12-01' }))).toEqual([['p1@1:s1@2026-11-28', 'completed']]);
    });

    it('does not treat a legacy overlay without placement history as a historical assignment snapshot', () => {
        const moved: PlacementAssignment = { sessionId: 's1', date: '2026-12-11', status: 'moved', movedFrom: '2026-12-02' };
        const result = evaluate({
            planRevisions: [makeRevision([session('s1', '2026-12-02')])],
            placements: [{
                planId: 'p1',
                revision: 1,
                updatedAt: '2026-12-10T10:00:00.000Z',
                assignments: [moved],
            }],
            placementHistory: [],
            executions: [makePlanExec('exec-1', '2026-12-11', 'p1', 1, 's1', 'h1')],
            performedOccurrences: [makeOccurrence('occ-1', '2026-12-11', 'exec-1')],
        });

        expect(outcomesOf(result)).toEqual([['p1@1:s1@2026-12-02', 'unknown']]);
        expect(result.c1.block.moved).toBe(0);
    });

    it('withholds execution completion state and fraction before completedAt while keeping the link', () => {
        const assignment: PlacementAssignment = { sessionId: 's1', date: '2026-11-28', status: 'planned' };
        const raw: Partial<DEvalRawLedgerData> = {
            planRevisions: [makeRevision([session('s1', '2026-11-28')])],
            placements: [{ planId: 'p1', revision: 1, assignments: [assignment] }],
            placementHistory: [event('2026-11-27', [], [assignment])],
            executions: [makePlanExec('exec-1', '2026-11-28', 'p1', 1, 's1', 'h1', {
                startedAt: '2026-11-28T22:30:00.000Z', // 23:30 Warsaw on Nov 28
                completedAt: '2026-11-28T23:30:00.000Z', // 00:30 Warsaw on Nov 29
            })],
            performedOccurrences: [makeOccurrence('occ-1', '2026-11-28', 'exec-1', {
                startedAt: '2026-11-28T22:30:00.000Z',
                endedAt: '2026-11-28T23:30:00.000Z',
            })],
        };

        const beforeMidnight = evaluate(raw, { asOfDate: '2026-11-28' });
        expect(outcomesOf(beforeMidnight)).toEqual([['p1@1:s1@2026-11-28', 'unknown']]);
        expect(beforeMidnight.c1.block.unplanned).toBe(0);

        const beforeCompleteTs = evaluate(raw, { asOfDate: '2026-11-29', asOfTimestamp: '2026-11-28T23:00:00.000Z' });
        expect(outcomesOf(beforeCompleteTs)).toEqual([['p1@1:s1@2026-11-28', 'unknown']]);
        expect(beforeCompleteTs.c1.block.unplanned).toBe(0);

        const afterComplete = evaluate(raw, { asOfDate: '2026-11-29' });
        expect(outcomesOf(afterComplete)).toEqual([['p1@1:s1@2026-11-28', 'completed']]);
    });

    it('keeps the authored due date when a later reset removes a post-due-date move', () => {
        const earlyMove: PlacementAssignment = { sessionId: 's', date: '2026-12-08', status: 'moved', movedFrom: '2026-12-03' };
        const lateMove: PlacementAssignment = { sessionId: 's', date: '2026-12-18', status: 'moved', movedFrom: '2026-12-03' };
        const firstReset: PlacementEvent = {
            ...event('2026-12-01', [], []),
            previousState: 'invalid',
            previousStateReason: 'current-schema-invalid',
        };
        const secondReset: PlacementEvent = {
            ...event('2026-12-06', [], []),
            previousState: 'invalid',
            previousStateReason: 'current-schema-invalid',
        };
        const result = evaluate({
            planRevisions: [makeRevision([session('s', '2026-12-03')])],
            placements: [{ planId: 'p1', revision: 1, assignments: [] }],
            placementHistory: [
                event('2026-11-29', [], [earlyMove]),
                firstReset,
                event('2026-12-05', [], [lateMove]),
                secondReset,
            ],
        });

        expect(outcomesOf(result)).toEqual([['p1@1:s@2026-12-03', 'unknown']]);
    });

    it('retains a superseded predecessor as unknown when its successor revision is unverified', () => {
        const superseded: PlacementAssignment = { sessionId: 'old', date: '2026-12-03', status: 'superseded' };
        const successors = { old: { revision: 2, sessionId: 'new' } };
        const result = evaluate({
            planRevisions: [makeRevision([session('old', '2026-12-03')])],
            planIssues: [{ planId: 'p1', revision: 2, reason: 'unverified_revision' }],
            placements: [{ planId: 'p1', revision: 1, assignments: [superseded], successors }],
            placementHistory: [{ ...event('2026-12-02', [], [superseded]), successors }],
        });

        expect(outcomesOf(result)).toEqual([['p1@1:old@2026-12-03', 'unknown']]);
        expect(result.knownLimits.join(' ')).toContain('p1@2:new');
    });

    it('excludes post-cutoff activity overrides and withholds pre-cutoff overrides edited after cutoff in C3', () => {
        const flagDay = '2026-11-28';
        const flags = makeAllFlags(BLOCK_START, BLOCK_END, date => (date === flagDay ? { illness_anomaly: { active: true } } : {}));
        const occ = makeOccurrence('occ', flagDay, undefined, {
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'g-1' }],
        });
        const activities = [{ activityId: 'g-1', date: flagDay, intensityTag: 'hard' }] as never;

        // Created after Dec 3 cutoff -> ignored; Garmin 'hard' tag applies and C3 window stays open on Dec 1 (still flagged hard).
        const createdAfter = evaluate({
            flagEvaluations: flags,
            performedOccurrences: [occ],
            activities,
            activityOverridesState: 'measured',
            activityOverrides: {
                'g-1': {
                    userId: 'u1',
                    activityId: 'g-1',
                    date: flagDay,
                    originalType: 'cycling',
                    originalIntensityTag: 'hard',
                    overriddenModality: 'Cycling',
                    overriddenIntensity: 'easy',
                    createdAt: '2026-12-05T10:00:00.000Z',
                    updatedAt: '2026-12-05T10:00:00.000Z',
                },
            },
        }, { asOfDate: '2026-12-03' });
        expect(createdAfter.c3.flaggedHardSessions.map(s => s.sessionId)).toEqual(['occ']);

        // Created before cutoff (Nov 28), edited after cutoff (Dec 5) -> historical intensity unknown, not easy and not Garmin.
        const editedAfter = evaluate({
            flagEvaluations: flags,
            performedOccurrences: [occ],
            activities,
            activityOverridesState: 'measured',
            activityOverrides: {
                'g-1': {
                    userId: 'u1',
                    activityId: 'g-1',
                    date: flagDay,
                    originalType: 'cycling',
                    originalIntensityTag: 'hard',
                    overriddenModality: 'Cycling',
                    overriddenIntensity: 'easy',
                    createdAt: '2026-11-28T12:00:00.000Z',
                    updatedAt: '2026-12-05T10:00:00.000Z',
                },
            },
        }, { asOfDate: '2026-12-03' });
        expect(editedAfter.c3.status).toBe('inconclusive');
        expect(editedAfter.c3.incompleteFollowUps).toContain('unknown_intensity:occ');
    });

    it('applies the Warsaw date cutoff to flag captures when asOfTimestamp is absent', () => {
        const flagDay = '2026-11-28';
        const lateFlags = makeAllFlags(BLOCK_START, BLOCK_END, date => (
            date === flagDay
                ? { illness_anomaly: { active: true, evaluatedAt: '2026-11-28T23:30:00.000Z' } }
                : {}
        ));
        const occ = makeOccurrence('occ', flagDay, undefined, {
            sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'g-1' }],
        });
        const activities = [{ activityId: 'g-1', date: flagDay, intensityTag: 'hard' }] as never;

        const onFlagDay = evaluate({
            flagEvaluations: lateFlags,
            performedOccurrences: [occ],
            activities,
        }, { asOfDate: flagDay });
        expect(onFlagDay.c3.flaggedHardSessions).toEqual([]);
        expect(onFlagDay.c3.blindFlagDates).toContain(flagDay);

        const nextDay = evaluate({
            flagEvaluations: lateFlags,
            performedOccurrences: [occ],
            activities,
        }, { asOfDate: '2026-11-29' });
        expect(nextDay.c3.flaggedHardSessions.map(s => s.sessionId)).toEqual(['occ']);
    });

    it('treats a check-in edited after the cutoff as unknown instead of excusing a historical miss', () => {
        const assignment: PlacementAssignment = { sessionId: 's1', date: '2026-11-28', status: 'planned' };
        const editedCheckin = makeCheckin('2026-11-28', {
            redFlags: { present: true, categories: ['neurological'] },
            submittedAt: '2026-11-28T07:00:00.000Z',
            createdAt: '2026-11-28T07:00:00.000Z',
            updatedAt: '2026-12-01T09:00:00.000Z',
        });
        const raw: Partial<DEvalRawLedgerData> = {
            planRevisions: [makeRevision([session('s1', '2026-11-28')])],
            placements: [{ planId: 'p1', revision: 1, assignments: [assignment] }],
            placementHistory: [event('2026-11-27', [], [assignment])],
            checkins: [editedCheckin],
        };

        expect(outcomesOf(evaluate(raw, { asOfDate: '2026-11-30' }))).toEqual([['p1@1:s1@2026-11-28', 'unknown']]);
        expect(outcomesOf(evaluate(raw, { asOfDate: '2026-11-30', asOfTimestamp: '2026-11-30T22:00:00.000Z' })))
            .toEqual([['p1@1:s1@2026-11-28', 'unknown']]);
        expect(outcomesOf(evaluate(raw, { asOfDate: '2026-12-01' }))).toEqual([['p1@1:s1@2026-11-28', 'flag_skip']]);
    });

    it('excludes plan revisions with unparseable importedAt from historical governance', () => {
        const validRev = makeRevision([session('s1', '2026-11-28')], { revision: 1 });
        const unparseableRev = makeRevision([session('s2', '2026-11-28')], {
            revision: 2,
            importedAt: 'not-a-timestamp',
            horizon: { effectiveFrom: '2026-11-25', startDate: BLOCK_START, endDate: BLOCK_END },
        });
        const governingOn = createPlanGovernance([validRev, unparseableRev]);
        expect(governingOn('2026-11-28')?.revision).toBe(1);
    });

    it('makes C4 inconclusive when the engine preference state cannot be verified while preserving missing as off', () => {
        for (const preferencesState of ['unavailable', 'invalid'] as const) {
            const unverified = evaluate({
                preferencesState,
                engineRecommendationsEnabled: null,
            });
            expect(unverified.c4.status).toBe('inconclusive');
            expect(unverified.c4.rollbackState).toBe('unused');
            expect(unverified.c4.reason).toContain('engineRecommendationsEnabled');
            expect(unverified.overall).toBe('EXTEND');

            const safetyOverride = evaluate({
                preferencesState,
                engineRecommendationsEnabled: null,
            }, { rollbackState: 'safety', rollbackReason: 'Safety rollback' });
            expect(safetyOverride.c4.status).toBe('fail');
            expect(safetyOverride.overall).toBe('NO_GO');
        }

        const missingProfile = evaluate({
            preferencesState: 'missing',
            engineRecommendationsEnabled: null,
        });
        expect(missingProfile.c4).toMatchObject({ status: 'pass', rollbackState: 'unused' });
    });

    it('excludes plan revisions imported after asOfTimestamp from C1 governance on the cutoff date', () => {
        const rev1 = makeRevision([session('s1', '2026-11-28')], {
            revision: 1,
            importedAt: '2026-10-25T08:00:00.000Z',
        });
        const rev2 = makeRevision([session('s2', '2026-11-28')], {
            revision: 2,
            contentHash: 'h2',
            importedAt: '2026-11-28T18:00:00.000Z',
            horizon: { effectiveFrom: '2026-11-28', startDate: BLOCK_START, endDate: BLOCK_END },
        });

        expect(createPlanGovernance([rev1, rev2], Date.parse('2026-11-28T10:00:00.000Z'))('2026-11-28')?.revision).toBe(1);
        expect(createPlanGovernance([rev1, rev2], Date.parse('2026-11-28T18:00:00.000Z'))('2026-11-28')?.revision).toBe(2);

        const baseLedger: Partial<DEvalRawLedgerData> = {
            planRevisions: [rev1, rev2],
            placements: [
                { planId: 'p1', revision: 1, assignments: [{ sessionId: 's1', date: '2026-11-28', status: 'completed' }] },
                { planId: 'p1', revision: 2, assignments: [{ sessionId: 's2', date: '2026-11-28', status: 'planned' }] },
            ],
            placementHistory: [
                event('2026-11-27', [], [{ sessionId: 's1', date: '2026-11-28', status: 'completed' }]),
                {
                    ...event('2026-11-28', [], [{ sessionId: 's2', date: '2026-11-28', status: 'planned' }]),
                    revision: 2,
                    recordedAt: '2026-11-28T18:00:00.000Z',
                },
            ],
            executions: [makePlanExec('exec-1', '2026-11-28', 'p1', 1, 's1', 'h1')],
            performedOccurrences: [makeOccurrence('occ-1', '2026-11-28', 'exec-1')],
        };

        const beforeRev2Import = evaluate(baseLedger, {
            asOfDate: '2026-11-28',
            asOfTimestamp: '2026-11-28T10:00:00.000Z',
        });
        expect(outcomesOf(beforeRev2Import)).toEqual([['p1@1:s1@2026-11-28', 'completed']]);

        const atRev2Import = evaluate(baseLedger, {
            asOfDate: '2026-11-28',
            asOfTimestamp: '2026-11-28T18:00:00.000Z',
        });
        expect(outcomesOf(atRev2Import)).toEqual([
            ['p1@1:s1@2026-11-28', 'completed'],
            ['p1@2:s2@2026-11-28', 'unknown'],
        ]);
    });
});
