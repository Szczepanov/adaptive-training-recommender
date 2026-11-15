import type { DataState } from '../engine/dataState';
import type { FlagEvaluation } from '../derived/flags/flagEvaluation';
import type { HealthAnomalyAssessmentRevision } from '../derived/flags/illnessAnomaly/healthAnomalyModels';
import type { PersistedFlagEvaluation } from '../ledger/flagEvaluation';
import { evaluateIllnessAnomalyFlag } from '../derived/flags/illnessAnomaly/illnessAnomalyFlag';
import { evaluateIllnessRiskSymptom } from '../derived/flags/illnessRiskSymptom';
import { evaluateRecoveryBeyondBaseline, RECOVERY_BEYOND_BASELINE_WINDOW } from '../derived/flags/recoveryBeyondBaseline';
import { healthAnomalyAssessmentRepository } from './healthAnomalyPersistence';
import { evaluateInjuryConstraintTouchesSession } from '../derived/flags/injuryConstraintTouchesSession';
import { worstState } from '../ledger/export/ledgerValue';
import type { SessionDefinition } from '../sessions/models';
import { compareExecutionPriority, isExternalPlanOccurrence } from '../sessions/models';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { getLocalDateString, addDaysToLocalDateString } from '../utils/localDate';
import { assertLocalDate } from '../ledger/export/window';
import { recoverySnapshotService } from './recoverySnapshotService';
import { checkinService } from './checkinService';
import { trainingSettingsService } from './trainingSettingsService';
import { activeExternalPlanService, placedSessionsForDate } from './activeExternalPlanService';
import { sessionOccurrenceService } from './sessionOccurrenceService';
import { sessionExecutionService } from './sessionExecutionService';
import { fixedActivityService } from './fixedActivityService';
import { buildFlagEvaluationRevision, flagEvidenceDigest, flagEvaluationRepository } from './flagEvaluationPersistence';

const defaultReads = {
    recovery: (userId: string, date: string) => recoverySnapshotService.getRecoverySnapshotState(userId, date),
    checkin: (userId: string, date: string) => checkinService.getCheckinState(userId, date),
    settings: (userId: string) => trainingSettingsService.peekTrainingSettingsState(userId),
    plan: async (userId: string, date: string) => {
        const fixed = await fixedActivityService.getActivitiesInRangeState(userId, date, date);
        if (fixed.status === 'INVALID' || fixed.status === 'UNAVAILABLE') return fixed;
        return activeExternalPlanService.getActivePlanState(userId, date, fixed.status === 'AVAILABLE' ? fixed.data : [],
            { failOnInvalidHeader: true });
    },
    occurrences: (userId: string, date: string) => sessionOccurrenceService.getOccurrencesInRangeState(userId, date, date),
    // Headers only: the flag needs each execution's pinned prescription, never its set diary.
    executions: async (userId: string, date: string) => {
        const read = await sessionExecutionService.getExecutionHeadersInRange(userId, date, addDaysToLocalDateString(date, 1));
        if (read.truncated) throw new Error('Execution header read truncated');
        return { executions: read.executions.map(execution => ({ execution })), invalidRecords: read.invalidRecords };
    },
    resolve: resolveSessionDefinition,
    healthAnomaly: (userId: string, date: string) =>
        healthAnomalyAssessmentRepository.getLatestForDateWithDiagnostics(userId, date),
    persist: flagEvaluationRepository.persistImmutable,
    priorFlags: (userId: string, date: string) => flagEvaluationRepository.getInRangeState(userId, date, date),
};
/** Audit input linking a re-captured flag to the revision it replaces (see `chooseRevision`). */
export const SUPERSEDES_REVISION_INPUT = 'supersedes_revision';
const flagKey = (id: string, sessionRef?: string) => `${id}::${sessionRef ?? ''}`;
function latestPriorFlags(state: DataState<PersistedFlagEvaluation[]>): {
    latest: Map<string, PersistedFlagEvaluation>; revisionIds: Set<string>;
} {
    const latest = new Map<string, PersistedFlagEvaluation>();
    const flags = state.status === 'AVAILABLE' ? state.data : [];
    for (const flag of flags) {
        const key = flagKey(flag.id, flag.sessionRef);
        const prev = latest.get(key);
        if (!prev || flag.evaluatedAt >= prev.evaluatedAt) latest.set(key, flag);
    }
    return { latest, revisionIds: new Set(flags.map(flag => flag.revisionId)) };
}
type HealthAnomalyDiagnosticRead = {
    revision: HealthAnomalyAssessmentRevision | null;
    unreadableCount: number;
};
function normalizeHealthAnomalyRead(
    value: HealthAnomalyAssessmentRevision | HealthAnomalyDiagnosticRead | null,
): HealthAnomalyDiagnosticRead {
    if (value && typeof value === 'object' && 'unreadableCount' in value) {
        return value;
    }
    return { revision: value, unreadableCount: 0 };
}
type FlagCaptureReads = Omit<typeof defaultReads, 'healthAnomaly' | 'priorFlags'> & {
    priorFlags?: typeof defaultReads.priorFlags;
    healthAnomaly?: (
        userId: string,
        date: string,
    ) => Promise<HealthAnomalyAssessmentRevision | HealthAnomalyDiagnosticRead | null>;
};
const data = <T,>(state: DataState<T>): T | null => state.status === 'AVAILABLE' ? state.data : null;
const failure = (state: { status: string }): 'invalid' | 'unavailable' | null =>
    state.status === 'INVALID' ? 'invalid' : state.status === 'UNAVAILABLE' ? 'unavailable' : null;
