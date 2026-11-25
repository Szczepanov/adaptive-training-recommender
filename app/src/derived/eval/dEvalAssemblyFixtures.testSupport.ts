import { LEDGER_FLAG_IDS, type LedgerFlagId } from '../../ledger/export/schema.ts';
import type { PersistedFlagEvaluation } from '../../ledger/flagEvaluation.ts';
import type { DailySubjectiveCheckin } from '../../ledger/models.ts';
import type { AssessmentAttempt } from '../../observations/models.ts';
import type { CurrentObservation } from '../../observations/progress.ts';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models.ts';
import { addDaysToLocalDateString } from '../../utils/localDate.ts';
import type { DEvalRawExecution, DEvalRawLedgerData, DEvalRawPlanRevision } from './dEvalRawLedger.ts';

export const BLOCK_START = '2026-11-24';
export const BLOCK_END = '2026-12-21';
export const BASELINE_START = '2026-10-27';
export const AS_OF_POST = '2026-12-26';

export function makeFlagsForDate(
    date: string,
    overrides: Partial<Record<LedgerFlagId, Partial<PersistedFlagEvaluation>>> = {},
): PersistedFlagEvaluation[] {
    return LEDGER_FLAG_IDS.map((id, idx) => {
        const custom = overrides[id];
        return {
            schemaVersion: 1,
            userId: 'u1',
            revisionId: `flag-${date.replaceAll('-', '')}${String(idx).padStart(56, '0')}`,
            idempotencyKey: `flag-${date.replaceAll('-', '')}${String(idx).padStart(56, '0')}`,
            id,
            observedOn: date,
            evaluatedAt: `${date}T06:00:00.000Z`,
            active: false,
            state: 'measured',
            reasonCode: 'clear',
            definitionVersion: `${id}-v1`,
            threshold: 'threshold',
            inputs: [{ name: 'signal', value: { value: 1, source: 'test', state: 'measured' } }],
            ...(id === 'injury_constraint_touches_session' ? { sessionRef: 'external_plan:p1@1:s1' } : {}),
            ...custom,
        };
    });
}

export function makeAllFlags(
    fromDate: string,
    toDate: string,
    perDate: (date: string) => Partial<Record<LedgerFlagId, Partial<PersistedFlagEvaluation>>> = () => ({}),
): PersistedFlagEvaluation[] {
    const out: PersistedFlagEvaluation[] = [];
    for (let d = fromDate; d <= toDate; d = addDaysToLocalDateString(d, 1)) {
        out.push(...makeFlagsForDate(d, perDate(d)));
    }
    return out;
}

export function makeOccurrence(
    id: string,
    date: string,
    executionId?: string,
    extra: Partial<PerformedTrainingOccurrence> = {},
): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: id,
        userId: 'u1',
        status: 'active',
        localDate: date,
        startedAt: `${date}T09:00:00.000Z`,
        endedAt: `${date}T10:00:00.000Z`,
        sourceRefs: executionId ? [{ kind: 'structured_execution', executionId }] : [],
        reconciliation: { state: 'single_source' },
        createdAt: `${date}T10:00:00.000Z`,
        updatedAt: `${date}T10:00:00.000Z`,
        ...extra,
    };
}

export function makePlanExec(
    executionId: string,
    date: string,
    planId: string,
    revision: number,
    sessionId: string,
    contentHash = 'h1',
    extra: Partial<DEvalRawExecution> = {},
): DEvalRawExecution {
    return {
        executionId,
        state: 'completed',
        date,
        startedAt: `${date}T09:00:00.000Z`,
        completedAt: `${date}T10:00:00.000Z`,
        executedDefinition: 'authored',
        completionEvidence: { completedFraction: 1 },
        sessionSource: {
            kind: 'external_plan',
            planId,
            revision,
            sessionId,
            contentHash,
        },
        ...extra,
    };
}

export function makeCheckin(date: string, extra: Partial<DailySubjectiveCheckin> = {}): DailySubjectiveCheckin {
    return {
        userId: 'u1',
        date,
        readiness: 8,
        sleepQuality: 8,
        fatigue: 2,
        soreness: 2,
        mentalStress: 2,
        motivation: 8,
        painOrInjury: false,
        illnessSymptoms: false,
        submittedAt: `${date}T07:00:00.000Z`,
        createdAt: `${date}T07:00:00.000Z`,
        updatedAt: `${date}T07:00:00.000Z`,
        dataQuality: { isComplete: true, missingFields: [] },
        ...extra,
    } as DailySubjectiveCheckin;
}

