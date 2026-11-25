import { describe, expect, it } from 'vitest';
import type { PersistedFlagEvaluation } from '../../ledger/flagEvaluation.ts';
import type { PlacementEvent } from '../../ledger/placementHistory.ts';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models.ts';
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import type { HealthAnomalyEpisodeOutcome } from '../flags/illnessAnomaly/healthAnomalyOutcome.ts';
import {
    assembleDEvalBlockInput,
    type DEvalRawExecution,
    type DEvalRawPlanRevision,
    type DEvalRawPlacementOverlay,
} from './dEvalAssembly.ts';
import {
    AS_OF_POST,
    BASELINE_START,
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
import { evaluateDEvalBlock } from './dEvalReadout.ts';

describe('assembleDEvalBlockInput', () => {
    it('assembles a complete 28-day block with OD4 baseline, post-due-date move preservation, and explicit successors', () => {
        const baselineDates = Array.from({ length: 10 }, (_, i) => addDaysToLocalDateString(BASELINE_START, i * 2));
        const blockDates = Array.from({ length: 10 }, (_, i) => addDaysToLocalDateString(BLOCK_START, i * 2));

        const planRevisions: DEvalRawPlanRevision[] = [
            makeRevision([
                ...baselineDates.map((d, i) => ({ id: `b${i}`, authoredDate: d, floating: false, gating: { intensity: 'easy' as const } })),
                ...blockDates.map((d, i) => ({ id: `s${i}`, authoredDate: d, floating: false, gating: { intensity: 'easy' as const } })),
                { id: 's-sup', authoredDate: '2026-12-18', floating: false, gating: { intensity: 'moderate' as const } },
            ]),
            makeRevision(
                [{ id: 's-succ', authoredDate: '2026-12-18', floating: false, gating: { intensity: 'moderate' as const } }],
                {
                    revision: 2,
                    contentHash: 'h2',
                    importedAt: '2026-11-23T08:00:00.000Z',
                    horizon: { effectiveFrom: '2026-12-18', startDate: BASELINE_START, endDate: BLOCK_END },
                },
            ),
        ];

        const baseAssignments = [
            ...baselineDates.map((d, i) => ({ sessionId: `b${i}`, date: d, status: i === 0 ? ('planned' as const) : ('completed' as const) })),
            // s0: due Nov 24, missed on Nov 24, moved AFTER due date on Nov 26 -> must STILL count as missed on Nov 24!
            // s1..s8: completed normally; s9: moved BEFORE due date (on Dec 11) from Dec 12 -> Dec 13 and completed on Dec 13.
            ...blockDates.map((d, i) => ({
                sessionId: `s${i}`,
                date: i === 0 ? '2026-11-27' : i === 9 ? '2026-12-13' : d,
                status: i === 0 || i === 9 ? ('moved' as const) : ('completed' as const),
                ...(i === 0 ? { movedFrom: '2026-11-24' } : {}),
                ...(i === 9 ? { movedFrom: d } : {}),
            })),
            // s-sup: due Dec 18, superseded before due date on Nov 23 by rev 2 s-succ -> skipped in rev 1, counted once in rev 2!
            { sessionId: 's-sup', date: '2026-12-18', status: 'superseded' as const },
        ];

        const placementHistoryRev1: PlacementEvent[] = [
            {
                userId: 'u1',
                planId: 'p1',
                revision: 1,
                changedOn: '2026-11-23',
                recordedAt: '2026-11-23T08:00:00.000Z',
                previous: baseAssignments.map(a =>
                    a.sessionId === 's0' ? { sessionId: 's0', date: '2026-11-24', status: 'planned' as const }
                        : a.sessionId === 's9' ? { sessionId: 's9', date: blockDates[9]!, status: 'planned' as const }
                            : a.sessionId === 's-sup' ? { sessionId: 's-sup', date: '2026-12-18', status: 'planned' as const }
                                : a,
                ),
                assignments: baseAssignments.map(a =>
                    a.sessionId === 's0' ? { sessionId: 's0', date: '2026-11-24', status: 'planned' as const }
                        : a.sessionId === 's9' ? { sessionId: 's9', date: blockDates[9]!, status: 'planned' as const }
                            : a,
                ),
                successors: { 's-sup': { revision: 2, sessionId: 's-succ' } },
            },
            {
                userId: 'u1',
                planId: 'p1',
                revision: 1,
                changedOn: '2026-11-26', // AFTER s0's 2026-11-24 due date!
                recordedAt: '2026-11-26T08:00:00.000Z',
                previous: baseAssignments.map(a =>
                    a.sessionId === 's0' ? { sessionId: 's0', date: '2026-11-24', status: 'planned' as const }
                        : a.sessionId === 's9' ? { sessionId: 's9', date: blockDates[9]!, status: 'planned' as const }
                            : a,
                ),
                assignments: baseAssignments.map(a =>
                    a.sessionId === 's9' ? { sessionId: 's9', date: blockDates[9]!, status: 'planned' as const } : a,
                ),
                successors: { 's-sup': { revision: 2, sessionId: 's-succ' } },
            },
            {
                userId: 'u1',
                planId: 'p1',
                revision: 1,
                changedOn: '2026-12-11', // BEFORE s9's 2026-12-12 due date!
                recordedAt: '2026-12-11T08:00:00.000Z',
                previous: baseAssignments.map(a =>
                    a.sessionId === 's9' ? { sessionId: 's9', date: blockDates[9]!, status: 'planned' as const } : a,
                ),
                assignments: baseAssignments,
                successors: { 's-sup': { revision: 2, sessionId: 's-succ' } },
            },
        ];

        const placementHistoryRev2: PlacementEvent[] = [
            {
                userId: 'u1',
                planId: 'p1',
                revision: 2,
                changedOn: '2026-11-23',
                recordedAt: '2026-11-23T08:00:00.000Z',
                previous: [{ sessionId: 's-succ', date: '2026-12-18', status: 'planned' }],
                assignments: [{ sessionId: 's-succ', date: '2026-12-18', status: 'completed' }],
                successors: {},
            },
        ];

        const placements: DEvalRawPlacementOverlay[] = [
            {
                planId: 'p1',
                revision: 1,
                assignments: baseAssignments,
                successors: { 's-sup': { revision: 2, sessionId: 's-succ' } },
            },
            {
                planId: 'p1',
                revision: 2,
                assignments: [{ sessionId: 's-succ', date: '2026-12-18', status: 'completed' }],
            },
        ];

        const executions: DEvalRawExecution[] = [
            ...baselineDates.slice(1).map((d, idx) => makePlanExec(`exec-b${idx + 1}`, d, 'p1', 1, `b${idx + 1}`, 'h1')),
            ...blockDates.slice(1, 9).map((d, idx) => makePlanExec(`exec-s${idx + 1}`, d, 'p1', 1, `s${idx + 1}`, 'h1')),
            makePlanExec('exec-s9', '2026-12-13', 'p1', 1, 's9', 'h1'),
            makePlanExec('exec-succ', '2026-12-18', 'p1', 2, 's-succ', 'h2'),
        ];

        const performedOccurrences: PerformedTrainingOccurrence[] = [
            ...baselineDates.slice(1).map((d, idx) => makeOccurrence(`occ-b${idx + 1}`, d, `exec-b${idx + 1}`)),
            ...blockDates.slice(1, 9).map((d, idx) => makeOccurrence(`occ-s${idx + 1}`, d, `exec-s${idx + 1}`)),
            makeOccurrence('occ-s9', '2026-12-13', 'exec-s9'),
            makeOccurrence('occ-succ', '2026-12-18', 'exec-succ'),
            makeOccurrence('occ-unplanned', '2026-12-19', undefined),
        ];

        const raw = emptyRaw({
            planRevisions,
            placements,
            placementHistory: [...placementHistoryRev1, ...placementHistoryRev2],
            executions,
            performedOccurrences,
        });

        const input = assembleDEvalBlockInput(raw, {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
            criteriaCommit: 'bfbf94df',
            phase2Commit: 'e7da517e',
        });
        const result = evaluateDEvalBlock(input);

        expect(result.c1.baseline.comparable).toBe(true);
        expect(result.c1.block.planned).toBe(11); // s0..s9 + s-succ (s-sup NOT double-counted!)
        expect(result.c1.block.missed).toBe(1); // s0 preserved as missed on 2026-11-24
        expect(result.c1.block.moved).toBe(1); // s9 moved before due date and completed inside block
        expect(result.c1.block.completed).toBe(9);
        expect(result.c1.block.unplanned).toBe(1);
        expect(result.c1.status).toBe('pass');
        expect(result.c2.status).toBe('pending');
        expect(result.c3.status).toBe('pass');
        expect(result.c4.status).toBe('pass');
        expect(result.overall).toBe('PENDING');
    });

    it('deduplicates same-day flag revisions and drops superseded pre-sync injury failures without hiding later failures', () => {
        const baseFlags = makeAllFlags(BLOCK_START, BLOCK_END);
        // Day 1: 06:00 missing check-in flag, 08:00 measured check-in flag + superseded pre-sync injury failure
        const extraRevs: PersistedFlagEvaluation[] = [
            {
                ...makeFlagsForDate(BLOCK_START)[1]!,
                revisionId: 'flag-early-missing',
                idempotencyKey: 'flag-early-missing',
                evaluatedAt: `${BLOCK_START}T05:00:00.000Z`,
                active: null,
                state: 'missing',
                reasonCode: 'no_checkin',
                inputs: [{ name: 'illness_symptoms', value: { value: null, source: 'daily_subjective_checkin', state: 'missing' } }],
            },
            {
                ...makeFlagsForDate(BLOCK_START)[2]!,
                revisionId: 'flag-early-injury-fail',
                idempotencyKey: 'flag-early-injury-fail',
                evaluatedAt: `${BLOCK_START}T05:00:00.000Z`,
                sessionRef: undefined,
                active: null,
                state: 'unavailable',
                reasonCode: 'source_unavailable',
                inputs: [{ name: 'planned_session_inputs', value: { value: null, source: 'planned_session_inputs', state: 'unavailable' } }],
            },
        ];

        const rawClean = emptyRaw({ flagEvaluations: [...baseFlags, ...extraRevs] });
        const cleanResult = evaluateDEvalBlock(assembleDEvalBlockInput(rawClean, {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        }));
        expect(cleanResult.c3.blindFlagDates).toEqual([]);
        expect(cleanResult.c3.status).toBe('pass');

        // Omit all flags on 3 distinct dates -> OD8 makes C3 inconclusive!
        const missingThreeDays = baseFlags.filter(
            f => !['2026-11-26', '2026-11-27', '2026-11-28'].includes(f.observedOn),
        );
        const blindRes = evaluateDEvalBlock(assembleDEvalBlockInput(emptyRaw({ flagEvaluations: missingThreeDays }), {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        }));
        expect(blindRes.c3.blindFlagDates).toEqual(['2026-11-26', '2026-11-27', '2026-11-28']);
        expect(blindRes.c3.status).toBe('inconclusive');
        expect(blindRes.overall).toBe('EXTEND');
    });

    it('fails closed on unreadable assessment attempts, truncated placement history, and conflicting responses', () => {
        const raw = emptyRaw({
            unreadableAttemptsCount: 1,
            planRevisions: [makeRevision([{ id: 's1', authoredDate: '2026-11-25', floating: false, gating: { intensity: 'easy' } }])],
            placements: [{
                planId: 'p1',
                revision: 1,
                assignments: [{ sessionId: 's1', date: '2026-11-25', status: 'completed' }],
            }],
            planIssues: [{ planId: 'p1', revision: 1, reason: 'history_truncated' }],
            executions: [makePlanExec('exec-1', '2026-11-25', 'p1', 1, 's1', 'h1')],
            performedOccurrences: [makeOccurrence('occ-1', '2026-11-25', 'exec-1')],
            responses: [
                { responseId: 'r1', window: 'immediate', date: '2026-11-25', sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-11-25' }, completedFraction: 1 },
                { responseId: 'r2', window: 'later_day', date: '2026-11-25', sourceSession: { kind: 'execution', id: 'exec-1', date: '2026-11-25' }, completedFraction: 0.5 },
            ],
        });

        const result = evaluateDEvalBlock(assembleDEvalBlockInput(raw, {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST,
            rollbackState: 'unused',
        }));

        expect(result.c1.block.unknown).toBe(1);
        expect(result.c2.status).toBe('inconclusive');
        expect(result.c2.reasons).toContain('attempt_records_unavailable');
    });

    it('detects C3 adverse outcomes on flagged hard sessions (planned or unplanned via Garmin/override) and enforces mid-block dry-run bounds', () => {
        const flags = makeAllFlags(BLOCK_START, BLOCK_END, date => (
            date === '2026-11-28'
                ? { illness_anomaly: { active: true, state: 'measured', reasonCode: 'possible_illness_or_systemic_stress' } }
                : {}
        ));
        const outcome: HealthAnomalyEpisodeOutcome = {
            userId: 'u1',
            episodeId: 'health-anomaly:2026-11-28',
            sourceAssessment: { date: '2026-11-28', revisionId: 'ha-1' },
            explanation: 'illness_symptoms',
            symptomOnset: null,
            respiratoryTest: null,
            note: null,
            createdAt: '2026-11-29T12:00:00.000Z',
            updatedAt: '2026-11-29T12:00:00.000Z',
            schemaVersion: 1,
        };
        const raw = emptyRaw({
            flagEvaluations: flags,
            performedOccurrences: [
                makeOccurrence('occ-hard', '2026-11-28', undefined, {
                    sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'g-1' }],
                }),
            ],
            activityOverrides: {
                'g-1': {
                    userId: 'u1',
                    activityId: 'g-1',
                    date: '2026-11-28',
                    originalType: 'cycling',
                    originalIntensityTag: 'moderate',
                    overriddenModality: 'Cycling',
                    overriddenIntensity: 'hard',
                    createdAt: '2026-11-28T12:00:00.000Z',
                    updatedAt: '2026-11-28T12:00:00.000Z',
                },
            },
            checkins: [makeCheckin('2026-11-28')],
            healthAnomalyOutcomes: [outcome],
            engineRecommendationsEnabled: true,
        });

        // Mid-block dry run on 2026-12-03: future sessions ignored, adverse flagged-day triggers NO_GO, engine warning logged!
        const input = assembleDEvalBlockInput(raw, {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2026-12-03',
            rollbackState: 'unused',
        });
        const result = evaluateDEvalBlock(input);

        expect(result.c3.status).toBe('fail');
        expect(result.overall).toBe('NO_GO');
        expect(result.knownLimits.some(line => line.includes('engineRecommendationsEnabled'))).toBe(true);
        expect(result.knownLimits.some(line => line.includes('Dry-run readout'))).toBe(true);
    });
});
