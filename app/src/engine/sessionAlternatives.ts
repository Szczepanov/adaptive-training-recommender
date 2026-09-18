import type { SessionTemplate, UserContext } from './models';
import { TEMPLATES } from './templates';
import { eligibleTemplates } from './eligibility';

/**
 * Same-effort, different-modality alternatives to today's recommended template -- the
 * neutral counterpart to `adjustSessionRecommendation`'s Tier 4 cross-modal substitution
 * (rules.ts), which only fires directionally (easier/harder). Reuses the same two gates
 * that make Tier 4 safe rather than inventing lighter ones:
 *   - `objectiveTransferable`: whether this session's training effect is fungible across
 *     modalities at all (false for Strength -- a squat day and a jog are not the same
 *     stimulus no matter how close their systemicCost is).
 *   - `eligibleTemplates`: equipment, environment, time budget, and injury/guardrail
 *     restricted-modality exclusion -- the same computation the day's own recommendation
 *     was filtered through, so an athlete whose Running is medically restricted can never
 *     be offered a run here just because a ride and a run share a category.
 *
 * `category` stands in for "same stimulus" because that is already this codebase's working
 * definition of it (coverage.ts credits the same `aerobic_volume` key across Cycling,
 * Running, and Walking "Easy Endurance" templates). `systemicCost` proximity picks the
 * closest-effort template within a modality when more than one shares the category.
 */
export function findStimulusMatchedAlternatives(
    baseTemplate: SessionTemplate,
    context: UserContext,
    checkinMinutes: number,
    date: string,
): SessionTemplate[] {
    if (baseTemplate.objectiveTransferable === false) return [];

    const avoidedModalities = new Set(context.preferences.avoidedModalities.map(m => m.trim().toLowerCase()));

    const candidates = eligibleTemplates(TEMPLATES, context, checkinMinutes, date)
        .filter(t => t.category === baseTemplate.category)
        .filter(t => t.modality !== baseTemplate.modality)
        .filter(t => !avoidedModalities.has(t.modality.trim().toLowerCase()));

    const costDelta = (t: SessionTemplate) => Math.abs(t.systemicCost - baseTemplate.systemicCost);

    const bestPerModality = new Map<SessionTemplate['modality'], SessionTemplate>();
    for (const candidate of candidates) {
        const existing = bestPerModality.get(candidate.modality);
        if (!existing || costDelta(candidate) < costDelta(existing)) {
            bestPerModality.set(candidate.modality, candidate);
        }
    }

    return [...bestPerModality.values()].sort((a, b) => costDelta(a) - costDelta(b));
}
