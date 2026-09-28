/** Offline, read-only validation and replayability accounting for schema-v2 TO4 exports. */
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

/**
 * Production validators run before any exported value can be considered. The current v2
 * exporter deliberately marks mutable historical sources unprovable; this function carries
 * those gaps into each candidate instead of rebuilding a date-D input from current state.
 */
export function assembleOfflineHistoricalContext(
    sourceEvidence: OfflineSourceEvidence,
    userId: string,
): OfflineHistoricalContextAssembly {
    const { startDate, endDateExclusive } = sourceEvidence.evaluationWindow;
    const dates = dateRange(startDate, endDateExclusive);
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
