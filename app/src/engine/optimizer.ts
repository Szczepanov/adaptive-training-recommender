import type {
    FatigueState,
    SessionTemplate,
    UserEvent,
    UserPreferences,
    WeeklyObjective,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';
import type { ResolvedAvailability } from './schedule';

const STRENGTH_CATEGORIES: SessionTemplate['category'][] = [
    'Upper-body Strength', 'Lower-body Strength', 'Full-body Strength', 'Power Maintenance',
];

export interface RankedCandidate {
    template: SessionTemplate;
    benefitScore: number;
    costPenalty: number;
    utilityScore: number;
    rationale: string;
}

export interface RecentHistoryEntry {
    modality?: string;
    type?: string;
    systemicCost?: number;
}

export interface OptimizationOptions {
    focusEvent?: UserEvent | null;
    /** `systemicCost` is optional so existing callers/tests that only track
     *  modality/type keep working -- omitting it just disables the intensity-stacking
     *  check below for that entry, never the modality-repetition checks. */
    recentHistory?: RecentHistoryEntry[];
    /** Set by planner.ts's weekly-architecture pre-pass (resolveWeeklyAnchors) when this
     *  candidate day was deliberately designated a "key session" day -- 'event-specific'
     *  for the weekend-style race-specific/race-simulation anchor, 'quality' for the
     *  midweek structured threshold/over-under anchor. Undefined/null (the default) means
     *  no anchor applies -- ranking behaves exactly as before this option existed. */
    anchorRole?: 'event-specific' | 'quality' | null;
    /** True when today sits immediately before or after either anchor day -- used to
     *  protect the anchor's freshness from heavy lower-body loading, independent of
     *  whatever was actually picked the day before (see Patch 1c above, which reacts to
     *  realized history; this reacts to a day that hasn't been picked yet). */
    adjacentToAnchor?: boolean;
}

/** Systemic-cost floor above which a template counts as a "hard" training day for
 *  same-day-tier stacking checks -- mirrors rules.ts's MODIFY_MAX_SYSTEMIC_COST idiom. */
const INTENSITY_STACK_THRESHOLD = 0.5;
/** Softer than the same-modality suppression below (0.15): this fires across *any*
 *  modality pairing (e.g. a hard bike day into a hard lift day), which is a real but
 *  lesser overreach risk than repeating the identical session type. */
const INTENSITY_STACK_PENALTY = 0.35;

/** Same magnitude class as the existing event-priority boost (1.25/1.40) below -- a
 *  deliberate nudge toward a day's designated weekly-architecture role, not a hard
 *  restriction (equipment/fatigue/safety gates already ran upstream, so a genuinely
 *  infeasible anchor day still falls through to the next-best real option). */
const ANCHOR_ROLE_BOOST = 1.35;
/** Protects an anchor's freshness by suppressing heavy lower-body/full-body strength on
 *  the day immediately before or after it -- upper-body and power-maintenance work are
 *  deliberately untouched (standard concurrent-training interference management: keep
 *  meaningful lower-body loading away from the key cycling days, not a blanket strength
 *  ban -- see docs on the weekly-architecture feature). */
const ANCHOR_ADJACENCY_SUPPRESSION = 0.3;
const HEAVY_LOWER_BODY_STRENGTH_CATEGORIES: SessionTemplate['category'][] = ['Lower-body Strength', 'Full-body Strength'];

export function getConsecutiveModalityCount(
    history: { modality?: string; type?: string }[],
    targetModality: string
): number {
    let count = 0;
    const target = targetModality.toLowerCase();
    for (let i = history.length - 1; i >= 0; i--) {
        const item = history[i];
        const modality = (item.modality ?? item.type ?? '').toLowerCase();
        if (modality.includes(target)) {
            count++;
        } else {
            break;
        }
    }
    return count;
}

export function getRollingModalityCount(
    history: { modality?: string; type?: string }[],
    targetModality: string
): number {
    const target = targetModality.toLowerCase();
    return history.filter(item => {
        const modality = (item.modality ?? item.type ?? '').toLowerCase();
        return modality.includes(target);
    }).length;
}

export function calculateStimulusBenefit(
    stimulusProfile: WorkoutStimulusProfile | undefined,
    unresolvedObjectives: WeeklyObjective[]
): number {
    // When no objectives remain unresolved, candidates receive baseline maintenance
    // benefit only. Objective-resolution policy -- what counts as "resolved" -- is
    // owned by microcycle.ts.
    if (!stimulusProfile || unresolvedObjectives.length === 0) return 0.5;

    let benefit = 0;
    unresolvedObjectives.forEach(obj => {
        const target = obj.targetStimulus;
        if (target.thresholdDevelopment && stimulusProfile.thresholdDevelopment) {
            benefit += target.thresholdDevelopment * stimulusProfile.thresholdDevelopment * 1.5;
        }
        if (target.surgeRepeatability && stimulusProfile.surgeRepeatability) {
            benefit += target.surgeRepeatability * stimulusProfile.surgeRepeatability * 1.5;
        }
        if (target.aerobicCapacity && stimulusProfile.aerobicCapacity) {
            benefit += target.aerobicCapacity * stimulusProfile.aerobicCapacity * 1.2;
        }
        if (target.maxStrength && stimulusProfile.maxStrength) {
            benefit += target.maxStrength * stimulusProfile.maxStrength * 1.2;
        }
    });

    return Math.max(0.2, benefit);
}

export function calculateFatigueCostPenalty(
    costProfile: WorkoutCostProfile | undefined,
    fatigueState: FatigueState
): number {
    if (!costProfile) return 0;
    const combined = fatigueState.combinedFatigue;

    // Dot product of candidate workout cost vs current dimensional fatigue
    const systemicPenalty = costProfile.systemic * combined.systemic * 2.0;
    const cardioPenalty = costProfile.cardiovascular * combined.cardiovascular * 1.5;
    const lowerBodyPenalty = costProfile.lowerBody * combined.lowerBody * 2.5; // High DOMS interference
    const upperBodyPenalty = costProfile.upperBody * combined.upperBody * 1.5;
    const impactPenalty = costProfile.impactTissue * combined.impactTissue * 2.0;
    const neuroPenalty = costProfile.neuromuscular * combined.neuromuscular * 1.8;

    return systemicPenalty + cardioPenalty + lowerBodyPenalty + upperBodyPenalty + impactPenalty + neuroPenalty;
}

/**
 * Ranks candidate workout templates using the benefit-vs-cost optimization engine.
 * Utility = (Benefit / (1 + Cost Penalty)) * Preference Multiplier
 */
export function rankCandidatesByUtility(
    candidates: SessionTemplate[],
    unresolvedObjectives: WeeklyObjective[],
    fatigueState: FatigueState,
    availability: ResolvedAvailability,
    injuryConstraints: string[],
    preferences: UserPreferences,
    options: OptimizationOptions = {}
): RankedCandidate[] {
    const isDisliked = (t: SessionTemplate) => preferences.avoidedModalities.some(m => m.toLowerCase() === t.modality.toLowerCase());
    const isPreferred = (t: SessionTemplate) => preferences.preferredModalities.some(m => m.toLowerCase() === t.modality.toLowerCase());

    const extraMargin = preferences.extraRecoveryMargin ?? preferences.conservativeBias ?? false;
    const focusEvent = options.focusEvent;
    const history = options.recentHistory ?? [];

    const isStrengthResolved = !unresolvedObjectives.some(o => o.key === 'strength_maintenance');

    return candidates
        .filter(t => t.durationMin <= availability.maxTimeMinutes)
        .filter(t => {
            // Equipment check
            for (const req of t.requiredEquipment) {
                if (!availability.availableEquipment.includes(req)) return false;
            }
            return true;
        })
        .filter(t => {
            // Hard safety gating: Physical injuries strictly exclude matching modalities
            const lowerMod = t.modality.toLowerCase();
            return !injuryConstraints.some(inj => inj.toLowerCase().includes(lowerMod));
        })
        .map(template => {
            const benefit = calculateStimulusBenefit(template.stimulusProfile, unresolvedObjectives);
            let costPenalty = calculateFatigueCostPenalty(template.costProfile, fatigueState);

            if (extraMargin && template.systemicCost > 0.5) {
                costPenalty += 0.3; // Extra Recovery Margin penalizes high systemic cost workouts on borderline fit
            }

            // Soft Preference Multiplier (Dislikes get 0.2x penalty rather than hard exclude)
            let prefMultiplier = 1.0;
            if (isDisliked(template)) {
                prefMultiplier = 0.2;
            } else if (isPreferred(template)) {
                prefMultiplier = 1.3;
            }

            // Patch 1: Anti-stacking, checking both consecutive days AND rolling 7-day
            // total exposures (across rest days). Applies to every modality uniformly --
            // cycling/running used to be exempted here on the theory that endurance
            // "doesn't stack" the way strength does, which let the optimizer chain the
            // same high-benefit endurance template (e.g. Tempo Ride) every single day
            // once nothing else suppressed it. There is no modality for which repeating
            // the identical session 3+ days running is actually the right prescription.
            const consecutiveCount = getConsecutiveModalityCount(history, template.modality);
            const rollingCount = getRollingModalityCount(history, template.modality);
            if (consecutiveCount >= 2 || rollingCount >= 2) {
                prefMultiplier *= 0.15; // Soft suppression of 3rd+ exposure to the same modality
            }

            // Patch 1b: Soft penalty on additional strength-family sessions once the
            // strength objective is already fulfilled this microcycle. Scoped to actual
            // strength categories (not "everything except cycling/running", which used
            // to also catch Field/Technical-Skill sessions that have nothing to do with
            // the strength objective being resolved).
            const isStrengthCategory = STRENGTH_CATEGORIES.includes(template.category);
            if (isStrengthResolved && isStrengthCategory) {
                prefMultiplier *= 0.20; // De-prioritize additional gym sessions when strength objective is satisfied
            }

            // Patch 1c: Intensity-stacking cap -- a Moderate/Hard day (systemicCost >= 0.5)
            // immediately following another Moderate/Hard day, in ANY modality, gets
            // suppressed. This is what actually stops the "tempo trap": Patch 1 above only
            // fires once the same modality has repeated twice, so a benefit-maximizing
            // optimizer could otherwise stack Tempo Ride on day 1 and day 2 back-to-back
            // before same-modality anti-stacking ever engages. Standard periodization
            // treats hard/moderate-day-into-hard/moderate-day as the thing to avoid,
            // independent of whether the two days share a modality.
            const lastEntry = history[history.length - 1];
            const lastWasHighIntensity = (lastEntry?.systemicCost ?? 0) >= INTENSITY_STACK_THRESHOLD;
            const candidateIsHighIntensity = template.systemicCost >= INTENSITY_STACK_THRESHOLD;
            if (lastWasHighIntensity && candidateIsHighIntensity) {
                prefMultiplier *= INTENSITY_STACK_PENALTY;
            }

            // Patch 2: Event-Priority Utility Multiplier & Non-Event Modality Penalty
            if (focusEvent && (focusEvent.priority === 'A' || focusEvent.priority === 'B')) {
                const categoryLower = focusEvent.category.toLowerCase();
                const templateModLower = template.modality.toLowerCase();
                const matchesEvent =
                    (categoryLower.includes('cycling') && templateModLower.includes('cycling')) ||
                    (categoryLower.includes('running') && templateModLower.includes('running')) ||
                    (categoryLower.includes('strength') && templateModLower.includes('strength')) ||
                    // Triathlon is documented (ADR-0007) to boost BOTH Cycling and Running --
                    // 'triathlon' doesn't substring-match any of the three checks above, so
                    // without this it fell through to the non-event penalty branch below and
                    // actively suppressed the two modalities that matter most for the event.
                    (categoryLower === 'triathlon' && (templateModLower.includes('cycling') || templateModLower.includes('running')));
                if (matchesEvent) {
                    const boost = focusEvent.priority === 'A' ? 1.40 : 1.25;
                    prefMultiplier *= boost;
                } else if (!isPreferred(template)) {
                    // Non-event modalities (e.g. Running during a Cycling event) receive a soft penalty
                    // so they do not hijack event-specific threshold/aerobic preparation
                    prefMultiplier *= 0.20;
                }
            }

            // Patch 3: Post-Objective Aerobic Default Filler
            const isAerobicDefault = template.category === 'Easy Endurance' || template.title.toLowerCase().includes('zone 2');
            if (unresolvedObjectives.length === 0 && isAerobicDefault) {
                prefMultiplier *= 1.25;
            }

            // Patch 4: Weekly-architecture anchor boost -- nudges ranking toward the
            // deliberately-designated role for a day the pre-pass chose as an anchor,
            // rather than leaving "which day gets the key session" entirely to reactive
            // anti-stacking/benefit-maximizing. Scoped to Cycling since this is the same
            // athlete/event-specific progression the anchor mechanism was built for.
            if (options.anchorRole === 'event-specific' && template.modality === 'Cycling' && template.category === 'Race-Specific Endurance') {
                prefMultiplier *= ANCHOR_ROLE_BOOST;
            } else if (options.anchorRole === 'quality' && template.modality === 'Cycling' && (template.category === 'Moderate Endurance' || template.category === 'Hard Endurance')) {
                prefMultiplier *= ANCHOR_ROLE_BOOST;
            }

            // Patch 5: Anchor-adjacency freshness protection -- suppress heavy lower-body/
            // full-body strength the day immediately before or after an anchor, regardless
            // of what actually gets picked on the anchor day itself.
            if (options.adjacentToAnchor && HEAVY_LOWER_BODY_STRENGTH_CATEGORIES.includes(template.category) && template.systemicCost >= INTENSITY_STACK_THRESHOLD) {
                prefMultiplier *= ANCHOR_ADJACENCY_SUPPRESSION;
            }

            const utility = (benefit / (1 + costPenalty)) * prefMultiplier;

            let rationale = `Benefit score: ${benefit.toFixed(2)}, Fatigue cost penalty: ${costPenalty.toFixed(2)}.`;
            if (isDisliked(template)) {
                rationale += ` (Soft penalty applied: modality '${template.modality}' is marked as avoided/disliked).`;
            }

            return {
                template,
                benefitScore: benefit,
                costPenalty,
                utilityScore: utility,
                rationale,
            };
        })
        .sort((a, b) => b.utilityScore - a.utilityScore);
}

