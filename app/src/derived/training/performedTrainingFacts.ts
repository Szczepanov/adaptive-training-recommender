/**
 * Canonical performed-training facts derivation (PR 1 / ADR-0034 cutover).
 *
 * Translates active `PerformedTrainingOccurrence` records and their attached sources
 * into recommendation-facing facts:
 * 1. `PerformedExposureFact` — broad recency/spacing fact (trusted modality is enough);
 * 2. `CoverageCreditFact` — narrow weekly role fact (exact catalog identity required);
 * 3. `PerformedTrainingFactsSnapshot` — revisioned bounded facts snapshot.
 *
 * Does not re-match sources. ADR-0034 canonical occurrence is the single deduplication authority.
 */
import type {
    ActivityOverride,
    ActivitySessionCost,
    ActivityStimulusDomain,
    EvidenceTier,
    Modality,
    NormalizedGarminActivity,
    SessionCategory,
} from '../../ledger/models';
import type { SessionExecutionState } from '../../sessions/models';
import type { CoverageSetId, PlanCoverageKey, CoverageSetDescriptor } from '../../workouts/event-plan';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../../workouts/event-plan';
import { grantsPowerExposureCredit } from '../../workouts/powerExposure';
import { grantsMechanicalExposureCredit, type MechanicalDoseVariant } from '../../workouts/mechanicalExposure';
import type { WorkoutVariant } from '../../workouts/models';
import type { PerformedTrainingOccurrence } from '../../training-occurrence/models';
import { getLocalDateString } from '../../utils/localDate';
import { classifyGarminTier, isGarminCyclingActivityType } from './providerEvidence';

export type FactConfidence = 'exact' | 'high' | 'inferred' | 'unknown';

export interface PerformedTrainingCatalog {
    templateIdForWorkoutId(workoutId: string): string | undefined;
    templateCategory(templateId: string): SessionCategory | undefined;
    categoryForWorkoutId(workoutId: string): SessionCategory | undefined;
    stimulusFamilyForWorkout(workoutId: string): ActivityStimulusDomain | null | undefined;
    stimulusFamilyForTemplate(templateId: string): ActivityStimulusDomain | null | undefined;
}

export interface PerformedExposureFact {
    performedOccurrenceId: string;
    localDate: string;
    startedAt?: string;
    endedAt?: string;
    /** Brief/export provenance only; omitted from default decision snapshots and hashes. */
    executionState?: SessionExecutionState;
    /** Brief/export source linkage; omitted from decision snapshots unless explicitly requested. */
    providerActivityIds?: string[];
    /** Brief/export only (issue #813 / #803): logged unilateral lower-body working sets from the
     * structured execution (`deliveredPatternWork`). Absent = no such delivered evidence.
     * Omitted from decision snapshots unless explicitly requested. */
    deliveredUnilateralLowerBody?: { workingSets: number; stepIds: string[] };
    /** Brief/export only: the structured execution's entries could not be read, so delivered
     * composition is unknown rather than absent. */
    deliveredCompositionUnavailable?: boolean;
    durationMin?: number;
    modality: Modality | 'Unknown';
    category?: SessionCategory;
    confidence: FactConfidence;
    sourceKinds: Array<'structured_execution' | 'provider_activity' | 'legacy_strength'>;
    evidenceTier: EvidenceTier;
    /** Provider-neutral semantic provenance. Omitted when a structured execution is present
     * so exact authored semantics stay authoritative. These fields do not themselves grant
     * exact weekly-role coverage. */
    stimulusDomain?: ActivityStimulusDomain;
    sessionCost?: ActivitySessionCost;
    intensityEvidence?: string;
    intensityClassificationVersion?: number;
    workoutId?: string;
    templateId?: string;
    /** Exact catalog dose variant recovered from the recommendation that owns this execution.
     * Missing means the performed dose variant is unknown and cannot prove power coverage. */
    workoutVariantId?: WorkoutVariant['id'];
    /** True when the completed exposure used a readiness-limited (`modify`-tier) easier
     * dose. Preserved through canonical coverage history so a completed modify-tier walk
     * cannot claim exact weekly `aerobic_volume` role coverage. */
    isReadinessModifiedDose?: boolean;
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
    overridesDegraded?: boolean;
}

