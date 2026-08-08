import type {
    FatigueState,
    SessionHistoryEntry,
    SessionRole,
    SessionTemplate,
    UserContext,
    UserEvent,
    UserPreferences,
    WeeklyObjective,
    WorkoutCostProfile,
} from './models';
import type { ResolvedAvailability } from './schedule';
import { resolveAvailability } from './schedule';
import { addDaysToLocalDateString, getDayDiff, getLocalDateString } from '../utils/localDate';

const STRENGTH_CATEGORIES: SessionTemplate['category'][] = [
    'Upper-body Strength', 'Lower-body Strength', 'Full-body Strength', 'Power Maintenance',
];

export interface RankedCandidate {
    template: SessionTemplate;
    benefitScore: number;
    costPenalty: number;
    utilityScore: number;
    rationale: string;
    excludedReasons: string[];
}

export interface RankCandidatesResult {
    accepted: RankedCandidate[];
    rejected: RankedCandidate[];
    all: RankedCandidate[];
}

export interface RecentHistoryEntry {
    date?: string;
    templateId?: string;
    category?: SessionTemplate['category'];
    modality?: string;
    type?: string;
    role?: SessionRole;
    systemicCost?: number;
    lowerBodyCost?: number;
}

export interface OptimizationOptions {
    date?: string;
    focusEvent?: UserEvent | null;
    recentHistory?: (RecentHistoryEntry | SessionHistoryEntry)[];
    anchorRole?: 'event-specific' | 'quality' | null;
    adjacentToAnchor?: boolean;
}

export interface OptimizationContext {
    unresolvedObjectives: WeeklyObjective[];
    fatigueState: FatigueState;
    availability: ResolvedAvailability;
    injuryConstraints: string[];
    preferences: UserPreferences;
    options: OptimizationOptions;
}

const DEFAULT_PREFERENCES: UserPreferences = {
    userId: '',
    preferredRecoveryStyle: 'mixed',
    defaultWeekdayTimeMin: 45,
    defaultWeekendTimeMin: 60,
    preferredTimeOfDay: 'flexible',
    preferredModalities: [],
    deprioritizedModalities: [],
    avoidedModalities: [],
    explanationVerbosity: 'detailed',
    conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
};

const INTENSITY_STACK_THRESHOLD = 0.5;
const INTENSITY_STACK_PENALTY = 0.35;
const ANCHOR_ROLE_BOOST = 1.35;
const ANCHOR_ADJACENCY_SUPPRESSION = 0.3;
const HEAVY_LOWER_BODY_STRENGTH_CATEGORIES: SessionTemplate['category'][] = ['Lower-body Strength', 'Full-body Strength'];
const VARIETY_TIE_BREAK_GAP = 0.05;

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

export function normalizeHistory(
    history: (RecentHistoryEntry | SessionHistoryEntry)[],
    targetDate: string
): SessionHistoryEntry[] {
    const validHistory = history.filter(entry => entry && typeof entry === 'object');
    const total = validHistory.length;
    return validHistory.map((entry, idx) => {
        const date = entry.date ?? addDaysToLocalDateString(targetDate, -(total - idx));
        const modality = ((entry.modality ?? entry.type ?? 'None') as SessionTemplate['modality']);
        const systemicCost = entry.systemicCost ?? 0;
        const lowerBodyCost = ('lowerBodyCost' in entry && typeof entry.lowerBodyCost === 'number')
            ? entry.lowerBodyCost
            : 0;

        let role: SessionRole = 'supporting';
        if ('role' in entry && entry.role) {
            role = entry.role;
        } else if (('category' in entry && entry.category && ['Hard Endurance', 'Moderate Endurance', 'Race-Specific Endurance', 'Full-body Strength'].includes(entry.category)) || systemicCost >= 0.7) {
            role = 'anchor';
        }

        const intensityClass = ('intensityClass' in entry && entry.intensityClass)
            ? entry.intensityClass
            : systemicCost >= 0.6 ? 'hard' : systemicCost >= 0.3 ? 'moderate' : 'easy';

        return {
            date,
            templateId: 'templateId' in entry ? entry.templateId : undefined,
            category: 'category' in entry ? entry.category : undefined,
            modality,
            role,
            intensityClass,
            systemicCost,
            lowerBodyCost,
        };
    });
}

