import { buildLedgerExport } from '../ledger/export/buildLedgerExport';
import type { BuildLedgerExportInput, LedgerExportRecords, SourceKey, SourceReadInput } from '../ledger/export/inputs';
import type { LedgerExport, LedgerState } from '../ledger/export/schema';
import { LEDGER_PURPOSES } from '../ledger/export/schema';
import { resolveWindow } from '../ledger/export/window';
import { worstState } from '../ledger/export/ledgerValue';
import { addDaysToLocalDateString } from '../utils/localDate';
import type { DataState } from '../engine/dataState';
import { recoverySnapshotService } from './recoverySnapshotService';
import { checkinService } from './checkinService';
import { activityService } from './activityService';
import { trainingSettingsService } from './trainingSettingsService';
import { preferencesService } from './preferencesService';
import { goalService } from './goalService';
import { fixedActivityService } from './fixedActivityService';
import { planBlockService } from './planBlockService';
import { anthropometryService } from './anthropometryService';
import { constraintService } from './constraintService';
import { scheduleWindowService } from './scheduleWindowService';
import { sessionResponseService } from './sessionResponseService';
import { competitionOutcomeService } from './competitionOutcomeService';
import { nutritionService } from '../nutrition/nutritionService';
import { intentBlockService } from './intentBlockService';
import { assessmentHistoryService } from './assessmentHistoryService';
import { assessmentBriefBindingsForGoals } from '../observations/contextBriefAssessments';
import { performedTrainingOccurrenceRepository } from '../training-occurrence/repository';
import { sessionExecutionService } from './sessionExecutionService';
import { externalPlanService } from './externalPlanService';
import { computeContentHash } from '../engine/externalPlanHash';

interface Read<T> { data: T; state: LedgerState }
function fromState<T>(result: DataState<T>, empty: T): Read<T> {
    return result.status === 'AVAILABLE' ? { data: result.data, state: 'measured' }
        : { data: empty, state: result.status === 'MISSING' ? 'missing' : result.status === 'INVALID' ? 'invalid' : 'unavailable' };
}
const measured = <T,>(data: T): Read<T> => ({ data, state: 'measured' });
export type LedgerExportRequest = Pick<BuildLedgerExportInput, 'asOfDate' | 'purpose' | 'window'> & { exportedAt?: string };

