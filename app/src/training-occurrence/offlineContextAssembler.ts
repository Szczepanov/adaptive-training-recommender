/** Offline, read-only validation and replayability accounting for schema-v2 TO4 exports. */
import { validateDecisionContext } from '../engine/decisionContext';
import { collapseTrainingHistoryReplay } from '../engine/historyReplayCapture';
import { POLICY_VERSION } from '../engine/policy';
import { getLocalDateString, addDaysToLocalDateString } from '../utils/localDate';
import { computeHistoricalReplayDigests, computeHistoricalHistoryDigest, type HistoricalReplayProvenance,
    type HistoricalDecisionInputs } from './historyRecommendationCounterfactual';
import type { PreparedTo4 } from './to4EvidencePreparation';
import { getMinimumSafetyCheckinStatus } from '../engine/safetyCheckin';
import { resolveLocalInstant } from '../engine/localInstant';
import {
    validateAuthoredPlanBlock,
    validateExternalPlanPlacement,
    validateFixedActivity,
    validateGoal,
    validatePreferences,
    validateScheduleOverlay,
    validateTrainingIntentProfile,
} from '../engine/validationCore';
import { validateScheduleWindowManifest } from '../engine/scheduleWindows';
import { validateSessionOccurrence } from '../sessions/validation';
import { validateAnyExternalTrainingPlan } from '../sessions/externalPlanValidation';
import { parseDailyRecommendation, parseNormalizedGarminActivity } from '../persistence/parsers/trainingHistory';
import { parseSessionEntryDocument, parseSessionExecutionDocument } from '../persistence/parsers/sessionExecution';
import { parseTrainingSettings } from '../persistence/parsers/trainingSettings';
import { parseRecoverySnapshot, parseSubjectiveCheckin } from '../persistence/parsers/decisionInputs';
import { parsePerformedTrainingOccurrence } from './validation';
import type { HistoricalDateInput } from './historyRecommendationCounterfactual';
import type { OfflineSourceEvidence } from './to4EvidencePreparation';

const PROVENANCE_REASONS: Readonly<Record<string, string>> = {
    performedTrainingOccurrences: 'performed_history_unprovable',
    activities: 'activity_history_unprovable',
    dailyRecommendations: 'recommendation_history_unprovable',
    dailyRecoverySnapshots: 'recovery_history_unprovable',
    dailySubjectiveCheckins: 'subjective_checkin_history_unprovable',
    fixedActivities: 'fixed_activity_history_unprovable',
    scheduleOverlays: 'schedule_overlay_history_unprovable',
    planBlocks: 'plan_block_history_unprovable',
    scheduleWindowManifests: 'schedule_window_history_unprovable',
    sessionOccurrences: 'session_occurrence_history_unprovable',
    trainingSettings: 'training_settings_history_unprovable',
    preferences: 'preferences_history_unprovable',
    trainingIntentProfiles: 'training_intent_history_unprovable',
    goals: 'goal_history_unprovable',
    intentBlocks: 'progression_history_unprovable',
    externalPlans: 'external_plan_history_unprovable',
};