export function evaluateRecoveryConstraints(
    template: SessionTemplate,
    targetDate: string,
    history: SessionHistoryEntry[],
    options: OptimizationOptions
): string[] {
    const reasons: string[] = [];

    // Constraint 1: Quality spacing -- >= 1 clear day (dayDiff >= 2) between two anchor-role sessions
    const isCandidateAnchor = options.anchorRole === 'event-specific' ||
        options.anchorRole === 'quality' ||
        template.category === 'Hard Endurance' ||
        template.category === 'Race-Specific Endurance' ||
        template.category === 'Full-body Strength';

    if (isCandidateAnchor) {
        const priorAnchor = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff > 0 && diff < 2 && (
                h.role === 'anchor' ||
                (h.category && ['Hard Endurance', 'Race-Specific Endurance', 'Full-body Strength'].includes(h.category))
            );
        });
        if (priorAnchor) {
            reasons.push('QUALITY_SPACING_VIOLATION');
        }
    }

    // Constraint 2: Hard lower-body spacing -- no back-to-back sessions with lowerBodyCost >= 0.6
    const candidateLowerBodyCost = template.costProfile?.lowerBody ?? (STRENGTH_CATEGORIES.includes(template.category) ? 0.6 : 0);
    if (candidateLowerBodyCost >= 0.6) {
        const priorHardLower = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff === 1 && h.lowerBodyCost >= 0.6;
        });
        if (priorHardLower) {
            reasons.push('HARD_LOWER_BODY_SPACING_VIOLATION');
        }
    }

    // Constraint 3: Rolling hard cap -- <= 3 sessions with systemicCost >= 0.5 in any rolling 7 days (dayDiff <= 6)
    if (template.systemicCost >= 0.5) {
        const hardInRollingWindow = history.filter(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff >= 1 && diff <= 6 && h.systemicCost >= 0.5;
        }).length;
        if (hardInRollingWindow >= 3) {
            reasons.push('ROLLING_HARD_CAP_EXCEEDED');
        }
    }

    // Constraint 4: Anchor protection -- no heavy lower-body strength within 1 day of a key cycling session
    const isHeavyLowerBodyStrength = HEAVY_LOWER_BODY_STRENGTH_CATEGORIES.includes(template.category) ||
        (template.modality === 'Strength' && (template.costProfile?.lowerBody ?? 0) >= 0.6);
    const isKeyCyclingSession = template.modality === 'Cycling' &&
        (options.anchorRole === 'event-specific' || options.anchorRole === 'quality' || template.category === 'Race-Specific Endurance' || template.category === 'Hard Endurance');

    if (isHeavyLowerBodyStrength) {
        const priorKeyCycling = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff >= 0 && diff <= 1 && h.modality === 'Cycling' && (
                h.role === 'anchor' || (h.category && ['Race-Specific Endurance', 'Hard Endurance'].includes(h.category))
            );
        });
        if (priorKeyCycling || options.adjacentToAnchor) {
            reasons.push('ANCHOR_PROTECTION_VIOLATION');
        }
    } else if (isKeyCyclingSession) {
        const priorHeavyStrength = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff >= 0 && diff <= 1 && (
                (h.category && HEAVY_LOWER_BODY_STRENGTH_CATEGORIES.includes(h.category)) ||
                (h.modality === 'Strength' && h.lowerBodyCost >= 0.6)
            );
        });
        if (priorHeavyStrength) {
            reasons.push('ANCHOR_PROTECTION_VIOLATION');
        }
    }

    return reasons;
}