export function makeGoalBoundObsAndAttempts(): {
    observations: CurrentObservation[];
    attempts: AssessmentAttempt[];
} {
    const specs: Array<{ protocolId: string; metricId: string; unit: string; val: number }> = [
        { protocolId: 'strength-back-squat-1rm', metricId: 'strength_1rm_kg', unit: 'kg', val: 140 },
        { protocolId: 'strength-bench-press-1rm', metricId: 'strength_1rm_kg', unit: 'kg', val: 100 },
        { protocolId: 'field-standing-broad-jump', metricId: 'standing_broad_jump_distance_cm', unit: 'cm', val: 250 },
        { protocolId: 'field-wall-touch-cmj', metricId: 'wall_touch_cmj_height_cm', unit: 'cm', val: 55 },
        { protocolId: 'field-seated-medball-chest-throw-3kg', metricId: 'seated_medball_throw_distance_m', unit: 'm', val: 5.5 },
        { protocolId: 'cycling-6s-seated-sprint', metricId: 'cycling_sprint_1s_peak_power_w', unit: 'W', val: 1100 },
        { protocolId: 'cycling-6s-seated-sprint', metricId: 'cycling_sprint_5s_mean_power_w', unit: 'W', val: 950 },
    ];
    const observations: CurrentObservation[] = [];
    const attempts: AssessmentAttempt[] = [];
    for (const spec of specs) {
        const attemptId = `att-before-${spec.protocolId}`;
        if (!attempts.some(a => a.id === attemptId)) {
            attempts.push({
                id: attemptId,
                protocolRef: { id: spec.protocolId, revision: 1 },
                state: 'completed',
                purpose: 'baseline',
                completedAt: '2026-10-22T10:00:00.000Z',
            });
        }
        const obsKey = `${attemptId}:${spec.metricId}`;
        observations.push({
            head: {
                observationKey: obsKey,
                assessmentAttemptId: attemptId,
                metricId: spec.metricId,
                headRevision: 1,
                createdAt: '2026-10-22T10:00:00.000Z',
                updatedAt: '2026-10-22T10:00:00.000Z',
            },
            revision: {
                observationKey: obsKey,
                revision: 1,
                metricId: spec.metricId,
                value: spec.val,
                unit: spec.unit,
                protocolRef: { id: spec.protocolId, revision: 1 },
                assessmentAttemptId: attemptId,
                source: 'manual',
                validity: 'valid',
                observedAt: '2026-10-22T10:00:00.000Z',
                comparisonSeriesKey: `${spec.protocolId}:series-1`,
                comparisonCanonicalizationVersion: '1',
                context: {},
                createdAt: '2026-10-22T10:00:00.000Z',
            },
        });
    }
    return { observations, attempts };
}

export function emptyRaw(overrides: Partial<DEvalRawLedgerData> = {}): DEvalRawLedgerData {
    const { observations, attempts } = makeGoalBoundObsAndAttempts();
    return {
        externalPlansState: 'measured',
        planRevisions: [],
        placements: [],
        placementHistory: [],
        occurrencesState: 'measured',
        performedOccurrences: [],
        executionsState: 'measured',
        executions: [],
        responsesState: 'measured',
        responses: [],
        flagEvaluationsState: 'measured',
        flagEvaluations: makeAllFlags(BASELINE_START, BLOCK_END),
        checkinsState: 'measured',
        checkins: [],
        trainingSettingsState: 'measured',
        injuries: [],
        healthAnomalyOutcomesState: 'measured',
        healthAnomalyOutcomes: [],
        observationsState: 'measured',
        observations,
        attemptsState: 'measured',
        attempts,
        preferencesState: 'measured',
        engineRecommendationsEnabled: false,
        ...overrides,
    };
}

/** A verified revision whose horizon covers the baseline and the block unless overridden. */
export function makeRevision(
    sessions: DEvalRawPlanRevision['sessions'],
    extra: Partial<DEvalRawPlanRevision> = {},
): DEvalRawPlanRevision {
    return {
        planId: 'p1',
        revision: 1,
        contentHash: 'h1',
        importedAt: '2026-10-25T08:00:00.000Z',
        horizon: { effectiveFrom: BASELINE_START, startDate: BASELINE_START, endDate: BLOCK_END },
        sessions,
        ...extra,
    };
}