function dateRange(start: string, endExclusive: string): string[] {
    const dates: string[] = [];
    const cursor = new Date(`${start}T00:00:00.000Z`);
    const end = Date.parse(`${endExclusive}T00:00:00.000Z`);
    while (cursor.getTime() < end) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

function validationOk(result: { isValid?: boolean; ok?: boolean }): boolean {
    return result.isValid === true || result.ok === true;
}

function recordDate(row: { data: Record<string, unknown> }): string | null {
    const value = row.data.date ?? row.data.localDate;
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export interface OfflineSourceCoverage {
    candidateDates: number;
    minimumSafetyCheckin: Record<'complete' | 'missing' | 'incomplete' | 'invalid' | 'provenIncomplete', number>;
    sources: Record<string, { provenance: 'exact_revision' | 'unprovable' | 'missing'; records: number; invalidRecords: number }>;
    notReplayableByReason: Record<string, number>;
}

export interface OfflineHistoricalContextAssembly {
    dates: string[];
    inputForDate(date: string): HistoricalDateInput;
    sourceCoverage: OfflineSourceCoverage;
}

export interface OfflineReplayOptions extends HistoricalReplayProvenance {
    canonicalHistory: PreparedTo4['replayCanonicalHistory'];
}

async function hydrateCapturedDate(
    evidence: OfflineSourceEvidence, userId: string, date: string, dateAlias: string,
    options?: OfflineReplayOptions,
): Promise<HistoricalDateInput | null> {
    const blocked = (reason: string): HistoricalDateInput => ({ status: 'not_replayable', dateAlias, reasonCodes: [reason] });
    if (evidence.decisionContexts?.some(row => !row || typeof row !== 'object'
        || typeof row.recommendationId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.recommendationId))) {
        return blocked('captured_context_export_invalid');
    }
    const records = evidence.decisionContexts?.filter(row => row.recommendationId === date) ?? [];
    const current = evidence.dailyRecommendations.filter(row => row.id === date);
    const archives = evidence.dailyRecommendationRevisions.filter(row => row.recommendationId === date);
    const recommendations = current.length ? current : archives.sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 1);
    const rec = recommendations[0]?.data;
    const audit = rec?.recommendationAudit as Record<string, unknown> | undefined;
    const binding = audit?.decisionContext as Record<string, unknown> | undefined;
    if (!records.length && !binding) return null;
    const revision = rec ? rec.revision : 0;
    const matches = records.filter(row => row.id === String(revision));
    if (matches.length !== 1) return blocked('captured_context_missing_or_ambiguous');
    let record;
    try {
        record = await validateDecisionContext(matches[0].data, {
            userId, date, recommendationRevision: revision as number,
        });
    } catch { return blocked('captured_context_invalid'); }
    if (record.policyVersion !== POLICY_VERSION || (options && options.policyVersion !== record.policyVersion)
        || getLocalDateString(new Date(record.evaluatedAt)) !== date) return blocked('captured_context_policy_or_instant_mismatch');
    if (record.minimumSafetyStatus !== 'complete') {
        return { status: 'not_applicable', dateAlias, reasonCode: `minimum_safety_checkin_${record.minimumSafetyStatus}` };
    }
    const path = `users/${userId}/daily_recommendations/${date}/decision_contexts/${revision}`;
    if (recommendations.length !== 1 || rec?.userId !== userId || rec.date !== date
        || parseDailyRecommendation(rec, path).status !== 'AVAILABLE'
        || !binding || binding.path !== path || binding.revision !== revision
        || binding.contentHash !== record.contentHash || audit?.policyVersion !== record.policyVersion
        || audit.evaluatedAt !== record.evaluatedAt) return blocked('captured_context_audit_binding_mismatch');
    const replay = record.trainingHistoryReplay;
    if (!replay || !record.evaluatorInputs || !record.mechanicalCheckinHistory) return blocked('captured_history_missing');
    if (audit.decisionContextRevision !== replay.preparedSnapshot.revision) return blocked('captured_history_revision_mismatch');
    let broad;
    try { broad = collapseTrainingHistoryReplay(replay.preparedSnapshot, replay.capture); }
    catch { return blocked('captured_history_invalid_or_inconsistent'); }
    if (!options) return blocked('canonical_history_not_supplied');
    const start = addDaysToLocalDateString(date, -broad.windowDays);
    if (options.canonicalHistory.invalidRecords > 0 || options.canonicalHistory.unknownDates.some(unknown => !unknown || (unknown >= start && unknown < date))) {
        return blocked('canonical_history_incomplete');
    }
    for (const source of ['performedTrainingOccurrences', 'activities', 'dailyRecommendations'] as const) {
        const bounds = evidence.sourceEvidenceBounds[source];
        if (bounds.startDate > start || bounds.endDateExclusive < date) return blocked('canonical_history_window_incomplete');
    }
    const { exposures: _exposures, revision: _revision, ...base } = replay.preparedSnapshot;
    void _exposures; void _revision;
    const captured = record.evaluatorInputs;
    const inputs: HistoricalDecisionInputs = {
        ...captured, userId, exportedUserId: userId, date, dateAlias, evaluatedAt: record.evaluatedAt,
        fixedActivities: captured.fixedActivities ?? [], authoredPlanBlocks: captured.authoredPlanBlocks ?? [],
        trainingIntentProfile: captured.trainingIntentProfile ?? null, preferences: captured.preferences ?? null,
        scheduleOverlays: captured.scheduleOverlays ?? [],
        minimumSafetyCheckinStatus: 'complete', normalRecommendationEligible: true,
        externalContext: captured.externalPlan ?? null, externalRestContext: captured.externalRest ?? null,
        confirmedProgressionOverrides: new Map(captured.confirmedProgressionOverrides),
        mechanicalCheckinHistory: record.mechanicalCheckinHistory as HistoricalDecisionInputs['mechanicalCheckinHistory'],
        preparedHistorySnapshot: { ...base, performedTrainingFacts: record.performedTrainingFacts },
        capturedHistoryRequests: replay.capture.requests,
    };
    const digests = await computeHistoricalReplayDigests(inputs, options);
    const canonicalExposures = options.canonicalHistory.exposures.filter(row => row.date >= start && row.date < date);
    const canonicalRevision = `canonical-replay:${await computeHistoricalHistoryDigest('canonical', canonicalExposures)}`;
    return {
        status: 'replayable', inputs,
        live: { ...digests, revision: replay.preparedSnapshot.revision, exposures: broad.exposures,
            digest: await computeHistoricalHistoryDigest(replay.preparedSnapshot.revision, broad.exposures), useCapturedRevisions: true },
        canonical: { ...digests, revision: canonicalRevision, exposures: canonicalExposures,
            digest: await computeHistoricalHistoryDigest(canonicalRevision, canonicalExposures) },
    };
}

