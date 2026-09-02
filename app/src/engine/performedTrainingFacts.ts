/**
 * Canonical performed-training facts derivation (PR 1 / ADR-0034 cutover).
 *
 * Translates active `PerformedTrainingOccurrence` records and their attached sources
 * into recommendation-facing facts:
 * 1. `PerformedExposureFact` — broad recency/spacing fact (trusted modality is enough);
 * 2. `CoverageCreditFact` — narrow weekly role fact (exact catalog identity required);
 * 3. `PerformedTrainingFactsSnapshot` — revisioned bounded facts snapshot;
 * 4. `compareCanonicalVsLegacyFacts` — dual-read diagnostic mismatch counters.
 *
 * Does not re-match sources. ADR-0034 canonical occurrence is the single deduplication authority.
 */
import type { SessionTemplate, EvidenceTier, NormalizedGarminActivity, CompletedTrainingEvent } from './models';
import type { CoverageSetId, PlanCoverageKey, CoverageSetDescriptor } from '../workouts/event-plan';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { workoutForTemplate } from '../workouts/prescription';
import { ENRICHED_TEMPLATES } from './templates';
import type { PerformedTrainingOccurrence } from '../training-occurrence/models';
import { getLocalDateString } from '../utils/localDate';
import { classifyGarminTier } from './completedTraining';

export type FactConfidence = 'exact' | 'high' | 'inferred' | 'unknown';

export interface PerformedExposureFact {
    performedOccurrenceId: string;
    localDate: string;
    startedAt?: string;
    endedAt?: string;
    durationMin?: number;
    modality: SessionTemplate['modality'] | 'Unknown';
    category?: SessionTemplate['category'];
    confidence: FactConfidence;
    sourceKinds: Array<'structured_execution' | 'provider_activity' | 'legacy_strength'>;
    evidenceTier: EvidenceTier;
    workoutId?: string;
    templateId?: string;
}

export interface CoverageCreditFact {
    performedOccurrenceId: string;
    coverageSetId: CoverageSetId;
    coverageKey: PlanCoverageKey;
    workoutId?: string;
    creditKind: 'exact' | 'semantic_confident' | 'none';
    confidence: number;
    reasonCode:
        | 'exact_workout_identity'
        | 'semantic_classifier'
        | 'generic_modality_only'
        | 'insufficient_detail'
        | 'conflicting_semantics';
    sourceKinds: string[];
}

export interface PerformedTrainingFactsSnapshot {
    asOfDate: string;
    windowDays: number;
    revision: string;
    exposures: PerformedExposureFact[];
    coverageCredits: CoverageCreditFact[];
}

export interface FactsComparisonResult {
    canonicalExposureCount: number;
    legacyExposureCount: number;
    exposureCountDelta: number;
    mismatchCount: number;
    mismatches: Array<{
        type: 'canonical_linked' | 'legacy_duplicate' | 'modality_mismatch' | 'date_mismatch' | 'legacy_unmatched';
        detail: string;
    }>;
}

function templatesForWorkoutId(workoutId: string): SessionTemplate[] {
    return ENRICHED_TEMPLATES.filter(t => workoutForTemplate(t.id)?.id === workoutId);
}

/**
 * Reverse workout -> engine-template inference is only safe when exactly one template
 * resolves to that workout. Some catalog workouts intentionally serve multiple engine
 * templates (for example the full-body maintenance workout), so choosing the first match
 * would fabricate prescribed identity that the structured source never proved.
 */
export function templateIdForWorkoutId(workoutId: string): string | undefined {
    const matches = templatesForWorkoutId(workoutId);
    return matches.length === 1 ? matches[0].id : undefined;
}

export function categoryForWorkoutId(workoutId: string): SessionTemplate['category'] | undefined {
    const matches = templatesForWorkoutId(workoutId);
    if (matches.length === 0) return undefined;
    const categories = new Set(matches.map(template => template.category));
    return categories.size === 1 ? matches[0].category : undefined;
}

