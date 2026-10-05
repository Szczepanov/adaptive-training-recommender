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
import type { ExecutionPrescription, SessionDefinition, SessionEntry, SessionExecution } from '../sessions/models';
import { buildTrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import { parseDailyRecommendation, parseNormalizedGarminActivity } from '../persistence/parsers/trainingHistory';
import { parseSessionEntryDocument, parseSessionExecutionDocument } from '../persistence/parsers/sessionExecution';
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
    recommendationId?: string;
    planId?: string;
}

interface DateWindow { startDate: string; endDateExclusive: string }

const BOUNDED_SOURCES = [
    'performedTrainingOccurrences', 'activities', 'dailyRecommendations', 'dailyRecommendationRevisions',
    'dailyRecoverySnapshots', 'dailySubjectiveCheckins', 'fixedActivities', 'scheduleOverlays',
    'planBlocks', 'scheduleWindowManifests', 'sessionOccurrences', 'sessionExecutions',
    'sessionEntries', 'executionPrescriptions', 'sessionDefinitionRevisions', 'externalPlanRevisions',
] as const;

const OFFLINE_SOURCES = [
    'performedTrainingOccurrences', 'activities', 'dailyRecommendations', 'sessionExecutions',
    'sessionEntries', 'executionPrescriptions', 'sessionDefinitionRevisions',
    'dailyRecommendationRevisions', 'dailyRecoverySnapshots', 'dailySubjectiveCheckins',
    'fixedActivities', 'scheduleOverlays', 'planBlocks', 'scheduleWindowManifests',
    'sessionOccurrences', 'externalPlanHeaders', 'externalPlanRevisions', 'externalPlanPlacements',
    'goals', 'intentBlockHeaders', 'intentBlockRevisions', 'trainingSettings', 'preferences',
    'trainingIntentProfiles',
] as const;

type BoundedSource = (typeof BOUNDED_SOURCES)[number];
type OfflineSource = (typeof OFFLINE_SOURCES)[number];
type SourceProvenance = Record<string, { status: 'unprovable'; reason: string } | { status: 'exact_revision' }>;

/** Shape written by `python -m garmin_sync export-training-occurrence-records`. */
export interface TrainingOccurrenceRecordExport extends Record<OfflineSource, RawRecordDocument[]> {
    schemaVersion: 2;
    userId: string;
    window?: DateWindow;
    evaluationWindow: DateWindow;
    sourceEvidenceBounds: Record<BoundedSource, DateWindow>;
    sourceProvenance: SourceProvenance;
    performedTrainingOccurrences: RawRecordDocument[];
    sessionExecutions: RawRecordDocument[];
    sessionEntries: RawRecordDocument[];
    executionPrescriptions: RawRecordDocument[];
    sessionDefinitionRevisions: RawRecordDocument[];
    activities: RawRecordDocument[];
    dailyRecommendations: RawRecordDocument[];
}

/** Private parsed export evidence for the offline date-D assembler; never placed in preparedInput. */
export interface OfflineSourceEvidence extends Record<OfflineSource, Array<{ id: string; data: Record<string, unknown>; recommendationId?: string; planId?: string }>> {
    evaluationWindow: DateWindow;
    sourceEvidenceBounds: Record<BoundedSource, DateWindow>;
    sourceProvenance: SourceProvenance;
}

export type ReviewLabel = 'correct_merge' | 'false_positive_merge' | 'correct_separate' | 'false_negative_split';
const REVIEW_LABEL_VALUES = new Set<ReviewLabel>(['correct_merge', 'false_positive_merge', 'correct_separate', 'false_negative_split']);

export interface PrepareOptions {
    sourceCommit: string;
    sourceTreeSha256: string;
    coveragePolicyVersion: string;
    fitFingerprintVersion: string;
    /** Reviewer labels keyed by the opaque alias printed in the private review sheet. */
    labels?: Readonly<Record<string, ReviewLabel>>;
    /** Verified exact manual revisions; only used when an old prescription lacks display metadata. */
    manualDefinitionRevisions?: readonly { definition: SessionDefinition; contentHash: string }[];
}