/**
 * Production validators run before any exported value can be considered. The current v2
 * exporter deliberately marks mutable historical sources unprovable; this function carries
 * those gaps into each candidate instead of rebuilding a date-D input from current state.
 */
export async function assembleOfflineHistoricalContext(
    sourceEvidence: OfflineSourceEvidence,
    userId: string,
    options?: OfflineReplayOptions,
): Promise<OfflineHistoricalContextAssembly> {
    const { startDate, endDateExclusive } = sourceEvidence.evaluationWindow;
    const dates = dateRange(startDate, endDateExclusive);
    const capturedByDate = new Map<string, HistoricalDateInput>();
    for (let index = 0; index < dates.length; index += 1) {
        const date = dates[index];
        const captured = await hydrateCapturedDate(sourceEvidence, userId, date, `D${String(index + 1).padStart(3, '0')}`, options);
        if (captured) capturedByDate.set(date, captured);
    }
    const invalidByDate = new Map<string, Set<string>>();
    const globalValidationReasons = new Set<string>();
    const sourceCounts: OfflineSourceCoverage['sources'] = {};

    const validateRows = (
        key: keyof OfflineSourceEvidence,
        rows: readonly { id: string; data: Record<string, unknown>; recommendationId?: string; planId?: string }[],
        validate: (data: Record<string, unknown>, id: string, row: { recommendationId?: string; planId?: string }) => boolean,
        code: string,
    ) => {
        let invalidRecords = 0;
        for (const row of rows) {
            if (validate(row.data, row.id, row)) continue;
            invalidRecords += 1;
            const date = recordDate(row);
            if (date && date >= startDate && date < endDateExclusive) {
                const reasons = invalidByDate.get(date) ?? new Set<string>();
                reasons.add(code);
                invalidByDate.set(date, reasons);
            } else globalValidationReasons.add(code);
        }
        const provenance = sourceEvidence.sourceProvenance[String(key)];
        sourceCounts[String(key)] = {
            provenance: provenance?.status === 'exact_revision' ? 'exact_revision' : provenance ? 'unprovable' : 'missing',
            records: rows.length,
            invalidRecords,
        };
    };

    validateRows('dailyRecoverySnapshots', sourceEvidence.dailyRecoverySnapshots, (data, id) => {
        return parseRecoverySnapshot(data, `users/${userId}/daily_recovery_snapshots/${id}`, userId, id).status === 'AVAILABLE';
    }, 'recovery_snapshot_invalid');
    validateRows('dailySubjectiveCheckins', sourceEvidence.dailySubjectiveCheckins, (data, id) => {
        return parseSubjectiveCheckin(data, `users/${userId}/daily_subjective_checkins/${id}`, userId, id).status === 'AVAILABLE';
    }, 'subjective_checkin_invalid');
    validateRows('performedTrainingOccurrences', sourceEvidence.performedTrainingOccurrences, (data, id) => {
        try {
            return parsePerformedTrainingOccurrence(data, userId).performedOccurrenceId === id;
        } catch {
            return false;
        }
    }, 'performed_occurrence_invalid');
    validateRows('activities', sourceEvidence.activities, (data, id) =>
        parseNormalizedGarminActivity(data, `users/${userId}/activities/${id}`, id).status === 'AVAILABLE', 'activity_invalid');
    validateRows('dailyRecommendations', sourceEvidence.dailyRecommendations, (data, id) =>
        data.userId === userId && data.date === id
            && parseDailyRecommendation(data, `users/${userId}/daily_recommendations/${id}`).status === 'AVAILABLE', 'recommendation_invalid');
    validateRows('sessionExecutions', sourceEvidence.sessionExecutions, (data, id) =>
        parseSessionExecutionDocument(data, `users/${userId}/session_executions/${id}`).status === 'AVAILABLE', 'session_execution_invalid');
    validateRows('sessionEntries', sourceEvidence.sessionEntries, (data, id) =>
        parseSessionEntryDocument(data, `users/${userId}/session_executions/*/entries/${id}`).status === 'AVAILABLE', 'session_entry_invalid');
    validateRows('fixedActivities', sourceEvidence.fixedActivities, data => validationOk(validateFixedActivity(data)), 'fixed_activity_invalid');
    validateRows('scheduleOverlays', sourceEvidence.scheduleOverlays, data => validationOk(validateScheduleOverlay(data)), 'schedule_overlay_invalid');
    validateRows('planBlocks', sourceEvidence.planBlocks, data => validationOk(validateAuthoredPlanBlock(data)), 'plan_block_invalid');
    validateRows('scheduleWindowManifests', sourceEvidence.scheduleWindowManifests, data => validationOk(validateScheduleWindowManifest(data)), 'schedule_window_invalid');
    validateRows('sessionOccurrences', sourceEvidence.sessionOccurrences, data => validationOk(validateSessionOccurrence(data)), 'session_occurrence_invalid');
    validateRows('goals', sourceEvidence.goals, data => validationOk(validateGoal(data)), 'goal_invalid');
    validateRows('trainingSettings', sourceEvidence.trainingSettings, data => parseTrainingSettings(data, userId) !== null, 'training_settings_invalid');
    validateRows('preferences', sourceEvidence.preferences, data => validationOk(validatePreferences(data)), 'preferences_invalid');
    validateRows('trainingIntentProfiles', sourceEvidence.trainingIntentProfiles, data => validationOk(validateTrainingIntentProfile(data)), 'training_intent_invalid');
    validateRows('externalPlanRevisions', sourceEvidence.externalPlanRevisions, data => validationOk(validateAnyExternalTrainingPlan(data)), 'external_plan_revision_invalid');
    validateRows('externalPlanPlacements', sourceEvidence.externalPlanPlacements, data => validationOk(validateExternalPlanPlacement(data)), 'external_plan_placement_invalid');
    for (const key of ['externalPlanHeaders', 'intentBlockHeaders', 'intentBlockRevisions'] as const) {
        const rows = sourceEvidence[key];
        const provenance = sourceEvidence.sourceProvenance[key === 'externalPlanHeaders' ? 'externalPlans' : 'intentBlocks'];
        sourceCounts[key] = {
            provenance: provenance?.status === 'exact_revision' ? 'exact_revision' : provenance ? 'unprovable' : 'missing',
            records: rows.length,
            invalidRecords: 0,
        };
    }

    validateRows('dailyRecommendationRevisions', sourceEvidence.dailyRecommendationRevisions, (data, id, row) => {
        const recommendationId = row.recommendationId;
        if (!recommendationId || data.userId !== userId || data.date !== recommendationId) return false;
        return parseDailyRecommendation(
            data,
            `users/${userId}/daily_recommendations/${recommendationId}/revisions/${id}`,
        ).status === 'AVAILABLE';
    }, 'recommendation_revision_invalid');

    const globalReasons = [
        ...globalValidationReasons,
        ...Object.entries(PROVENANCE_REASONS).flatMap(([source, reason]) => {
        const state = sourceEvidence.sourceProvenance[source];
        return state?.status === 'unprovable' || !state ? [reason] : [];
        }),
    ];
    const minimumSafetyCheckin = { complete: 0, missing: 0, incomplete: 0, invalid: 0, provenIncomplete: 0 };
    const provenNotApplicable = new Map<string, string>();
    for (const date of dates) {
        const captured = capturedByDate.get(date);
        if (captured) {
            if (captured.status === 'replayable') minimumSafetyCheckin.complete += 1;
            else if (captured.status === 'not_applicable') {
                if (captured.reasonCode === 'minimum_safety_checkin_incomplete') {
                    minimumSafetyCheckin.incomplete += 1;
                    minimumSafetyCheckin.provenIncomplete += 1;
                } else minimumSafetyCheckin.missing += 1;
            }
            continue;
        }
        const row = sourceEvidence.dailySubjectiveCheckins.find(item => item.id === date);
        if (!row) {
            minimumSafetyCheckin.missing += 1;
            continue;
        }
        const parsed = parseSubjectiveCheckin(row.data, `users/${userId}/daily_subjective_checkins/${date}`, userId, date);
        if (parsed.status !== 'AVAILABLE') {
            minimumSafetyCheckin.invalid += 1;
            continue;
        }
        const status = getMinimumSafetyCheckinStatus(parsed.data);
        minimumSafetyCheckin[status] += 1;
        const midnight = resolveLocalInstant(date, '00:00', 'Europe/Warsaw');
        const createdAt = row.data.createdAt;
        const updatedAt = parsed.revision;
        if (status === 'incomplete' && midnight.status === 'resolved'
            && typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt))
            && typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt))
            && Date.parse(createdAt) <= Date.parse(midnight.instant)
            && Date.parse(updatedAt) >= Date.parse(createdAt)
            && Date.parse(updatedAt) <= Date.parse(midnight.instant)) {
            minimumSafetyCheckin.provenIncomplete += 1;
            provenNotApplicable.set(date, 'minimum_safety_checkin_incomplete');
        }
    }
    const aliases = new Map(dates.map((date, index) => [date, `D${String(index + 1).padStart(3, '0')}`]));
    const reasonsByDate = new Map<string, string[]>();
    const notReplayableByReason: Record<string, number> = {};
    for (const date of dates) {
        const captured = capturedByDate.get(date);
        if (captured) {
            if (captured.status === 'not_replayable') {
                for (const reason of captured.reasonCodes) notReplayableByReason[reason] = (notReplayableByReason[reason] ?? 0) + 1;
            }
            continue;
        }
        if (provenNotApplicable.has(date)) continue;
        const reasons = [...new Set([...globalReasons, ...(invalidByDate.get(date) ?? [])])].sort();
        // No replayable shape can be created unless every required date-D source is proven.
        if (reasons.length === 0) reasons.push('historical_context_not_assembled');
        reasonsByDate.set(date, reasons);
        for (const reason of reasons) notReplayableByReason[reason] = (notReplayableByReason[reason] ?? 0) + 1;
    }

    return {
        dates,
        inputForDate(date) {
            const captured = capturedByDate.get(date);
            if (captured) return captured;
            const notApplicable = provenNotApplicable.get(date);
            if (notApplicable) return { status: 'not_applicable', reasonCode: notApplicable, dateAlias: aliases.get(date) };
            const reasons = reasonsByDate.get(date);
            if (!reasons) throw new Error(`Date ${date} is outside the evaluation window.`);
            return { status: 'not_replayable', dateAlias: aliases.get(date), reasonCodes: reasons };
        },
        sourceCoverage: {
            candidateDates: dates.length,
            minimumSafetyCheckin,
            sources: Object.fromEntries(Object.entries(sourceCounts).sort(([a], [b]) => a.localeCompare(b))),
            notReplayableByReason: Object.fromEntries(Object.entries(notReplayableByReason).sort(([a], [b]) => a.localeCompare(b))),
        },
    };
}
