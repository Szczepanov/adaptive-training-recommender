/**
 * TO4 (#646) input preparation: turns one user-scoped raw record export into the sanitized
 * prepared input consumed by `scripts/training-occurrence-evidence.mjs`.
 *
 * Pure and deterministic. Raw documents go through the production parsers; the live side is
 * the production `buildTrainingHistorySnapshot` (manual-training policy off, as in production);
 * the canonical side is `canonicalBroadHistory.ts`. The returned `preparedInput` contains only
 * opaque aliases, engine-shaped exposure rows and aggregate counts -- never user, occurrence,
 * execution or activity IDs. The separate `privateReviewSheet` does contain source keys and is
 * for a local, ignored review file only.
 */
import type { DailyRecommendation, NormalizedGarminActivity } from '../engine/models';
import type { CompletedExposure } from '../engine/trainingHistory';
import type { SessionExecution } from '../sessions/models';
import { buildTrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import { parseDailyRecommendation, parseNormalizedGarminActivity } from '../persistence/parsers/trainingHistory';
import { parseSessionExecutionDocument } from '../persistence/parsers/sessionExecution';
import { getLocalDateString } from '../utils/localDate';
import {
    PERFORMED_OCCURRENCE_SCHEMA_VERSION,
    RECONCILIATION_MATCHER_VERSION,
    RECONCILIATION_POLICY_VERSION,
    isProviderActivityRef,
    isStructuredExecutionRef,
    type PerformedTrainingOccurrence,
} from './models';
import { parsePerformedTrainingOccurrence } from './validation';
import {
    computeCanonicalIdentityMetrics,
    pairLiveAndCanonicalHistory,
    type CanonicalHistorySources,
    type HistoryPairingResult,
} from './canonicalBroadHistory';
import { compareCompletedExposureSets } from './historyCounterfactual';

export interface RawRecordDocument {
    id: string;
    data: unknown;
}

/** Shape written by `python -m garmin_sync export-training-occurrence-records`. */
export interface TrainingOccurrenceRecordExport {
    schemaVersion: 1;
    userId: string;
    window: { startDate: string; endDateExclusive: string };
    performedTrainingOccurrences: RawRecordDocument[];
    sessionExecutions: RawRecordDocument[];
    activities: RawRecordDocument[];
    dailyRecommendations: RawRecordDocument[];
}

export type ReviewLabel = 'correct_merge' | 'false_positive_merge' | 'correct_separate' | 'false_negative_split';

export interface PrepareOptions {
    sourceCommit: string;
    coveragePolicyVersion: string;
    fitFingerprintVersion: string;
    /** Reviewer labels keyed by the opaque alias printed in the private review sheet. */
    labels?: Readonly<Record<string, ReviewLabel>>;
}

type GateState = 'pass' | 'fail' | 'not_evaluated';

export interface PreparedTo4 {
    preparedInput: Record<string, unknown>;
    liveExposures: CompletedExposure[];
    canonicalExposures: CompletedExposure[];
    privateReviewSheet: Array<Record<string, unknown>>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(start: string, endExclusive: string): number {
    return Math.round((Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

interface ParsedRecords {
    occurrences: PerformedTrainingOccurrence[];
    executions: SessionExecution[];
    activities: NormalizedGarminActivity[];
    recommendations: DailyRecommendation[];
    crossUserRecords: number;
    invalidRecords: number;
}

function parseRecords(raw: TrainingOccurrenceRecordExport): ParsedRecords {
    const parsed: ParsedRecords = { occurrences: [], executions: [], activities: [], recommendations: [], crossUserRecords: 0, invalidRecords: 0 };
    const ownerOf = (data: unknown): unknown => (data && typeof data === 'object' ? (data as Record<string, unknown>).userId : undefined);
    const foreign = (data: unknown): boolean => {
        const owner = ownerOf(data);
        return owner !== undefined && owner !== raw.userId;
    };
    for (const document of raw.performedTrainingOccurrences) {
        if (foreign(document.data)) { parsed.crossUserRecords += 1; continue; }
        try {
            parsed.occurrences.push(parsePerformedTrainingOccurrence(document.data, raw.userId));
        } catch {
            parsed.invalidRecords += 1;
        }
    }
    for (const document of raw.sessionExecutions) {
        if (foreign(document.data)) { parsed.crossUserRecords += 1; continue; }
        const state = parseSessionExecutionDocument(document.data, `session_executions/${document.id}`);
        if (state.status === 'AVAILABLE') parsed.executions.push(state.data);
        else parsed.invalidRecords += 1;
    }
    for (const document of raw.activities) {
        if (foreign(document.data)) { parsed.crossUserRecords += 1; continue; }
        const state = parseNormalizedGarminActivity(document.data, `activities/${document.id}`, document.id);
        if (state.status === 'AVAILABLE') parsed.activities.push(state.data);
        else parsed.invalidRecords += 1;
    }
    for (const document of raw.dailyRecommendations) {
        if (foreign(document.data)) { parsed.crossUserRecords += 1; continue; }
        const state = parseDailyRecommendation(document.data, `daily_recommendations/${document.id}`);
        if (state.status === 'AVAILABLE') parsed.recommendations.push(state.data);
        else parsed.invalidRecords += 1;
    }
    return parsed;
}

function strataFor(
    occurrences: readonly PerformedTrainingOccurrence[],
    sources: CanonicalHistorySources,
): Record<string, number> {
    const active = occurrences.filter(occurrence => occurrence.status === 'active');
    const strata: Record<string, number> = {};
    const add = (key: string) => { strata[key] = (strata[key] ?? 0) + 1; };
    const sameDay = new Map<string, number>();
    for (const occurrence of active) {
        const structured = occurrence.sourceRefs.filter(isStructuredExecutionRef);
        const garmin = occurrence.sourceRefs.filter(isProviderActivityRef);
        const execution = structured[0] ? sources.executionsById.get(structured[0].executionId) : undefined;
        if (structured.length && garmin.length) {
            add(/strength|weight|lift/i.test(occurrence.modality ?? '') ? 'matched_structured_garmin_strength' : 'matched_structured_garmin_endurance');
        } else if (structured.length) add('structured_only');
        else add('garmin_only');
        if (execution?.sessionSource.kind === 'manual') add('manual_authored_execution');
        if (execution?.sessionSource.kind === 'external_plan') add('imported_external_execution');
        if (occurrence.reconciliation.state === 'ambiguous') add('ambiguous_candidates');
        const decision = occurrence.reconciliation.manualDecision?.decision;
        if (decision === 'unlink' || decision === 'keep_separate') add('manual_unlink_keep_separate');
        if (garmin.some(ref => !sources.activitiesById.has(ref.activityId))) add('incomplete_garmin_detail');
        if (occurrence.startedAt && occurrence.localDate && Number.isFinite(Date.parse(occurrence.startedAt))
            // UTC calendar date differs from the Warsaw performed date: the midnight/timezone
            // boundary stratum (DST transitions are a subset, not separately detected).
            && occurrence.startedAt.slice(0, 10) !== occurrence.localDate) add('timezone_dst_boundary');
        const dayKey = `${occurrence.localDate ?? ''}|${occurrence.modality ?? ''}`;
        sameDay.set(dayKey, (sameDay.get(dayKey) ?? 0) + 1);
    }
    for (const count of sameDay.values()) if (count > 1) strata.same_day_same_modality = (strata.same_day_same_modality ?? 0) + count;
    return strata;
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

function occurrencesInWindow(
    occurrences: readonly PerformedTrainingOccurrence[],
    window: TrainingOccurrenceRecordExport['window'],
): PerformedTrainingOccurrence[] {
    return occurrences.filter(occurrence => {
        const date = occurrence.localDate
            ?? (occurrence.startedAt && Number.isFinite(Date.parse(occurrence.startedAt)) ? getLocalDateString(new Date(occurrence.startedAt)) : undefined);
        return date !== undefined && date >= window.startDate && date < window.endDateExclusive;
    });
}

function pair(parsed: ParsedRecords, window: TrainingOccurrenceRecordExport['window']): {
    pairing: HistoryPairingResult;
    liveEvents: ReturnType<typeof buildTrainingHistorySnapshot>['completedEvents'];
    sources: CanonicalHistorySources;
} {
    const inWindow = (date: string) => date >= window.startDate && date < window.endDateExclusive;
    const activities = parsed.activities.filter(activity => inWindow(activity.date));
    const recommendations = parsed.recommendations.filter(recommendation => inWindow(recommendation.date));
    const snapshot = buildTrainingHistorySnapshot(
        window.endDateExclusive,
        daysBetween(window.startDate, window.endDateExclusive),
        { status: 'AVAILABLE', data: activities, revision: 'to4-export' },
        { status: 'AVAILABLE', data: recommendations, revision: 'to4-export' },
        '1970-01-01T00:00:00.000Z',
    );
    const sources: CanonicalHistorySources = {
        // Hydration may use the wider exported activity set (an occurrence near the window edge
        // can reference an activity whose provider date is just outside it).
        activitiesById: new Map(parsed.activities.map(activity => [activity.activityId, activity])),
        executionsById: new Map(parsed.executions.map(execution => [execution.executionId, execution])),
        recommendationsByDate: new Map(parsed.recommendations.map(recommendation => [recommendation.date, recommendation])),
    };
    const occurrences = occurrencesInWindow(parsed.occurrences, window);
    const pairing = pairLiveAndCanonicalHistory({
        liveEvents: snapshot.completedEvents,
        liveExposures: snapshot.exposures,
        occurrences,
        sources,
    });
    return { pairing, liveEvents: snapshot.completedEvents, sources };
}

export function prepareTo4Evidence(raw: TrainingOccurrenceRecordExport, options: PrepareOptions): PreparedTo4 {
    if (raw.schemaVersion !== 1 || typeof raw.userId !== 'string' || raw.userId.length === 0) {
        throw new Error('Record export must be schemaVersion 1 with a userId scope.');
    }
    if (!DATE.test(raw.window?.startDate ?? '') || !DATE.test(raw.window?.endDateExclusive ?? '') || raw.window.startDate >= raw.window.endDateExclusive) {
        throw new Error('Record export window must be YYYY-MM-DD with startDate < endDateExclusive.');
    }
    const parsed = parseRecords(raw);
    const first = pair(parsed, raw.window);
    // Determinism gate: a second independent derivation from the same parsed input must match.
    const second = pair(parseRecords(raw), raw.window);
    const deterministic = stableJson([first.pairing.liveExposures, first.pairing.canonicalExposures, first.pairing.unknownCanonicalOccurrenceKeys])
        === stableJson([second.pairing.liveExposures, second.pairing.canonicalExposures, second.pairing.unknownCanonicalOccurrenceKeys]);

    const windowOccurrences = occurrencesInWindow(parsed.occurrences, raw.window);
    const identity = computeCanonicalIdentityMetrics(windowOccurrences, first.liveEvents);
    const comparison = compareCompletedExposureSets(first.pairing.liveExposures, first.pairing.canonicalExposures, first.pairing.unknownCanonicalOccurrenceKeys);
    const exactOf = (row: CompletedExposure | undefined) => Boolean(row?.workoutId || row?.templateId);
    let upgrades = 0;
    let downgrades = 0;
    for (const canonical of first.pairing.canonicalExposures) {
        const live = first.pairing.liveExposures.filter(row => row.occurrenceKey === canonical.occurrenceKey);
        if (live.length !== 1) continue;
        if (exactOf(canonical) && !exactOf(live[0])) upgrades += 1;
        if (!exactOf(canonical) && exactOf(live[0])) downgrades += 1;
    }

    const privateReviewSheet = [...first.pairing.privateAliasSources.entries()]
        .filter(([, entry]) => entry.canonicalSourceKeys.length > 1 || entry.liveSourceKeys.length !== 1
            || entry.canonicalSourceKeys.length === 0)
        .map(([alias, entry]) => ({ alias, ...entry, label: options.labels?.[alias] ?? null }));
    // Labels bind to the reviewable aliases of this exact export (the CLI additionally checks
    // the records hash). The reviewed sample is every multi-source (automatically merged) group;
    // the false-positive gate passes only when that whole sample is labelled.
    const reviewable = new Set(privateReviewSheet.map(row => row.alias));
    const mergedAliases = privateReviewSheet.filter(row => row.canonicalSourceKeys.length > 1).map(row => row.alias);
    const labels = Object.entries(options.labels ?? {});
    if (labels.some(([alias]) => !reviewable.has(alias))) throw new Error('Review labels reference an alias absent from this export review sheet.');
    const falsePositiveMerges = labels.filter(([, label]) => label === 'false_positive_merge').length;
    const mergedFullyLabelled = mergedAliases.every(alias => options.labels?.[alias] !== undefined);
    const canonicalAliasCounts = new Map<string, number>();
    for (const row of first.pairing.canonicalExposures) canonicalAliasCounts.set(row.occurrenceKey ?? '', (canonicalAliasCounts.get(row.occurrenceKey ?? '') ?? 0) + 1);
    const audit = first.pairing.audit;
    const totalRecords = raw.performedTrainingOccurrences.length + raw.sessionExecutions.length
        + raw.activities.length + raw.dailyRecommendations.length;
    const evaluated = (denominator: number, ok: boolean): GateState => (denominator === 0 ? 'not_evaluated' : ok ? 'pass' : 'fail');

    const hardGates: Record<string, GateState> = {
        // Path scoping in the exporter is the primary guarantee; this re-checks owner fields.
        noCrossUserEvidenceLeakage: evaluated(totalRecords, parsed.crossUserRecords === 0),
        noSourceUniquenessViolations: evaluated(identity.activeOccurrences, identity.sourceLinkConflicts === 0),
        noStickyManualDecisionViolations: evaluated(identity.manualDecisionOccurrences, identity.manualDecisionViolations === 0),
        deterministicReplayStable: evaluated(totalRecords, deterministic),
        noKnownFalsePositiveMerges: falsePositiveMerges > 0 ? 'fail'
            : evaluated(mergedFullyLabelled ? mergedAliases.length : 0, true),
        // A physical workout (one alias) may contribute at most one canonical row.
        matchedOccurrenceSingleExposure: evaluated(audit.multiSourceDerived, [...canonicalAliasCounts.values()].every(count => count === 1)),
        structuredSemanticAuthorityPreserved: evaluated(audit.structuredDerived, audit.structuredAuthorityViolations === 0),
        missingDetailRemainsUnknown: evaluated(
            audit.activeOccurrences,
            audit.derived + audit.unknown === audit.activeOccurrences && audit.unsupportedDerivations === 0,
        ),
    };

    const aliasCount = first.pairing.privateAliasSources.size;
    const preparedInput = {
        schemaVersion: 1,
        metadata: {
            sourceCommit: options.sourceCommit,
            occurrenceSchemaVersion: PERFORMED_OCCURRENCE_SCHEMA_VERSION,
            matcherVersion: RECONCILIATION_MATCHER_VERSION,
            reconciliationPolicyVersion: RECONCILIATION_POLICY_VERSION,
            coveragePolicyVersion: options.coveragePolicyVersion,
            fitFingerprintVersion: options.fitFingerprintVersion,
        },
        corpus: {
            realHistory: 'prepared',
            realHistoryOccurrenceCount: aliasCount,
            strata: strataFor(windowOccurrences, first.sources),
        },
        liveExposures: first.pairing.liveExposures,
        canonicalExposures: first.pairing.canonicalExposures,
        unknownCanonicalOccurrenceKeys: first.pairing.unknownCanonicalOccurrenceKeys,
        canonicalDerivation: {
            windowDays: daysBetween(raw.window.startDate, raw.window.endDateExclusive),
            parsedOccurrences: parsed.occurrences.length,
            invalidRecords: parsed.invalidRecords,
            crossUserRecordsRejected: parsed.crossUserRecords,
            derived: first.pairing.canonicalExposures.length,
            unknownByReason: first.pairing.unknownByReason,
        },
        identityEvidence: {
            status: 'prepared',
            ...identity,
            exactIdentityUpgrades: upgrades,
            exactIdentityDowngrades: downgrades,
            allProviderSourceRefsEvaluated: true,
            reviewedMatchLabels: labels.length,
            reviewedFalsePositiveMerges: falsePositiveMerges,
            pairedMatched: comparison.perOccurrence.filter(row => row.status === 'matched').length,
            pairedLiveOnly: comparison.perOccurrence.filter(row => row.status === 'live_only').length,
            pairedCanonicalOnly: comparison.perOccurrence.filter(row => row.status === 'canonical_only').length,
            pairedAmbiguous: comparison.perOccurrence.filter(row => row.status === 'ambiguous_key').length,
        },
        hardGates,
    };

    return {
        preparedInput,
        liveExposures: first.pairing.liveExposures,
        canonicalExposures: first.pairing.canonicalExposures,
        privateReviewSheet,
    };
}
