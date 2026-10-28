import type { DataState } from '../engine/dataState';
import type { FlagEvaluation } from '../derived/flags/flagEvaluation';
import { ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION } from '../derived/flags/illnessAnomaly/illnessAnomalyFlag';
import { evaluateIllnessRiskSymptom } from '../derived/flags/illnessRiskSymptom';
import { evaluateRecoveryBeyondBaseline, RECOVERY_BEYOND_BASELINE_WINDOW } from '../derived/flags/recoveryBeyondBaseline';
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
    persist: flagEvaluationRepository.persistImmutable,
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

/** Captures only the current Warsaw date; export never calls this writer. */
export class FlagCaptureService {
    private readonly reads: typeof defaultReads;
    constructor(reads: typeof defaultReads = defaultReads) { this.reads = reads; }

    async captureForDate(userId: string, date: string, today = getLocalDateString(), evaluatedAt = new Date().toISOString()): Promise<void> {
        if (!userId.trim() || userId.includes('/')) throw new Error('Invalid flag owner');
        assertLocalDate(date, 'observedOn');
        if (date !== today) throw new Error('Only the current Warsaw date may be captured');
        const [recovery, checkin, settings, plan, occurrences, executionRead] = await Promise.all([
            readState(() => this.reads.recovery(userId, date)),
            readState(() => this.reads.checkin(userId, date)),
            readState(() => this.reads.settings(userId)),
            readState(() => this.reads.plan(userId, date)),
            readState(() => this.reads.occurrences(userId, date)),
            this.reads.executions(userId, date).then(value => ({ status: 'AVAILABLE' as const, data: value }),
                () => ({ status: 'UNAVAILABLE' as const })),
        ]);
        const save = async (evaluation: FlagEvaluation, source: unknown, sessionRef?: string, baselineWindow?: string) => {
            // A digest binds mutable inputs without copying private notes or account identifiers.
            const fingerprint = await flagEvidenceDigest(source);
            const flag = { ...evaluation, inputs: [...evaluation.inputs, { name: 'source_revision',
                value: { value: fingerprint, source: 'flag_capture', state: 'measured' as const } }] };
            await this.reads.persist(await buildFlagEvaluationRevision({ userId, observedOn: date, evaluatedAt,
                evaluation: flag, ...(sessionRef ? { sessionRef } : {}), ...(baselineWindow ? { baselineWindow } : {}) }));
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
        await save(failure(recovery) ? failed(recoveryFlag, 'daily_recovery_snapshots', failure(recovery)!) : recoveryFlag,
            recovery, undefined, RECOVERY_BEYOND_BASELINE_WINDOW);
        await save(failure(checkin) ? failed(checkinFlag, 'daily_subjective_checkins', failure(checkin)!) : checkinFlag, checkin);
        await save({
            id: 'illness_anomaly', active: null, state: 'not_yet_supported', reasonCode: 'ha7_release_gate_unmet',
            definitionVersion: ILLNESS_ANOMALY_FLAG_DEFINITION_VERSION, threshold: 'Withheld until the HA7 release gate is met',
            inputs: [{ name: 'ha7_release_gate', value: { value: 'unmet', source: 'health_anomaly_assessment', state: 'not_yet_supported' } }],
        }, 'ha7_release_gate_unmet');

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

/** Lazy, non-blocking lifecycle boundary. Never logs health records or document paths. */
export function captureCurrentFlags(userId: string): void {
    void flagCaptureService.captureForDate(userId, getLocalDateString()).catch(() => {
        console.warn('Flag capture unavailable; the export will retain explicit gaps.');
    });
}
