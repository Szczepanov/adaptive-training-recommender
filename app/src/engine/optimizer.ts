import type {
    FatigueState,
    IntensityClass,
    PlannedDose,
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
import { qualifiesForObjective } from './microcycle';

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
    plannedDose?: PlannedDose;
    /** Phase 5.2: per-workout hard-lower-body spacing (planningCandidate.ts's
     *  `PlanningCandidate.minimumDaysAfterHardLowerBody`), keyed by engine template id.
     *  Optional and unset by default -- every existing caller keeps today's flat
     *  2-day-minimum-gap rule (see evaluateRecoveryConstraints) unchanged. */
    resolveMinimumDaysAfterHardLowerBody?: (templateId: string) => number | undefined;
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
const HARD_INTENSITY_MIN = 0.8;
const HARD_SYSTEMIC_COST_THRESHOLD = 0.6;
const MODERATE_SYSTEMIC_COST_THRESHOLD = 0.3;
const ANCHOR_ROLE_BOOST = 1.35;
/** Weekly architecture is a Level-4 timing signal under the Phase-3 lexicographic
 * contract, not merely a Level-6 preference. This additive benefit lets a candidate that
 * actually fulfils the nominated role outrank unrelated unresolved work on that date,
 * while still allowing fatigue/safety/recovery hard gates to reject the anchor. */
const ANCHOR_TIMING_BENEFIT = 1.0;
/** A triathlon focus event has two currently supported sport modalities. Treat an absent
 * supported modality in the rolling planning window as the same Level-4 timing class as
 * an anchor: it is event architecture, not a user-preference multiplier. Reusing the
 * established timing weight avoids inventing a second calibration constant. */
const MULTISPORT_MODALITY_COVERAGE_BENEFIT = ANCHOR_TIMING_BENEFIT;
const ANCHOR_ADJACENCY_SUPPRESSION = 0.3;
const HEAVY_LOWER_BODY_STRENGTH_CATEGORIES: SessionTemplate['category'][] = ['Lower-body Strength', 'Full-body Strength'];
const VARIETY_TIE_BREAK_GAP = 0.05;
/** Lexicographic tie band for Level 4 (objective benefit) sorting -- deliberately a
 *  separate constant from VARIETY_TIE_BREAK_GAP even though both are currently 0.05:
 *  one governs whether two candidates count as "same objective benefit" for sort
 *  ordering, the other whether they're "close enough to rotate for variety". Sharing a
 *  literal between them made either one easy to change by accident. */
const BENEFIT_TIE_BAND = 0.05;
/** Single source of truth for "this session counts as a protected anchor/quality
 *  session" -- used for history role classification (normalizeHistory), the recovery
 *  constraints themselves (evaluateRecoveryConstraints), and planner.ts's own history
 *  tagging. Deliberately excludes 'Moderate Endurance': a moderate day is a real but
 *  lesser stimulus than these, and evaluateRecoveryConstraints' own isCandidateAnchor/
 *  priorAnchor checks already only treat these three as anchor-grade. */
export const ANCHOR_HISTORY_CATEGORIES: SessionTemplate['category'][] = [
    'Hard Endurance', 'Race-Specific Endurance', 'Full-body Strength',
];

/** A weekly anchor nomination describes what the day is trying to host; it is not a
 * property of every candidate evaluated on that date. A candidate only inherits the
 * nominated anchor role when its realized modality/category actually fulfils that role. */
export function candidateMatchesAnchorRole(
    template: SessionTemplate,
    anchorRole: OptimizationOptions['anchorRole']
): boolean {
    if (anchorRole === 'event-specific') {
        return template.modality === 'Cycling' && template.category === 'Race-Specific Endurance';
    }
    if (anchorRole === 'quality') {
        return template.modality === 'Cycling'
            && (template.category === 'Hard Endurance' || template.category === 'Moderate Endurance');
    }
    return false;
}

export function intensityClassForTemplate(template: SessionTemplate): IntensityClass {
    if (template.category === 'Rest' || template.category === 'Mobility/Recovery') return 'recovery';
    if (template.category === 'Hard Endurance' || template.category === 'Race-Specific Endurance' || template.systemicCost >= HARD_SYSTEMIC_COST_THRESHOLD) return 'hard';
    if (template.category === 'Moderate Endurance' || template.systemicCost >= MODERATE_SYSTEMIC_COST_THRESHOLD) return 'moderate';
    return 'easy';
}

export function isIntensityClassAdmissible(intensityClass: IntensityClass, plannedIntensity: number): boolean {
    return intensityClass !== 'hard' || plannedIntensity >= HARD_INTENSITY_MIN;
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
        } else if (('category' in entry && entry.category && ANCHOR_HISTORY_CATEGORIES.includes(entry.category)) || systemicCost >= 0.7) {
            role = 'anchor';
        }

        const intensityClass = ('intensityClass' in entry && entry.intensityClass)
            ? entry.intensityClass
            : systemicCost >= HARD_SYSTEMIC_COST_THRESHOLD ? 'hard' : systemicCost >= MODERATE_SYSTEMIC_COST_THRESHOLD ? 'moderate' : 'easy';

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

function needsMultisportModalityCoverage(
    template: SessionTemplate,
    focusEvent: UserEvent | null | undefined,
    history: SessionHistoryEntry[],
    targetDate: string,
): boolean {
    if (focusEvent?.category !== 'triathlon') return false;
    if (template.modality !== 'Cycling' && template.modality !== 'Running') return false;

    const seenInRollingWindow = history.some(entry => {
        const diff = getDayDiff(targetDate, entry.date);
        return diff >= 1 && diff <= 6 && entry.modality === template.modality;
    });
    return !seenInRollingWindow;
}

export function evaluateRecoveryConstraints(
    template: SessionTemplate,
    targetDate: string,
    history: SessionHistoryEntry[],
    options: OptimizationOptions
): string[] {
    const reasons: string[] = [];

    const isCandidateAnchor = options.anchorRole
        ? candidateMatchesAnchorRole(template, options.anchorRole)
        : ANCHOR_HISTORY_CATEGORIES.includes(template.category);

    if (isCandidateAnchor) {
        const priorAnchor = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff > 0 && diff < 2 && (
                h.role === 'anchor' ||
                (h.category && ANCHOR_HISTORY_CATEGORIES.includes(h.category))
            );
        });
        if (priorAnchor) reasons.push('QUALITY_SPACING_VIOLATION');
    }

    const candidateLowerBodyCost = template.costProfile?.lowerBody ?? (STRENGTH_CATEGORIES.includes(template.category) ? 0.6 : 0);
    if (candidateLowerBodyCost >= 0.6) {
        // Phase 5.2: a detailed workout's own eligibility.minimumDaysAfterHardLowerBody
        // (planningCandidate.ts) can require a longer gap than the flat 2-day default
        // below -- the default reproduces the exact prior behavior (diff === 1 was the
        // only violation) for every template with no such workout-level override.
        const minGapDays = options.resolveMinimumDaysAfterHardLowerBody?.(template.id) ?? 2;
        const priorHardLower = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff >= 1 && diff < minGapDays && h.lowerBodyCost >= 0.6;
        });
        if (priorHardLower) reasons.push('HARD_LOWER_BODY_SPACING_VIOLATION');
    }

    if (template.systemicCost >= 0.5) {
        const hardInRollingWindow = history.filter(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff >= 1 && diff <= 6 && h.systemicCost >= 0.5;
        }).length;
        if (hardInRollingWindow >= 3) reasons.push('ROLLING_HARD_CAP_EXCEEDED');
    }

    const isHeavyLowerBodyStrength = HEAVY_LOWER_BODY_STRENGTH_CATEGORIES.includes(template.category) ||
        (template.modality === 'Strength' && (template.costProfile?.lowerBody ?? 0) >= 0.6);
    const isKeyCyclingSession = candidateMatchesAnchorRole(template, options.anchorRole)
        || (template.modality === 'Cycling'
            && (template.category === 'Race-Specific Endurance' || template.category === 'Hard Endurance'));

    if (isHeavyLowerBodyStrength) {
        const priorKeyCycling = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff >= 0 && diff <= 1 && h.modality === 'Cycling' && (
                h.role === 'anchor' || (h.category && ['Race-Specific Endurance', 'Hard Endurance'].includes(h.category))
            );
        });
        if (priorKeyCycling) reasons.push('ANCHOR_PROTECTION_VIOLATION');
    } else if (isKeyCyclingSession) {
        const priorHeavyStrength = history.find(h => {
            const diff = getDayDiff(targetDate, h.date);
            return diff >= 0 && diff <= 1 && (
                (h.category && HEAVY_LOWER_BODY_STRENGTH_CATEGORIES.includes(h.category)) ||
                (h.modality === 'Strength' && h.lowerBodyCost >= 0.6)
            );
        });
        if (priorHeavyStrength) reasons.push('ANCHOR_PROTECTION_VIOLATION');
    }

    return reasons;
}

