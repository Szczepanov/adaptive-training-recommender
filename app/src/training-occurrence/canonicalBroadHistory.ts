/**
 * TO4 (#646, ADR-0034): diagnostic-only derivation of broad `CompletedExposure` history from
 * canonical performed occurrences, plus opaque pairing with the live legacy history.
 *
 * Nothing here is wired into a recommendation path. Legacy `CompletedTrainingEvent ->
 * CompletedExposure` stays the broad fatigue/dose/objective authority; this module only
 * produces the counterfactual side of an offline comparison.
 *
 * Semantics are borrowed from the live mappers rather than re-invented:
 * - a provider-only Garmin occurrence goes through `reconcileCompletedTrainingEvents` and
 *   `completedEventToExposure` exactly as the live path does;
 * - a structured catalog execution mirrors the live "followed exact template" path
 *   (`mergeAdherenceIntoGarmin` / `candidateEventFromAdherence` + `exposureWithExactIdentity`):
 *   template cost scaled by delivered dose, template stimulus, exact template/workout identity,
 *   Garmin as measured duration/Training-Effect authority when linked. Structured identity and
 *   modality are never replaced by Garmin's classification.
 *
 * Everything else fails closed to an explicit `unknown` reason. Planned `SessionOccurrence`
 * documents are never read, so a plan cannot become a performed exposure.
 */
import type { CompletedTrainingEvent, CompletedTrainingSource, DailyRecommendation, NormalizedGarminActivity } from '../engine/models';
import type { CompletedExposure } from '../engine/trainingHistory';
import type { SessionExecution } from '../sessions/models';
import {
    DEFAULT_COST_BY_MODALITY,
    DEFAULT_STIMULUS_BY_MODALITY,
    catalogReferenceDurationMin,
    completedEventToExposure,
    reconcileCompletedTrainingEvents,
    scaleCostByDeliveredDose,
    templateDurationReferenceMin,
} from '../engine/completedTraining';
import { recommendationOwnsExecution, templateIdForWorkoutId } from '../engine/performedTrainingFacts';
import { ENRICHED_TEMPLATES_BY_ID } from '../engine/templates';
import { workoutForTemplate } from '../workouts/prescription';
import { getLocalDateString } from '../utils/localDate';
import {
    isProviderActivityRef,
    isStructuredExecutionRef,
    type PerformedTrainingOccurrence,
} from './models';
import { sourceKeyForRef } from './sourceIdentity';

export const CANONICAL_EXPOSURE_UNKNOWN_REASONS = [
    'multiple_structured_sources',
    'multiple_provider_sources',
    'unsupported_provider',
    'structured_source_unavailable',
    'structured_source_not_completed',
    'legacy_strength_semantics_not_derived',
    'non_catalog_structured_semantics',
    'template_identity_ambiguous',
    'provider_source_unavailable',
    'no_performed_date',
] as const;
export type CanonicalExposureUnknownReason = (typeof CANONICAL_EXPOSURE_UNKNOWN_REASONS)[number];

export interface CanonicalHistorySources {
    executionsById: ReadonlyMap<string, SessionExecution>;
    activitiesById: ReadonlyMap<string, NormalizedGarminActivity>;
    recommendationsByDate: ReadonlyMap<string, DailyRecommendation>;
}

export type CanonicalExposureDerivation =
    | { status: 'derived'; exposure: CompletedExposure; authority: 'structured' | 'provider' }
    | { status: 'unknown'; reason: CanonicalExposureUnknownReason };

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

function executionDurationMin(execution: SessionExecution): number | undefined {
    if (!execution.completedAt) return undefined;
    const minutes = (Date.parse(execution.completedAt) - Date.parse(execution.startedAt)) / 60000;
    return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : undefined;
}