export function normalizeModality(raw: string | undefined): SessionTemplate['modality'] | 'Unknown' {
    if (!raw) return 'Unknown';
    const lower = raw.toLowerCase();
    if (lower.includes('strength') || lower.includes('weight') || lower.includes('lift')) return 'Strength';
    if (lower.includes('cycl') || lower.includes('bike') || lower.includes('biking')) return 'Cycling';
    if (lower.includes('run')) return 'Running';
    if (lower.includes('swim')) return 'Swimming';
    if (lower.includes('walk')) return 'Walking';
    if (lower.includes('mobility') || lower.includes('yoga')) return 'Mobility';
    if (lower.includes('soccer') || lower.includes('football') || lower.includes('field')) return 'Field';
    if (lower.includes('cross') || lower.includes('row') || lower.includes('ellipt')) return 'Cross Training';
    if (lower === 'rest' || lower === 'none') return 'None';
    return 'Unknown';
}

function normalizeCategory(category?: string): SessionTemplate['category'] | undefined {
    if (!category) return undefined;
    const cat = category as SessionTemplate['category'];
    const validCategories: SessionTemplate['category'][] = [
        'Hard Endurance', 'Moderate Endurance', 'Easy Endurance', 'Race-Specific Endurance',
        'Upper-body Strength', 'Lower-body Strength', 'Full-body Strength',
        'Power Maintenance', 'Field Maintenance', 'Technical Skill', 'Mobility/Recovery', 'Rest',
    ];
    return validCategories.includes(cat) ? cat : undefined;
}

export interface HydratedOccurrenceContext {
    structured?: {
        executionId: string;
        workoutId?: string;
        templateId?: string;
        modality?: SessionTemplate['modality'];
        category?: SessionTemplate['category'];
        startedAt?: string;
        endedAt?: string;
        durationMin?: number;
        isLegacyStrength?: boolean;
    };
    provider?: {
        activityId: string;
        provider: string;
        modality?: SessionTemplate['modality'] | 'Unknown';
        startedAt?: string;
        endedAt?: string;
        durationMin?: number;
        garminActivity?: NormalizedGarminActivity;
    };
}

function isValidCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(Date.UTC(year, month - 1, day));

    return candidate.getUTCFullYear() === year
        && candidate.getUTCMonth() === month - 1
        && candidate.getUTCDate() === day;
}

function requirePerformedLocalDate(
    occurrence: PerformedTrainingOccurrence,
    startedAt: string | undefined,
    hydrated: HydratedOccurrenceContext,
): string {
    let localDate: string | undefined;

    if (occurrence.localDate !== undefined) {
        localDate = occurrence.localDate;
    } else if (startedAt) {
        const startedInstant = new Date(startedAt);
        if (Number.isNaN(startedInstant.getTime())) {
            throw new Error(`Performed training occurrence ${occurrence.performedOccurrenceId} has invalid start time: ${startedAt}.`);
        }
        localDate = getLocalDateString(startedInstant);
    } else if (hydrated.provider?.garminActivity?.date !== undefined) {
        localDate = hydrated.provider.garminActivity.date;
    }

    if (!localDate) {
        throw new Error(`Performed training occurrence ${occurrence.performedOccurrenceId} has no performed local date or start time.`);
    }
    if (!isValidCalendarDate(localDate)) {
        throw new Error(`Performed training occurrence ${occurrence.performedOccurrenceId} has invalid performed local date: ${localDate}.`);
    }
    return localDate;
}

/**
 * Pure fact derivation from a single active occurrence and its hydrated sources.
 * Enforces field-level source precedence (D4, D5).
 */
