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

const BASELINE_START = '2026-10-26';
const BASELINE_END = '2026-11-22';

/** A planned session inside the §3 pre-block baseline window (the 28 dates before BLOCK_START). */
function baselineSession(index: number, overrides: Partial<DEvalC1PlannedSessionInput> = {}): DEvalC1PlannedSessionInput {
    const assignedDate = `2026-11-${String(1 + index).padStart(2, '0')}`;
    return plannedSession(index, {
        sessionKey: `base-${index}`,
        assignedDate,
        performedDate: assignedDate,
        performedOccurrenceId: `base-occ-${index}`,
        blockStartDate: BASELINE_START,
        blockEndDate: BASELINE_END,
        ...overrides,
    });
}

function completedAttempts(observations: readonly CurrentObservation[]): AssessmentAttempt[] {
    return observations.map(obs => ({
        id: obs.revision.assessmentAttemptId,
        protocolRef: { id: obs.revision.protocolRef.id, revision: obs.revision.protocolRef.revision },
        state: 'completed' as const,
        purpose: 'baseline' as const,
    }));
}

function c2Input(observations: CurrentObservation[], overrides: Partial<Parameters<typeof evaluateC2Benchmarks>[0]> = {}) {
    return {
        observations,
        attemptRecords: completedAttempts(observations),
        blockStartDate: BLOCK_START,
        blockEndDate: BLOCK_END,
        asOfDate: '2027-01-20',
        ...overrides,
    };
}