function performedLocalDate(
    occurrence: PerformedTrainingOccurrence,
    execution: SessionExecution | undefined,
    activity: NormalizedGarminActivity | undefined,
): string | undefined {
    if (occurrence.localDate) return VALID_DATE.test(occurrence.localDate) ? occurrence.localDate : undefined;
    if (execution?.date && VALID_DATE.test(execution.date)) return execution.date;
    const startedAt = occurrence.startedAt ?? execution?.startedAt ?? activity?.startedAt;
    if (startedAt && Number.isFinite(Date.parse(startedAt))) return getLocalDateString(new Date(startedAt));
    return activity?.date && VALID_DATE.test(activity.date) ? activity.date : undefined;
}

/** The live Garmin-only event for one activity, from the production reconciler itself. */
function liveGarminEvent(activity: NormalizedGarminActivity): CompletedTrainingEvent {
    return reconcileCompletedTrainingEvents([activity], [])[0];
}

function exactTemplateIdForExecution(execution: SessionExecution, workoutId: string, recommendation: DailyRecommendation | undefined): string | undefined {
    const unique = templateIdForWorkoutId(workoutId);
    if (unique) return unique;
    // A workout shared by several engine templates is resolved only by the recommendation
    // that provably owns this execution; otherwise the template stays unknown.
    if (!recommendation || !recommendationOwnsExecution(execution, recommendation.templateId, recommendation)) return undefined;
    return workoutForTemplate(recommendation.templateId)?.id === workoutId ? recommendation.templateId : undefined;
}

function structuredExposure(
    occurrence: PerformedTrainingOccurrence,
    execution: SessionExecution,
    activity: NormalizedGarminActivity | undefined,
    sources: CanonicalHistorySources,
    localDate: string,
): CanonicalExposureDerivation {
    if (execution.state !== 'completed') return { status: 'unknown', reason: 'structured_source_not_completed' };
    const source = execution.sessionSource;
    if (source.kind === 'manual' && source.definitionId === 'legacy_strength') {
        return { status: 'unknown', reason: 'legacy_strength_semantics_not_derived' };
    }
    if (source.kind !== 'catalog') return { status: 'unknown', reason: 'non_catalog_structured_semantics' };
    if (source.workoutId === 'legacy_strength') return { status: 'unknown', reason: 'legacy_strength_semantics_not_derived' };

    const templateId = exactTemplateIdForExecution(execution, source.workoutId, sources.recommendationsByDate.get(execution.date));
    const template = templateId ? ENRICHED_TEMPLATES_BY_ID.get(templateId) : undefined;
    if (!template) return { status: 'unknown', reason: 'template_identity_ambiguous' };

    const garmin = activity ? liveGarminEvent(activity) : undefined;
    const costIntensity = garmin
        ? garmin.costIntensity ?? garmin.intensity
        : template.systemicCost >= 0.55 ? 'hard' : 'moderate';
    const deliveredDose = {
        plannedDurationMin: templateDurationReferenceMin(template) ?? catalogReferenceDurationMin(template.modality, costIntensity),
        // Garmin remains the measured duration authority when linked, as in the live merge.
        completedDurationMin: garmin?.durationMin ?? executionDurationMin(execution),
    };
    const sourcesUsed: CompletedTrainingSource[] = garmin ? ['garmin'] : [];
    const event: CompletedTrainingEvent = {
        id: `canonical:${occurrence.performedOccurrenceId}`,
        date: localDate,
        durationMin: deliveredDose.completedDurationMin ?? null,
        deliveredDose,
        modality: template.modality,
        intensity: garmin?.intensity ?? costIntensity,
        ...(garmin && costIntensity !== garmin.intensity ? { costIntensity } : {}),
        trainingEffect: garmin?.trainingEffect ?? null,
        estimatedCost: scaleCostByDeliveredDose(template.costProfile ?? DEFAULT_COST_BY_MODALITY[template.modality][costIntensity], deliveredDose),
        estimatedStimulus: template.stimulusProfile ?? DEFAULT_STIMULUS_BY_MODALITY[template.modality][costIntensity],
        exactTemplateMatch: Boolean(template.stimulusProfile),
        sources: sourcesUsed,
        confidence: 'high',
        evidenceTier: 'completedStructuredWorkout',
        linkedActivityId: activity?.activityId ?? null,
        linkedRecommendationDate: null,
        athleteFeedback: { followed: null, notes: null },
    };
    return {
        status: 'derived',
        authority: 'structured',
        exposure: {
            ...completedEventToExposure(event),
            templateId: template.id,
            workoutId: source.workoutId,
            modality: template.modality,
            category: template.category,
        },
    };
}