export function calculateStimulusBenefit(
    template: SessionTemplate,
    unresolvedObjectives: WeeklyObjective[]
): number {
    if (template.category === 'Rest') {
        return 0.1;
    }

    const stimulusProfile = template.stimulusProfile;
    if (!stimulusProfile || unresolvedObjectives.length === 0) {
        if (template.category === 'Mobility/Recovery') return 0.2;
        if (template.category === 'Technical Skill') return 0.3;
        const totalStim = stimulusProfile ? (stimulusProfile.aerobicCapacity ?? 0) + (stimulusProfile.thresholdDevelopment ?? 0) : 0;
        return Math.min(0.75, 0.45 + totalStim * 0.2);
    }

    let benefit = 0;
    unresolvedObjectives.forEach(obj => {
        if (obj.qualification) {
            if (obj.qualification.allowedCategories && obj.qualification.allowedCategories.length > 0) {
                if (!obj.qualification.allowedCategories.includes(template.category)) {
                    return;
                }
            }
            if (obj.qualification.allowedModalities && obj.qualification.allowedModalities.length > 0) {
                if (!obj.qualification.allowedModalities.includes(template.modality)) {
                    return;
                }
            }

        }

        const target = obj.targetStimulus;
        const threshTarget = target.thresholdPower ?? target.thresholdDevelopment ?? 0;
        const threshStim = stimulusProfile.thresholdPower ?? stimulusProfile.thresholdDevelopment ?? 0;
        if (threshTarget && threshStim) {
            benefit += threshTarget * threshStim * 1.5;
        }

        const surgeTarget = target.repeatedSurges ?? target.surgeRepeatability ?? 0;
        const surgeStim = stimulusProfile.repeatedSurges ?? stimulusProfile.surgeRepeatability ?? 0;
        if (surgeTarget && surgeStim) {
            benefit += surgeTarget * surgeStim * 1.5;
        }

        const aeroTarget = target.aerobicEndurance ?? target.aerobicCapacity ?? 0;
        const aeroStim = stimulusProfile.aerobicEndurance ?? stimulusProfile.aerobicCapacity ?? 0;
        if (aeroTarget && aeroStim) {
            benefit += aeroTarget * aeroStim * 1.2;
        }

        const strengthTarget = target.maxStrength ?? target.hypertrophy ?? 0;
        const strengthStim = stimulusProfile.maxStrength ?? stimulusProfile.hypertrophy ?? 0;
        if (strengthTarget && strengthStim) {
            benefit += strengthTarget * strengthStim * 1.6;
        }

        const fatigueTarget = target.fatigueResistance ?? 0;
        const fatigueStim = stimulusProfile.fatigueResistance ?? 0;
        if (fatigueTarget && fatigueStim) {
            benefit += fatigueTarget * fatigueStim * 1.2;
        }
    });

    if (benefit === 0) {
        benefit = template.category === 'Mobility/Recovery' ? 0.2 : 0.5;
    }

    return Math.max(0.2, benefit);
}

export function calculateFatigueCostPenalty(
    costProfile: WorkoutCostProfile | undefined,
    fatigueState: FatigueState
): number {
    if (!costProfile) return 0;
    const combined = fatigueState.combinedFatigue;

    const systemicPenalty = costProfile.systemic * combined.systemic * 2.0;
    const cardioPenalty = costProfile.cardiovascular * combined.cardiovascular * 1.5;
    const lowerBodyPenalty = costProfile.lowerBody * combined.lowerBody * 2.5;
    const upperBodyPenalty = costProfile.upperBody * combined.upperBody * 1.5;
    const impactPenalty = costProfile.impactTissue * combined.impactTissue * 2.0;
    const neuroPenalty = costProfile.neuromuscular * combined.neuromuscular * 1.8;

    return systemicPenalty + cardioPenalty + lowerBodyPenalty + upperBodyPenalty + impactPenalty + neuroPenalty;
}