export function deriveFactsFromOccurrence(
    occurrence: PerformedTrainingOccurrence,
    hydrated: HydratedOccurrenceContext,
    descriptor: CoverageSetDescriptor = EVERGREEN_GENERAL_COVERAGE_SET,
): { exposure: PerformedExposureFact; coverageCredits: CoverageCreditFact[] } {
    const sourceKinds: Array<'structured_execution' | 'provider_activity' | 'legacy_strength'> = [];
    if (hydrated.structured) {
        sourceKinds.push(hydrated.structured.isLegacyStrength ? 'legacy_strength' : 'structured_execution');
    }
    if (hydrated.provider) {
        sourceKinds.push('provider_activity');
    }

    const occurrenceModality = occurrence.modality ? normalizeModality(occurrence.modality) : undefined;
    const providerModality = hydrated.provider?.modality;
    const modality: SessionTemplate['modality'] | 'Unknown' =
        hydrated.structured?.modality
        ?? (occurrenceModality && occurrenceModality !== 'Unknown' ? occurrenceModality : undefined)
        ?? (providerModality && providerModality !== 'Unknown' ? providerModality : undefined)
        ?? occurrenceModality
        ?? providerModality
        ?? 'Unknown';

    const workoutId = hydrated.structured?.workoutId;
    const explicitTemplate = hydrated.structured?.templateId
        ? ENRICHED_TEMPLATES.find(template => template.id === hydrated.structured?.templateId)
        : undefined;
    const templateId = hydrated.structured?.templateId ?? (workoutId ? templateIdForWorkoutId(workoutId) : undefined);
    const category = normalizeCategory(
        hydrated.structured?.category
        ?? explicitTemplate?.category
        ?? (workoutId ? categoryForWorkoutId(workoutId) : undefined),
    );

    const startedAt = hydrated.structured?.startedAt ?? occurrence.startedAt ?? hydrated.provider?.startedAt;
    const endedAt = hydrated.structured?.endedAt ?? occurrence.endedAt ?? hydrated.provider?.endedAt;

    const durationMin =
        hydrated.structured?.durationMin
        ?? hydrated.provider?.durationMin
        ?? (startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000)) : undefined);

    let confidence: FactConfidence = 'unknown';
    let evidenceTier: EvidenceTier = 'genericModalityFallback';

    if (hydrated.structured) {
        if (workoutId && workoutId !== 'legacy_strength') {
            confidence = 'exact';
            evidenceTier = 'completedStructuredWorkout';
        } else if (hydrated.structured.isLegacyStrength) {
            confidence = 'high';
            evidenceTier = 'athleteClassification';
        } else {
            confidence = 'high';
            evidenceTier = 'completedStructuredWorkout';
        }
    } else if (hydrated.provider?.garminActivity) {
        confidence = 'inferred';
        evidenceTier = classifyGarminTier({
            trainingEffectAerobic: hydrated.provider.garminActivity.trainingEffectAerobic,
            trainingEffectAnaerobic: hydrated.provider.garminActivity.trainingEffectAnaerobic,
            intensityTag: hydrated.provider.garminActivity.intensityTag,
            activityTrainingLoad: hydrated.provider.garminActivity.activityTrainingLoad,
            modalityKnown: modality !== 'Unknown',
        });
    }

    const localDate = requirePerformedLocalDate(occurrence, startedAt, hydrated);

    const exposure: PerformedExposureFact = {
        performedOccurrenceId: occurrence.performedOccurrenceId,
        localDate,
        ...(startedAt ? { startedAt } : {}),
        ...(endedAt ? { endedAt } : {}),
        ...(durationMin !== undefined ? { durationMin } : {}),
        modality,
        ...(category ? { category } : {}),
        confidence,
        sourceKinds,
        evidenceTier,
        ...(workoutId ? { workoutId } : {}),
        ...(templateId ? { templateId } : {}),
    };

    const coverageCredits: CoverageCreditFact[] = [];
    if (workoutId && workoutId !== 'legacy_strength') {
        const matchingItems = descriptor.coverage.filter(item => item.workoutIds.includes(workoutId));
        for (const item of matchingItems) {
            coverageCredits.push({
                performedOccurrenceId: occurrence.performedOccurrenceId,
                coverageSetId: descriptor.id,
                coverageKey: item.key,
                workoutId,
                creditKind: 'exact',
                confidence: 1.0,
                reasonCode: 'exact_workout_identity',
                sourceKinds,
            });
        }
    } else if (modality === 'Strength') {
        // Generic strength occurred without proven exact catalog role (D1, D5).
        coverageCredits.push({
            performedOccurrenceId: occurrence.performedOccurrenceId,
            coverageSetId: descriptor.id,
            coverageKey: 'primary_strength',
            creditKind: 'none',
            confidence: 0,
            reasonCode: 'generic_modality_only',
            sourceKinds,
        });
    }

    return { exposure, coverageCredits };
}