function failed(flag: FlagEvaluation, source: string, state: 'invalid' | 'unavailable'): FlagEvaluation {
    return { ...flag, active: null, state, reasonCode: 'source_' + state,
        inputs: [{ name: source, value: { value: null, source, state } }] };
}
async function readState<T>(operation: () => Promise<DataState<T>>): Promise<DataState<T>> {
    try { return await operation(); } catch { return { status: 'UNAVAILABLE', operation: 'capture flag input', retryable: true }; }
}

/**
 * Flag revisions are content-addressed, so re-capturing an older result (A, then a failed
 * read, then A again) would return the first document with its old `evaluatedAt`, and the
 * newer failure would stay "latest". When the result repeats an older revision that is no
 * longer the latest for its key, chain it to the latest so a new immutable revision is minted.
 */
async function chooseRevision(
    build: (supersedes?: string) => Promise<PersistedFlagEvaluation>,
    prior: ReturnType<typeof latestPriorFlags>,
    key: string,
): Promise<PersistedFlagEvaluation> {
    const latest = prior.latest.get(key);
    const latestLink = latest?.inputs.find(input => input.name === SUPERSEDES_REVISION_INPUT)?.value.value;
    const repeat = await build(typeof latestLink === 'string' ? latestLink : undefined);
    if (!latest || repeat.revisionId === latest.revisionId) return repeat;
    const base = await build();
    return prior.revisionIds.has(base.revisionId) ? build(latest.revisionId) : base;
}

/** Captures only the current Warsaw date; export never calls this writer. */
export class FlagCaptureService {
    private readonly reads: typeof defaultReads;
    constructor(reads: FlagCaptureReads = defaultReads) {
        const readHealthAnomaly = reads.healthAnomaly ?? defaultReads.healthAnomaly;
        this.reads = {
            ...reads,
            priorFlags: reads.priorFlags ?? defaultReads.priorFlags,
            healthAnomaly: async (userId: string, date: string) =>
                normalizeHealthAnomalyRead(await readHealthAnomaly(userId, date)),
        };
    }