type GateState = 'pass' | 'fail' | 'not_evaluated';

export interface PreparedTo4 {
    preparedInput: Record<string, unknown>;
    liveExposures: CompletedExposure[];
    canonicalExposures: CompletedExposure[];
    sourceEvidence: OfflineSourceEvidence;
    privateReviewSheet: Array<Record<string, unknown>>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(start: string, endExclusive: string): number {
    return Math.round((Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function validWindow(value: unknown): value is DateWindow {
    if (!value || typeof value !== 'object') return false;
    const window = value as Record<string, unknown>;
    return typeof window.startDate === 'string' && DATE.test(window.startDate)
        && typeof window.endDateExclusive === 'string' && DATE.test(window.endDateExclusive)
        && window.startDate < window.endDateExclusive;
}

function offlineEvidence(raw: TrainingOccurrenceRecordExport): OfflineSourceEvidence {
    const sourceEvidenceBounds = {} as Record<BoundedSource, DateWindow>;
    for (const key of BOUNDED_SOURCES) {
        const bound = raw.sourceEvidenceBounds?.[key];
        if (!validWindow(bound) || bound.startDate > raw.evaluationWindow.startDate
            || bound.endDateExclusive < raw.evaluationWindow.endDateExclusive) {
            throw new Error(`Invalid source evidence bounds for ${key}.`);
        }
        sourceEvidenceBounds[key] = bound;
    }
    if (!raw.sourceProvenance || typeof raw.sourceProvenance !== 'object') throw new Error('Missing source provenance.');
    const sourceProvenance: SourceProvenance = {};
    for (const [key, value] of Object.entries(raw.sourceProvenance)) {
        if (!value || typeof value !== 'object'
            || (value.status !== 'exact_revision' && (value.status !== 'unprovable' || typeof value.reason !== 'string' || !value.reason))) {
            throw new Error(`Invalid source provenance for ${key}.`);
        }
        sourceProvenance[key] = value;
    }
    const result = { evaluationWindow: raw.evaluationWindow, sourceEvidenceBounds, sourceProvenance } as OfflineSourceEvidence;
    for (const key of OFFLINE_SOURCES) {
        const documents = raw[key];
        if (!Array.isArray(documents)) throw new Error(`Missing offline source ${key}.`);
        result[key] = documents.map(document => {
            if (!document || typeof document.id !== 'string' || !document.id
                || !document.data || typeof document.data !== 'object' || Array.isArray(document.data)
                || ('userId' in document.data && document.data.userId !== raw.userId)
                || (document.recommendationId !== undefined && (typeof document.recommendationId !== 'string' || !document.recommendationId))
                || (document.planId !== undefined && (typeof document.planId !== 'string' || !document.planId))) {
                throw new Error(`Invalid or cross-user offline source ${key}.`);
            }
            return document as { id: string; data: Record<string, unknown>; recommendationId?: string; planId?: string };
        });
    }
    return result;
}

interface ParsedRecords {
    occurrences: PerformedTrainingOccurrence[];
    executions: SessionExecution[];
    entries: SessionEntry[];
    prescriptions: ExecutionPrescription[];
    activities: NormalizedGarminActivity[];
    recommendations: DailyRecommendation[];
    crossUserRecords: number;
    invalidRecords: number;
}

function parseRecords(raw: TrainingOccurrenceRecordExport): ParsedRecords {
    const parsed: ParsedRecords = { occurrences: [], executions: [], entries: [], prescriptions: [], activities: [], recommendations: [], crossUserRecords: 0, invalidRecords: 0 };
    const ownerOf = (data: unknown): unknown => (data && typeof data === 'object' ? (data as Record<string, unknown>).userId : undefined);
    const foreign = (data: unknown): boolean => {
        const owner = ownerOf(data);
        return owner !== undefined && owner !== raw.userId;
    };
    const validSource = (data: unknown): boolean => {
        if (!data || typeof data !== 'object') return false;
        const source = data as Record<string, unknown>;
        const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
        const revision = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 0;
        if (source.kind === 'catalog') return nonEmpty(source.workoutId) && nonEmpty(source.catalogVersion);
        if (source.kind === 'manual') return nonEmpty(source.definitionId) && revision(source.revision) && nonEmpty(source.contentHash);
        if (source.kind === 'external_plan') {
            return nonEmpty(source.planId) && revision(source.revision) && nonEmpty(source.sessionId) && nonEmpty(source.contentHash);
        }
        return source.kind === 'unplanned_fixture' && nonEmpty(source.fixtureId);
    };
    const validDuration = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false;
        const range = value as Record<string, unknown>;
        return typeof range.min === 'number' && Number.isFinite(range.min) && range.min > 0
            && typeof range.max === 'number' && Number.isFinite(range.max) && range.max >= range.min;
    };
    const validPrescription = (data: unknown, documentId: string): data is ExecutionPrescription => {
        if (!data || typeof data !== 'object') return false;
        const candidate = data as Record<string, unknown>;
        const metadata = candidate.displayMetadata as Record<string, unknown> | undefined;
        if (candidate.prescriptionHash !== documentId
            || typeof candidate.schemaVersion !== 'number' || !Number.isInteger(candidate.schemaVersion)
            || typeof candidate.definitionHash !== 'string' || !candidate.definitionHash
            || typeof candidate.createdAt !== 'string'
            || !validSource(candidate.sessionSource)
            || !Array.isArray(candidate.blocks)
            || (metadata === undefined && (candidate.sessionSource as Record<string, unknown>).kind !== 'manual')
            || (metadata !== undefined && (!metadata || typeof metadata.title !== 'string' || !metadata.title.trim()
                || typeof metadata.intent !== 'string'
                || (metadata.dominantModality !== undefined && typeof metadata.dominantModality !== 'string')
                || (metadata.duration !== undefined && !validDuration(metadata.duration))))) return false;
        const validRoles = new Set(['warmup', 'main', 'cooldown', 'accessory', 'test', 'recovery']);
        const validModes = new Set(['sequential', 'circuit', 'superset', 'density', 'amrap', 'alternating']);
        return candidate.blocks.every(block => {
            if (!block || typeof block !== 'object') return false;
            const fields = block as Record<string, unknown>;
            if (typeof fields.id !== 'string' || !validRoles.has(String(fields.role))
                || !validModes.has(String(fields.executionMode)) || !Array.isArray(fields.steps)) return false;
            return (fields.steps as unknown[]).every(step => {
                if (!step || typeof step !== 'object') return false;
                const stepFields = step as Record<string, unknown>;
                if (typeof stepFields.id !== 'string'
                    || (stepFields.optional !== undefined && typeof stepFields.optional !== 'boolean')) return false;
                const dose = stepFields.dose;
                if (dose === undefined) return true;
                if (!dose || typeof dose !== 'object') return false;
                const doseFields = dose as Record<string, unknown>;
                if (!['repetition', 'duration', 'distance', 'checkoff'].includes(String(doseFields.kind))) return false;
                const count = doseFields.kind === 'repetition' ? doseFields.sets
                    : doseFields.kind === 'checkoff' ? doseFields.rounds
                        : doseFields.kind === 'duration' || doseFields.kind === 'distance' ? doseFields.sets : undefined;
                return (doseFields.kind !== 'repetition' || (typeof count === 'number' && Number.isFinite(count) && count >= 0))
                    && (count === undefined || (typeof count === 'number' && Number.isFinite(count) && count >= 0));
            });
        });
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
    for (const document of raw.sessionEntries ?? []) {
        if (foreign(document.data)) { parsed.crossUserRecords += 1; continue; }
        const state = parseSessionEntryDocument(document.data, `session_executions/*/entries/${document.id}`);
        if (state.status === 'AVAILABLE') {
            if (!state.data.deletedAt) parsed.entries.push(state.data);
        }
        else parsed.invalidRecords += 1;
    }
    for (const document of raw.executionPrescriptions ?? []) {
        if (foreign(document.data)) { parsed.crossUserRecords += 1; continue; }
        if (validPrescription(document.data, document.id)) {
            parsed.prescriptions.push(document.data);
        } else parsed.invalidRecords += 1;
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
    window: DateWindow,
): PerformedTrainingOccurrence[] {
    return occurrences.filter(occurrence => {
        const date = occurrence.localDate
            ?? (occurrence.startedAt && Number.isFinite(Date.parse(occurrence.startedAt)) ? getLocalDateString(new Date(occurrence.startedAt)) : undefined);
        return date !== undefined && date >= window.startDate && date < window.endDateExclusive;
    });
}

function pair(
    parsed: ParsedRecords,
    window: DateWindow,
    manualDefinitionRevisions: PrepareOptions['manualDefinitionRevisions'],
): {
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
        entriesByExecutionId: new Map(parsed.executions.map(execution => [
            execution.executionId, parsed.entries.filter(entry => entry.executionId === execution.executionId),
        ])),
        prescriptionsByHash: new Map(parsed.prescriptions.map(prescription => [prescription.prescriptionHash, prescription])),
        recommendationsByDate: new Map(parsed.recommendations.map(recommendation => [recommendation.date, recommendation])),
        manualDefinitionRevisions,
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
    if (options.labels !== undefined && (!options.labels || typeof options.labels !== 'object'
        || Array.isArray(options.labels) || Object.values(options.labels).some(label => !REVIEW_LABEL_VALUES.has(label)))) {
        throw new Error('Review labels must map aliases to a supported label.');
    }
    if (raw.schemaVersion !== 2 || typeof raw.userId !== 'string' || raw.userId.length === 0) {
        throw new Error('Record export must be schemaVersion 2 with a userId scope.');
    }
    if (!validWindow(raw.evaluationWindow)) {
        throw new Error('Record export evaluationWindow must be YYYY-MM-DD with startDate < endDateExclusive.');
    }
    if (raw.window !== undefined && (!validWindow(raw.window)
        || raw.window.startDate !== raw.evaluationWindow.startDate
        || raw.window.endDateExclusive !== raw.evaluationWindow.endDateExclusive)) {
        throw new Error('Legacy window must match evaluationWindow.');
    }
    const sourceEvidence = offlineEvidence(raw);
    const evaluationWindow = sourceEvidence.evaluationWindow;
    const historyBounds = ['performedTrainingOccurrences', 'activities', 'dailyRecommendations'] as const;
    const historyWindow: DateWindow = {
        startDate: historyBounds.map(key => sourceEvidence.sourceEvidenceBounds[key].startDate).sort()[0],
        endDateExclusive: historyBounds.map(key => sourceEvidence.sourceEvidenceBounds[key].endDateExclusive).sort().at(-1)!,
    };
    const parsed = parseRecords(raw);
    const first = pair(parsed, historyWindow, options.manualDefinitionRevisions);
    const evaluated = pair(parsed, evaluationWindow, options.manualDefinitionRevisions);
    // Determinism gate: a second independent derivation from the same parsed input must match.
    const second = pair(parseRecords(raw), historyWindow, options.manualDefinitionRevisions);
    const deterministic = stableJson([first.pairing.liveExposures, first.pairing.canonicalExposures, first.pairing.unknownCanonicalOccurrenceKeys])
        === stableJson([second.pairing.liveExposures, second.pairing.canonicalExposures, second.pairing.unknownCanonicalOccurrenceKeys]);

    const windowOccurrences = occurrencesInWindow(parsed.occurrences, evaluationWindow);
    const identity = computeCanonicalIdentityMetrics(windowOccurrences, evaluated.liveEvents);
    const comparison = compareCompletedExposureSets(evaluated.pairing.liveExposures, evaluated.pairing.canonicalExposures, evaluated.pairing.unknownCanonicalOccurrenceKeys);
    const exactOf = (row: CompletedExposure | undefined) => Boolean(row?.workoutId || row?.templateId);
    let upgrades = 0;
    let downgrades = 0;
    for (const canonical of evaluated.pairing.canonicalExposures) {
        const live = evaluated.pairing.liveExposures.filter(row => row.occurrenceKey === canonical.occurrenceKey);
        if (live.length !== 1) continue;
        if (exactOf(canonical) && !exactOf(live[0])) upgrades += 1;
        if (!exactOf(canonical) && exactOf(live[0])) downgrades += 1;
    }

    const evaluationAliases = [...first.pairing.privateAliasSources.entries()]
        .filter(([, entry]) => entry.date >= evaluationWindow.startDate && entry.date < evaluationWindow.endDateExclusive);
    const privateReviewSheet = evaluationAliases
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
    for (const row of evaluated.pairing.canonicalExposures) canonicalAliasCounts.set(row.occurrenceKey ?? '', (canonicalAliasCounts.get(row.occurrenceKey ?? '') ?? 0) + 1);
    const audit = evaluated.pairing.audit;
    const totalRecords = raw.performedTrainingOccurrences.length + raw.sessionExecutions.length
        + (raw.sessionEntries?.length ?? 0) + (raw.executionPrescriptions?.length ?? 0)
        + raw.activities.length + raw.dailyRecommendations.length;
    const gate = (denominator: number, ok: boolean): GateState => (denominator === 0 ? 'not_evaluated' : ok ? 'pass' : 'fail');

    const hardGates: Record<string, GateState> = {
        // Path scoping in the exporter is the primary guarantee; this re-checks owner fields.
        noCrossUserEvidenceLeakage: gate(totalRecords, parsed.crossUserRecords === 0),
        noSourceUniquenessViolations: gate(identity.activeOccurrences, identity.sourceLinkConflicts === 0),
        noStickyManualDecisionViolations: gate(identity.manualDecisionOccurrences, identity.manualDecisionViolations === 0),
        deterministicReplayStable: gate(totalRecords, deterministic),
        noKnownFalsePositiveMerges: falsePositiveMerges > 0 ? 'fail'
            : gate(mergedFullyLabelled ? mergedAliases.length : 0, true),
        // A physical workout (one alias) may contribute at most one canonical row.
        matchedOccurrenceSingleExposure: gate(audit.multiSourceDerived, [...canonicalAliasCounts.values()].every(count => count === 1)),
        structuredSemanticAuthorityPreserved: gate(audit.structuredDerived, audit.structuredAuthorityViolations === 0),
        missingDetailRemainsUnknown: gate(
            audit.activeOccurrences,
            audit.derived + audit.unknown === audit.activeOccurrences && audit.unsupportedDerivations === 0,
        ),
    };

    const aliasCount = evaluationAliases.length;
    const preparedInput = {
        schemaVersion: 1,
        metadata: {
            sourceCommit: options.sourceCommit,
            sourceTreeSha256: options.sourceTreeSha256,
            occurrenceSchemaVersion: PERFORMED_OCCURRENCE_SCHEMA_VERSION,
            matcherVersion: RECONCILIATION_MATCHER_VERSION,
            reconciliationPolicyVersion: RECONCILIATION_POLICY_VERSION,
            coveragePolicyVersion: options.coveragePolicyVersion,
            fitFingerprintVersion: options.fitFingerprintVersion,
        },
        corpus: {
            realHistory: 'prepared',
            realHistoryOccurrenceCount: aliasCount,
            strata: strataFor(windowOccurrences, evaluated.sources),
        },
        liveExposures: evaluated.pairing.liveExposures,
        canonicalExposures: evaluated.pairing.canonicalExposures,
        unknownCanonicalOccurrenceKeys: evaluated.pairing.unknownCanonicalOccurrenceKeys,
        canonicalDerivation: {
            windowDays: daysBetween(evaluationWindow.startDate, evaluationWindow.endDateExclusive),
            parsedOccurrences: windowOccurrences.length,
            invalidRecords: parsed.invalidRecords,
            crossUserRecordsRejected: parsed.crossUserRecords,
            derived: evaluated.pairing.canonicalExposures.length,
            manualDefinitionMetadataFallbacks: evaluated.pairing.audit.manualDefinitionMetadataFallbacks,
            unknownByReason: evaluated.pairing.unknownByReason,
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
        liveExposures: evaluated.pairing.liveExposures,
        canonicalExposures: evaluated.pairing.canonicalExposures,
        sourceEvidence,
        privateReviewSheet,
    };
}