/**
 * Derives one broad-history exposure for one active canonical occurrence. Every source ref is
 * evaluated: more than one structured or provider source is reported rather than resolved by
 * picking a primary row, and a non-Garmin provider has no production mapper yet.
 */
export function deriveCanonicalBroadExposure(
    occurrence: PerformedTrainingOccurrence,
    sources: CanonicalHistorySources,
): CanonicalExposureDerivation {
    const structuredRefs = occurrence.sourceRefs.filter(isStructuredExecutionRef);
    const providerRefs = occurrence.sourceRefs.filter(isProviderActivityRef);
    if (structuredRefs.length > 1) return { status: 'unknown', reason: 'multiple_structured_sources' };
    if (providerRefs.length > 1) return { status: 'unknown', reason: 'multiple_provider_sources' };
    const providerRef = providerRefs[0];
    if (providerRef && providerRef.provider.trim().toLowerCase() !== 'garmin') return { status: 'unknown', reason: 'unsupported_provider' };

    const execution = structuredRefs[0] ? sources.executionsById.get(structuredRefs[0].executionId) : undefined;
    const activity = providerRef ? sources.activitiesById.get(providerRef.activityId) : undefined;
    if (structuredRefs[0] && !execution) return { status: 'unknown', reason: 'structured_source_unavailable' };
    if (providerRef && !activity && !execution) return { status: 'unknown', reason: 'provider_source_unavailable' };

    const localDate = performedLocalDate(occurrence, execution, activity);
    if (!localDate) return { status: 'unknown', reason: 'no_performed_date' };
    if (execution) return structuredExposure(occurrence, execution, activity, sources, localDate);
    if (!activity) return { status: 'unknown', reason: 'provider_source_unavailable' };
    return {
        status: 'derived',
        authority: 'provider',
        exposure: { ...completedEventToExposure(liveGarminEvent(activity)), date: localDate },
    };
}

export interface HistoryPairingInput {
    liveEvents: readonly CompletedTrainingEvent[];
    liveExposures: readonly CompletedExposure[];
    occurrences: readonly PerformedTrainingOccurrence[];
    sources: CanonicalHistorySources;
}

export interface HistoryPairingResult {
    liveExposures: CompletedExposure[];
    canonicalExposures: CompletedExposure[];
    unknownCanonicalOccurrenceKeys: string[];
    unknownByReason: Partial<Record<CanonicalExposureUnknownReason, number>>;
    /** Private alias -> private source keys, for the local review sheet only. Never report it. */
    privateAliasSources: Map<string, { date: string; liveSourceKeys: string[]; canonicalSourceKeys: string[] }>;
    audit: DerivationAudit;
}

/** Independent re-check of each derivation against its hydrated sources, so hard gates are
 * measured rather than asserted by construction. */
export interface DerivationAudit {
    activeOccurrences: number;
    derived: number;
    unknown: number;
    /** Derived rows whose own sources do not support the authority they claim. */
    unsupportedDerivations: number;
    multiSourceDerived: number;
    structuredDerived: number;
    /** Structured-derived rows whose identity/modality differs from the execution's catalog
     * template -- i.e. a provider classification overrode structured semantics. */
    structuredAuthorityViolations: number;
}