interface ComparableExposure {
    date: string;
    modality: SessionTemplate['modality'] | 'Unknown';
}

function consumeFirstMatch<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
    const index = items.findIndex(predicate);
    if (index < 0) return undefined;
    const [matched] = items.splice(index, 1);
    return matched;
}

/**
 * Diagnostic helper comparing canonical facts vs legacy completed training events.
 * Matching is multiset-aware: exact date+modality matches are consumed first, then
 * equal-date and equal-modality leftovers are classified so equal row counts cannot
 * hide semantic or date drift. Remaining rows expose split/unmatched-path differences.
 */
export function compareCanonicalVsLegacyFacts(
    canonicalExposures: readonly PerformedExposureFact[],
    legacyEvents: readonly CompletedTrainingEvent[],
): FactsComparisonResult {
    const mismatches: FactsComparisonResult['mismatches'] = [];
    const unmatchedLegacy: ComparableExposure[] = legacyEvents.map(event => ({
        date: event.date,
        modality: normalizeModality(event.modality),
    }));
    const unmatchedCanonical: ComparableExposure[] = [];

    for (const exposure of canonicalExposures) {
        const canonical = { date: exposure.localDate, modality: exposure.modality };
        const exact = consumeFirstMatch(
            unmatchedLegacy,
            legacy => legacy.date === canonical.date && legacy.modality === canonical.modality,
        );
        if (!exact) unmatchedCanonical.push(canonical);
    }

    let modalityMismatchCount = 0;
    for (let index = unmatchedCanonical.length - 1; index >= 0; index -= 1) {
        const canonical = unmatchedCanonical[index];
        const sameDate = consumeFirstMatch(unmatchedLegacy, legacy => legacy.date === canonical.date);
        if (sameDate) {
            modalityMismatchCount += 1;
            unmatchedCanonical.splice(index, 1);
        }
    }
    if (modalityMismatchCount > 0) {
        mismatches.push({
            type: 'modality_mismatch',
            detail: `${modalityMismatchCount} canonical/legacy event pair(s) share a local date but disagree on modality.`,
        });
    }

    let dateMismatchCount = 0;
    for (let index = unmatchedCanonical.length - 1; index >= 0; index -= 1) {
        const canonical = unmatchedCanonical[index];
        const sameModality = consumeFirstMatch(unmatchedLegacy, legacy => legacy.modality === canonical.modality);
        if (sameModality) {
            dateMismatchCount += 1;
            unmatchedCanonical.splice(index, 1);
        }
    }
    if (dateMismatchCount > 0) {
        mismatches.push({
            type: 'date_mismatch',
            detail: `${dateMismatchCount} canonical/legacy event pair(s) share a modality but disagree on local date.`,
        });
    }

    const legacyExtraCount = unmatchedLegacy.length;
    if (legacyExtraCount > 0) {
        mismatches.push({
            type: 'legacy_duplicate',
            detail: `${legacyExtraCount} legacy event(s) remain without a canonical counterpart (potential legacy split/duplicate).`,
        });
    }

    const canonicalExtraCount = unmatchedCanonical.length;
    if (canonicalExtraCount > 0) {
        mismatches.push({
            type: 'legacy_unmatched',
            detail: `${canonicalExtraCount} canonical occurrence(s) remain without a legacy counterpart.`,
        });
    }

    return {
        canonicalExposureCount: canonicalExposures.length,
        legacyExposureCount: legacyEvents.length,
        exposureCountDelta: canonicalExposures.length - legacyEvents.length,
        mismatchCount: modalityMismatchCount + dateMismatchCount + legacyExtraCount + canonicalExtraCount,
        mismatches,
    };
}