    async captureForDate(userId: string, date: string, today = getLocalDateString(), evaluatedAt = new Date().toISOString()): Promise<void> {
        if (!userId.trim() || userId.includes('/')) throw new Error('Invalid flag owner');
        assertLocalDate(date, 'observedOn');
        if (date !== today) throw new Error('Only the current Warsaw date may be captured');
        const [recovery, checkin, settings, plan, occurrences, executionRead, anomalyRead, priorRead] = await Promise.all([
            readState(() => this.reads.recovery(userId, date)),
            readState(() => this.reads.checkin(userId, date)),
            readState(() => this.reads.settings(userId)),
            readState(() => this.reads.plan(userId, date)),
            readState(() => this.reads.occurrences(userId, date)),
            this.reads.executions(userId, date).then(value => ({ status: 'AVAILABLE' as const, data: value }),
                () => ({ status: 'UNAVAILABLE' as const })),
            this.reads.healthAnomaly(userId, date).then(
                value => ({ status: 'AVAILABLE' as const, ...normalizeHealthAnomalyRead(value) }),
                () => ({ status: 'UNAVAILABLE' as const, revision: null, unreadableCount: 0 }),
            ),
            readState(() => this.reads.priorFlags(userId, date)),
        ]);
        const prior = latestPriorFlags(priorRead);
        const save = async (evaluation: FlagEvaluation, source: unknown, sessionRef?: string, baselineWindow?: string) => {
            // A digest binds mutable inputs without copying private notes or account identifiers.
            const fingerprint = await flagEvidenceDigest(source);
            const build = (supersedes?: string) => buildFlagEvaluationRevision({ userId, observedOn: date, evaluatedAt,
                evaluation: { ...evaluation, inputs: [...evaluation.inputs,
                    { name: 'source_revision', value: { value: fingerprint, source: 'flag_capture', state: 'measured' as const } },
                    ...(supersedes ? [{ name: SUPERSEDES_REVISION_INPUT,
                        value: { value: supersedes, source: 'flag_capture', state: 'measured' as const } }] : []),
                ] },
                ...(sessionRef ? { sessionRef } : {}), ...(baselineWindow ? { baselineWindow } : {}) });
            await this.reads.persist(await chooseRevision(build, prior, flagKey(evaluation.id, sessionRef)));
        };
        const recoveryResult = evaluateRecoveryBeyondBaseline(data(recovery), date);
        const recoveryFlag = { ...recoveryResult.flag, inputs: [
            ...recoveryResult.flag.inputs,
            ...recoveryResult.metrics.flatMap(metric => [
                { name: metric.metric + '_delta7d', value: {
                    value: metric.delta7d, unit: metric.unit, source: 'daily_recovery_snapshots',
                    state: metric.delta7d === null ? 'missing' as const : metric.state, observedOn: metric.metricDate,
                } },
                { name: metric.metric + '_band', value: {
                    value: metric.band, unit: metric.unit, source: 'daily_recovery_snapshots',
                    state: metric.band === null ? 'missing' as const : metric.state, observedOn: metric.metricDate,
                } },
            ]),
        ] };
        const checkinFlag = evaluateIllnessRiskSymptom(data(checkin));
        const anomalyFlag = anomalyRead.status === 'UNAVAILABLE'
            ? failed(evaluateIllnessAnomalyFlag(null), 'health_anomaly_assessments', 'unavailable')
            : anomalyRead.unreadableCount > 0
                ? failed(
                    evaluateIllnessAnomalyFlag(anomalyRead.revision?.assessment ?? null),
                    'health_anomaly_assessments',
                    'invalid',
                )
                : evaluateIllnessAnomalyFlag(anomalyRead.revision?.assessment ?? null);
        await save(failure(recovery) ? failed(recoveryFlag, 'daily_recovery_snapshots', failure(recovery)!) : recoveryFlag,
            recovery, undefined, RECOVERY_BEYOND_BASELINE_WINDOW);
        await save(failure(checkin) ? failed(checkinFlag, 'daily_subjective_checkins', failure(checkin)!) : checkinFlag, checkin);
        const anomalySource = anomalyRead.status === 'UNAVAILABLE'
            ? { status: 'UNAVAILABLE' }
            : anomalyRead.unreadableCount > 0
                ? {
                    status: 'UNREADABLE',
                    unreadableCount: anomalyRead.unreadableCount,
                    latestReadableRevisionId: anomalyRead.revision?.revisionId ?? null,
                }
                : anomalyRead.revision
                    ? {
                        revisionId: anomalyRead.revision.revisionId,
                        mode: anomalyRead.revision.mode,
                        assessment: anomalyRead.revision.assessment,
                    }
                    : { status: 'MISSING' };
        await save(anomalyFlag, anomalySource);

        const constraints = data(settings)?.injuries ?? null;
        const empty = evaluateInjuryConstraintTouchesSession(constraints, date, null);
        const executionFailure = executionRead.status === 'AVAILABLE'
            ? executionRead.data.invalidRecords > 0 ? 'invalid' : null : 'unavailable';
        const faults = [failure(settings), failure(plan), failure(occurrences), executionFailure].filter((s): s is 'invalid' | 'unavailable' => s !== null);
        // Bind the settings revision to preserve reversions; omit diary-only execution fields.
        const source = {
            injuries: settings.status === 'AVAILABLE' ? { status: settings.status, revision: settings.revision, injuries: settings.data.injuries ?? null } : settings,
            plan, occurrences,
            executions: executionRead.status === 'AVAILABLE' ? {
                invalidRecords: executionRead.data.invalidRecords,
                bindings: executionRead.data.executions
                    .map(({ execution }) => ({ occurrenceId: execution.occurrenceId ?? null, prescriptionHash: execution.prescriptionHash ?? null, state: execution.state, startedAt: execution.startedAt }))
                    .sort((a, b) => String(a.occurrenceId).localeCompare(String(b.occurrenceId))
                        || String(a.prescriptionHash).localeCompare(String(b.prescriptionHash))
                        || String(a.state).localeCompare(String(b.state)) || String(a.startedAt).localeCompare(String(b.startedAt))),
            } : executionRead,
        };
        if (faults.length > 0) {
            await save(failed(empty, 'planned_session_inputs', worstState(faults) as 'invalid' | 'unavailable'), source);
            return;
        }
        const sessions = new Map<string, DataState<SessionDefinition>>();
        const activePlan = data(plan);
        if (activePlan) for (const placed of placedSessionsForDate(activePlan, date)) {
            const session = placed.session;
            const ref = `external_plan:${activePlan.plan.planId}@${activePlan.plan.revision}:${session.id}`;
            sessions.set(ref, 'definition' in session
                ? { status: 'AVAILABLE', data: session.definition, revision: String(activePlan.plan.revision) }
                : await readState(() => this.reads.resolve(userId, {
                    kind: 'external_plan', planId: activePlan.plan.planId, revision: activePlan.plan.revision,
                    sessionId: session.id, contentHash: activePlan.header.contentHash,
                })));
        }
        for (const occurrence of data(occurrences) ?? []) {
            if (!['scheduled', 'active', 'completed'].includes(occurrence.state)) continue;
            const externalRef = isExternalPlanOccurrence(occurrence)
                ? `external_plan:${occurrence.externalPlanRef.planId}@${occurrence.externalPlanRef.revision}:${occurrence.externalPlanRef.sessionId}` : null;
            const ref = externalRef && sessions.has(externalRef) ? externalRef : 'occurrence:' + occurrence.occurrenceId;
            const sessionSource = isExternalPlanOccurrence(occurrence)
                ? { kind: 'external_plan' as const, ...occurrence.externalPlanRef }
                : { kind: 'manual' as const, ...occurrence.definitionRef };
            const execution = executionRead.status === 'AVAILABLE'
                ? executionRead.data.executions.map(row => row.execution)
                    .filter(execution => execution.occurrenceId === occurrence.occurrenceId)
                    .sort(compareExecutionPriority)[0] : null;
            const definition = await readState(() => this.reads.resolve(userId, sessionSource, execution?.prescriptionHash));
            sessions.set(ref, definition);
        }
        if (sessions.size === 0) {
            await save({ ...empty, active: false, state: 'not_applicable', reasonCode: 'no_planned_session',
                inputs: [
                    { name: 'planned_sessions_count', value: { value: 0, source: 'planned_sessions', state: 'measured' } },
                    { name: 'injury_constraints_count', value: { value: constraints?.length ?? null, source: 'training_settings',
                        state: constraints ? 'measured' : 'not_recorded' } },
                ] }, source);
        } else for (const [ref, definition] of sessions) {
            const evaluated = evaluateInjuryConstraintTouchesSession(constraints, date, data(definition));
            const result = failure(definition) ? failed(evaluated, 'session_definition', failure(definition)!) : evaluated;
            await save(result, { source, definition }, ref);
        }
    }
}
export const flagCaptureService = new FlagCaptureService();

const captureChains = new Map<string, Promise<void>>();

/**
 * Lazy, non-blocking lifecycle boundary. Never logs health records or document paths.
 * Captures run one at a time per user: `chooseRevision` reads the latest prior revision,
 * so overlapping captures could otherwise both judge against the same stale "latest".
 * The date and evaluation instant are taken when each queued capture starts.
 */
export function captureCurrentFlags(userId: string): Promise<void> {
    const previous = captureChains.get(userId) ?? Promise.resolve();
    const next = previous.then(() => flagCaptureService.captureForDate(userId, getLocalDateString())).catch(() => {
        console.warn('Flag capture unavailable; the export will retain explicit gaps.');
    });
    captureChains.set(userId, next);
    void next.finally(() => { if (captureChains.get(userId) === next) captureChains.delete(userId); });
    return next;
}