export function buildOptimizationContext(
    intent: {
        unresolvedObjectives: WeeklyObjective[];
        fatigue: FatigueState;
        periodization?: { focusEvent?: UserEvent | null } | null;
        history?: (RecentHistoryEntry | SessionHistoryEntry)[];
    },
    context: UserContext,
    preferences: Partial<UserPreferences> | null,
    date: string,
    options: Partial<OptimizationOptions> = {}
): OptimizationContext {
    const contextPrefs = context.preferences ? {
        ...DEFAULT_PREFERENCES,
        preferredModalities: context.preferences.preferredModalities ?? [],
        deprioritizedModalities: context.preferences.deprioritizedModalities ?? [],
        avoidedModalities: context.preferences.avoidedModalities ?? [],
        conservativeBias: context.preferences.conservativeBias ?? false,
    } : DEFAULT_PREFERENCES;
    const basePrefs = preferences ? { ...DEFAULT_PREFERENCES, ...preferences } : contextPrefs;
    const userId = (context.trainingSettings?.userId && context.trainingSettings.userId !== '')
        ? context.trainingSettings.userId
        : (basePrefs.userId ?? '');
    const effectivePreferences: UserPreferences = {
        ...basePrefs,
        userId,
    };

    const availability = resolveAvailability(date, null, [], context);
    const injuryConstraints = context.constraints?.restrictedModalities ?? [];

    const rawHistory: (RecentHistoryEntry | SessionHistoryEntry)[] = options.recentHistory ?? (intent.history ?? []).map(e => {
        const completedDate = 'completedDate' in e && typeof e.completedDate === 'string' ? e.completedDate : undefined;
        const rec = e as Record<string, unknown>;
        const recType = rec.trainingRecordLike && typeof rec.trainingRecordLike === 'object' && 'type' in (rec.trainingRecordLike as object) ? (rec.trainingRecordLike as { type?: string }).type : undefined;
        const costProf = rec.costProfile && typeof rec.costProfile === 'object' ? rec.costProfile as Record<string, number> : undefined;
        const systemic = costProf?.systemic;
        const lowerBody = costProf?.lowerBody;
        const entryType = 'type' in e && typeof e.type === 'string' ? e.type : undefined;

        return {
            date: completedDate ?? e.date ?? date,
            templateId: e.templateId,
            category: e.category,
            modality: e.modality ?? recType ?? entryType,
            role: e.role,
            systemicCost: e.systemicCost ?? systemic ?? 0,
            lowerBodyCost: ('lowerBodyCost' in e && typeof e.lowerBodyCost === 'number')
                ? e.lowerBodyCost
                : (lowerBody ?? 0),
            type: entryType ?? recType,
        };
    });

    const optimizationOptions: OptimizationOptions = {
        date,
        focusEvent: options.focusEvent ?? intent.periodization?.focusEvent ?? null,
        recentHistory: rawHistory,
        anchorRole: options.anchorRole ?? null,
        adjacentToAnchor: options.adjacentToAnchor ?? false,
    };

    return {
        unresolvedObjectives: intent.unresolvedObjectives ?? [],
        fatigueState: intent.fatigue,
        availability,
        injuryConstraints,
        preferences: effectivePreferences,
        options: optimizationOptions,
    };
}

