import { describe, expect, it } from 'vitest';
import { deriveTissueSeverity as engineDeriveTissueSeverity } from '../../engine/injuryPolicy';
import {
    TISSUE_LEVELS,
    type DailySubjectiveCheckin,
    type RegionTissueResponse,
    type TissueResponseLevel,
} from '../../ledger/models';
import type {
    AssessmentAttempt,
    MetricObservationHead,
    MetricObservationRevision,
} from '../../observations/models';
import { PHYSICAL_CAPITAL_PROTOCOL_REVISIONS } from '../../observations/physicalCapitalProtocols';
import type { CurrentObservation } from '../../observations/progress';
import { assertValidReliabilityEstimate } from '../../observations/reliability';
import type { HealthAnomalyEpisodeOutcome } from '../flags/illnessAnomaly/healthAnomalyOutcome';
import type { DEvalC1PlannedSessionInput } from './dEvalC1';
import {
    DEVAL_ABSOLUTE_ADHERENCE_FLOOR,
    DEVAL_ADHERENCE_TOLERANCE,
    DEVAL_ADVERSE_WINDOW_HOURS,
    DEVAL_GOAL_BOUND_PROTOCOLS,
    DEVAL_MAX_BLIND_FLAG_DATES_EXCLUSIVE,
    DEVAL_MAX_BLOCK_UNKNOWN_RATIO,
    DEVAL_MIN_BASELINE_DETERMINABLE_RATIO,
    DEVAL_MIN_BLOCK_DAYS,
    DEVAL_MIN_ELIGIBLE_SESSIONS,
    DEVAL_PARTIAL_WEIGHT,
    parseUtcTimestampMs,
} from './dEvalCriteria';
import {
    deriveTissueSeverity,
    evaluateC1Adherence,
    evaluateC2Benchmarks,
    evaluateC3FlaggedOutcomes,
    evaluateC4Rollback,
    evaluateDEvalBlock,
    renderDEvalResultMarkdown,
} from './dEvalReadout';

const BLOCK_START = '2026-11-23';
const BLOCK_END = '2026-12-20';
const AS_OF_POST_BLOCK = '2026-12-24';

function plannedSession(
    index: number,
    overrides: Partial<DEvalC1PlannedSessionInput> = {},
): DEvalC1PlannedSessionInput {
    const day = String(1 + (index % 28)).padStart(2, '0');
    const assignedDate = index < 8 ? `2026-11-${23 + index}` : `2026-12-${day}`;
    return {
        sessionKey: `sess-${index}`,
        assignedDate,
        asOfDate: AS_OF_POST_BLOCK,
        blockStartDate: BLOCK_START,
        blockEndDate: BLOCK_END,
        status: 'planned',
        evidenceComplete: true,
        linked: true,
        unverifiedEvidence: false,
        executions: [],
        performedOccurrenceId: `occ-${index}`,
        performedDate: assignedDate,
        linkedExecution: { state: 'completed', executedDefinition: 'authored', completedFraction: 1 },
        responseCompletedFraction: null,
        activeFlagOnAssignedDate: false,
        redFlagOnAssignedDate: false,
        ...overrides,
    };
}

function makeObservation(params: {
    observationKey: string;
    protocolId: string;
    protocolRevision?: number;
    metricId: string;
    value: number;
    unit: string;
    observedAt: string;
    seriesKey?: string;
    attemptId?: string;
    validity?: MetricObservationRevision['validity'];
}): CurrentObservation {
    const revision: MetricObservationRevision = {
        observationKey: params.observationKey,
        revision: 1,
        metricId: params.metricId,
        value: params.value,
        unit: params.unit,
        observedAt: params.observedAt,
        source: 'manual',
        protocolRef: {
            id: params.protocolId,
            revision: params.protocolRevision ?? 2,
        },
        comparisonSeriesKey: params.seriesKey ?? `${params.protocolId}:series-1`,
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: params.attemptId ?? `attempt-${params.observationKey}`,
        validity: params.validity ?? 'valid',
        context: {},
        createdAt: params.observedAt,
    };
    const head: MetricObservationHead = {
        observationKey: revision.observationKey,
        assessmentAttemptId: revision.assessmentAttemptId,
        metricId: revision.metricId,
        headRevision: revision.revision,
        createdAt: revision.createdAt,
        updatedAt: revision.createdAt,
    };
    return { head, revision };
}