export function calculateStimulusBenefit(
    template: SessionTemplate,
    unresolvedObjectives: WeeklyObjective[]
): number {
    if (template.category === 'Rest') return 0.1;

    const stimulusProfile = template.stimulusProfile;
    if (!stimulusProfile || unresolvedObjectives.length === 0) {
        if (template.category === 'Mobility/Recovery') return 0.2;
        if (template.category === 'Technical Skill') return 0.3;
        const totalStim = stimulusProfile ? stimulusProfile.aerobicEndurance + stimulusProfile.thresholdPower : 0;
        return Math.min(0.75, 0.45 + totalStim * 0.2);
    }

    let benefit = 0;
    unresolvedObjectives.forEach(obj => {
        // Mirrors microcycle.ts's qualifiesForObjective/deriveObjectiveCreditFromProfile gate:
        // a candidate that cannot actually resolve an objective (wrong category/modality, or
        // below its minimumStimulus floor) must not rank as if it could.
        if (!qualifiesForObjective(stimulusProfile, template.modality, obj.qualification, template.category)) return;

        const target = obj.targetStimulus;
        const threshTarget = target.thresholdPower ?? 0;
        const threshStim = stimulusProfile.thresholdPower;
        if (threshTarget && threshStim) benefit += threshTarget * threshStim * 1.5;

        const surgeTarget = target.repeatedSurges ?? 0;
        const surgeStim = stimulusProfile.repeatedSurges;
        if (surgeTarget && surgeStim) benefit += surgeTarget * surgeStim * 1.5;

        const vo2Target = target.vo2MaxPower ?? 0;
        const vo2Stim = stimulusProfile.vo2MaxPower;
        if (vo2Target && vo2Stim) benefit += vo2Target * vo2Stim * 1.5;

        const aeroTarget = target.aerobicEndurance ?? 0;
        const aeroStim = stimulusProfile.aerobicEndurance;
        if (aeroTarget && aeroStim) benefit += aeroTarget * aeroStim * 1.2;

        const strengthTarget = Math.max(target.maxStrength ?? 0, target.hypertrophy ?? 0);
        const strengthStim = Math.max(stimulusProfile.maxStrength, stimulusProfile.hypertrophy);
        if (strengthTarget && strengthStim) benefit += strengthTarget * strengthStim * 1.6;

        const fatigueTarget = target.fatigueResistance ?? 0;
        const fatigueStim = stimulusProfile.fatigueResistance;
        if (fatigueTarget && fatigueStim) benefit += fatigueTarget * fatigueStim * 1.2;
    });

    const nonObjectiveBaseline = template.category === 'Mobility/Recovery' ? 0.2 : 0.5;
    return benefit === 0 ? nonObjectiveBaseline : benefit + nonObjectiveBaseline;
}