function auditDerivation(
    occurrence: PerformedTrainingOccurrence,
    derivation: Extract<CanonicalExposureDerivation, { status: 'derived' }>,
    sources: CanonicalHistorySources,
): { unsupported: boolean; structuredViolation: boolean } {
    const structuredRefs = occurrence.sourceRefs.filter(isStructuredExecutionRef);
    const providerRefs = occurrence.sourceRefs.filter(isProviderActivityRef);
    if (derivation.authority === 'provider') {
        const ref = providerRefs[0];
        const supported = structuredRefs.length === 0 && providerRefs.length === 1
            && ref.provider.trim().toLowerCase() === 'garmin' && sources.activitiesById.has(ref.activityId);
        return { unsupported: !supported, structuredViolation: false };
    }
    const execution = structuredRefs.length === 1 ? sources.executionsById.get(structuredRefs[0].executionId) : undefined;
    const source = execution?.sessionSource;
    const supported = Boolean(execution && execution.state === 'completed' && source?.kind === 'catalog'
        && source.workoutId !== 'legacy_strength' && providerRefs.length <= 1);
    const exposure = derivation.exposure;
    const template = exposure.templateId ? ENRICHED_TEMPLATES_BY_ID.get(exposure.templateId) : undefined;
    const structuredViolation = !template || source?.kind !== 'catalog'
        || exposure.workoutId !== source.workoutId
        || workoutForTemplate(template.id)?.id !== source.workoutId
        || exposure.modality !== template.modality
        || exposure.category !== template.category
        || exposure.stimulusConfidence !== 'exact';
    return { unsupported: !supported, structuredViolation };
}

function liveKeys(event: CompletedTrainingEvent): string[] {
    return [
        ...(event.linkedActivityId ? [`activity:${event.linkedActivityId}`] : []),
        ...(event.linkedRecommendationDate ? [`recommendation:${event.linkedRecommendationDate}`] : []),
    ];
}

function canonicalKeys(occurrence: PerformedTrainingOccurrence, sources: CanonicalHistorySources): string[] {
    const keys: string[] = [];
    for (const ref of occurrence.sourceRefs) {
        if (isProviderActivityRef(ref) && ref.provider.trim().toLowerCase() === 'garmin') keys.push(`activity:${ref.activityId}`);
        if (isStructuredExecutionRef(ref)) {
            const execution = sources.executionsById.get(ref.executionId);
            const recommendation = execution ? sources.recommendationsByDate.get(execution.date) : undefined;
            const templateId = execution?.sessionSource.kind === 'catalog'
                ? exactTemplateIdForExecution(execution, execution.sessionSource.workoutId, recommendation)
                : undefined;
            if (execution && recommendation && recommendationOwnsExecution(execution, templateId, recommendation)) {
                keys.push(`recommendation:${recommendation.date}`);
            }
        }
    }
    return keys;
}

/**
 * Pairs live and canonical rows that share a Garmin activity or an owning recommendation, and
 * assigns deterministic opaque `occ-NNNN` aliases. A connected group with more than one row on
 * either side keeps one shared alias so the comparison reports it as ambiguous rather than
 * silently choosing a pair. No raw ID survives into the returned exposure rows.
 */
