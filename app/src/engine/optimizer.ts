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

export interface RankedCandidate {
    template: SessionTemplate;
    benefitScore: number;
    costPenalty: number;
    utilityScore: number;
    rationale: string;
}

export interface OptimizationOptions {
    focusEvent?: UserEvent | null;
    recentHistory?: { modality?: string; type?: string }[];
}

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

export function calculateStimulusBenefit(
    stimulusProfile: WorkoutStimulusProfile | undefined,
    unresolvedObjectives: WeeklyObjective[]
): number {
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

            // Patch 1: Anti-stacking for non-endurance modalities (e.g. Strength)
            const consecutiveCount = getConsecutiveModalityCount(history, template.modality);
            const isNonEndurance = !['cycling', 'running'].includes(template.modality.toLowerCase());
            if (consecutiveCount >= 2 && isNonEndurance) {
                prefMultiplier *= 0.15; // Soft suppression of 3rd+ consecutive day of strength/hybrid
            }

            // Patch 2: Event-Priority Utility Multiplier for A-Priority Focus Events
            if (focusEvent && focusEvent.priority === 'A') {
                const categoryLower = focusEvent.category.toLowerCase();
                const templateModLower = template.modality.toLowerCase();
                const matchesEvent =
                    (categoryLower.includes('cycling') && templateModLower.includes('cycling')) ||
                    (categoryLower.includes('running') && templateModLower.includes('running')) ||
                    (categoryLower.includes('strength') && templateModLower.includes('strength'));
                if (matchesEvent) {
                    prefMultiplier *= 1.40;
                }
            }

            // Patch 3: Post-Objective Aerobic Default Filler
            const isAerobicDefault = template.category === 'Easy Endurance' || template.title.toLowerCase().includes('zone 2');
            if (unresolvedObjectives.length === 0 && isAerobicDefault) {
                prefMultiplier *= 1.25;
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