function makeProtocolBaselineAndAfter(
    afterValueOverrides: Partial<Record<string, number>> = {},
    options: { afterDate?: string; includeAfter?: boolean } = {},
): CurrentObservation[] {
    const unitByMetric: Record<string, string> = {
        strength_1rm_kg: 'kg',
        standing_broad_jump_distance_cm: 'cm',
        wall_touch_cmj_height_cm: 'cm',
        seated_medball_throw_distance_m: 'm',
        cycling_sprint_1s_peak_power_w: 'W',
        cycling_sprint_5s_mean_power_w: 'W',
    };
    const baselineValueByMetric: Record<string, number> = {
        strength_1rm_kg: 120,
        standing_broad_jump_distance_cm: 240,
        wall_touch_cmj_height_cm: 55,
        seated_medball_throw_distance_m: 6.2,
        cycling_sprint_1s_peak_power_w: 1100,
        cycling_sprint_5s_mean_power_w: 980,
    };

    const list: CurrentObservation[] = [];
    for (const protocol of DEVAL_GOAL_BOUND_PROTOCOLS) {
        for (const metricId of protocol.metricIds) {
            const baseVal = baselineValueByMetric[metricId]!;
            const unit = unitByMetric[metricId]!;
            list.push(makeObservation({
                observationKey: `before:${protocol.protocolId}:${metricId}`,
                protocolId: protocol.protocolId,
                metricId,
                value: baseVal,
                unit,
                observedAt: '2026-10-22T09:00:00Z',
            }));
            if (options.includeAfter !== false) {
                const afterDate = options.afterDate ?? '2027-01-15';
                const afterVal = afterValueOverrides[`${protocol.protocolId}:${metricId}`] ?? baseVal;
                list.push(makeObservation({
                    observationKey: `after:${protocol.protocolId}:${metricId}`,
                    protocolId: protocol.protocolId,
                    metricId,
                    value: afterVal,
                    unit,
                    observedAt: `${afterDate}T09:00:00Z`,
                }));
            }
        }
    }
    return list;
}