export function pairLiveAndCanonicalHistory(input: HistoryPairingInput): HistoryPairingResult {
    if (input.liveEvents.length !== input.liveExposures.length) {
        throw new Error('Live events and exposures must be index-aligned (manual-training policy off).');
    }
    const active = input.occurrences.filter(occurrence => occurrence.status === 'active');
    const nodes: Array<{ side: 'live' | 'canonical'; index: number; keys: string[]; date: string }> = [
        ...input.liveEvents.map((event, index) => ({ side: 'live' as const, index, keys: liveKeys(event), date: event.date })),
        ...active.map((occurrence, index) => ({
            side: 'canonical' as const,
            index,
            keys: canonicalKeys(occurrence, input.sources),
            date: occurrence.localDate ?? '',
        })),
    ];
    const parent = nodes.map((_node, index) => index);
    const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
    const owner = new Map<string, number>();
    nodes.forEach((node, index) => {
        for (const key of node.keys) {
            const existing = owner.get(key);
            if (existing === undefined) owner.set(key, index);
            else parent[find(index)] = find(existing);
        }
    });
    const groups = new Map<number, number[]>();
    nodes.forEach((_node, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), index]));

    const derivations = active.map(occurrence => deriveCanonicalBroadExposure(occurrence, input.sources));
    const orderedGroups = [...groups.values()].map(members => {
        const dates = members.map(member => nodes[member].date).filter(Boolean).sort();
        const sortKey = `${dates[0] ?? ''}|${members.flatMap(member => nodes[member].keys).sort().join(',')}|${members.map(member => `${nodes[member].side}${nodes[member].index}`).join(',')}`;
        return { members, sortKey };
    }).sort((left, right) => left.sortKey.localeCompare(right.sortKey));

    const result: HistoryPairingResult = {
        liveExposures: [], canonicalExposures: [], unknownCanonicalOccurrenceKeys: [], unknownByReason: {},
        privateAliasSources: new Map(),
        audit: {
            activeOccurrences: active.length, derived: 0, unknown: 0, unsupportedDerivations: 0,
            multiSourceDerived: 0, structuredDerived: 0, structuredAuthorityViolations: 0,
        },
    };
    orderedGroups.forEach((group, groupIndex) => {
        const alias = `occ-${String(groupIndex + 1).padStart(4, '0')}`;
        let hasUnknown = false;
        const privateEntry = { date: '', liveSourceKeys: [] as string[], canonicalSourceKeys: [] as string[] };
        for (const member of group.members) {
            const node = nodes[member];
            if (node.side === 'live') {
                result.liveExposures.push({ ...input.liveExposures[node.index], occurrenceKey: alias });
                privateEntry.liveSourceKeys.push(...node.keys);
                privateEntry.date ||= node.date;
                continue;
            }
            const occurrence = active[node.index];
            privateEntry.canonicalSourceKeys.push(...occurrence.sourceRefs.map(sourceKeyForRef));
            const derivation = derivations[node.index];
            if (derivation.status === 'unknown') {
                hasUnknown = true;
                result.audit.unknown += 1;
                result.unknownByReason[derivation.reason] = (result.unknownByReason[derivation.reason] ?? 0) + 1;
                continue;
            }
            const check = auditDerivation(occurrence, derivation, input.sources);
            result.audit.derived += 1;
            if (check.unsupported) result.audit.unsupportedDerivations += 1;
            if (occurrence.sourceRefs.length > 1) result.audit.multiSourceDerived += 1;
            if (derivation.authority === 'structured') {
                result.audit.structuredDerived += 1;
                if (check.structuredViolation) result.audit.structuredAuthorityViolations += 1;
            }
            result.canonicalExposures.push({ ...derivation.exposure, occurrenceKey: alias });
            privateEntry.date ||= derivation.exposure.date;
        }
        if (hasUnknown && !result.canonicalExposures.some(row => row.occurrenceKey === alias)) {
            result.unknownCanonicalOccurrenceKeys.push(alias);
        }
        result.privateAliasSources.set(alias, privateEntry);
    });
    const byDate = (left: CompletedExposure, right: CompletedExposure) => left.date.localeCompare(right.date)
        || (left.occurrenceKey ?? '').localeCompare(right.occurrenceKey ?? '');
    result.liveExposures.sort(byDate);
    result.canonicalExposures.sort(byDate);
    return result;
}

export interface CanonicalIdentityMetrics {
    activeOccurrences: number;
    mergedOccurrencesExcluded: number;
    matchedOccurrences: number;
    singleSourceOccurrences: number;
    ambiguousOccurrences: number;
    structuredOnlyOccurrences: number;
    providerOnlyOccurrences: number;
    multiProviderSourceOccurrences: number;
    nonGarminProviderSourceRefs: number;
    sourceLinkConflicts: number;
    manualDecisionOccurrences: number;
    manualDecisionViolations: number;
    duplicatePhysicalWorkoutCandidates: number;
    liveActivitiesAbsentFromCanonical: number;
    canonicalProviderActivitiesAbsentFromLive: number;
}