/** User-initiated, read-only assembly. No default migration, reconciliation, or engine evaluation. */
export class LedgerExportService {
    async build(userId: string, request: LedgerExportRequest): Promise<LedgerExport> {
        if (!userId.trim() || userId.includes('/')) throw new Error('A user-scoped ledger export requires a user id');
        if (!LEDGER_PURPOSES.includes(request.purpose)) throw new Error('Unknown ledger export purpose');
        const window = resolveWindow(request.purpose, request.asOfDate, request.window);
        const through = addDaysToLocalDateString(window.endDate, 1);
        const upcomingEnd = addDaysToLocalDateString(request.asOfDate, 6);
        const exportedAt = request.exportedAt ?? new Date().toISOString();
        const records: LedgerExportRecords = {};
        const sources: Partial<Record<SourceKey, SourceReadInput>> = {};
        async function read<K extends keyof LedgerExportRecords>(key: SourceKey, recordKey: K,
            operation: () => Promise<Read<LedgerExportRecords[K]>>, empty: LedgerExportRecords[K]) {
            try {
                const result = await operation();
                records[recordKey] = result.data;
                sources[key] = { state: result.state, readAt: exportedAt };
            } catch {
                records[recordKey] = empty;
                sources[key] = { state: 'unavailable', readAt: exportedAt };
            }
        }
        let assessmentBindings: ReturnType<typeof assessmentBriefBindingsForGoals> = { bindings: [], unsupportedCount: 0 };
        await Promise.all([
            read('daily_recovery_snapshots', 'recovery', async () => fromState(await recoverySnapshotService.getRecoverySnapshotsInRangeState(userId, window.startDate, through), []), []),
            read('daily_subjective_checkins', 'checkins', async () => fromState(await checkinService.getCheckinsInRangeState(userId, window.startDate, through), []), []),
            read('activities', 'activities', async () => fromState(await activityService.getActivitiesInRange(userId, window.startDate, through), []), []),
            read('training_settings', 'trainingSettings', async () => fromState(await trainingSettingsService.peekTrainingSettingsState(userId), null), null),
            read('preferences', 'preferences', async () => fromState(await preferencesService.getPreferencesState(userId), null), null),
            read('goals', 'goals', async () => {
                const result = fromState(await goalService.getActiveGoalsState(userId), []);
                assessmentBindings = assessmentBriefBindingsForGoals(result.data);
                return result;
            }, []),
            read('fixed_activities', 'fixedActivities', async () => fromState(await fixedActivityService.getActivitiesInRangeState(userId, window.startDate, upcomingEnd), []), []),
            read('plan_blocks', 'planBlocks', async () => fromState(await planBlockService.getBlocksInRangeState(userId, window.startDate, upcomingEnd), []), []),
            read('anthropometry_entries', 'anthropometry', async () => measured(await anthropometryService.getEntriesInRange(userId, window.startDate, window.endDate)), []),
            read('constraints', 'constraints', async () => measured(await constraintService.listConstraints(userId)), []),
            read('schedule_windows', 'scheduleWindows', async () => {
                const dates = Array.from({ length: 7 }, (_, i) => addDaysToLocalDateString(request.asOfDate, i));
                const results = await Promise.all(dates.map(async date => fromState(await scheduleWindowService.getWindowsForDateState(userId, date), [])));
                return { data: results.flatMap(r => r.data), state: worstState(results.map(r => r.state)) };
            }, []),
            read('session_responses', 'sessionResponses', async () => fromState(await sessionResponseService.getResponsesInRangeState(userId, window.startDate, through), []), []),
            read('nutrition_days', 'nutritionDays', async () => fromState(await nutritionService.getNutritionDaysState(userId, window.startDate, window.endDate), []), []),
            read('competition_outcomes', 'competitionOutcomes', async () => {
                const result = await competitionOutcomeService.listForLedger(userId, window.startDate, window.endDate);
                return { data: result.outcomes, state: result.truncated ? 'unavailable' : result.unreadableCount ? 'invalid' : 'measured' };
            }, []),
            read('intent_blocks', 'intentBlocks', async () => {
                const result = await intentBlockService.getActiveBlocksWithDiagnostics(userId, window.startDate, 20, upcomingEnd);
                return { data: result.blocks, state: result.truncated ? 'unavailable' : result.unreadableCount ? 'invalid' : 'measured' };
            }, []),
        ]);
        const assessmentState = worstState([sources.goals?.state ?? 'unavailable']);
        await read('metric_observations', 'metricObservations', async () => {
            const bindings = assessmentBindings;
            const result = await assessmentHistoryService.loadPlanningAssessmentSources(userId, bindings.bindings, window.endDate);
            records.assessmentAttempts = [...new Map(result.sources.flatMap(s => s.attempts).map(a => [a.id, a])).values()];
            const state = worstState([assessmentState, result.relevanceState !== 'available' || result.omittedCount > 0 || bindings.unsupportedCount > 0
                || result.sources.some(s => s.unavailable || s.truncated) ? 'unavailable'
                : result.sources.some(s => s.unreadableCount > 0) ? 'invalid' : 'measured']);
            sources.assessment_attempts = { state, readAt: exportedAt };
            return { data: result.sources.flatMap(s => s.observations.map(o => o.revision)), state };
        }, []);
        if (!sources.assessment_attempts) {
            sources.assessment_attempts = { state: 'unavailable', readAt: exportedAt };
            records.assessmentAttempts = [];
        }
        const [performed, executions] = await Promise.allSettled([
            performedTrainingOccurrenceRepository.queryActiveInDateWindow(userId, window.startDate, window.endDate),
            sessionExecutionService.getExecutionsInRange(userId, window.startDate, through),
        ]);
        const executionRows = executions.status === 'fulfilled' ? executions.value.executions : [];
        const executionMap = new Map(executionRows.map(row => [row.execution.executionId, row]));
        records.performedOccurrences = performed.status === 'fulfilled' ? performed.value.map(occurrence => {
            const linked = occurrence.sourceRefs.filter(ref => ref.kind === 'structured_execution').map(ref => executionMap.get(ref.executionId));
            const entries = linked.flatMap(row => row?.entries ?? []).filter(e => e.payload.kind !== 'choice' && !e.deletedAt);
            return { ...occurrence, ...(linked.length > 0 && linked.every(Boolean) && executions.status === 'fulfilled' && executions.value.invalidRecords === 0 ? {
                structuredEntries: { exerciseCount: new Set(entries.map(e => (e.exerciseRef?.kind === 'catalog' ? e.exerciseRef.exerciseId : e.exerciseRef?.name) ?? e.stepId).filter(Boolean)).size, setCount: entries.length },
            } : {}) };
        }) : [];
        sources.performed_training_occurrences = { state: performed.status === 'rejected' || executions.status === 'rejected' ? 'unavailable'
            : executions.value.invalidRecords > 0 ? 'invalid' : 'measured', readAt: exportedAt };
        await read('planned_to_performed', 'plannedToPerformed', async () => {
            if (performed.status !== 'fulfilled' || executions.status !== 'fulfilled') return { data: [], state: 'unavailable' };
            let missingExecution = false;
            const rows = performed.value.flatMap(occurrence => occurrence.sourceRefs.flatMap(ref => {
                if (ref.kind !== 'structured_execution') return [];
                const execution = executionMap.get(ref.executionId)?.execution;
                if (!execution) missingExecution = true;
                const source = execution?.sessionSource;
                if (!execution || source?.kind !== 'external_plan') return [];
                return [{ planId: source.planId, revision: source.revision, sessionId: source.sessionId, date: execution.date, performedOccurrenceId: occurrence.performedOccurrenceId }];
            }));
            return { data: rows, state: missingExecution ? 'unavailable' : sources.performed_training_occurrences!.state ?? 'unavailable' };
        }, []);
        const verifiedPlans = await this.readPlans(userId, records, sources, exportedAt);
        records.plannedToPerformed = (records.plannedToPerformed ?? []).filter(link => {
            const verified = verifiedPlans.get(`${link.planId}@${link.revision}`);
            if (!verified) {
                sources.planned_to_performed!.state = worstState([sources.planned_to_performed!.state ?? 'measured',
                    sources.external_plan_revisions?.state === 'invalid' ? 'invalid' : 'unavailable']);
                return false;
            }
            const occurrence = performed.status === 'fulfilled'
                ? performed.value.find(row => row.performedOccurrenceId === link.performedOccurrenceId) : undefined;
            const matching = occurrence?.sourceRefs.some(ref => {
                if (ref.kind !== 'structured_execution') return false;
                const source = executionMap.get(ref.executionId)?.execution.sessionSource;
                return source?.kind === 'external_plan' && source.planId === link.planId && source.revision === link.revision
                    && source.sessionId === link.sessionId && source.contentHash === verified.contentHash;
            });
            if (matching && verified.sessionIds.has(link.sessionId)) return true;
            sources.planned_to_performed!.state = worstState([sources.planned_to_performed!.state ?? 'measured', 'invalid']);
            return false;
        });
        // Include the current identity only as redaction input, never as an exported field.
        const scopedRecords = { ...records, userId };
        return buildLedgerExport({ ...request, exportedAt, records: scopedRecords, sources });
    }