const COMPLETE_FOLLOW_UP = {
    followUpSourcesComplete: true,
    followUpSourceStates: { checkins: 'measured', injuries: 'measured', healthAnomalyOutcomes: 'measured' },
    checkins: [],
    injuries: [],
    healthAnomalyOutcomes: [],
} as const;

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
            ...Array.from({ length: 8 }, (_, i) => baselineSession(i)),
            ...Array.from({ length: 2 }, (_, i) => baselineSession(8 + i, {
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
            blockStartDate: BLOCK_START,
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
            ...Array.from({ length: 8 }, (_, i) => baselineSession(i)),
            ...Array.from({ length: 2 }, (_, i) => baselineSession(8 + i, { evidenceComplete: false })),
        ];
        const fallbackRes = evaluateC1Adherence({
            blockStartDate: BLOCK_START,
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

    it('rejects a baseline that is not the 28 dates before the block start', () => {
        const blockSessions = Array.from({ length: 10 }, (_, i) => plannedSession(i, {
            ...(i >= 8 ? { linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null } : {}),
        }));
        // The current block's own sessions supplied as the "baseline" (100% adherence) must not set a 95% threshold.
        const selfBaseline = evaluateC1Adherence({
            blockStartDate: BLOCK_START,
            block: { plannedSessions: blockSessions },
            baseline: { plannedSessions: Array.from({ length: 8 }, (_, i) => plannedSession(i)) },
        });
        expect(selfBaseline.baseline.comparable).toBe(false);
        expect(selfBaseline.baseline.reason).toBe('baseline_outside_pre_block_28_day_window');
        expect(selfBaseline.threshold).toBe(DEVAL_ABSOLUTE_ADHERENCE_FLOOR);
        expect(selfBaseline.status).toBe('pass');

        // Without a block start date the window cannot be confirmed.
        const noStart = evaluateC1Adherence({
            block: { plannedSessions: blockSessions },
            baseline: { plannedSessions: Array.from({ length: 10 }, (_, i) => baselineSession(i)) },
        });
        expect(noStart.baseline.comparable).toBe(false);
        expect(noStart.baseline.reason).toBe('baseline_window_unconfirmed_no_block_start');
    });

    it('lets an observed adherence failure take precedence over excess unknown evidence', () => {
        const missed = { linked: false, performedOccurrenceId: null, performedDate: null, linkedExecution: null };
        // 4 completed, 6 missed, 2 unknown: best case (4 + 2) / 12 = 50% < 75% -> fail despite unknown > 10%.
        const observedFail = evaluateC1Adherence({ block: { plannedSessions: [
            ...Array.from({ length: 4 }, (_, i) => plannedSession(i)),
            ...Array.from({ length: 6 }, (_, i) => plannedSession(4 + i, missed)),
            plannedSession(10, { evidenceComplete: false }),
            plannedSession(11, { evidenceComplete: false }),
        ] } });
        expect(observedFail.status).toBe('fail');
        expect(observedFail.reasons).toContain('adherence_below_threshold');

        // 7 completed, 3 missed, 2 unknown: best case 9 / 12 = 75% meets the floor -> stays inconclusive.
        const couldPass = evaluateC1Adherence({ block: { plannedSessions: [
            ...Array.from({ length: 7 }, (_, i) => plannedSession(i)),
            ...Array.from({ length: 3 }, (_, i) => plannedSession(7 + i, missed)),
            plannedSession(10, { evidenceComplete: false }),
            plannedSession(11, { evidenceComplete: false }),
        ] } });
        expect(couldPass.status).toBe('inconclusive');
        expect(couldPass.reasons).toContain('unknown_exceeds_10_percent');

        // Fewer than 8 eligible stays inconclusive: unknowns could resolve to excluded outcomes.
        const smallSample = evaluateC1Adherence({ block: { plannedSessions: [
            ...Array.from({ length: 7 }, (_, i) => plannedSession(i, missed)),
            plannedSession(7, { evidenceComplete: false }),
            plannedSession(8, { evidenceComplete: false }),
        ] } });
        expect(smallSample.status).toBe('inconclusive');
    });
});

describe('evaluateC2Benchmarks', () => {
    it('passes when all 6 goal-bound protocols remain within or above noise bounds', () => {
        const result = evaluateC2Benchmarks({
            observations: makeProtocolBaselineAndAfter(),
            attemptRecords: completedAttempts(makeProtocolBaselineAndAfter()),
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
            attemptRecords: completedAttempts(obs),
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
        });
        expect(litResult.status).toBe('pass');

        const personalResult = evaluateC2Benchmarks({
            observations: obs,
            attemptRecords: completedAttempts(obs),
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
            attemptRecords: completedAttempts(onlyBefore),
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-03-20', // <= 90d dueDate 2027-03-20!
        });
        expect(pendingRes.status).toBe('pending');
        expect(pendingRes.pendingDueDates).toEqual(['2027-03-20', '2027-06-18']);

        const overdue90d = evaluateC2Benchmarks({
            observations: onlyBefore,
            attemptRecords: completedAttempts(onlyBefore),
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
            attemptRecords: completedAttempts(declinePlusPending),
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
            attemptRecords: completedAttempts(revChangedObs),
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
            attemptRecords: completedAttempts(makeProtocolBaselineAndAfter()),
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
            attemptRecords: completedAttempts(makeProtocolBaselineAndAfter({}, { afterDate: '2027-01-10' })),
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
            attemptRecords: [],
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
            attemptRecords: completedAttempts(noNoiseObs),
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
            ...COMPLETE_FOLLOW_UP,
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
        c2: (() => {
            const observations = makeProtocolBaselineAndAfter();
            return { observations, attemptRecords: completedAttempts(observations) };
        })(),
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
            c2: (() => {
                const observations = makeProtocolBaselineAndAfter({}, { includeAfter: false });
                return { observations, attemptRecords: completedAttempts(observations) };
            })(),
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
            c2: (() => {
                const observations = makeProtocolBaselineAndAfter({}, { includeAfter: false });
                return { observations, attemptRecords: completedAttempts(observations) };
            })(),
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

describe('review regressions (PR #1284)', () => {
    const broadJumpOnly = DEVAL_GOAL_BOUND_PROTOCOLS.filter(p => p.protocolId === 'field-standing-broad-jump');
    const jump = (key: string, observedAt: string, value: number, extra: { seriesKey?: string } = {}) =>
        makeObservation({
            observationKey: key,
            protocolId: 'field-standing-broad-jump',
            metricId: 'standing_broad_jump_distance_cm',
            value,
            unit: 'cm',
            observedAt,
            ...extra,
        });

    it('parseUtcTimestampMs rejects impossible calendar dates and out-of-range times', () => {
        expect(parseUtcTimestampMs('2026-02-30T10:00:00Z')).toBeNull();
        expect(parseUtcTimestampMs('2026-13-01T10:00:00Z')).toBeNull();
        expect(parseUtcTimestampMs('2026-12-01T24:00:00Z')).toBeNull();
        expect(parseUtcTimestampMs('2028-02-29T10:00:00+01:00')).toBe(Date.parse('2028-02-29T09:00:00Z'));
    });

    it('C2 is inconclusive when attempt records are omitted', () => {
        const result = evaluateC2Benchmarks({
            observations: makeProtocolBaselineAndAfter(),
            blockStartDate: BLOCK_START,
            blockEndDate: BLOCK_END,
            asOfDate: '2027-01-20',
        });
        expect(result.status).toBe('inconclusive');
        expect(result.reasons).toContain('attempt_records_unavailable');
    });

    it('C2 excludes a before-attempt on the block start date', () => {
        const obs = [jump('b-on-start', `${BLOCK_START}T09:00:00Z`, 240), jump('a', '2027-01-15T09:00:00Z', 240)];
        const result = evaluateC2Benchmarks(c2Input(obs, { protocols: broadJumpOnly }));
        expect(result.status).toBe('inconclusive');
        expect(result.protocols[0]?.metrics[0]?.comparability).toBe('missing_before');
    });

    it('C2 does not let a newer non-comparable pre-block record hide a comparable baseline', () => {
        const obs = [
            jump('b-old', '2026-10-20T09:00:00Z', 240),
            jump('b-new-other-series', '2026-10-22T09:00:00Z', 250, { seriesKey: 'field-standing-broad-jump:series-2' }),
            jump('a', '2027-01-15T09:00:00Z', 241),
        ];
        const result = evaluateC2Benchmarks(c2Input(obs, { protocols: broadJumpOnly }));
        expect(result.status).toBe('pass');
        expect(result.protocols[0]?.metrics[0]?.before?.observationKey).toBe('b-old');
    });

    it('C2 orders observations by instant, not timestamp text, across UTC offsets', () => {
        // '11:00+02:00' (09:00Z) sorts after '09:30Z' as text but happened 30 minutes earlier.
        const obs = [
            jump('b-early', '2026-10-22T11:00:00+02:00', 200),
            jump('b-late', '2026-10-22T09:30:00Z', 240),
            jump('a', '2027-01-15T09:00:00Z', 240),
        ];
        const result = evaluateC2Benchmarks(c2Input(obs, { protocols: broadJumpOnly }));
        expect(result.protocols[0]?.metrics[0]?.before?.observationKey).toBe('b-late');
        expect(result.status).toBe('pass');
    });

    it('C2 ignores retests after the as-of date and only counts rollbacks on or before it', () => {
        const obs = [jump('b', '2026-10-22T09:00:00Z', 240), jump('a-future', '2027-01-25T09:00:00Z', 200)];
        expect(evaluateC2Benchmarks(c2Input(obs, { protocols: broadJumpOnly, asOfDate: '2027-01-20' })).status).toBe('pending');
        expect(evaluateC2Benchmarks(c2Input(obs, { protocols: broadJumpOnly, asOfDate: '2027-01-25' })).status).toBe('fail');

        const onlyBefore = [jump('b', '2026-10-22T09:00:00Z', 240)];
        const rollbackOn = (rollbackAtDate: string) => evaluateC2Benchmarks(c2Input(onlyBefore, {
            protocols: broadJumpOnly,
            asOfDate: '2027-01-20',
            rollbackBeforeAfterAttempt: true,
            rollbackAtDate,
        })).status;
        expect(rollbackOn('2027-02-01')).toBe('pending');
        expect(rollbackOn('2027-01-20')).toBe('inconclusive');
    });

    const flaggedHardC3 = {
        blockStartDate: BLOCK_START,
        blockEndDate: BLOCK_END,
        asOfDate: '2026-12-05',
        asOfTimestamp: '2026-12-05T12:00:00Z',
        flags: [{ id: 'illness_anomaly' as const, observedOn: '2026-12-01', active: true, state: 'measured' as const }],
        performedSessions: [{
            sessionId: 's-hard',
            performedDate: '2026-12-01',
            performedAt: '2026-12-01T10:00:00Z',
            performedIntensity: 'hard' as const,
        }],
    };

    it('C3 treats omitted follow-up completeness as inconclusive only when a flagged hard session exists', () => {
        const omitted = evaluateC3FlaggedOutcomes(flaggedHardC3);
        expect(omitted.status).toBe('inconclusive');
        expect(omitted.incompleteFollowUps).toContain('follow_up_completeness_unconfirmed');

        expect(evaluateC3FlaggedOutcomes({ ...flaggedHardC3, ...COMPLETE_FOLLOW_UP }).status).toBe('pass');
        expect(evaluateC3FlaggedOutcomes({ ...flaggedHardC3, performedSessions: [] }).status).toBe('pass');
    });

    it('C3 ignores evidence recorded after the as-of cutoff', () => {
        const result = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            asOfDate: '2026-12-02',
            asOfTimestamp: '2026-12-02T08:00:00Z',
            checkins: [makeCheckin('2026-12-02', { illnessSymptoms: true, submittedAt: '2026-12-02T09:00:00Z' })],
            injuries: [{ id: 'inj', severity: 'limit', since: '2026-12-03' }],
            healthAnomalyOutcomes: [makeOutcome({ createdAt: '2026-12-02T10:00:00Z' })],
        });
        expect(result.adverseOutcomes).toHaveLength(0);
        expect(result.status).toBe('inconclusive');
        expect(result.reasons).toContain('followup_72h_window_still_open');
    });

    it('C3 attributes a timestamped injury onset by Warsaw date when the session has no timestamp', () => {
        const result = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            performedSessions: [{ sessionId: 's-notime', performedDate: '2026-12-01', performedIntensity: 'hard' }],
            injuries: [{ id: 'inj-ts', severity: 'limit', since: '2026-12-02T15:00:00Z' }],
        });
        expect(result.status).toBe('fail');
        expect(result.adverseOutcomes[0]?.date).toBe('2026-12-02');
    });

    it('C3 attributes illness outcomes by createdAt; an in-window edit of an older record is ambiguous, not pass or fail', () => {
        const editedInWindow = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            healthAnomalyOutcomes: [makeOutcome({ createdAt: '2026-11-25T08:00:00Z', updatedAt: '2026-12-02T08:00:00Z' })],
        });
        expect(editedInWindow.adverseOutcomes).toHaveLength(0);
        expect(editedInWindow.status).toBe('inconclusive');
        expect(editedInWindow.incompleteFollowUps).toContain('illness_outcome_edited_in_window:ep-1');

        // Edited outside the window: an old record stays unattributed and C3 passes.
        const editedOutside = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            healthAnomalyOutcomes: [makeOutcome({ createdAt: '2026-11-25T08:00:00Z', updatedAt: '2026-11-26T08:00:00Z' })],
        });
        expect(editedOutside.status).toBe('pass');
    });

    it('C3 counts a pre-session record relabelled with a post-session symptom onset as adverse', () => {
        const relabelled = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            healthAnomalyOutcomes: [makeOutcome({
                createdAt: '2026-11-30T08:00:00Z',
                updatedAt: '2026-12-03T08:00:00Z',
                symptomOnset: { date: '2026-12-03', precision: 'day' },
            })],
        });
        expect(relabelled.status).toBe('fail');
        expect(relabelled.adverseOutcomes[0]?.date).toBe('2026-12-03');
    });

    it('C3 excludes evidence first recorded or edited after the as-of cutoff', () => {
        const atCutoff = {
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            asOfDate: '2026-12-05',
            asOfTimestamp: '2026-12-05T12:00:00Z',
        };
        // Injury created after the cutoff with a backdated `since` must not be attributed.
        const backdatedInjury = evaluateC3FlaggedOutcomes({
            ...atCutoff,
            injuries: [{ id: 'inj-late', severity: 'limit', since: '2026-12-02', createdAt: '2026-12-06T09:00:00Z' }],
        });
        expect(backdatedInjury.adverseOutcomes).toHaveLength(0);
        expect(backdatedInjury.status).toBe('pass');

        // Illness record created in-window but edited after the cutoff: current label is post-cutoff information.
        const editedAfterCutoff = evaluateC3FlaggedOutcomes({
            ...atCutoff,
            healthAnomalyOutcomes: [makeOutcome({ createdAt: '2026-12-02T08:00:00Z', updatedAt: '2026-12-06T08:00:00Z' })],
        });
        expect(editedAfterCutoff.adverseOutcomes).toHaveLength(0);
        expect(editedAfterCutoff.status).toBe('inconclusive');
        expect(editedAfterCutoff.incompleteFollowUps).toContain('illness_outcome_edited_after_cutoff:ep-1');
    });

    it('C3 treats same-day date-only evidence at a timestamp cutoff as incomplete, not adverse', () => {
        const result = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            asOfDate: '2026-12-02',
            asOfTimestamp: '2026-12-02T08:00:00Z',
            injuries: [{ id: 'inj-same-day', severity: 'limit', since: '2026-12-02' }],
        });
        expect(result.adverseOutcomes).toHaveLength(0);
        expect(result.status).toBe('inconclusive');
        expect(result.incompleteFollowUps).toContain('injury_same_day_date_only_at_cutoff:inj-same-day');

        // Without a timestamp cutoff the whole as-of date is known, so the same injury is attributed.
        const dateCutoff = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            asOfDate: '2026-12-05',
            asOfTimestamp: null,
            injuries: [{ id: 'inj-same-day', severity: 'limit', since: '2026-12-02' }],
        });
        expect(dateCutoff.status).toBe('fail');
    });

    it('C3 does not attribute adverse fields written to a submitted check-in by a later update', () => {
        // Submitted before the session, then updated inside the window with pain: ambiguous.
        const editedInWindow = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            checkins: [makeCheckin('2026-12-01', {
                painOrInjury: true,
                submittedAt: '2026-12-01T06:00:00Z',
                updatedAt: '2026-12-01T18:00:00Z',
            })],
        });
        expect(editedInWindow.adverseOutcomes).toHaveLength(0);
        expect(editedInWindow.status).toBe('inconclusive');
        expect(editedInWindow.incompleteFollowUps).toContain('checkin_edited_in_window:2026-12-01');

        // Submitted in-window before the cutoff but updated after it: unknown at the cutoff.
        const editedAfterCutoff = evaluateC3FlaggedOutcomes({
            ...flaggedHardC3,
            ...COMPLETE_FOLLOW_UP,
            checkins: [makeCheckin('2026-12-02', {
                painOrInjury: true,
                submittedAt: '2026-12-02T06:00:00Z',
                updatedAt: '2026-12-06T06:00:00Z',
            })],
        });
        expect(editedAfterCutoff.adverseOutcomes).toHaveLength(0);
        expect(editedAfterCutoff.status).toBe('inconclusive');
        expect(editedAfterCutoff.incompleteFollowUps).toContain('checkin_edited_after_cutoff:2026-12-02');
    });

    it('C2 excludes attempts completed after the as-of date and keeps those completed on it or without completedAt', () => {
        const obs = [jump('b', '2026-10-22T09:00:00Z', 240), jump('a', '2027-01-15T09:00:00Z', 200)];
        const withAfterCompletedAt = (completedAt: string | undefined) => evaluateC2Benchmarks(c2Input(obs, {
            protocols: broadJumpOnly,
            asOfDate: '2027-01-20',
            attemptRecords: completedAttempts(obs).map(attempt => (
                attempt.id === 'attempt-a' && completedAt !== undefined ? { ...attempt, completedAt } : attempt
            )),
        })).status;
        expect(withAfterCompletedAt('2027-01-21T09:00:00Z')).toBe('pending');
        expect(withAfterCompletedAt('2027-01-20T20:00:00Z')).toBe('fail');
        expect(withAfterCompletedAt(undefined)).toBe('fail');
        expect(withAfterCompletedAt('not-a-timestamp')).toBe('pending');
    });

    it('C2 marks affected metrics inconclusive when observation reads are incomplete, while preserving complete metrics', () => {
        const jumpBefore = jump('before-jump', '2026-10-22T09:00:00Z', 240);
        const jumpAfter = jump('after-jump', '2027-01-18T09:00:00Z', 242);
        const cmjBefore = makeObservation({
            observationKey: 'obs-cmj-before',
            protocolId: 'field-wall-touch-cmj',
            metricId: 'wall_touch_cmj_height_cm',
            value: 55,
            unit: 'cm',
            observedAt: '2026-10-22T09:00:00Z',
            attemptId: 'att-cmj-b',
        });
        const cmjAfter = makeObservation({
            observationKey: 'obs-cmj-after',
            protocolId: 'field-wall-touch-cmj',
            metricId: 'wall_touch_cmj_height_cm',
            value: 56,
            unit: 'cm',
            observedAt: '2027-01-18T09:00:00Z',
            attemptId: 'att-cmj-a',
        });
        const bothProtocols = DEVAL_GOAL_BOUND_PROTOCOLS.filter(
            p => p.protocolId === 'field-standing-broad-jump' || p.protocolId === 'field-wall-touch-cmj',
        );
        const obs = [jumpBefore, jumpAfter, cmjBefore, cmjAfter];

        const metricScoped = evaluateC2Benchmarks(c2Input(obs, {
            protocols: bothProtocols,
            incompleteObservationMetricIds: ['standing_broad_jump_distance_cm'],
        }));
        expect(metricScoped.status).toBe('inconclusive');
        expect(metricScoped.protocols.find(p => p.protocolId === 'field-standing-broad-jump')?.status).toBe('inconclusive');
        expect(metricScoped.protocols.find(p => p.protocolId === 'field-standing-broad-jump')?.reasons).toContain('observation_records_incomplete');
        expect(metricScoped.protocols.find(p => p.protocolId === 'field-wall-touch-cmj')?.status).toBe('pass');

        const allIncomplete = evaluateC2Benchmarks(c2Input(obs, {
            protocols: bothProtocols,
            observationsComplete: false,
        }));
        expect(allIncomplete.status).toBe('inconclusive');
        expect(allIncomplete.protocols.map(p => ({ protocolId: p.protocolId, status: p.status }))).toEqual([
            { protocolId: 'field-standing-broad-jump', status: 'inconclusive' },
            { protocolId: 'field-wall-touch-cmj', status: 'inconclusive' },
        ]);
    });

    it('C2 excludes revision 1 created after the cutoff and fails closed on unresolved post-cutoff corrections', () => {
        const jumpOnly = DEVAL_GOAL_BOUND_PROTOCOLS.filter(p => p.protocolId === 'field-standing-broad-jump');
        const jump = (key: string, observedAt: string, value: number) => makeObservation({
            observationKey: key,
            protocolId: 'field-standing-broad-jump',
            metricId: 'standing_broad_jump_distance_cm',
            value,
            unit: 'cm',
            observedAt,
            attemptId: `attempt-${key}`,
        });

        const before = jump('b', '2026-10-22T09:00:00Z', 240);
        const rev1AfterCutoff = jump('a', '2027-01-15T09:00:00Z', 200);
        rev1AfterCutoff.revision.createdAt = '2027-01-20T23:30:00Z'; // Jan 21 Warsaw

        expect(evaluateC2Benchmarks(c2Input([before, rev1AfterCutoff], {
            protocols: jumpOnly,
            asOfDate: '2027-01-20',
        })).status).toBe('pending');
        expect(evaluateC2Benchmarks(c2Input([before, rev1AfterCutoff], {
            protocols: jumpOnly,
            asOfDate: '2027-01-21',
        })).status).toBe('fail');

        const correctedValid: CurrentObservation = {
            head: { ...rev1AfterCutoff.head, headRevision: 2, updatedAt: '2027-01-25T09:00:00Z' },
            revision: {
                ...rev1AfterCutoff.revision,
                revision: 2,
                supersedesRevision: 1,
                value: 245,
                correctionReason: 'Corrected reading',
                createdAt: '2027-01-25T09:00:00Z',
            },
        };
        const unresolvedValid = evaluateC2Benchmarks(c2Input([before, correctedValid], {
            protocols: jumpOnly,
            asOfDate: '2027-01-20',
        }));
        expect(unresolvedValid.status).toBe('inconclusive');
        expect(unresolvedValid.reasons).toContain('observation_revision_unresolved_at_cutoff');

        const correctedSameDayBeforeTs = evaluateC2Benchmarks(c2Input([before, correctedValid], {
            protocols: jumpOnly,
            asOfDate: '2027-01-25',
            asOfTimestamp: '2027-01-25T08:00:00Z',
        }));
        expect(correctedSameDayBeforeTs.status).toBe('inconclusive');
        expect(correctedSameDayBeforeTs.reasons).toContain('observation_revision_unresolved_at_cutoff');

        const correctedInvalid: CurrentObservation = {
            head: { ...correctedValid.head },
            revision: {
                ...correctedValid.revision,
                validity: 'invalid',
                invalidReason: 'Post-cutoff invalidation',
            },
        };
        const unresolvedInvalid = evaluateC2Benchmarks(c2Input([before, correctedInvalid], {
            protocols: jumpOnly,
            asOfDate: '2027-01-20',
        }));
        expect(unresolvedInvalid.status).toBe('inconclusive');
        expect(unresolvedInvalid.reasons).toContain('observation_revision_unresolved_at_cutoff');

        const unparseableCreatedAt = jump('u', '2027-01-15T09:00:00Z', 245);
        unparseableCreatedAt.revision.createdAt = 'not-a-timestamp';
        const invalidTimestampResult = evaluateC2Benchmarks(c2Input([before, unparseableCreatedAt], {
            protocols: jumpOnly,
            asOfDate: '2027-01-20',
        }));
        expect(invalidTimestampResult.status).toBe('inconclusive');
        expect(invalidTimestampResult.reasons).toContain('observation_revision_unresolved_at_cutoff');
        expect(invalidTimestampResult.knownLimits.join(' ')).toContain('could not be established');
        expect(invalidTimestampResult.knownLimits.join(' ')).not.toContain('modified after');
    });

    it('C2 applies the date-only cutoff to baseline observations when asOfMs is absent', () => {
        const jumpOnly = DEVAL_GOAL_BOUND_PROTOCOLS.filter(p => p.protocolId === 'field-standing-broad-jump');
        const jump = (key: string, observedAt: string, createdAt: string, value: number) => {
            const obs = makeObservation({
                observationKey: key,
                protocolId: 'field-standing-broad-jump',
                metricId: 'standing_broad_jump_distance_cm',
                value,
                unit: 'cm',
                observedAt,
                attemptId: `attempt-${key}`,
            });
            obs.revision.createdAt = createdAt;
            obs.head.createdAt = createdAt;
            obs.head.updatedAt = createdAt;
            return obs;
        };

        const futureObsEnteredEarly = jump('future-obs', '2026-11-12T09:00:00Z', '2026-11-09T09:00:00Z', 240);
        const onCutoffObs = jump('cutoff-obs', '2026-11-10T09:00:00Z', '2026-11-09T09:00:00Z', 245);

        const excluded = evaluateC2Benchmarks(c2Input([futureObsEnteredEarly], {
            protocols: jumpOnly,
            asOfDate: '2026-11-10',
        }));
        expect(excluded.status).toBe('inconclusive');
        expect(excluded.reasons).toContain('missing_before_attempt');

        const included = evaluateC2Benchmarks(c2Input([futureObsEnteredEarly, onCutoffObs], {
            protocols: jumpOnly,
            asOfDate: '2026-11-10',
        }));
        expect(included.status).toBe('pending');
        expect(included.protocols[0]?.metrics[0]?.before?.date).toBe('2026-11-10');
    });
});