function overlaps(left: PerformedTrainingOccurrence, right: PerformedTrainingOccurrence): boolean {
    if (!left.startedAt || !left.endedAt || !right.startedAt || !right.endedAt) return false;
    return Date.parse(left.startedAt) < Date.parse(right.endedAt) && Date.parse(right.startedAt) < Date.parse(left.endedAt);
}

/** Identity/evidence metrics over every canonical source ref, not just a primary Garmin row. */
export function computeCanonicalIdentityMetrics(
    occurrences: readonly PerformedTrainingOccurrence[],
    liveEvents: readonly CompletedTrainingEvent[],
): CanonicalIdentityMetrics {
    const active = occurrences.filter(occurrence => occurrence.status === 'active');
    const sourceOwners = new Map<string, number>();
    for (const occurrence of active) {
        for (const key of new Set(occurrence.sourceRefs.map(sourceKeyForRef))) sourceOwners.set(key, (sourceOwners.get(key) ?? 0) + 1);
    }
    const canonicalGarminIds = new Set(active.flatMap(occurrence => occurrence.sourceRefs
        .filter(isProviderActivityRef)
        .filter(ref => ref.provider.trim().toLowerCase() === 'garmin')
        .map(ref => ref.activityId)));
    const liveGarminIds = new Set(liveEvents.flatMap(event => (event.linkedActivityId ? [event.linkedActivityId] : [])));
    const manual = active.filter(occurrence => occurrence.reconciliation.manualDecision);
    let duplicates = 0;
    for (let left = 0; left < active.length; left += 1) {
        for (let right = left + 1; right < active.length; right += 1) {
            const a = active[left];
            const b = active[right];
            if (a.localDate && a.localDate === b.localDate && a.modality === b.modality && overlaps(a, b)) duplicates += 1;
        }
    }
    return {
        activeOccurrences: active.length,
        mergedOccurrencesExcluded: occurrences.length - active.length,
        matchedOccurrences: active.filter(occurrence => occurrence.reconciliation.state === 'matched').length,
        singleSourceOccurrences: active.filter(occurrence => occurrence.reconciliation.state === 'single_source').length,
        ambiguousOccurrences: active.filter(occurrence => occurrence.reconciliation.state === 'ambiguous').length,
        structuredOnlyOccurrences: active.filter(occurrence => occurrence.sourceRefs.every(isStructuredExecutionRef)).length,
        providerOnlyOccurrences: active.filter(occurrence => occurrence.sourceRefs.every(isProviderActivityRef)).length,
        multiProviderSourceOccurrences: active.filter(occurrence => occurrence.sourceRefs.filter(isProviderActivityRef).length > 1).length,
        nonGarminProviderSourceRefs: active.flatMap(occurrence => occurrence.sourceRefs.filter(isProviderActivityRef))
            .filter(ref => ref.provider.trim().toLowerCase() !== 'garmin').length,
        sourceLinkConflicts: [...sourceOwners.values()].filter(count => count > 1).length,
        manualDecisionOccurrences: manual.length,
        manualDecisionViolations: manual.filter(occurrence => {
            const excluded = new Set(occurrence.reconciliation.excludedSourceKeys ?? []);
            return occurrence.sourceRefs.some(ref => excluded.has(sourceKeyForRef(ref)));
        }).length,
        duplicatePhysicalWorkoutCandidates: duplicates,
        liveActivitiesAbsentFromCanonical: [...liveGarminIds].filter(id => !canonicalGarminIds.has(id)).length,
        canonicalProviderActivitiesAbsentFromLive: [...canonicalGarminIds].filter(id => !liveGarminIds.has(id)).length,
    };
}