    private async readPlans(userId: string, records: LedgerExportRecords,
        sources: Partial<Record<SourceKey, SourceReadInput>>, readAt: string): Promise<Map<string, { contentHash: string; sessionIds: Set<string> }>> {
        const verified = new Map<string, { contentHash: string; sessionIds: Set<string> }>();
        records.planRevisions = [];
        records.placements = [];
        let revisionState: LedgerState = 'measured';
        let placementState: LedgerState = 'measured';
        try {
            const ids = await externalPlanService.listPlanIds(userId);
            if (ids.status !== 'AVAILABLE') throw new Error('Plan list unavailable');
            // References from performed work also preserve older revision provenance.
            for (const planId of [...ids.data].sort()) {
                const header = await externalPlanService.getHeaderState(userId, planId);
                const activations = await externalPlanService.getActivationState(userId, planId);
                if (header.status !== 'AVAILABLE') { revisionState = 'unavailable'; placementState = 'unavailable'; continue; }
                const refs = new Set([header.data.revision, ...(records.plannedToPerformed ?? []).filter(r => r.planId === planId).map(r => r.revision),
                    ...(activations.status === 'AVAILABLE' ? activations.data.map(a => a.revision) : [])]);
                if (activations.status !== 'AVAILABLE') revisionState = 'unavailable';
                for (const revision of [...refs].sort((a, b) => a - b)) {
                    const plan = await externalPlanService.getRevisionState(userId, planId, revision);
                    const placement = await externalPlanService.getPlacementState(userId, planId, revision);
                    if (placement.status === 'AVAILABLE') records.placements = [...records.placements, placement.data];
                    else if (placement.status !== 'MISSING') placementState = worstState([placementState, placement.status === 'INVALID' ? 'invalid' : 'unavailable']);
                    if (plan.status !== 'AVAILABLE') { revisionState = 'unavailable'; continue; }
                    const activation = activations.status === 'AVAILABLE' ? activations.data.find(a => a.revision === revision) : undefined;
                    const hash = revision === header.data.revision ? header.data.contentHash : activation?.contentHash;
                    const importedAt = revision === header.data.revision ? header.data.importedAt : activation?.activatedAt;
                    if (!hash || !importedAt || await computeContentHash(plan.data) !== hash) { revisionState = 'invalid'; continue; }
                    verified.set(`${planId}@${revision}`, { contentHash: hash, sessionIds: new Set(plan.data.sessions.map(session => session.id)) });
                    records.planRevisions = [...records.planRevisions, { planId, revision, contentHash: hash, importedAt, schema: plan.data.schema, notes: plan.data.notes }];
                }
            }
        } catch { revisionState = 'unavailable'; placementState = 'unavailable'; }
        sources.external_plan_revisions = { state: revisionState, readAt };
        sources.external_plan_placements = { state: placementState, readAt };
        return verified;
    }
}
export const ledgerExportService = new LedgerExportService();