export function calculateFatigueCostPenalty(
    costProfile: WorkoutCostProfile | undefined,
    fatigueState: FatigueState
): number {
    if (!costProfile) return 0;
    const combined = fatigueState.combinedFatigue;
    return costProfile.systemic * combined.systemic * 2.0
        + costProfile.cardiovascular * combined.cardiovascular * 1.5
        + costProfile.lowerBody * combined.lowerBody * 2.5
        + costProfile.upperBody * combined.upperBody * 1.5
        + costProfile.impactTissue * combined.impactTissue * 2.0
        + costProfile.neuromuscular * combined.neuromuscular * 1.8;
}

export function buildOptimizationContext(
    intent: {
        unresolvedObjectives: WeeklyObjective[];
        fatigue: FatigueState;
        periodization?: { focusEvent?: UserEvent | null } | null;
        history?: (RecentHistoryEntry | SessionHistoryEntry)[];
        plannedDose?: PlannedDose;
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
    const effectivePreferences: UserPreferences = { ...basePrefs, userId };

    const availability = resolveAvailability(date, null, [], context);
    const injuryConstraints = context.constraints?.restrictedModalities ?? [];

    const rawHistory: (RecentHistoryEntry | SessionHistoryEntry)[] = options.recentHistory ?? (intent.history ?? []).map(e => {
        const completedDate = 'completedDate' in e && typeof e.completedDate === 'string' ? e.completedDate : undefined;
        const rec = e as Record<string, unknown>;
        const recType = rec.trainingRecordLike && typeof rec.trainingRecordLike === 'object' && 'type' in (rec.trainingRecordLike as object)
            ? (rec.trainingRecordLike as { type?: string }).type : undefined;
        const costProf = rec.costProfile && typeof rec.costProfile === 'object' ? rec.costProfile as Record<string, number> : undefined;
        const systemic = costProf?.systemic;
        const lowerBody = costProf?.lowerBody;
        const entryType = 'type' in e && typeof e.type === 'string' ? e.type : undefined;

        return {
            date: completedDate ?? e.date,
            templateId: e.templateId,
            category: e.category,
            modality: e.modality ?? recType ?? entryType,
            role: e.role,
            systemicCost: e.systemicCost ?? systemic ?? 0,
            lowerBodyCost: ('lowerBodyCost' in e && typeof e.lowerBodyCost === 'number') ? e.lowerBodyCost : (lowerBody ?? 0),
            type: entryType ?? recType,
        };
    });

    return {
        unresolvedObjectives: intent.unresolvedObjectives ?? [],
        fatigueState: intent.fatigue,
        availability,
        injuryConstraints,
        preferences: effectivePreferences,
        options: {
            date,
            focusEvent: options.focusEvent ?? intent.periodization?.focusEvent ?? null,
            recentHistory: rawHistory,
            anchorRole: options.anchorRole ?? null,
            adjacentToAnchor: options.adjacentToAnchor ?? false,
            ...(intent.plannedDose ? { plannedDose: intent.plannedDose } : {}),
            ...(options.resolveMinimumDaysAfterHardLowerBody ? { resolveMinimumDaysAfterHardLowerBody: options.resolveMinimumDaysAfterHardLowerBody } : {}),
        },
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

        if ((template.durationMin ?? 0) > availability.maxTimeMinutes) excludedReasons.push('TIME_BUDGET_EXCEEDED');
        for (const req of template.requiredEquipment ?? []) {
            if (!availability.availableEquipment.includes(req)) {
                excludedReasons.push('MISSING_REQUIRED_EQUIPMENT');
                break;
            }
        }

        const lowerMod = (template.modality ?? '').toLowerCase();
        if (injuryConstraints.some(inj => inj.toLowerCase() === lowerMod || inj.toLowerCase().includes(lowerMod))) {
            excludedReasons.push('INJURY_RESTRICTION');
        }

        if (options.plannedDose && !isIntensityClassAdmissible(intensityClassForTemplate(template), options.plannedDose.intensity)) {
            excludedReasons.push('INTENSITY_SCALE_INADMISSIBLE');
        }

        excludedReasons.push(...evaluateRecoveryConstraints(template, targetDate, history, options));

        let benefit = calculateStimulusBenefit(template, unresolvedObjectives);
        const fulfilsNominatedAnchor = candidateMatchesAnchorRole(template, options.anchorRole);

        if (focusEvent && (focusEvent.priority === 'A' || focusEvent.priority === 'B')) {
            const categoryLower = focusEvent.category.toLowerCase();
            const templateModLower = (template.modality ?? '').toLowerCase();
            const matchesEvent =
                (categoryLower.includes('cycling') && templateModLower.includes('cycling')) ||
                (categoryLower.includes('running') && templateModLower.includes('running')) ||
                (categoryLower.includes('strength') && templateModLower.includes('strength')) ||
                (categoryLower === 'triathlon' && (templateModLower.includes('cycling') || templateModLower.includes('running')));
            const satisfiesUnresolvedObjective = unresolvedObjectives.some(obj =>
                obj.qualification?.allowedModalities
                    ? obj.qualification.allowedModalities.includes(template.modality)
                    : (template.modality === 'Strength' && obj.key === 'strength_maintenance')
            );
            const eventPriorityApplies = !categoryLower.includes('strength') || satisfiesUnresolvedObjective || fulfilsNominatedAnchor;
            if (matchesEvent && eventPriorityApplies) {
                benefit *= focusEvent.priority === 'A' ? 1.40 : 1.25;
            } else if (!matchesEvent && !isPreferred(template) && !satisfiesUnresolvedObjective && unresolvedObjectives.length > 0) {
                benefit *= 0.20;
            }
        }

        if (needsMultisportModalityCoverage(template, focusEvent, history, targetDate)) {
            benefit += MULTISPORT_MODALITY_COVERAGE_BENEFIT;
        }

        if (fulfilsNominatedAnchor) benefit += ANCHOR_TIMING_BENEFIT;

        let costPenalty = calculateFatigueCostPenalty(template.costProfile, fatigueState);
        if (extraMargin && template.systemicCost > 0.5) costPenalty += 0.3;

        if (excludedReasons.length > 0) {
            const item: RankedCandidate = {
                template, benefitScore: benefit, costPenalty, utilityScore: 0,
                rationale: `Excluded by hard constraint(s): ${excludedReasons.join(', ')}.`, excludedReasons,
            };
            rejected.push(item);
            all.push(item);
            return;
        }

        let prefMultiplier = 1.0;
        if (isDisliked(template)) prefMultiplier = 0.2;
        else if (isPreferred(template)) prefMultiplier = 1.3;

        const isStrengthCategory = STRENGTH_CATEGORIES.includes(template.category);
        if (isStrengthResolved && isStrengthCategory) prefMultiplier *= 0.20;

        const lastEntry = history
            .filter(h => getDayDiff(targetDate, h.date) >= 1)
            .sort((a, b) => getDayDiff(targetDate, a.date) - getDayDiff(targetDate, b.date))[0];
        const lastWasHighIntensity = (lastEntry?.systemicCost ?? 0) >= INTENSITY_STACK_THRESHOLD;
        const candidateIsHighIntensity = template.systemicCost >= INTENSITY_STACK_THRESHOLD;
        if (lastWasHighIntensity && candidateIsHighIntensity) prefMultiplier *= INTENSITY_STACK_PENALTY;

        const usedYesterday = history.some(h => getDayDiff(targetDate, h.date) === 1 && h.templateId === template.id);
        if (usedYesterday) prefMultiplier *= 0.2;

        const isAerobicDefault = template.category === 'Easy Endurance' || (template.title ?? '').toLowerCase().includes('zone 2');
        if (unresolvedObjectives.length === 0 && isAerobicDefault) prefMultiplier *= 1.25;

        if (fulfilsNominatedAnchor) prefMultiplier *= ANCHOR_ROLE_BOOST;
        if (options.adjacentToAnchor && HEAVY_LOWER_BODY_STRENGTH_CATEGORIES.includes(template.category) && template.systemicCost >= INTENSITY_STACK_THRESHOLD) {
            prefMultiplier *= ANCHOR_ADJACENCY_SUPPRESSION;
        }

        const utility = (benefit / (1 + costPenalty)) * prefMultiplier;
        let rationale = `Benefit score: ${benefit.toFixed(2)}, Fatigue cost penalty: ${costPenalty.toFixed(2)}.`;
        if (isDisliked(template)) rationale += ` (Soft penalty applied: modality '${template.modality}' is marked as avoided/disliked).`;
        if (needsMultisportModalityCoverage(template, focusEvent, history, targetDate)) {
            rationale += ` (Event-modality coverage: ${template.modality} has no exposure in the rolling 6-day history.)`;
        }

        const item: RankedCandidate = { template, benefitScore: benefit, costPenalty, utilityScore: utility, rationale, excludedReasons: [] };
        accepted.push(item);
        all.push(item);
    });

    const byBenefitDesc = [...accepted].sort((a, b) => b.benefitScore - a.benefitScore);
    const benefitTierByCandidate = new Map<RankedCandidate, number>();
    byBenefitDesc.forEach((c, idx) => {
        const prevTier = idx === 0 ? 0 : benefitTierByCandidate.get(byBenefitDesc[idx - 1])!;
        const startsNewTier = idx > 0 && (byBenefitDesc[idx - 1].benefitScore - c.benefitScore) > BENEFIT_TIE_BAND;
        benefitTierByCandidate.set(c, startsNewTier ? prevTier + 1 : prevTier);
    });
    const getBenefitTier = (candidate: RankedCandidate) => benefitTierByCandidate.get(candidate)!;

    accepted.sort((a, b) => {
        const tierDiff = getBenefitTier(a) - getBenefitTier(b);
        if (tierDiff !== 0) return tierDiff;
        return b.utilityScore - a.utilityScore;
    });

    if (accepted.length > 1) {
        const topCandidate = accepted[0];
        const topBenefitTier = getBenefitTier(topCandidate);
        const nearEquivalents = accepted.filter(c =>
            getBenefitTier(c) === topBenefitTier &&
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
                    if (template.id && typeStr.includes(template.id)) return rawHistory.length - i;
                    if (template.title && typeStr.includes(template.title)) return rawHistory.length - i;
                }
                return 999;
            };

            nearEquivalents.sort((x, y) => {
                const recencyX = getRecentIndex(x.template);
                const recencyY = getRecentIndex(y.template);
                if (recencyX !== recencyY) return recencyY - recencyX;
                return y.utilityScore - x.utilityScore;
            });

            const nearEquivalentSet = new Set(nearEquivalents);
            const remaining = accepted.filter(c => !nearEquivalentSet.has(c));
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
    return rankCandidates(candidates, unresolvedObjectives, fatigueState, availability, injuryConstraints, preferences, options).accepted;
}