function makeCheckin(date: string, overrides: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date,
        readiness: 7,
        sleepQuality: 7,
        fatigue: 4,
        soreness: 4,
        mentalStress: 3,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        unusuallyLimitedTime: false,
        alreadyTrainedToday: false,
        availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
        notes: null,
        submittedAt: `${date}T06:00:00Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        schemaVersion: 1,
        createdAt: `${date}T06:00:00Z`,
        updatedAt: `${date}T06:00:00Z`,
        ...overrides,
    };
}

function makeOutcome(overrides: Partial<HealthAnomalyEpisodeOutcome> = {}): HealthAnomalyEpisodeOutcome {
    return {
        userId: 'u1',
        episodeId: 'ep-1',
        sourceAssessment: { date: '2026-12-01', revisionId: 'ha-0123456789abcdef' },
        explanation: 'illness_symptoms',
        symptomOnset: null,
        respiratoryTest: null,
        note: null,
        createdAt: '2026-12-02T08:00:00Z',
        updatedAt: '2026-12-02T08:00:00Z',
        schemaVersion: 1,
        ...overrides,
    };
}

describe('dEvalCriteria constants and OD10 goal-bound battery', () => {
    it('freezes all owner-approved OD constants', () => {
        expect(DEVAL_MIN_BLOCK_DAYS).toBe(28);
        expect(DEVAL_PARTIAL_WEIGHT).toBe(0.5);
        expect(DEVAL_ADVERSE_WINDOW_HOURS).toBe(72);
        expect(DEVAL_MIN_ELIGIBLE_SESSIONS).toBe(8);
        expect(DEVAL_MIN_BASELINE_DETERMINABLE_RATIO).toBe(0.9);
        expect(DEVAL_MAX_BLOCK_UNKNOWN_RATIO).toBe(0.1);
        expect(DEVAL_ABSOLUTE_ADHERENCE_FLOOR).toBe(0.75);
        expect(DEVAL_ADHERENCE_TOLERANCE).toBe(0.05);
        expect(DEVAL_MAX_BLIND_FLAG_DATES_EXCLUSIVE).toBe(3);
    });

    it('declares the exact 6 OD10 goal-bound protocols matching physicalCapitalProtocols and valid reliability', () => {
        expect(DEVAL_GOAL_BOUND_PROTOCOLS.map(p => p.protocolId)).toEqual([
            'strength-back-squat-1rm',
            'strength-bench-press-1rm',
            'field-standing-broad-jump',
            'field-wall-touch-cmj',
            'field-seated-medball-chest-throw-3kg',
            'cycling-6s-seated-sprint',
        ]);
        for (const spec of DEVAL_GOAL_BOUND_PROTOCOLS) {
            const matchingRevisions = PHYSICAL_CAPITAL_PROTOCOL_REVISIONS.filter(p => p.id === spec.protocolId);
            expect(matchingRevisions.length).toBeGreaterThan(0);
            for (const rev of matchingRevisions) {
                expect(spec.metricIds).toEqual(rev.metricIds);
            }
            expect(spec.reliability).not.toBeNull();
            assertValidReliabilityEstimate(spec.reliability!);
        }
        // Fixed-load velocity protocols are deliberately non-goal-bound.
        const ids = new Set(DEVAL_GOAL_BOUND_PROTOCOLS.map(p => p.protocolId));
        expect(ids.has('strength-back-squat-fixed-load-velocity')).toBe(false);
        expect(ids.has('strength-bench-press-fixed-load-velocity')).toBe(false);
    });

    it('parseUtcTimestampMs accepts Z and numeric offsets while rejecting offset-less ISO timestamps', () => {
        expect(parseUtcTimestampMs('2026-12-01T10:00:00Z')).toBe(Date.parse('2026-12-01T10:00:00Z'));
        expect(parseUtcTimestampMs('2026-12-01T11:00:00+01:00')).toBe(Date.parse('2026-12-01T10:00:00Z'));
        expect(parseUtcTimestampMs('2026-12-01T10:00:00')).toBeNull();
        expect(parseUtcTimestampMs('2026-12-01')).toBeNull();
    });
});

describe('evaluateC1Adherence', () => {
    it('deduplicates performedOccurrenceId across assignments and tracks reduced breakdowns separately', () => {
        const sessions: DEvalC1PlannedSessionInput[] = [
            // 6 completed
            ...Array.from({ length: 6 }, (_, i) => plannedSession(i)),
            // 1 moved
            plannedSession(6, { status: 'moved', assignedDate: '2026-12-03', performedDate: '2026-12-05' }),
            // 2 partial (one via fraction 0.6, one via abandoned execution)
            plannedSession(7, { linkedExecution: { state: 'completed', completedFraction: 0.6 } }),
            plannedSession(8, { linkedExecution: { state: 'abandoned' } }),
            // 1 missed
            plannedSession(9, { linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null }),
            // 4 reduced (1 completed, 1 partial, 1 abandoned, 1 unknown fraction)
            plannedSession(10, { linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: 1 } }),
            plannedSession(11, { linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: 0.5 } }),
            plannedSession(12, { linkedExecution: { state: 'abandoned', executedDefinition: 'reduced' } }),
            plannedSession(13, { linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: null } }),
            // 1 flag_skip
            plannedSession(14, { linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null, activeFlagOnAssignedDate: true }),
            // 1 duplicate claim referencing occ-0 -> becomes unknown!
            plannedSession(15, { performedOccurrenceId: 'occ-0' }),
        ];

        const result = evaluateC1Adherence({ block: { plannedSessions: sessions, unplannedCount: 3 } });
        expect(result.block.planned).toBe(16);
        expect(result.block.completed).toBe(6);
        expect(result.block.moved).toBe(1);
        expect(result.block.partial).toBe(2);
        expect(result.block.reduced).toBe(4);
        expect(result.block.reducedCompleted).toBe(1);
        expect(result.block.reducedPartial).toBe(1);
        expect(result.block.reducedAbandoned).toBe(1);
        expect(result.block.reducedUnknown).toBe(1);
        expect(result.block.reducedShare).toBeCloseTo(4 / 16);
        expect(result.block.flag_skip).toBe(1);
        expect(result.block.missed).toBe(1);
        expect(result.block.unknown).toBe(1);
        expect(result.block.unplanned).toBe(3);
        expect(result.block.duplicateOccurrenceIds).toEqual(['occ-0']);
        // eligible = 16 - 4 - 1 - 1 = 10; numerator = 6 + 1 + 0.5 * 2 = 8 -> 0.80 >= 0.75
        expect(result.block.eligible).toBe(10);
        expect(result.block.adherenceRate).toBeCloseTo(0.8);
        expect(result.threshold).toBe(0.75);
        expect(result.thresholdSource).toBe('absolute_floor');
        expect(result.status).toBe('pass');
    });

    it('uses baseline - 5pp when OD4 holds (handles IEEE-754 0.8 - 0.05 boundary cleanly) and falls back to 75% otherwise', () => {
        // Comparable baseline: 8 completed, 2 missed -> 80% adherence, 10 eligible, 100% determinable
        const baselineSessions = [
            ...Array.from({ length: 8 }, (_, i) => plannedSession(i)),
            ...Array.from({ length: 2 }, (_, i) => plannedSession(8 + i, {
                linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null,
            })),
        ];
        // Block: 9 completed, 3 missed -> 75% adherence (exact 0.8 - 0.05 = 0.75 boundary!)
        const blockSessions = [
            ...Array.from({ length: 9 }, (_, i) => plannedSession(i)),
            ...Array.from({ length: 3 }, (_, i) => plannedSession(9 + i, {
                linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null,
            })),
        ];
        const passRes = evaluateC1Adherence({
            block: { plannedSessions: blockSessions },
            baseline: { plannedSessions: baselineSessions },
        });
        expect(passRes.baseline.comparable).toBe(true);
        expect(passRes.thresholdSource).toBe('baseline_minus_tolerance');
        expect(passRes.threshold).toBeCloseTo(0.75);
        expect(passRes.status).toBe('pass');
        expect(passRes.knownLimits.some(line => line.includes('loop vs loop'))).toBe(true);

        // Non-comparable baseline: 2 of 10 unknown (80% determinable < 90% OD4) -> falls back to 75%
        const nonCompBaseline = [
            ...Array.from({ length: 8 }, (_, i) => plannedSession(i)),
            ...Array.from({ length: 2 }, (_, i) => plannedSession(8 + i, { evidenceComplete: false })),
        ];
        const fallbackRes = evaluateC1Adherence({
            block: { plannedSessions: blockSessions },
            baseline: { plannedSessions: nonCompBaseline },
        });
        expect(fallbackRes.baseline.comparable).toBe(false);
        expect(fallbackRes.thresholdSource).toBe('absolute_floor');
        expect(fallbackRes.threshold).toBe(0.75);
        expect(fallbackRes.status).toBe('pass');
    });

    it('returns inconclusive when eligible < 8 or unknown > 10%, and fail when below threshold', () => {
        // 6 completed, 2 reduced, 2 flag_skip -> 100% adherence but only 6 eligible -> inconclusive!
        const fewEligible = [
            ...Array.from({ length: 6 }, (_, i) => plannedSession(i)),
            plannedSession(6, { linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: 1 } }),
            plannedSession(7, { linkedExecution: { state: 'completed', executedDefinition: 'reduced', completedFraction: 1 } }),
            plannedSession(8, { linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null, activeFlagOnAssignedDate: true }),
            plannedSession(9, { linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null, activeFlagOnAssignedDate: true }),
        ];
        const incFew = evaluateC1Adherence({ block: { plannedSessions: fewEligible } });
        expect(incFew.block.eligible).toBe(6);
        expect(incFew.status).toBe('inconclusive');
        expect(incFew.reasons).toContain('fewer_than_8_eligible_sessions');

        // 9 completed, 2 unknown -> unknown 2/11 > 10% -> inconclusive!
        const highUnknown = [
            ...Array.from({ length: 9 }, (_, i) => plannedSession(i)),
            plannedSession(9, { evidenceComplete: false }),
            plannedSession(10, { evidenceComplete: false }),
        ];
        const incUnknown = evaluateC1Adherence({ block: { plannedSessions: highUnknown } });
        expect(incUnknown.status).toBe('inconclusive');
        expect(incUnknown.reasons).toContain('unknown_exceeds_10_percent');

        // 7 completed, 3 missed -> 70% < 75% -> fail!
        const belowFloor = [
            ...Array.from({ length: 7 }, (_, i) => plannedSession(i)),
            ...Array.from({ length: 3 }, (_, i) => plannedSession(7 + i, {
                linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null,
            })),
        ];
        const failRes = evaluateC1Adherence({ block: { plannedSessions: belowFloor } });
        expect(failRes.status).toBe('fail');
    });
});

describe('evaluateC2Benchmarks', () => {
    it('passes when all 6 goal-bound protocols remain within or above noise bounds', () => {
        const result = evaluateC2Benchmarks({
            observations: makeProtocolBaselineAndAfter(),
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
        });
        expect(result.status).toBe('pass');
        expect(result.protocols).toHaveLength(6);
        expect(result.pendingDueDates).toEqual([]);
    });

    it('prefers personal repeatability over literature CV when provided for a series', () => {
        const obs = makeProtocolBaselineAndAfter({ 'field-standing-broad-jump:standing_broad_jump_distance_cm': 234 });
        // 234 vs 240 is -2.5%: within 3.8% literature CV -> pass, but exceeds 2.0% personal CV -> fail!
        const litResult = evaluateC2Benchmarks({
            observations: obs,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
        });
        expect(litResult.status).toBe('pass');

        const personalResult = evaluateC2Benchmarks({
            observations: obs,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            reliabilityEstimates: [{
                comparisonSeriesKey: 'field-standing-broad-jump:series-1',
                estimate: { source: 'personal_repeatability', statistic: 'cv_pct', value: 2.0 },
            }],
        });
        expect(personalResult.status).toBe('fail');
    });

    it('treats missing after-attempt as pending before dueDate and inconclusive after dueDate, and beats pending on any fail', () => {
        const onlyBefore = makeProtocolBaselineAndAfter({}, { includeAfter: false });
        const pendingRes = evaluateC2Benchmarks({
            observations: onlyBefore,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-03-20', // <= 90d dueDate 2027-03-20!
        });
        expect(pendingRes.status).toBe('pending');
        expect(pendingRes.pendingDueDates).toEqual(['2027-03-20', '2027-06-18']);

        const overdue90d = evaluateC2Benchmarks({
            observations: onlyBefore,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-03-21', // 1 day past 90d dueDate!
        });
        expect(overdue90d.status).toBe('inconclusive');

        // Observed decline > noise beats pending / inconclusive per §4!
        const declinePlusPending = [
            ...onlyBefore,
            makeObservation({
                observationKey: 'after-decline',
                protocolId: 'strength-back-squat-1rm',
                metricId: 'strength_1rm_kg',
                value: 110, // -8.33% > 4.2% CV
                unit: 'kg',
                observedAt: '2027-01-15T09:00:00Z',
            }),
        ];
        const failBeatsPending = evaluateC2Benchmarks({
            observations: declinePlusPending,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
        });
        expect(failBeatsPending.status).toBe('fail');
    });

    it('handles non-comparable series/revision changes, rollback timing, attempt state filtering, and zero protocols', () => {
        // Non-comparable after (protocol revision changed from 2 to 3) -> pending until dueDate, inconclusive after
        const revChangedObs = makeProtocolBaselineAndAfter({}, { includeAfter: false });
        revChangedObs.push(makeObservation({
            observationKey: 'after-rev-3',
            protocolId: 'field-standing-broad-jump',
            protocolRevision: 3,
            metricId: 'standing_broad_jump_distance_cm',
            value: 250,
            unit: 'cm',
            observedAt: '2027-01-15T09:00:00Z',
        }));
        const pendingRev = evaluateC2Benchmarks({
            observations: revChangedObs,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            protocols: DEVAL_GOAL_BOUND_PROTOCOLS.filter(p => p.protocolId === 'field-standing-broad-jump'),
        });
        expect(pendingRev.status).toBe('pending');
        expect(pendingRev.protocols[0]?.metrics[0]?.nonComparableAttemptsObserved).toBe(true);

        // Rollback between blockEndDate and afterDate -> inconclusive (even if improvement)
        const rollbackBeforeAfter = evaluateC2Benchmarks({
            observations: makeProtocolBaselineAndAfter(),
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            rollbackBeforeAfterAttempt: true,
            rollbackAtDate: '2027-01-05',
        });
        expect(rollbackBeforeAfter.status).toBe('inconclusive');

        // Rollback strictly AFTER an already-completed after-attempt -> passes!
        const rollbackAfterCleanTest = evaluateC2Benchmarks({
            observations: makeProtocolBaselineAndAfter({}, { afterDate: '2027-01-10' }),
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            rollbackBeforeAfterAttempt: true,
            rollbackAtDate: '2027-01-12',
        });
        expect(rollbackAfterCleanTest.status).toBe('pass');

        // Abandoned attempt excluded when attemptRecords is provided
        const obsSingle = makeProtocolBaselineAndAfter({}, { afterDate: '2027-01-10' }).filter(
            o => o.revision.protocolRef.id === 'field-wall-touch-cmj',
        );
        const attempts: AssessmentAttempt[] = [
            { id: 'attempt-before:field-wall-touch-cmj:wall_touch_cmj_height_cm', protocolRef: { id: 'field-wall-touch-cmj', revision: 2 }, state: 'completed', purpose: 'baseline' },
            { id: 'attempt-after:field-wall-touch-cmj:wall_touch_cmj_height_cm', protocolRef: { id: 'field-wall-touch-cmj', revision: 2 }, state: 'abandoned', purpose: 'post_block' },
        ];
        const abandonedRes = evaluateC2Benchmarks({
            observations: obsSingle,
            attemptRecords: attempts,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-04-01',
            protocols: DEVAL_GOAL_BOUND_PROTOCOLS.filter(p => p.protocolId === 'field-wall-touch-cmj'),
        });
        expect(abandonedRes.status).toBe('inconclusive');

        // Zero protocols declared -> inconclusive
        expect(evaluateC2Benchmarks({
            observations: [],
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST_BLOCK,
            protocols: [],
        }).status).toBe('inconclusive');

        // Custom protocol with reliability: null and zero directional change -> inconclusive with no_stated_noise
        const noNoiseObs = makeProtocolBaselineAndAfter({}, { afterDate: '2027-01-10' }).filter(
            o => o.revision.protocolRef.id === 'field-wall-touch-cmj',
        );
        const noNoiseRes = evaluateC2Benchmarks({
            observations: noNoiseObs,
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
            protocols: [{
                protocolId: 'field-wall-touch-cmj',
                retestIntervalDays: 90,
                metricIds: ['wall_touch_cmj_height_cm'],
                reliability: null,
            }],
        });
        expect(noNoiseRes.status).toBe('inconclusive');
        expect(noNoiseRes.protocols[0]?.metrics[0]?.comparability).toBe('no_stated_noise');
    });
});

describe('evaluateC3FlaggedOutcomes and deriveTissueSeverity parity', () => {
    it('matches engine/injuryPolicy.ts deriveTissueSeverity across every tissue-level combination', () => {
        const optionalLevels: (TissueResponseLevel | undefined)[] = [undefined, ...TISSUE_LEVELS];
        for (const morningState of TISSUE_LEVELS) {
            for (const painDuringTraining of optionalLevels) {
                for (const afterTrainingState of optionalLevels) {
                    for (const nextMorningReaction of optionalLevels) {
                        const response: RegionTissueResponse = {
                            region: 'knee',
                            morningState,
                            ...(painDuringTraining ? { painDuringTraining } : {}),
                            ...(afterTrainingState ? { afterTrainingState } : {}),
                            ...(nextMorningReaction ? { nextMorningReaction } : {}),
                        };
                        expect(deriveTissueSeverity(response)).toBe(engineDeriveTissueSeverity(response));
                    }
                }
            }
        }
    });

    it('counts distinct blind flag dates across D-FLAGS including illness_anomaly (OD8/OD9)', () => {
        const twoBlind = evaluateC3FlaggedOutcomes({
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST_BLOCK,
            flags: [
                { id: 'illness_anomaly', observedOn: '2026-11-24', active: null, state: 'missing' },
                { id: 'recovery_beyond_baseline', observedOn: '2026-11-24', active: null, state: 'unavailable' },
                { id: 'illness_risk_symptom', observedOn: '2026-11-25', active: null, state: 'invalid' },
                // Outside block: must not count!
                { id: 'illness_anomaly', observedOn: '2026-11-22', active: null, state: 'missing' },
            ],
            performedSessions: [],
        });
        expect(twoBlind.blindFlagDates).toEqual(['2026-11-24', '2026-11-25']);
        expect(twoBlind.status).toBe('pass');

        const threeBlind = evaluateC3FlaggedOutcomes({
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST_BLOCK,
            flags: [
                { id: 'illness_anomaly', observedOn: '2026-11-24', active: null, state: 'missing' },
                { id: 'recovery_beyond_baseline', observedOn: '2026-11-25', active: null, state: 'unavailable' },
                { id: 'illness_risk_symptom', observedOn: '2026-11-26', active: null, state: 'missing' },
            ],
            performedSessions: [],
        });
        expect(threeBlind.blindFlagDates).toHaveLength(3);
        expect(threeBlind.status).toBe('inconclusive');

        // Stale / not_recorded flags with active: null and stale input leaves count toward OD8,
        // while healthy measured allergy_like_symptom_day: { state: 'not_recorded' } does NOT count.
        const staleAndNotRecordedBlind = evaluateC3FlaggedOutcomes({
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: AS_OF_POST_BLOCK,
            flags: [
                { id: 'illness_anomaly', observedOn: '2026-11-24', active: null, state: 'not_recorded' },
                { id: 'recovery_beyond_baseline', observedOn: '2026-11-25', active: null, state: 'stale' },
                {
                    id: 'recovery_beyond_baseline',
                    observedOn: '2026-11-26',
                    active: false,
                    state: 'measured',
                    inputs: [{ name: 'hrv', value: { state: 'stale' } }],
                },
                {
                    id: 'illness_risk_symptom',
                    observedOn: '2026-11-27',
                    active: false,
                    state: 'measured',
                    inputs: [{ name: 'allergy_like_symptom_day', value: { state: 'not_recorded' } }],
                },
            ],
            performedSessions: [],
        });
        expect(staleAndNotRecordedBlind.blindFlagDates).toEqual(['2026-11-24', '2026-11-25', '2026-11-26']);
        expect(staleAndNotRecordedBlind.status).toBe('inconclusive');
    });

    it('checks 72h elapsed timestamps and detects adverse check-ins, new injuries, and illness outcomes', () => {
        const sessionAt = '2026-12-01T10:00:00Z';
        const baseC3 = {
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2026-12-05',
            asOfTimestamp: '2026-12-05T12:00:00Z',
            flags: [{ id: 'illness_anomaly' as const, observedOn: '2026-12-01', active: true, state: 'measured' as const }],
            performedSessions: [{
                sessionId: 's-hard',
                performedDate: '2026-12-01',
                performedAt: sessionAt,
                performedIntensity: 'hard' as const,
            }],
        };

        // Reduced session using easy intensity on flagged day -> not a flagged hard session!
        const reducedEasy = evaluateC3FlaggedOutcomes({
            ...baseC3,
            performedSessions: [{
                sessionId: 's-reduced',
                performedDate: '2026-12-01',
                performedAt: sessionAt,
                executedDefinition: 'reduced',
                authoredIntensity: 'hard',
                reducedIntensity: 'easy',
            }],
            checkins: [makeCheckin('2026-12-02', { illnessSymptoms: true, submittedAt: '2026-12-02T07:00:00Z' })],
        });
        expect(reducedEasy.flaggedHardSessions).toHaveLength(0);
        expect(reducedEasy.status).toBe('pass');

        // Morning check-in BEFORE session and check-in at +72h01s AFTER session -> outside 72h -> pass!
        const outside72h = evaluateC3FlaggedOutcomes({
            ...baseC3,
            checkins: [
                makeCheckin('2026-12-01', { illnessSymptoms: true, submittedAt: '2026-12-01T09:59:59Z' }),
                makeCheckin('2026-12-04', { painOrInjury: true, submittedAt: '2026-12-04T10:00:01Z' }),
            ],
            injuries: [{ severity: 'limit', region: 'knee' }], // legacy unknown onset stays unattributed!
        });
        expect(outside72h.status).toBe('pass');
        expect(outside72h.knownLimits.some(line => line.includes('Legacy injury'))).toBe(true);

        // Escalated tissue response at exact +72h boundary -> fail!
        const tissueFail = evaluateC3FlaggedOutcomes({
            ...baseC3,
            checkins: [makeCheckin('2026-12-04', {
                submittedAt: '2026-12-04T10:00:00Z',
                tissueResponses: {
                    achilles: { region: 'achilles', morningState: 'moderate' },
                },
            })],
        });
        expect(tissueFail.status).toBe('fail');
        expect(tissueFail.adverseOutcomes[0]?.reason).toBe('tissueResponses');

        // Red flag check-in with explicit categories -> fail!
        const redFlagFail = evaluateC3FlaggedOutcomes({
            ...baseC3,
            checkins: [makeCheckin('2026-12-02', {
                submittedAt: '2026-12-02T08:00:00Z',
                redFlags: { present: true, categories: ['systemic_infection'] },
            })],
        });
        expect(redFlagFail.status).toBe('fail');

        // Red flag check-in with present: true and omitted/empty categories -> still fail via hasRecordedRedFlag!
        const redFlagOmittedCat = evaluateC3FlaggedOutcomes({
            ...baseC3,
            checkins: [makeCheckin('2026-12-02', {
                submittedAt: '2026-12-02T08:00:00Z',
                redFlags: { present: true },
            })],
        });
        expect(redFlagOmittedCat.status).toBe('fail');
        expect(redFlagOmittedCat.adverseOutcomes[0]?.reason).toBe('redFlags');

        // Same-day date-only injury constraint -> fail and disclose same-day ordering limit in knownLimits!
        const sameDayInjuryFail = evaluateC3FlaggedOutcomes({
            ...baseC3,
            injuries: [{ id: 'inj-same-day', region: 'ankle', severity: 'limit', since: '2026-12-01' }],
        });
        expect(sameDayInjuryFail.status).toBe('fail');
        expect(sameDayInjuryFail.knownLimits.some(line => line.includes('Same-day') || line.includes('same-day'))).toBe(true);

        // New injury constraint with recorded `since` -> fail!
        const newInjuryFail = evaluateC3FlaggedOutcomes({
            ...baseC3,
            injuries: [{ id: 'inj-1', region: 'calf', severity: 'limit', since: '2026-12-02' }],
        });
        expect(newInjuryFail.status).toBe('fail');
        expect(newInjuryFail.adverseOutcomes[0]?.source).toBe('injury_constraint');

        // HealthAnomalyEpisodeOutcome with positive test / illness_symptoms -> fail!
        const anomalyIllnessFail = evaluateC3FlaggedOutcomes({
            ...baseC3,
            healthAnomalyOutcomes: [makeOutcome({
                explanation: 'other_not_sure',
                respiratoryTest: { result: 'positive', testedOn: '2026-12-03', source: 'user_reported' },
                updatedAt: '2026-12-03T11:00:00Z',
            })],
        });
        expect(anomalyIllnessFail.status).toBe('fail');
        expect(anomalyIllnessFail.adverseOutcomes[0]?.source).toBe('health_anomaly_outcome');

        // Date-only conservative 3-day fallback when performedAt is omitted -> records knownLimit
        const dateFallbackFail = evaluateC3FlaggedOutcomes({
            ...baseC3,
            performedSessions: [{
                sessionId: 's-hard-notime',
                performedDate: '2026-12-01',
                performedIntensity: 'max',
            }],
            checkins: [makeCheckin('2026-12-04', { painOrInjury: true, submittedAt: '' })],
        });
        expect(dateFallbackFail.status).toBe('fail');
        expect(dateFallbackFail.knownLimits.some(line => line.includes('next 3 Warsaw calendar dates'))).toBe(true);

        // Open 72h window -> inconclusive, unless adverse outcome already observed -> fail!
        const openWindow = evaluateC3FlaggedOutcomes({
            ...baseC3,
            asOfDate: '2026-12-04',
            asOfTimestamp: '2026-12-04T09:00:00Z',
        });
        expect(openWindow.status).toBe('inconclusive');

        const adverseBeatsOpen = evaluateC3FlaggedOutcomes({
            ...baseC3,
            asOfDate: '2026-12-04',
            asOfTimestamp: '2026-12-04T09:00:00Z',
            checkins: [makeCheckin('2026-12-02', { illnessSymptoms: true, submittedAt: '2026-12-02T07:00:00Z' })],
        });
        expect(adverseBeatsOpen.status).toBe('fail');
    });
});

describe('evaluateC4Rollback, evaluateDEvalBlock, and renderDEvalResultMarkdown', () => {
    const cleanBlockInput = () => ({
        blockStartDate: BLOCK_START,
        blockEndDate: BLOCK_END,
        asOfDate: '2027-01-20',
        asOfTimestamp: '2027-01-20T12:00:00Z',
        criteriaCommit: 'abc1234',
        phase2Commit: 'def5678',
        c1: {
            block: {
                plannedSessions: Array.from({ length: 10 }, (_, i) => plannedSession(i)),
                unplannedCount: 1,
            },
        },
        c2: {
            observations: makeProtocolBaselineAndAfter(),
        },
        c3: {
            flags: [{ id: 'illness_anomaly' as const, observedOn: '2026-12-01', active: false, state: 'measured' as const }],
            performedSessions: [],
        },
        c4: { rollbackState: 'unused' as const },
    });

    it('maps C4 rollback states accurately', () => {
        expect(evaluateC4Rollback('unused').status).toBe('pass');
        expect(evaluateC4Rollback({ rollbackState: 'safety', reason: 'illness gate bug' }).status).toBe('fail');
        expect(evaluateC4Rollback({ rollbackState: 'non_safety', reason: 'UX fix' }).status).toBe('inconclusive');
    });

    it('applies §4 overall precedence (NO_GO > EXTEND > PENDING > GO) and OD1 28-day gate', () => {
        const goResult = evaluateDEvalBlock(cleanBlockInput());
        expect(goResult.blockDays).toBe(28);
        expect(goResult.meetsMinBlockDays).toBe(true);
        expect(goResult.overall).toBe('GO');

        const pendingResult = evaluateDEvalBlock({
            ...cleanBlockInput(),
            asOfDate: '2026-12-25',
            asOfTimestamp: '2026-12-25T12:00:00Z',
            c2: { observations: makeProtocolBaselineAndAfter({}, { includeAfter: false }) },
        });
        expect(pendingResult.c2.status).toBe('pending');
        expect(pendingResult.overall).toBe('PENDING');

        // Shorter than 28 days -> EXTEND even when criteria pass
        const shortBlockExtend = evaluateDEvalBlock({
            ...cleanBlockInput(),
            blockEndDate: '2026-12-19', // 27 days
        });
        expect(shortBlockExtend.blockDays).toBe(27);
        expect(shortBlockExtend.overall).toBe('EXTEND');

        // Failure beats <28d and pending -> NO_GO!
        const shortBlockFail = evaluateDEvalBlock({
            ...cleanBlockInput(),
            blockEndDate: '2026-12-19',
            c4: { rollbackState: 'safety', reason: 'clinical regression' },
        });
        expect(shortBlockFail.overall).toBe('NO_GO');
    });

    it('renders the §7 D-EVAL result Markdown template cleanly', () => {
        const pendingResult = evaluateDEvalBlock({
            ...cleanBlockInput(),
            asOfDate: '2026-12-25',
            asOfTimestamp: '2026-12-25T12:00:00Z',
            c2: { observations: makeProtocolBaselineAndAfter({}, { includeAfter: false }) },
        });
        const md = renderDEvalResultMarkdown(pendingResult);
        expect(md).toContain('# ADR-0052 D-EVAL result: 2026-11-23 – 2026-12-20');
        expect(md).toContain('| C1 | pass |');
        expect(md).toContain('| C2 | pending |');
        expect(md).toContain('| C3 | pass |');
        expect(md).toContain('| C4 | pass |');
        expect(md).toContain('**Overall: PENDING (C2 after-attempts due 2027-03-20, 2027-06-18)**');
    });
});