export function normalizeModality(raw: string | undefined): Modality | 'Unknown' {
    if (!raw) return 'Unknown';
    const lower = raw.toLowerCase();
    if (lower.includes('strength') || lower.includes('weight') || lower.includes('lift')) return 'Strength';
    if (isGarminCyclingActivityType(lower) || lower.includes('cycl') || lower.includes('bike') || lower.includes('biking')) return 'Cycling';
    if (lower.includes('run')) return 'Running';
    if (lower.includes('swim')) return 'Swimming';
    if (lower.includes('walk')) return 'Walking';
    if (lower.includes('mobility') || lower.includes('yoga')) return 'Mobility';
    if (lower.includes('soccer') || lower.includes('football') || lower.includes('field')) return 'Field';
    if (lower.includes('cross') || lower.includes('row') || lower.includes('ellipt')) return 'Cross Training';
    if (lower === 'rest' || lower === 'none') return 'None';
    return 'Unknown';
}

function normalizeCategory(category?: string): SessionCategory | undefined {
    if (!category) return undefined;
    const cat = category as SessionCategory;
    const validCategories: SessionCategory[] = [
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
        modality?: Modality;
        category?: SessionCategory;
        startedAt?: string;
        endedAt?: string;
        executionState?: SessionExecutionState;
        durationMin?: number;
        isLegacyStrength?: boolean;
        workoutVariantId?: WorkoutVariant['id'];
        isReadinessModifiedDose?: boolean;
    };
    provider?: {
        activityId: string;
        provider: string;
        modality?: Modality | 'Unknown';
        startedAt?: string;
        endedAt?: string;
        durationMin?: number;
        garminActivity?: NormalizedGarminActivity;
        override?: ActivityOverride;
        /** Failed override hydration cannot prove that provider semantics are unmodified. */
        overridesUnavailable?: boolean;
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

/** Re-evaluate an already reconciled exact identity under a new descriptor, without
 * carrying old descriptor credit or widening semantic coverage policy. */
export function deriveExactCoverageCredits(
    fact: Pick<PerformedExposureFact, 'performedOccurrenceId' | 'workoutId' | 'workoutVariantId' | 'isReadinessModifiedDose' | 'sourceKinds'>,
    descriptor: CoverageSetDescriptor,
): CoverageCreditFact[] {
    const coverageCredits: CoverageCreditFact[] = [];
    const workoutId = fact.workoutId;
    if (workoutId && workoutId !== 'legacy_strength') {
        const matchingItems = descriptor.coverage
            .filter(item => item.workoutIds.includes(workoutId))
            // Issue #802: completed power credit requires both exact workout identity and
            // the exact materialized dose variant. Unknown variants fail closed.
            .filter(item => item.key !== 'power_exposure' || (
                fact.workoutVariantId !== undefined
                && grantsPowerExposureCredit({
                    workoutId,
                    variant: fact.workoutVariantId,
                    isReadinessModifiedDose: fact.isReadinessModifiedDose,
                })
            ))
            // Issue #804: completed mechanical credit likewise requires the exact materialized
            // variant. Unknown variants fail closed rather than inheriting a broad family role.
            .filter(item => item.key !== 'mechanical_exposure' || (
                fact.workoutVariantId !== undefined
                && grantsMechanicalExposureCredit({
                    workoutId,
                    variant: fact.workoutVariantId as MechanicalDoseVariant,
                    isReadinessModifiedDose: fact.isReadinessModifiedDose,
                })
            ));
        for (const item of matchingItems) {
            coverageCredits.push({
                performedOccurrenceId: fact.performedOccurrenceId,
                coverageSetId: descriptor.id,
                coverageKey: item.key,
                workoutId,
                creditKind: 'exact',
                confidence: 1.0,
                reasonCode: 'exact_workout_identity',
                sourceKinds: fact.sourceKinds,
            });
        }
    }
    return coverageCredits;
}

/**
 * Pure fact derivation from a single active occurrence and its hydrated sources.
 * Enforces field-level source precedence (D4, D5).
 */
export function deriveFactsFromOccurrence(
    occurrence: PerformedTrainingOccurrence,
    hydrated: HydratedOccurrenceContext,
    catalog: PerformedTrainingCatalog,
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
    const providerOverride = hydrated.structured ? undefined : hydrated.provider?.override;
    const modality: Modality | 'Unknown' =
        hydrated.structured?.modality
        ?? providerOverride?.overriddenModality
        ?? (occurrenceModality && occurrenceModality !== 'Unknown' ? occurrenceModality : undefined)
        ?? (providerModality && providerModality !== 'Unknown' ? providerModality : undefined)
        ?? occurrenceModality
        ?? providerModality
        ?? 'Unknown';

    const workoutId = hydrated.structured?.workoutId;
    const explicitTemplateCategory = hydrated.structured?.templateId
        ? catalog.templateCategory(hydrated.structured?.templateId)
        : undefined;
    const templateId = hydrated.structured?.templateId ?? (workoutId ? catalog.templateIdForWorkoutId(workoutId) : undefined);
    const category = normalizeCategory(
        hydrated.structured?.category
        ?? explicitTemplateCategory
        ?? (workoutId ? catalog.categoryForWorkoutId(workoutId) : undefined),
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
    } else if (providerOverride) {
        confidence = 'high';
        evidenceTier = 'athleteClassification';
    } else if (hydrated.provider?.garminActivity) {
        confidence = 'inferred';
        evidenceTier = classifyGarminTier({
            trainingEffectAerobic: hydrated.provider.garminActivity.trainingEffectAerobic,
            trainingEffectAnaerobic: hydrated.provider.garminActivity.trainingEffectAnaerobic,
            intensityTag: hydrated.provider.garminActivity.intensityTag ?? '',
            activityTrainingLoad: hydrated.provider.garminActivity.activityTrainingLoad,
            modalityKnown: modality !== 'Unknown',
        });
    }

    let structuredDomain: ActivityStimulusDomain | undefined;
    if (hydrated.structured) {
        const family = (workoutId ? catalog.stimulusFamilyForWorkout(workoutId) : undefined)
            ?? (templateId ? catalog.stimulusFamilyForTemplate(templateId) : undefined);
        if (family && family !== 'recovery') {
            structuredDomain = family;
        } else if (family === 'recovery') {
            structuredDomain = 'recovery';
        }
    }

    const localDate = requirePerformedLocalDate(occurrence, startedAt, hydrated);
    const hasOverride = hydrated.provider?.override !== undefined;
    const providerSemantics = (hydrated.structured || hasOverride || hydrated.provider?.overridesUnavailable)
        ? undefined
        : hydrated.provider?.garminActivity;
    const resolvedStimulusDomain = structuredDomain ?? providerSemantics?.stimulusDomain;

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
        ...(resolvedStimulusDomain !== undefined ? { stimulusDomain: resolvedStimulusDomain } : {}),
        ...(providerSemantics?.sessionCost !== undefined ? { sessionCost: providerSemantics.sessionCost } : {}),
        ...(providerSemantics?.intensityEvidence !== undefined ? { intensityEvidence: providerSemantics.intensityEvidence } : {}),
        ...(providerSemantics?.intensityClassificationVersion !== undefined
            ? { intensityClassificationVersion: providerSemantics.intensityClassificationVersion }
            : {}),
        ...(workoutId ? { workoutId } : {}),
        ...(templateId ? { templateId } : {}),
        ...(hydrated.structured?.workoutVariantId ? { workoutVariantId: hydrated.structured.workoutVariantId } : {}),
        ...(hydrated.structured?.isReadinessModifiedDose ? { isReadinessModifiedDose: true } : {}),
    };

    const coverageCredits: CoverageCreditFact[] = [];
    if (workoutId && workoutId !== 'legacy_strength') {
        coverageCredits.push(...deriveExactCoverageCredits(exposure, descriptor));
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