export function rankCandidates(
    candidates: SessionTemplate[],
    unresolvedObjectives: WeeklyObjective[],
    fatigueState: FatigueState,
    availability: ResolvedAvailability,
    injuryConstraints: string[],
    preferences: UserPreferences,
    options: OptimizationOptions = {}
): RankCandidatesResult {
    const isDisliked = (t: SessionTemplate) => preferences.avoidedModalities.some(m => m.toLowerCase() === (t.modality ?? '').toLowerCase());
    const isPreferred = (t: SessionTemplate) => preferences.preferredModalities.some(m => m.toLowerCase() === (t.modality ?? '').toLowerCase());

    const extraMargin = preferences.extraRecoveryMargin ?? preferences.conservativeBias ?? false;
    const focusEvent = options.focusEvent;
    const rawHistory = options.recentHistory ?? [];
    const targetDate = options.date ?? getLocalDateString();
    const history = normalizeHistory(rawHistory, targetDate);

    const isStrengthResolved = !unresolvedObjectives.some(o => o.key === 'strength_maintenance');

    const accepted: RankedCandidate[] = [];
    const rejected: RankedCandidate[] = [];
    const all: RankedCandidate[] = [];

    candidates.forEach(template => {
        if (!template) return;
        const excludedReasons: string[] = [];

        // Level 1: Time Feasibility
        const durationMin = template.durationMin ?? 0;
        if (durationMin > availability.maxTimeMinutes) {
            excludedReasons.push('TIME_BUDGET_EXCEEDED');
        }

        // Level 1: Equipment Feasibility
        const requiredEquipment = template.requiredEquipment ?? [];
        for (const req of requiredEquipment) {
            if (!availability.availableEquipment.includes(req)) {
                excludedReasons.push('MISSING_REQUIRED_EQUIPMENT');
                break;
            }
        }

        // Level 1: Injury Safety
        const lowerMod = (template.modality ?? '').toLowerCase();
        if (injuryConstraints.some(inj => inj.toLowerCase() === lowerMod || inj.toLowerCase().includes(lowerMod))) {
            excludedReasons.push('INJURY_RESTRICTION');
        }

        // Level 3: Sequence & Recovery Constraints
        const recoveryReasons = evaluateRecoveryConstraints(template, targetDate, history, options);
        excludedReasons.push(...recoveryReasons);

        let benefit = calculateStimulusBenefit(template, unresolvedObjectives);

        // Level 4 Event Modality Priority: Boost benefit for templates matching an A/B event modality
        if (focusEvent && (focusEvent.priority === 'A' || focusEvent.priority === 'B')) {
            const categoryLower = focusEvent.category.toLowerCase();
            const templateModLower = (template.modality ?? '').toLowerCase();
            const matchesEvent =
                (categoryLower.includes('cycling') && templateModLower.includes('cycling')) ||
                (categoryLower.includes('running') && templateModLower.includes('running')) ||
                (categoryLower.includes('strength') && templateModLower.includes('strength')) ||
                (categoryLower === 'triathlon' && (templateModLower.includes('cycling') || templateModLower.includes('running')));
            const satisfiesUnresolvedObjective = unresolvedObjectives.some(obj =>
                obj.qualification?.allowedModalities ? obj.qualification.allowedModalities.includes(template.modality) : (template.modality === 'Strength' && obj.key === 'strength_maintenance')
            );
            if (matchesEvent) {
                const boost = focusEvent.priority === 'A' ? 1.40 : 1.25;
                benefit *= boost;
            } else if (!isPreferred(template) && !satisfiesUnresolvedObjective) {
                benefit *= 0.20;
            }
        }

        let costPenalty = calculateFatigueCostPenalty(template.costProfile, fatigueState);

        if (extraMargin && template.systemicCost > 0.5) {
            costPenalty += 0.3;
        }

        if (excludedReasons.length > 0) {
            const item: RankedCandidate = {
                template,
                benefitScore: benefit,
                costPenalty,
                utilityScore: 0,
                rationale: `Excluded by hard constraint(s): ${excludedReasons.join(', ')}.`,
                excludedReasons,
            };
            rejected.push(item);
            all.push(item);
            return;
        }

        // Level 6: Preference & Soft Nudges
        let prefMultiplier = 1.0;
        if (isDisliked(template)) {
            prefMultiplier = 0.2;
        } else if (isPreferred(template)) {
            prefMultiplier = 1.3;
        }

        const isStrengthCategory = STRENGTH_CATEGORIES.includes(template.category);
        if (isStrengthResolved && isStrengthCategory) {
            prefMultiplier *= 0.20;
        }

        const lastEntry = history[history.length - 1];
        const lastWasHighIntensity = (lastEntry?.systemicCost ?? 0) >= INTENSITY_STACK_THRESHOLD;
        const candidateIsHighIntensity = template.systemicCost >= INTENSITY_STACK_THRESHOLD;
        if (lastWasHighIntensity && candidateIsHighIntensity) {
            prefMultiplier *= INTENSITY_STACK_PENALTY;
        }

        // Soft penalty for repeating exact same template on consecutive days
        const usedYesterday = history.some(h => getDayDiff(targetDate, h.date) === 1 && (h.templateId === template.id || (h.category && h.category === template.category)));
        if (usedYesterday) {
            prefMultiplier *= 0.2;
        }

        const isAerobicDefault = template.category === 'Easy Endurance' || (template.title ?? '').toLowerCase().includes('zone 2');
        if (unresolvedObjectives.length === 0 && isAerobicDefault) {
            prefMultiplier *= 1.25;
        }

        if (options.anchorRole === 'event-specific' && template.modality === 'Cycling' && template.category === 'Race-Specific Endurance') {
            prefMultiplier *= ANCHOR_ROLE_BOOST;
        } else if (options.anchorRole === 'quality' && template.modality === 'Cycling' && (template.category === 'Moderate Endurance' || template.category === 'Hard Endurance')) {
            prefMultiplier *= ANCHOR_ROLE_BOOST;
        }

        if (options.adjacentToAnchor && HEAVY_LOWER_BODY_STRENGTH_CATEGORIES.includes(template.category) && template.systemicCost >= INTENSITY_STACK_THRESHOLD) {
            prefMultiplier *= ANCHOR_ADJACENCY_SUPPRESSION;
        }

        const utility = (benefit / (1 + costPenalty)) * prefMultiplier;

        let rationale = `Benefit score: ${benefit.toFixed(2)}, Fatigue cost penalty: ${costPenalty.toFixed(2)}.`;
        if (isDisliked(template)) {
            rationale += ` (Soft penalty applied: modality '${template.modality}' is marked as avoided/disliked).`;
        }

        const item: RankedCandidate = {
            template,
            benefitScore: benefit,
            costPenalty,
            utilityScore: utility,
            rationale,
            excludedReasons: [],
        };
        accepted.push(item);
        all.push(item);
    });

    // Lexicographic Sorting
    accepted.sort((a, b) => {
        const benefitDiff = b.benefitScore - a.benefitScore;
        if (Math.abs(benefitDiff) > 0.05) {
            return benefitDiff;
        }
        return b.utilityScore - a.utilityScore;
    });

    // Catalog Variety Rotation on accepted candidates
    if (accepted.length > 1) {
        const topCandidate = accepted[0];
        const nearEquivalents = accepted.filter(c =>
            c.template.category === topCandidate.template.category &&
            (c.template.modality === topCandidate.template.modality ||
             (focusEvent?.category === 'triathlon' && ['Cycling', 'Running'].includes(c.template.modality) && ['Cycling', 'Running'].includes(topCandidate.template.modality))) &&
            Math.abs(topCandidate.utilityScore - c.utilityScore) <= VARIETY_TIE_BREAK_GAP
        );

        if (nearEquivalents.length > 1) {
            const getRecentIndex = (template: SessionTemplate) => {
                for (let i = rawHistory.length - 1; i >= 0; i--) {
                    const entry = rawHistory[i];
                    const typeStr = ('type' in entry && typeof entry.type === 'string' ? entry.type : undefined) ?? entry.modality ?? '';
                    if (template.id && typeStr.includes(template.id)) {
                        return rawHistory.length - i;
                    }
                    if (template.title && typeStr.includes(template.title)) {
                        return rawHistory.length - i;
                    }
                }
                return 999;
            };

            nearEquivalents.sort((x, y) => {
                const recencyX = getRecentIndex(x.template);
                const recencyY = getRecentIndex(y.template);
                if (recencyX !== recencyY) return recencyY - recencyX;
                return y.utilityScore - x.utilityScore;
            });

            const remaining = accepted.slice(nearEquivalents.length);
            accepted.splice(0, accepted.length, ...nearEquivalents, ...remaining);
        }
    }

    return { accepted, rejected, all };
}

export function rankCandidatesByUtility(
    candidates: SessionTemplate[],
    unresolvedObjectives: WeeklyObjective[],
    fatigueState: FatigueState,
    availability: ResolvedAvailability,
    injuryConstraints: string[],
    preferences: UserPreferences,
    options: OptimizationOptions = {}
): RankedCandidate[] {
    return rankCandidates(
        candidates,
        unresolvedObjectives,
        fatigueState,
        availability,
        injuryConstraints,
        preferences,
        options
    ).accepted;
}
