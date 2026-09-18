import type { Recommendation, SessionTemplate, UserContext, WorkoutStimulusProfile } from './models';
import { ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID } from './templates';
import { eligibleTemplates, resolveMaximumSessionMinutes } from './eligibility';
import { resolveTimeCapDoseAdjustment } from './optimizer';

const STIMULUS_AXES: readonly (keyof WorkoutStimulusProfile)[] = [
    'aerobicEndurance',
    'thresholdPower',
    'vo2MaxPower',
    'repeatedSurges',
    'sprintPower',
    'fatigueResistance',
    'maxStrength',
    'hypertrophy',
];

function normalizedSet(values: readonly string[]): Set<string> {
    return new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean));
}

function stimulusDistance(base: SessionTemplate, candidate: SessionTemplate): number {
    if (!base.stimulusProfile || !candidate.stimulusProfile) return Number.POSITIVE_INFINITY;
    return STIMULUS_AXES.reduce(
        (total, axis) => total + Math.abs(base.stimulusProfile![axis] - candidate.stimulusProfile![axis]),
        0,
    );
}

function midpointDuration(template: SessionTemplate): number {
    return (template.durationMin + template.durationMax) / 2;
}

/**
 * Finds conservative cross-modality alternatives for today's recommendation.
 *
 * This is intentionally stricter than merely sharing a broad category:
 * - the base and candidate must both opt into objective transfer;
 * - normal hard-feasibility gates still apply (equipment, environment, time and safety);
 * - avoided modalities are excluded and deprioritized modalities are used only as fallback;
 * - a one-tap substitution may match or reduce systemic cost, but never silently increase it;
 * - within each modality, the enriched stimulus profile is the primary similarity signal,
 *   followed by systemic cost and duration proximity for deterministic tie-breaking.
 *
 * Category remains a coarse compatibility gate because the catalog's enriched templates use
 * category-derived stimulus profiles for older templates that do not yet author one explicitly.
 * Weekly programming-role coverage is deliberately NOT inferred here: coverage.ts requires exact
 * catalog/workout identity and is a separate concern from physiological stimulus similarity.
 */
export function findStimulusMatchedAlternatives(
    baseTemplate: SessionTemplate,
    context: UserContext,
    checkinMinutes: number,
    date: string,
): SessionTemplate[] {
    const enrichedBase = ENRICHED_TEMPLATES_BY_ID.get(baseTemplate.id) ?? baseTemplate;
    if (enrichedBase.objectiveTransferable === false) return [];

    const avoidedModalities = normalizedSet(context.preferences.avoidedModalities);
    const deprioritizedModalities = normalizedSet(context.preferences.deprioritizedModalities);

    let candidates = eligibleTemplates(ENRICHED_TEMPLATES, context, checkinMinutes, date)
        .filter(candidate => candidate.category === enrichedBase.category)
        .filter(candidate => candidate.modality !== enrichedBase.modality)
        .filter(candidate => candidate.objectiveTransferable !== false)
        .filter(candidate => candidate.systemicCost <= enrichedBase.systemicCost + Number.EPSILON)
        .filter(candidate => !avoidedModalities.has(candidate.modality.trim().toLowerCase()));

    const nonDeprioritized = candidates.filter(
        candidate => !deprioritizedModalities.has(candidate.modality.trim().toLowerCase()),
    );
    if (nonDeprioritized.length > 0) candidates = nonDeprioritized;

    const compare = (left: SessionTemplate, right: SessionTemplate): number => {
        const stimulusDelta = stimulusDistance(enrichedBase, left) - stimulusDistance(enrichedBase, right);
        if (stimulusDelta !== 0) return stimulusDelta;

        const leftCostDelta = Math.abs(left.systemicCost - enrichedBase.systemicCost);
        const rightCostDelta = Math.abs(right.systemicCost - enrichedBase.systemicCost);
        const costDelta = leftCostDelta - rightCostDelta;
        if (costDelta !== 0) return costDelta;

        const durationDelta = Math.abs(midpointDuration(left) - midpointDuration(enrichedBase))
            - Math.abs(midpointDuration(right) - midpointDuration(enrichedBase));
        if (durationDelta !== 0) return durationDelta;

        return left.id.localeCompare(right.id);
    };

    const bestPerModality = new Map<SessionTemplate['modality'], SessionTemplate>();
    for (const candidate of candidates) {
        const existing = bestPerModality.get(candidate.modality);
        if (!existing || compare(candidate, existing) < 0) {
            bestPerModality.set(candidate.modality, candidate);
        }
    }

    return [...bestPerModality.values()].sort(compare);
}

/**
 * Resolves a user-selected alternative against the CURRENT context instead of trusting a
 * previously rendered template id. This makes application fail closed when a new check-in,
 * injury restriction, equipment change or time change invalidates the earlier choice.
 */
export function resolveStimulusMatchedAlternative(
    baseTemplate: SessionTemplate,
    requestedTemplateId: string,
    context: UserContext,
    checkinMinutes: number,
    date: string,
): SessionTemplate | null {
    return findStimulusMatchedAlternatives(baseTemplate, context, checkinMinutes, date)
        .find(candidate => candidate.id === requestedTemplateId) ?? null;
}

/**
 * Applies a currently valid stimulus-matched alternative and re-derives any dose adjustment
 * from the replacement template. Reusing the original recommendation's activeDose would leak
 * modality-specific labels/durations (for example a cycling harder-dose) into a running swap.
 */
export function applyStimulusMatchedAlternative(
    baseRecommendation: Recommendation,
    requestedTemplateId: string,
    context: UserContext,
    checkinMinutes: number,
    date: string,
): Recommendation | null {
    const template = resolveStimulusMatchedAlternative(
        baseRecommendation.template,
        requestedTemplateId,
        context,
        checkinMinutes,
        date,
    );
    if (!template) return null;

    const maxTimeMinutes = resolveMaximumSessionMinutes(context, checkinMinutes, date);
    const doseAdjustment = resolveTimeCapDoseAdjustment(
        template,
        maxTimeMinutes,
        baseRecommendation.mode === 'modify',
    );

    return {
        ...baseRecommendation,
        template,
        rationale: `1-tap alternative applied: ${template.title} (${template.modality}) is the closest currently eligible cross-modality match for today's ${baseRecommendation.template.category.toLowerCase()} stimulus.`,
        activeDose: doseAdjustment?.activeDose,
        adjustment: doseAdjustment?.adjustment,
        prescription: undefined,
        primarySession: undefined,
    };
}
