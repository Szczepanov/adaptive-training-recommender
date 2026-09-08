import type {
    DailyReadiness,
    AuthoredPlanBlock,
    DimensionalFatigue,
    DoseVariation,
    FatigueState,
    FixedActivity,
    MicrocycleState,
    Recommendation,
    ScheduleOverlay,
    SessionAdjustment,
    SessionHistoryEntry,
    SessionRole,
    SessionTemplate,
    UserContext,
    UserEvent,
    UserPreferences,
    TrainingIntentProfile,
    WeeklyObjective,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';

export interface PlannedObjectiveCredit {
    date: string;
    objectiveKey: string;
    objectiveTitle: string;
    templateId: string;
    templateTitle: string;
    modality: SessionTemplate['modality'];
    earnedCredit: number;
}
import { resolveAvailability, scheduleOverlayCostProfileForDate } from './schedule';
import { isTemplatePhaseEligible, evaluatePeriodizationPhase, resolveMultiEventObjectives, type DroppedContributorObjective, type PeriodizationResult } from './periodization';
import { eligibleTemplates } from './eligibility';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import {
    createEmptyFatigue,
    applyCompletedSessionLoad,
    buildFatigueStateFromHistory,
    combineFatigue,
    computeInternalResponseStrain,
    decayFatigue,
} from './fatigue';
import type { FatigueFusionPolicy } from './fatigue';
import {
    buildMicrocycleState,
    creditObjectivesFromStimulus,
    generateWeeklyObjectives,
    getUnresolvedObjectives,
    projectCompatibilityExposures,
} from './microcycle';
import {
    type OptimizationContext,
    type RankCandidatesResult,
    type RecentHistoryEntry,
    ANCHOR_HISTORY_CATEGORIES,
    buildOptimizationContext,
    candidateMatchesAnchorRole,
    materializeEffectiveDose,
    rankCandidates,
    resolveRecoveryStyle,
    resolveTimeCapDoseAdjustment,
} from './optimizer';
import { ENRICHED_TEMPLATES, ENRICHED_TEMPLATES_BY_ID } from './templates';
import { resolveMinimumDaysAfterHardLowerBody, resolveRecoveryHoursForTemplate } from './planningCandidate';
import { resolvePlannedDoseForDate, resolveTrainingIntent } from './trainingIntent';
import { resolvePlanDefinitionForEvent, type PlanDefinition } from './planSchedule';
import { deriveObjectiveCreditFromProfile, type StimulusConfidence } from './stimulus';
import { buildCoverageState, coverageNeedTierForTemplate, resolveCoverageHistory, workoutIdForTemplateId, type CoverageHistoryEntry } from './coverage';
import { resolveEvergreenPlan } from './evergreenPlanning';
import { isSevereAdverseRecoveryReadiness } from './evergreenStrategy';
import { applyPlanningOverlays } from './planningOverlays';
import {
    allocationSurvives,
    attachExactEligibleIdentities,
    deriveRequiredRoleOccurrences,
    occurrenceForTemplate,
    resolveWeeklyRoleReservations,
    WEEKLY_ALLOCATION_SEARCH_BUDGET,
    type AllocationAssignment,
    type AllocationDateEvaluator,
    type ProjectedDateOutcome,
    type WeeklyRoleAllocationOutcome,
    type WeeklyRoleAllocationReport,
    type WeeklyRoleMissReason,
} from './weeklyAllocation';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { resolveFixedActivityIdentity } from './fixedActivityIdentity';
import { sumFixedActivityCostProfiles } from './fixedActivityCostProfile';

export interface WeekAheadDay {
    date: string;
    dayOffset: number;
    confidence: 'provisional' | 'projected';
    phaseName: string;
    /** Authored catalog identity remains stable for coverage and display. When `activeDose`
     * is present, the projection ledger materializes that dose before charging fatigue,
     * objective stimulus, duration, and projected-history cost. */
    template: SessionTemplate;
    mode: 'train' | 'recover';
    rationale: string;
    addressesObjectives: string[];
    activeDose?: DoseVariation;
    adjustment?: SessionAdjustment;
    diagnostics?: {
        peakFatigue: number;
        fatigueTier: 'train' | 'modify' | 'recover';
        topUtilityScore: number;
        runnerUpUtilityScore: number | null;
        selectedBenefitScore: number;
        selectedCostPenalty: number;
        bestBenefitTemplateId: string;
        bestBenefitScore: number;
        fatigue?: FatigueState;
        activeObjectives?: Array<{
            key: WeeklyObjective['key'];
            completedCredit: number;
            projectedCredit: number;
            requiredCredit: number;
        }>;
        contributorObjectiveChanges?: {
            added: WeeklyObjective['key'][];
            dropped: WeeklyObjective['key'][];
        };
        fixedActivity?: {
            count: number;
            cost: WorkoutCostProfile;
            stimulus: WorkoutStimulusProfile;
        };
        rejectionCounts?: Record<string, number>;
    };
}

export interface WeekAheadPlan {
    startDate: string;
    days: WeekAheadDay[];
    objectiveCredits: PlannedObjectiveCredit[];
    microcycleObjectives: WeeklyObjective[];
    droppedContributorObjectives: DroppedContributorObjective[];
    /** ADR-0018 forecast-only evidence. This is not completed training or audit data. */
    allocationReport: WeeklyRoleAllocationReport;
}

export interface WeekAheadPlanSeed {
    microcycle: MicrocycleState;
    fatigue: FatigueState;
    trailingHistory?: (RecentHistoryEntry | SessionHistoryEntry)[];
    /** Canonical completed-role history. Operational/projected history stays separate so
     * future recommendations never reclassify completed occurrences through legacy lookup. */
    completedCoverageHistory?: CoverageHistoryEntry[];
    droppedContributorObjectives?: DroppedContributorObjective[];
}

export interface WeekAheadOptions {
    days?: number;
    events?: UserEvent[];
    fixedActivities?: FixedActivity[];
    authoredPlanBlocks?: readonly AuthoredPlanBlock[];
    scheduleOverlays?: readonly ScheduleOverlay[];
    planDefinition?: PlanDefinition | null;
    /** Simulation-only fatigue comparison. Live callers use the default `max`. */
    fatigueFusionPolicy?: FatigueFusionPolicy;
}

const ZERO_COST: WorkoutCostProfile = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};

const ZERO_STIMULUS: WorkoutStimulusProfile = {
    aerobicEndurance: 0,
    thresholdPower: 0,
    vo2MaxPower: 0,
    repeatedSurges: 0,
    sprintPower: 0,
    fatigueResistance: 0,
    maxStrength: 0,
    hypertrophy: 0,
};

/**
 * Pre-indexes dated fixed activities into a date map to enable O(1) day lookups during rolling plan projection.
 */
export function groupFixedActivitiesByDate(fixedActivities: readonly FixedActivity[]): Map<string, FixedActivity[]> {
    const map = new Map<string, FixedActivity[]>();
    for (const activity of fixedActivities) {
        let list = map.get(activity.date);
        if (!list) {
            list = [];
            map.set(activity.date, list);
        }
        list.push(activity);
    }
    return map;
}

function fixedActivityTraceForDate(fixedActivities: readonly FixedActivity[], date: string): {
    count: number;
    cost: WorkoutCostProfile;
    stimulus: WorkoutStimulusProfile;
} {
    const activities = fixedActivities.filter(activity => (activity.date === date || !activity.date) && !activity.isCompleted);
    const cost = fixedActivityCostProfileForDate(activities, date);
    const stimulus = activities.reduce<WorkoutStimulusProfile>((sum, activity) => {
        const expected = activity.expectedStimulus ?? {};
        return {
            aerobicEndurance: sum.aerobicEndurance + (expected.aerobicEndurance ?? 0),
            thresholdPower: sum.thresholdPower + (expected.thresholdPower ?? 0),
            vo2MaxPower: sum.vo2MaxPower + (expected.vo2MaxPower ?? 0),
            repeatedSurges: sum.repeatedSurges + (expected.repeatedSurges ?? 0),
            sprintPower: sum.sprintPower + (expected.sprintPower ?? 0),
            fatigueResistance: sum.fatigueResistance + (expected.fatigueResistance ?? 0),
            maxStrength: sum.maxStrength + (expected.maxStrength ?? 0),
            hypertrophy: sum.hypertrophy + (expected.hypertrophy ?? 0),
        };
    }, ZERO_STIMULUS);
    return { count: activities.length, cost, stimulus };
}

export function projectFatigueForRankingDate(
    externalFatigue: FatigueState,
    internalStrain: DimensionalFatigue,
    internalStrainAsOf: string,
    date: string,
    fatigueFusionPolicy: FatigueFusionPolicy = 'max',
): FatigueState {
    const externalHours = Math.max(0, getDayDiff(date, externalFatigue.lastUpdatedDate) * 24);
    const internalHours = Math.max(0, getDayDiff(date, internalStrainAsOf) * 24);
    const decayedRawExternal = externalFatigue.rawExternalLoadFatigue
        ? decayFatigue(externalFatigue.rawExternalLoadFatigue, externalHours)
        : decayFatigue(externalFatigue.externalLoadFatigue, externalHours);
    const decayedExternal: DimensionalFatigue = {
        systemic: Math.min(1, decayedRawExternal.systemic),
        cardiovascular: Math.min(1, decayedRawExternal.cardiovascular),
        lowerBody: Math.min(1, decayedRawExternal.lowerBody),
        upperBody: Math.min(1, decayedRawExternal.upperBody),
        impactTissue: Math.min(1, decayedRawExternal.impactTissue),
        neuromuscular: Math.min(1, decayedRawExternal.neuromuscular),
    };
    const decayedInternal = decayFatigue(internalStrain, internalHours);
    return {
        lastUpdatedDate: date,
        externalLoadFatigue: decayedExternal,
        rawExternalLoadFatigue: decayedRawExternal,
        internalResponseStrain: decayedInternal,
        combinedFatigue: combineFatigue(decayedExternal, decayedInternal, fatigueFusionPolicy),
    };
}

export const PROJECTED_FATIGUE_RECOVER_THRESHOLD = 0.65;
export const PROJECTED_FATIGUE_MODIFY_THRESHOLD = 0.6;
export const PROJECTED_MODIFY_MAX_SYSTEMIC_COST = 0.5;

export interface ProjectedFatigueThresholds {
    recover: number;
    modify: number;
    modifyMaxSystemicCost: number;
}

export function projectedFatigueThresholds(conservativeBias = false): ProjectedFatigueThresholds {
    return conservativeBias
        ? { recover: PROJECTED_FATIGUE_RECOVER_THRESHOLD * 0.88, modify: PROJECTED_FATIGUE_MODIFY_THRESHOLD * 0.88, modifyMaxSystemicCost: PROJECTED_MODIFY_MAX_SYSTEMIC_COST * 0.85 }
        : { recover: PROJECTED_FATIGUE_RECOVER_THRESHOLD, modify: PROJECTED_FATIGUE_MODIFY_THRESHOLD, modifyMaxSystemicCost: PROJECTED_MODIFY_MAX_SYSTEMIC_COST };
}

export function maxFatigueDimension(fatigue: DimensionalFatigue): number {
    return Math.max(
        fatigue.systemic, fatigue.cardiovascular, fatigue.lowerBody,
        fatigue.upperBody, fatigue.impactTissue, fatigue.neuromuscular
    );
}

export function fatigueTierFor(peakFatigue: number, thresholds: ProjectedFatigueThresholds = projectedFatigueThresholds()): 'train' | 'modify' | 'recover' {
    if (peakFatigue >= thresholds.recover) return 'recover';
    if (peakFatigue >= thresholds.modify) return 'modify';
    return 'train';
}

export const NEUTRAL_PREFERENCES: UserPreferences = {
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

export function displayModeFromCategory(category: SessionTemplate['category']): 'train' | 'recover' {
    return category === 'Rest' || category === 'Mobility/Recovery' ? 'recover' : 'train';
}

export function enrichedCostProfile(templateId: string): WorkoutCostProfile {
    return ENRICHED_TEMPLATES_BY_ID.get(templateId)?.costProfile ?? ZERO_COST;
}

export function enrichedStimulusProfile(template: SessionTemplate): WorkoutStimulusProfile {
    return template.stimulusProfile ?? ENRICHED_TEMPLATES_BY_ID.get(template.id)?.stimulusProfile ?? ZERO_STIMULUS;
}

/** Materialize an authored template into the exact dose the projection ledger should
 * charge. Enrichment happens before dose scaling so catalog fallback cost/stimulus are
 * scaled even if the caller passed a sparse template object. */
export function effectiveTemplateForProjection(
    template: SessionTemplate,
    activeDose?: DoseVariation,
): SessionTemplate {
    const enriched: SessionTemplate = {
        ...template,
        costProfile: template.costProfile ?? enrichedCostProfile(template.id),
        stimulusProfile: enrichedStimulusProfile(template),
    };
    return materializeEffectiveDose(enriched, activeDose);
}

/** An allocator assignment replayed by the projection ledger. `activeDose` is present only
 * when the caller already knows the dose the candidate would actually be prescribed (the
 * greedy loop's viability probe); hypothetical allocator reservations leave it undefined
 * because their final dose is not resolved yet. */
type ProjectedAssignment = AllocationAssignment & { activeDose?: DoseVariation };

export interface ProjectedObjectiveCreditInput {
    objectiveId: string;
    earnedCredit: number;
}

export interface ProjectedObjectiveCreditAllocation {
    objectiveId: string;
    earnedCredit: number;
}

export function applyProjectedObjectiveCredits(
    microcycle: MicrocycleState,
    credits: readonly ProjectedObjectiveCreditInput[],
): { microcycle: MicrocycleState; allocations: ProjectedObjectiveCreditAllocation[] } {
    const proposedById = new Map(credits.map(credit => [credit.objectiveId, credit.earnedCredit]));
    const allocations: ProjectedObjectiveCreditAllocation[] = [];
    const objectives = microcycle.objectives.map(objective => {
        const proposed = proposedById.get(objective.id) ?? 0;
        if (!Number.isFinite(proposed) || proposed <= 0) return objective;

        const completedCredit = objective.completedCredit ?? objective.completedExposures;
        const projectedCredit = objective.projectedCredit ?? 0;
        const requiredCredit = objective.requiredCredit ?? objective.targetExposures;
        const remaining = Math.max(0, requiredCredit - completedCredit - projectedCredit);
        const allocated = Math.min(remaining, proposed);
        if (allocated <= 0) return objective;

        allocations.push({ objectiveId: objective.id, earnedCredit: allocated });
        const nextProjectedCredit = projectedCredit + allocated;
        return {
            ...objective,
            completedCredit,
            projectedCredit: nextProjectedCredit,
            completedExposures: projectCompatibilityExposures(
                completedCredit + nextProjectedCredit,
                objective.targetExposures,
            ),
        };
    });

    return {
        microcycle: { ...microcycle, objectives },
        allocations,
    };
}

export function isAdjacentDate(date: string, anchorDate: string | null): boolean {
    if (!anchorDate) return false;
    return addDaysToLocalDateString(date, 1) === anchorDate || addDaysToLocalDateString(date, -1) === anchorDate;
}

export interface WeeklyAnchors {
    eventSpecificAnchorDate: string | null;
    qualityAnchorDate: string | null;
}

const QUALITY_ANCHOR_MIN_GAP_DAYS = 2;

export function realizedSessionRole(
    date: string,
    template: SessionTemplate,
    anchors: WeeklyAnchors,
): SessionRole {
    const nominatedRole = date === anchors.eventSpecificAnchorDate
        ? 'event-specific'
        : date === anchors.qualityAnchorDate ? 'quality' : null;
    if (candidateMatchesAnchorRole(template, nominatedRole)) return 'anchor';
    return ANCHOR_HISTORY_CATEGORIES.includes(template.category) ? 'anchor' : 'supporting';
}

function templateFitsResolvedAvailability(
    template: SessionTemplate,
    availability: ReturnType<typeof resolveAvailability>,
): boolean {
    return template.requiredEquipment.every(item => availability.availableEquipment.includes(item))
        && (!availability.environmentOverride
            || template.environment === 'either'
            || template.environment === availability.environmentOverride);
}

export function resolveWeeklyAnchors(
    todayDate: string,
    totalDays: number,
    events: UserEvent[],
    fixedActivities: FixedActivity[],
    context: UserContext,
    tomorrowCategory?: SessionTemplate['category'],
    tomorrowModality?: SessionTemplate['modality'],
    scheduleOverlays: readonly ScheduleOverlay[] = [],
): WeeklyAnchors {
    const raceSpecificTemplates = ENRICHED_TEMPLATES.filter(t => t.category === 'Race-Specific Endurance' && !t.phaseEligibility?.requiresTaper);
    const qualityTemplates = ENRICHED_TEMPLATES.filter(t => t.modality === 'Cycling' && (t.category === 'Moderate Endurance' || t.category === 'Hard Endurance'));

    const tomorrowDate = addDaysToLocalDateString(todayDate, 1);
    let eventSpecificAnchorDate: string | null = null;
    let qualityAnchorDate: string | null = null;

    if (tomorrowModality === 'Cycling' && tomorrowCategory === 'Race-Specific Endurance') {
        eventSpecificAnchorDate = tomorrowDate;
    } else if (tomorrowModality === 'Cycling' && (tomorrowCategory === 'Hard Endurance' || tomorrowCategory === 'Moderate Endurance')) {
        qualityAnchorDate = tomorrowDate;
    }

    interface AnchorDayInfo {
        date: string;
        offset: number;
        availability: ReturnType<typeof resolveAvailability>;
        periodization: ReturnType<typeof evaluatePeriodizationPhase>;
    }
    const dayInfo: AnchorDayInfo[] = [];
    for (let offset = 2; offset <= totalDays; offset++) {
        const date = addDaysToLocalDateString(todayDate, offset);
        const periodization = evaluatePeriodizationPhase(events, date, todayDate);
        if (!periodization.focusEvent) continue;
        const availability = resolveAvailability(date, null, fixedActivities, context, scheduleOverlays);
        dayInfo.push({ date, offset, availability, periodization });
    }

    const largestByTime = (pool: typeof dayInfo) =>
        pool.reduce((best, d) => (d.availability.maxTimeMinutes > best.availability.maxTimeMinutes ? d : best), pool[0]);

    if (!eventSpecificAnchorDate && dayInfo.length > 0) {
        const farEnoughFromQuality = (d: AnchorDayInfo) => {
            if (!qualityAnchorDate) return true;
            const qualityOffset = qualityAnchorDate === tomorrowDate ? 1 : (dayInfo.find(di => di.date === qualityAnchorDate)?.offset ?? 0);
            return Math.abs(d.offset - qualityOffset) >= QUALITY_ANCHOR_MIN_GAP_DAYS;
        };
        const eventSpecificPool = dayInfo.filter(d =>
            farEnoughFromQuality(d) &&
            eligibleTemplates(raceSpecificTemplates, context, d.availability.maxTimeMinutes, d.date)
                .filter(template => templateFitsResolvedAvailability(template, d.availability))
                .some(template => isTemplatePhaseEligible(template, d.periodization))
        );
        if (eventSpecificPool.length > 0) eventSpecificAnchorDate = largestByTime(eventSpecificPool).date;
    }

    if (!qualityAnchorDate && dayInfo.length > 0) {
        const remaining = dayInfo.filter(d => d.date !== eventSpecificAnchorDate);
        const farEnough = (d: AnchorDayInfo) => {
            if (!eventSpecificAnchorDate) return true;
            const anchorOffset = eventSpecificAnchorDate === tomorrowDate ? 1 : (dayInfo.find(di => di.date === eventSpecificAnchorDate)?.offset ?? 0);
            return Math.abs(d.offset - anchorOffset) >= QUALITY_ANCHOR_MIN_GAP_DAYS;
        };
        const fitsQuality = (d: AnchorDayInfo) => eligibleTemplates(qualityTemplates, context, d.availability.maxTimeMinutes, d.date)
            .some(template => templateFitsResolvedAvailability(template, d.availability));
        const qualityPool = remaining.filter(d => farEnough(d) && fitsQuality(d));
        if (qualityPool.length > 0) qualityAnchorDate = largestByTime(qualityPool).date;
    }

    return { eventSpecificAnchorDate, qualityAnchorDate };
}

export interface ProjectedDatePlanningContext {
    context: UserContext;
    preferences: UserPreferences;
    events: UserEvent[];
    fixedActivities: FixedActivity[];
    authoredPlanBlocks: readonly AuthoredPlanBlock[];
    scheduleOverlays?: readonly ScheduleOverlay[];
    anchors: WeeklyAnchors;
    internalStrain: DimensionalFatigue;
    internalStrainAsOf: string;
    fatigueFusionPolicy?: FatigueFusionPolicy;
    planDefinition?: PlanDefinition | null;
    todayDate?: string;
}

export interface ProjectedDateState {
    microcycle: MicrocycleState;
    externalFatigue: FatigueState;
    projectedHistory: (RecentHistoryEntry | SessionHistoryEntry)[];
    coverageHistory?: CoverageHistoryEntry[];
}

export interface ProjectedDateEvaluation {
    date: string;
    periodization: PeriodizationResult;
    availability: ReturnType<typeof resolveAvailability>;
    rankingFatigue: FatigueState;
    peakFatigue: number;
    fatigueTier: 'train' | 'modify' | 'recover';
    anchorRole: 'event-specific' | 'quality' | null;
    adjacentToAnchor: boolean;
    eligible: SessionTemplate[];
    fatigueGated: SessionTemplate[];
    optimizationContext: OptimizationContext;
    rank(candidates: readonly SessionTemplate[]): RankCandidatesResult;
}

export function evaluateProjectedDate(
    date: string,
    state: ProjectedDateState,
    shared: ProjectedDatePlanningContext,
): ProjectedDateEvaluation {
    const periodization = evaluatePeriodizationPhase(shared.events, date, shared.todayDate);
    const availability = resolveAvailability(date, null, shared.fixedActivities, shared.context, shared.scheduleOverlays ?? []);

    const rankingFatigue = applyCompletedSessionLoad(
        projectFatigueForRankingDate(state.externalFatigue, shared.internalStrain, shared.internalStrainAsOf, date, shared.fatigueFusionPolicy ?? 'max'),
        date,
        availability.reservedCapacityCostProfile,
        shared.fatigueFusionPolicy ?? 'max',
    );
    const peakFatigue = maxFatigueDimension(rankingFatigue.combinedFatigue);

    const eligible = eligibleTemplates(ENRICHED_TEMPLATES, shared.context, availability.maxTimeMinutes, date)
        .filter(template => templateFitsResolvedAvailability(template, availability))
        .filter(t => isTemplatePhaseEligible(t, periodization));

    const isConservative = shared.preferences?.conservativeBias ?? false;
    const fatigueThresholds = projectedFatigueThresholds(isConservative);
    const fatigueTier = fatigueTierFor(peakFatigue, fatigueThresholds);

    const fatigueGated = eligible.filter(t => {
        if (peakFatigue >= fatigueThresholds.recover) {
            return t.category === 'Rest' || t.category === 'Mobility/Recovery';
        }
        if (peakFatigue >= fatigueThresholds.modify) {
            return t.systemicCost <= fatigueThresholds.modifyMaxSystemicCost;
        }
        return true;
    });

    const anchorRole = date === shared.anchors.eventSpecificAnchorDate ? 'event-specific' as const
        : date === shared.anchors.qualityAnchorDate ? 'quality' as const : null;
    const adjacentToAnchor = isAdjacentDate(date, shared.anchors.eventSpecificAnchorDate)
        || isAdjacentDate(date, shared.anchors.qualityAnchorDate);

    const unresolved = getUnresolvedObjectives(state.microcycle, true);
    const planDefinition = shared.planDefinition ?? resolvePlanDefinitionForEvent(periodization.focusEvent, shared.authoredPlanBlocks);
    const optimizationContext = buildOptimizationContext(
        {
            unresolvedObjectives: unresolved,
            fatigue: rankingFatigue,
            periodization,
            history: state.projectedHistory,
            plannedDose: applyPlanningOverlays(resolvePlannedDoseForDate(
                periodization.phase,
                state.microcycle.objectives,
                unresolved,
                planDefinition,
                date,
            ), date, shared.authoredPlanBlocks, planDefinition, shared.scheduleOverlays ?? []),
        },
        shared.context,
        shared.preferences,
        date,
        {
            anchorRole, adjacentToAnchor, resolveMinimumDaysAfterHardLowerBody, resolveRecoveryHours: resolveRecoveryHoursForTemplate, fatigueTier,
            authoredPlanBlocks: shared.authoredPlanBlocks,
            ...(planDefinition ? {
                coverageState: buildCoverageState(
                    planDefinition,
                    date,
                    state.coverageHistory ?? resolveCoverageHistory(undefined, state.projectedHistory),
                ),
            } : {}),
        },
        shared.fixedActivities,
    );

    const rankings = new Map<string, RankCandidatesResult>();

    return {
        date,
        periodization,
        availability,
        rankingFatigue,
        peakFatigue,
        fatigueTier,
        anchorRole,
        adjacentToAnchor,
        eligible,
        fatigueGated,
        optimizationContext,
        rank: (candidates: readonly SessionTemplate[]) => {
            const key = candidates.map(template => template.id).join(',');
            const cached = rankings.get(key);
            if (cached) return cached;
            const result = rankCandidates(
                [...candidates],
                optimizationContext.unresolvedObjectives,
                optimizationContext.fatigueState,
                optimizationContext.availability,
                optimizationContext.injuryConstraints,
                optimizationContext.preferences,
                optimizationContext.options,
            );
            rankings.set(key, result);
            return result;
        },
    };
}

const NOT_ELIGIBLE_ON_DATE = 'NOT_ELIGIBLE_ON_DATE';
const PROJECTED_DATE_OUTCOMES = new WeakMap<ProjectedDateEvaluation, ProjectedDateOutcome>();

export function projectedDateOutcomeFrom(evaluation: ProjectedDateEvaluation): ProjectedDateOutcome {
    const memoized = PROJECTED_DATE_OUTCOMES.get(evaluation);
    if (memoized) return memoized;
    const ranking = evaluation.rank(evaluation.fatigueGated);
    const eligibleIds = new Set(evaluation.eligible.map(template => template.id));
    const gatedIds = new Set(evaluation.fatigueGated.map(template => template.id));
    const exclusionReasons = new Map<string, readonly string[]>();
    ranking.rejected.forEach(candidate => exclusionReasons.set(candidate.template.id, candidate.excludedReasons));
    ENRICHED_TEMPLATES.forEach(template => {
        if (!eligibleIds.has(template.id)) exclusionReasons.set(template.id, [NOT_ELIGIBLE_ON_DATE]);
    });
    const outcome: ProjectedDateOutcome = {
        date: evaluation.date,
        fatigueTier: evaluation.fatigueTier,
        acceptedTemplateIds: ranking.accepted.map(candidate => candidate.template.id),
        fatigueExcludedTemplateIds: evaluation.eligible
            .filter(template => !gatedIds.has(template.id))
            .map(template => template.id),
        exclusionReasons,
    };
    PROJECTED_DATE_OUTCOMES.set(evaluation, outcome);
    return outcome;
}

function rejectionCountsFor(evaluation: ProjectedDateEvaluation): Record<string, number> {
    const outcome = projectedDateOutcomeFrom(evaluation);
    const counts: Record<string, number> = {};
    outcome.exclusionReasons.forEach(reasons => reasons.forEach(reason => {
        counts[reason] = (counts[reason] ?? 0) + 1;
    }));
    outcome.fatigueExcludedTemplateIds.forEach(() => {
        counts.PROJECTED_FATIGUE_GATE = (counts.PROJECTED_FATIGUE_GATE ?? 0) + 1;
    });
    return counts;
}

export function projectTrailingHistory(
    history: (RecentHistoryEntry | SessionHistoryEntry)[]
): (RecentHistoryEntry | SessionHistoryEntry)[] {
    return history.map(e => {
        const completedDate = 'completedDate' in e && typeof e.completedDate === 'string' ? e.completedDate : undefined;
        const rec = e as Record<string, unknown>;
        const recordType = rec.trainingRecordLike && typeof rec.trainingRecordLike === 'object' && 'type' in (rec.trainingRecordLike as object) ? (rec.trainingRecordLike as { type?: string }).type : undefined;
        const recordDurationMin = rec.trainingRecordLike && typeof rec.trainingRecordLike === 'object'
            && typeof (rec.trainingRecordLike as { duration_min?: unknown }).duration_min === 'number'
            ? (rec.trainingRecordLike as { duration_min: number }).duration_min
            : undefined;
        const costProf = rec.costProfile && typeof rec.costProfile === 'object' ? rec.costProfile as Record<string, number> : undefined;
        const systemic = costProf?.systemic;

        const item: RecentHistoryEntry = {
            type: recordType ?? ('type' in e ? e.type : undefined) ?? e.modality,
            systemicCost: e.systemicCost ?? systemic ?? 0,
        };
        const dt = completedDate ?? ('date' in e ? e.date : undefined);
        if (dt) item.date = dt;
        if ('category' in e && e.category) item.category = e.category;
        if ('modality' in e && e.modality) item.modality = e.modality;
        if ('role' in e && e.role) item.role = e.role;
        if ('templateId' in e && e.templateId) item.templateId = e.templateId;
        if ('lowerBodyCost' in e && typeof e.lowerBodyCost === 'number') item.lowerBodyCost = e.lowerBodyCost;
        if ('durationMin' in e && typeof e.durationMin === 'number') item.durationMin = e.durationMin;
        else if (recordDurationMin !== undefined) item.durationMin = recordDurationMin;
        if ('recoveryHours' in e && typeof e.recoveryHours === 'number') item.recoveryHours = e.recoveryHours;
        else if (item.templateId) item.recoveryHours = resolveRecoveryHoursForTemplate(item.templateId);
        return item;
    });
}

export function trailingHistoryFromCompletedExposures(
    history: CompletedExposure[],
    todayDate: string
): RecentHistoryEntry[] {
    return history.map(e => ({
        date: ('completedDate' in e && typeof e.completedDate === 'string' ? e.completedDate : 'date' in e && typeof e.date === 'string' ? e.date : todayDate),
        templateId: e.templateId,
        modality: e.modality,
        category: e.category,
        systemicCost: e.costProfile?.systemic ?? 0,
        lowerBodyCost: e.costProfile?.lowerBody ?? 0,
        durationMin: e.trainingRecordLike?.duration_min ?? e.deliveredDose?.completedDurationMin,
        recoveryHours: e.recoveryHours ?? (e.templateId ? resolveRecoveryHoursForTemplate(e.templateId) : undefined),
    }));
}

function isCompletedExposure(entry: RecentHistoryEntry | SessionHistoryEntry): entry is CompletedExposure & (RecentHistoryEntry | SessionHistoryEntry) {
    const record = entry as unknown as Record<string, unknown>;
    return typeof record.date === 'string'
        && !!record.costProfile && typeof record.costProfile === 'object'
        && !!record.trainingRecordLike && typeof record.trainingRecordLike === 'object';
}

const LIGHTWEIGHT_HISTORY_STIMULUS: WorkoutStimulusProfile = {
    thresholdPower: 0.8,
    aerobicEndurance: 0.5,
    repeatedSurges: 0.5,
    vo2MaxPower: 0,
    sprintPower: 0,
    fatigueResistance: 0.5,
    maxStrength: 0.5,
    hypertrophy: 0.5,
};

export function prepareWeekAheadPlanSeed(
    readinessOrMicrocycle: DailyReadiness | MicrocycleState,
    eventsOrFatigue: UserEvent[] | FatigueState,
    todayDate: string,
    history: (RecentHistoryEntry | SessionHistoryEntry)[] = []
): WeekAheadPlanSeed {
    if ('objectives' in readinessOrMicrocycle && 'externalLoadFatigue' in eventsOrFatigue) {
        return {
            microcycle: readinessOrMicrocycle as MicrocycleState,
            fatigue: eventsOrFatigue as FatigueState,
            trailingHistory: projectTrailingHistory(history),
        };
    }

    const readiness = readinessOrMicrocycle as DailyReadiness;
    const events = (Array.isArray(eventsOrFatigue) ? eventsOrFatigue : []) as UserEvent[];
    const periodization = evaluatePeriodizationPhase(events, todayDate);
    const completedHistory = history.filter(isCompletedExposure) as CompletedExposure[];
    const lightweightHistory = history.filter(entry => !isCompletedExposure(entry));

    if (completedHistory.length > 0) {
        let microcycle = buildMicrocycleState(
            periodization.phase,
            addDaysToLocalDateString(todayDate, -7),
            completedHistory,
            periodization.focusEvent,
        );
        const multiEventResolution = resolveMultiEventObjectives(events, todayDate, periodization, microcycle.objectives);
        microcycle = { ...microcycle, objectives: multiEventResolution.objectives };
        lightweightHistory.forEach(h => {
            const typeStr = 'type' in h && typeof h.type === 'string' ? h.type : undefined;
            const modality = (h.modality ?? typeStr ?? 'None') as SessionTemplate['modality'];
            microcycle = creditObjectivesFromStimulus(
                microcycle,
                LIGHTWEIGHT_HISTORY_STIMULUS,
                modality,
                h.category,
            );
        });
        return {
            microcycle,
            fatigue: buildFatigueStateFromHistory(
                completedHistory,
                computeInternalResponseStrain(readiness),
                todayDate,
            ),
            trailingHistory: projectTrailingHistory(history),
            droppedContributorObjectives: multiEventResolution.droppedContributorObjectives,
        };
    }

    let microcycle = generateWeeklyObjectives(periodization.phase, todayDate, periodization.focusEvent);
    const multiEventResolution = resolveMultiEventObjectives(events, todayDate, periodization, microcycle.objectives);
    microcycle = { ...microcycle, objectives: multiEventResolution.objectives };
    lightweightHistory.forEach(h => {
        const typeStr = 'type' in h && typeof h.type === 'string' ? h.type : undefined;
        const modality = (h.modality ?? typeStr ?? 'None') as SessionTemplate['modality'];
        const category = h.category;
        microcycle = creditObjectivesFromStimulus(microcycle, LIGHTWEIGHT_HISTORY_STIMULUS, modality, category);
    });
    const fatigue = buildFatigueStateFromHistory([], computeInternalResponseStrain(readiness), todayDate);
    return {
        microcycle,
        fatigue,
        trailingHistory: projectTrailingHistory(history),
        droppedContributorObjectives: multiEventResolution.droppedContributorObjectives,
    };
}

interface ObjectiveCreditSnapshot {
    completedCredit: number;
    projectedCredit: number;
    completedExposures: number;
}

function snapshotObjectiveCredit(objective: WeeklyObjective): ObjectiveCreditSnapshot {
    return {
        completedCredit: objective.completedCredit ?? objective.completedExposures,
        projectedCredit: objective.projectedCredit ?? 0,
        completedExposures: objective.completedExposures,
    };
}

export interface ProjectionExposure {
    occurrenceKey: string;
    date: string;
    stimulus: WorkoutStimulusProfile;
    templateId?: string;
    workoutId?: string;
    modality?: SessionTemplate['modality'];
    category?: SessionTemplate['category'];
    durationMin?: number;
    stimulusConfidence?: StimulusConfidence;
}

function backfillCreditFromPriorExposures(
    definition: WeeklyObjective,
    priorExposures: readonly ProjectionExposure[],
): number {
    const requiredCredit = definition.requiredCredit ?? definition.targetExposures;
    let total = 0;
    const seen = new Set<string>();
    for (const exposure of priorExposures) {
        if (seen.has(exposure.occurrenceKey)) continue;
        seen.add(exposure.occurrenceKey);
        if (total >= requiredCredit) break;
        const credit = deriveObjectiveCreditFromProfile(definition, exposure.stimulus, {}, {
            modality: exposure.modality,
            category: exposure.category,
        }, exposure.stimulusConfidence ?? 'exact');
        if (credit.qualifies && credit.earnedCredit > 0) {
            total = Math.min(requiredCredit, total + credit.earnedCredit);
        }
    }
    return total;
}

export function reconcileObjectivesForDate(
    microcycle: MicrocycleState,
    events: UserEvent[],
    date: string,
    todayDate: string,
    periodization: PeriodizationResult,
    creditMemory: Map<string, ObjectiveCreditSnapshot>,
    priorExposures: readonly ProjectionExposure[] = [],
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
    planDefinition?: PlanDefinition | null,
): { microcycle: MicrocycleState; droppedContributorObjectives: DroppedContributorObjective[] } {
    const planDefinitionForDate = planDefinition ?? resolvePlanDefinitionForEvent(periodization.focusEvent, authoredPlanBlocks);
    const skeleton = generateWeeklyObjectives(periodization.phase, todayDate, periodization.focusEvent, planDefinitionForDate, date);
    const fresh = resolveMultiEventObjectives(events, date, periodization, skeleton.objectives);

    const existingById = new Map(microcycle.objectives.map(objective => [objective.id, objective]));
    const existingByKey = new Map<WeeklyObjective['key'], WeeklyObjective[]>();
    microcycle.objectives.forEach(objective => {
        const matching = existingByKey.get(objective.key) ?? [];
        matching.push(objective);
        existingByKey.set(objective.key, matching);
    });
    const freshIds = new Set(fresh.objectives.map(objective => objective.id));
    const freshKeyCounts = new Map<WeeklyObjective['key'], number>();
    fresh.objectives.forEach(objective => freshKeyCounts.set(objective.key, (freshKeyCounts.get(objective.key) ?? 0) + 1));

    microcycle.objectives.forEach(objective => {
        if (!freshIds.has(objective.id)) {
            const snapshot = snapshotObjectiveCredit(objective);
            creditMemory.set(objective.id, snapshot);
            if ((existingByKey.get(objective.key)?.length ?? 0) === 1) creditMemory.set(`key:${objective.key}`, snapshot);
        }
    });

    const objectives = fresh.objectives.map(definition => {
        const sameKey = existingByKey.get(definition.key) ?? [];
        const uniqueFreshKey = freshKeyCounts.get(definition.key) === 1;
        const existing = existingById.get(definition.id) ?? (uniqueFreshKey && sameKey.length === 1 ? sameKey[0] : undefined);
        const carried = existing
            ? snapshotObjectiveCredit(existing)
            : creditMemory.get(definition.id) ?? (uniqueFreshKey ? creditMemory.get(`key:${definition.key}`) : undefined);
        if (carried) return { ...definition, ...carried };

        const relevantExposures = priorExposures.filter(exposure => exposure.date < date);
        const backfilled = backfillCreditFromPriorExposures(definition, relevantExposures);
        if (backfilled <= 0) return definition;
        return {
            ...definition,
            projectedCredit: backfilled,
            completedExposures: projectCompatibilityExposures(backfilled, definition.targetExposures),
        };
    });

    return {
        microcycle: { ...microcycle, objectives },
        droppedContributorObjectives: fresh.droppedContributorObjectives,
    };
}

export interface FixedActivityStimulusResult {
    microcycle: MicrocycleState;
    credits: PlannedObjectiveCredit[];
    exposures: ProjectionExposure[];
}

export function applyFixedActivityStimulusCredit(
    microcycle: MicrocycleState,
    fixedActivities: FixedActivity[],
    date: string,
): FixedActivityStimulusResult {
    const dayActivities = fixedActivities.filter(a => a.date === date && !a.isCompleted && a.expectedStimulus);
    let nextMicrocycle = microcycle;
    const credits: PlannedObjectiveCredit[] = [];
    const exposures: ProjectionExposure[] = [];
    const seenOccurrences = new Set<string>();

    dayActivities.forEach(activity => {
        const identity = resolveFixedActivityIdentity(activity);
        if (!identity || seenOccurrences.has(identity.occurrenceKey)) return;
        seenOccurrences.add(identity.occurrenceKey);

        const stimulus: WorkoutStimulusProfile = { ...ZERO_STIMULUS, ...activity.expectedStimulus };
        const stimulusConfidence = identity.stimulusConfidence ?? 'exact';
        exposures.push({
            occurrenceKey: identity.occurrenceKey,
            date,
            stimulus,
            templateId: identity.templateId,
            workoutId: identity.workoutId,
            modality: identity.modality,
            category: identity.category,
            stimulusConfidence,
        });

        const derivedCredits = getUnresolvedObjectives(nextMicrocycle, true).flatMap(objective => {
            const credit = deriveObjectiveCreditFromProfile(objective, stimulus, {}, {
                modality: identity.modality,
                category: identity.category,
            }, stimulusConfidence);
            return credit.qualifies && credit.earnedCredit > 0
                ? [{ objective, earnedCredit: credit.earnedCredit }]
                : [];
        });
        if (derivedCredits.length === 0) return;

        const projected = applyProjectedObjectiveCredits(
            nextMicrocycle,
            derivedCredits.map(item => ({ objectiveId: item.objective.id, earnedCredit: item.earnedCredit })),
        );
        const allocationById = new Map(projected.allocations.map(item => [item.objectiveId, item.earnedCredit]));
        derivedCredits.forEach(({ objective }) => {
            const allocated = allocationById.get(objective.id) ?? 0;
            if (allocated <= 0) return;
            credits.push({
                date,
                objectiveKey: objective.key,
                objectiveTitle: objective.title,
                templateId: identity.templateId,
                templateTitle: activity.title,
                modality: identity.modality,
                earnedCredit: allocated,
            });
        });
        nextMicrocycle = projected.microcycle;
    });

    return { microcycle: nextMicrocycle, credits, exposures };
}

export function fixedActivityCostProfileForDate(fixedActivities: FixedActivity[], date: string): WorkoutCostProfile {
    const dayActivities = fixedActivities.filter(a => a.date === date && !a.isCompleted);
    return sumFixedActivityCostProfiles(dayActivities);
}

function accumulateNewDrops(
    accumulated: DroppedContributorObjective[],
    currentlyDropped: Set<string>,
    freshDrops: DroppedContributorObjective[],
): void {
    const dropKey = (d: DroppedContributorObjective) => `${d.eventId}:${d.objectiveKey}`;
    const freshKeys = new Set(freshDrops.map(dropKey));

    freshDrops.forEach(drop => {
        if (!currentlyDropped.has(dropKey(drop))) accumulated.push(drop);
    });

    currentlyDropped.clear();
    freshKeys.forEach(key => currentlyDropped.add(key));
}

export function generateWeekAheadPlan(
    todayReadiness: DailyReadiness,
    context: UserContext,
    preferences: UserPreferences | null,
    todayDate: string,
    todayRec: Recommendation,
    tomorrowRec: Recommendation | null,
    seed: WeekAheadPlanSeed,
    options: WeekAheadOptions = {}
): WeekAheadPlan {
    const isSevereAdverseRecovery = isSevereAdverseRecoveryReadiness(todayReadiness, todayRec.mode);

    const totalDays = Math.max(1, options.days ?? 7);
    const events = options.events ?? [];
    const fixedActivities = options.fixedActivities ?? [];
    const fixedActivitiesByDate = groupFixedActivitiesByDate(fixedActivities);
    const unsetDateFixedActivities = fixedActivities.filter(a => !a.date);
    const getFixedActivitiesForDate = (targetDate: string): FixedActivity[] => {
        const dated = fixedActivitiesByDate.get(targetDate) ?? [];
        return unsetDateFixedActivities.length > 0 ? [...dated, ...unsetDateFixedActivities] : dated;
    };
    const authoredPlanBlocks = options.authoredPlanBlocks ?? [];
    const scheduleOverlays = options.scheduleOverlays ?? [];
    const suppliedPlanDefinition = options.planDefinition ?? null;
    const fatigueFusionPolicy = options.fatigueFusionPolicy ?? 'max';
    const effectivePreferences = preferences ?? { ...NEUTRAL_PREFERENCES, preferredRecoveryStyle: resolveRecoveryStyle(context) };

    const periodizationToday = evaluatePeriodizationPhase(events, todayDate);
    let microcycle: MicrocycleState = seed.microcycle ?? generateWeeklyObjectives(periodizationToday.phase, todayDate, periodizationToday.focusEvent, suppliedPlanDefinition, todayDate);
    const internalStrain: DimensionalFatigue = seed.fatigue?.internalResponseStrain ?? { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
    const internalStrainAsOf = todayDate;
    let externalFatigue: FatigueState = seed.fatigue?.externalLoadFatigue ? seed.fatigue : createEmptyFatigue(todayDate);

    const resultDays: WeekAheadDay[] = [];
    const objectiveCredits: PlannedObjectiveCredit[] = [];
    const anchors = resolveWeeklyAnchors(todayDate, totalDays, events, fixedActivities, context, tomorrowRec?.template.category, tomorrowRec?.template.modality, scheduleOverlays);

    const beganAfterHardRaceSpecificExposure = todayRec.mode === 'recover' && (seed.trailingHistory ?? []).some(entry =>
        entry.date === addDaysToLocalDateString(todayDate, -1)
        && entry.category === 'Race-Specific Endurance'
        && (entry.systemicCost ?? 0) >= PROJECTED_MODIFY_MAX_SYSTEMIC_COST
    );

    const creditMemory = new Map<string, ObjectiveCreditSnapshot>();
    const droppedContributorObjectives: DroppedContributorObjective[] = [...(seed.droppedContributorObjectives ?? [])];
    const currentlyDroppedPairs = new Set<string>(
        droppedContributorObjectives.map(d => `${d.eventId}:${d.objectiveKey}`)
    );
    const projectionExposures: ProjectionExposure[] = [];
    const appliedProjectionOccurrences = new Set<string>();
    const appliedFixedCostOccurrences = new Set<string>();
    const appliedScheduleOverlayCostDates = new Set<string>();

    type DerivedPlanningCredit = {
        objective: WeeklyObjective;
        earnedCredit: number;
    };

    const creditingObjectivesFor = (template: SessionTemplate, activeDose?: DoseVariation): DerivedPlanningCredit[] => {
        const effectiveTemplate = effectiveTemplateForProjection(template, activeDose);
        const stimulus = enrichedStimulusProfile(effectiveTemplate);
        return getUnresolvedObjectives(microcycle, true).flatMap(objective => {
            const credit = deriveObjectiveCreditFromProfile(objective, stimulus, {}, {
                modality: template.modality,
                category: template.category,
            });
            return credit.qualifies && credit.earnedCredit > 0
                ? [{ objective, earnedCredit: credit.earnedCredit }]
                : [];
        });
    };

    const applyPick = (
        date: string,
        template: SessionTemplate,
        activeDose?: DoseVariation,
        derivedCredits: DerivedPlanningCredit[] = creditingObjectivesFor(template, activeDose),
    ) => {
        const occurrenceKey = `recommendation:${date}`;
        if (appliedProjectionOccurrences.has(occurrenceKey)) return;
        appliedProjectionOccurrences.add(occurrenceKey);
        const effectiveTemplate = effectiveTemplateForProjection(template, activeDose);

        const projected = applyProjectedObjectiveCredits(
            microcycle,
            derivedCredits.map(item => ({ objectiveId: item.objective.id, earnedCredit: item.earnedCredit })),
        );
        const allocationById = new Map(projected.allocations.map(item => [item.objectiveId, item.earnedCredit]));
        derivedCredits.forEach(({ objective }) => {
            const allocated = allocationById.get(objective.id) ?? 0;
            if (allocated <= 0) return;
            objectiveCredits.push({
                date,
                objectiveKey: objective.key,
                objectiveTitle: objective.title,
                templateId: template.id,
                templateTitle: template.title,
                modality: template.modality,
                earnedCredit: allocated,
            });
        });
        microcycle = projected.microcycle;
        externalFatigue = applyCompletedSessionLoad(
            externalFatigue,
            date,
            effectiveTemplate.costProfile ?? enrichedCostProfile(template.id),
            fatigueFusionPolicy,
        );
        projectionExposures.push({
            occurrenceKey,
            date,
            stimulus: enrichedStimulusProfile(effectiveTemplate),
            templateId: template.id,
            modality: template.modality,
            category: template.category,
            durationMin: effectiveTemplate.durationMin,
        });
    };

    const applyFixedActivityStimulus = (date: string) => {
        const dayFixed = getFixedActivitiesForDate(date);
        const result = applyFixedActivityStimulusCredit(microcycle, dayFixed, date);
        const freshExposures = result.exposures.filter(exposure => !appliedProjectionOccurrences.has(exposure.occurrenceKey));
        if (freshExposures.length === 0) return;
        freshExposures.forEach(exposure => appliedProjectionOccurrences.add(exposure.occurrenceKey));
        microcycle = result.microcycle;
        objectiveCredits.push(...result.credits);
        projectionExposures.push(...freshExposures);
    };

    const applyFixedActivityCost = (date: string) => {
        const dayActivities = getFixedActivitiesForDate(date).filter(a => !a.isCompleted && a.expectedCost);
        const freshActivities = dayActivities.filter(activity => {
            const key = `fixed:${activity.id}:cost`;
            if (appliedFixedCostOccurrences.has(key)) return false;
            appliedFixedCostOccurrences.add(key);
            return true;
        });
        if (freshActivities.length === 0) return;
        const costProfile = fixedActivityCostProfileForDate(freshActivities, date);
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, costProfile, fatigueFusionPolicy);
    };

    const applyScheduleOverlayCost = (date: string) => {
        if (appliedScheduleOverlayCostDates.has(date)) return;
        appliedScheduleOverlayCostDates.add(date);
        const cost = scheduleOverlayCostProfileForDate(scheduleOverlays, date);
        if (!Object.values(cost).some(value => value > 0)) return;
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, cost, fatigueFusionPolicy);
    };

    applyFixedActivityStimulus(todayDate);
    applyPick(todayDate, todayRec.template, todayRec.activeDose);
    applyFixedActivityCost(todayDate);
    applyScheduleOverlayCost(todayDate);

    if (tomorrowRec) {
        const tomorrowDate = addDaysToLocalDateString(todayDate, 1);
        const tomorrowPeriodization = evaluatePeriodizationPhase(events, tomorrowDate);
        const tomorrowReconciled = reconcileObjectivesForDate(microcycle, events, tomorrowDate, todayDate, tomorrowPeriodization, creditMemory, projectionExposures, authoredPlanBlocks, suppliedPlanDefinition);
        microcycle = tomorrowReconciled.microcycle;
        accumulateNewDrops(droppedContributorObjectives, currentlyDroppedPairs, tomorrowReconciled.droppedContributorObjectives);
        applyFixedActivityStimulus(tomorrowDate);
        const tomorrowCredits = creditingObjectivesFor(tomorrowRec.template, tomorrowRec.activeDose);
        resultDays.push({
            date: tomorrowDate,
            dayOffset: 1,
            confidence: 'provisional',
            phaseName: tomorrowPeriodization.phase.phaseName,
            template: tomorrowRec.template,
            mode: tomorrowRec.mode === 'recover' ? 'recover' : 'train',
            rationale: tomorrowRec.rationale,
            addressesObjectives: tomorrowCredits.map(item => item.objective.title),
            ...(tomorrowRec.activeDose ? { activeDose: tomorrowRec.activeDose, adjustment: tomorrowRec.adjustment } : {}),
        });
        applyPick(tomorrowDate, tomorrowRec.template, tomorrowRec.activeDose, tomorrowCredits);
        applyFixedActivityCost(tomorrowDate);
        applyScheduleOverlayCost(tomorrowDate);
    }

    const sharedProjection: ProjectedDatePlanningContext = {
        context,
        preferences: effectivePreferences,
        events,
        fixedActivities,
        authoredPlanBlocks,
        scheduleOverlays,
        anchors,
        internalStrain,
        internalStrainAsOf,
        fatigueFusionPolicy,
        planDefinition: suppliedPlanDefinition,
        todayDate,
    };

    type ProjectedHistoryEntry = RecentHistoryEntry & { source: 'projected' };
    const historyEntryFor = (date: string, template: SessionTemplate, activeDose?: DoseVariation): ProjectedHistoryEntry => {
        const effectiveTemplate = effectiveTemplateForProjection(template, activeDose);
        return {
            date,
            templateId: template.id,
            category: template.category,
            modality: template.modality,
            role: realizedSessionRole(date, template, anchors),
            systemicCost: effectiveTemplate.systemicCost,
            lowerBodyCost: effectiveTemplate.costProfile?.lowerBody ?? 0,
            durationMin: effectiveTemplate.durationMin,
            recoveryHours: resolveRecoveryHoursForTemplate(template.id),
            type: template.title,
            source: 'projected',
        };
    };

    const liveProjectedHistory = (): (RecentHistoryEntry | SessionHistoryEntry)[] => [
        ...(seed.trailingHistory ?? []),
        historyEntryFor(todayDate, todayRec.template, todayRec.activeDose),
        ...resultDays.map(day => historyEntryFor(day.date, day.template, day.activeDose)),
    ];

    const completedCoverageHistory = seed.completedCoverageHistory
        ?? resolveCoverageHistory(undefined, seed.trailingHistory ?? []);
    const liveProjectedCoverageHistory = (): CoverageHistoryEntry[] => [
        ...completedCoverageHistory,
        ...resolveCoverageHistory(undefined, [
            historyEntryFor(todayDate, todayRec.template, todayRec.activeDose),
            ...resultDays.map(day => historyEntryFor(day.date, day.template, day.activeDose)),
        ]),
    ];

    const forecastDatesFrom = (startOffset: number): string[] => {
        const dates: string[] = [];
        for (let offset = startOffset; offset <= totalDays; offset++) dates.push(addDaysToLocalDateString(todayDate, offset));
        return dates;
    };

    const evaluationCache = new Map<string, ProjectedDateEvaluation>();

    const projectedEvaluation = (date: string, applied: readonly ProjectedAssignment[]): ProjectedDateEvaluation => {
        const cacheKey = [
            resultDays.length,
            externalFatigue.lastUpdatedDate,
            date,
            applied.map(item => `${item.date}:${item.templateId}:${item.activeDose ? `${item.activeDose.label}:${item.activeDose.doseRatio}` : ''}`).sort().join(','),
        ].join('#');
        const cached = evaluationCache.get(cacheKey);
        if (cached) return cached;
        const history = liveProjectedHistory();
        const coverageHistory = liveProjectedCoverageHistory();
        const loads: Array<{ date: string; cost: WorkoutCostProfile }> = [];
        fixedActivities
            .filter(activity => !activity.isCompleted && activity.expectedCost
                && activity.date > externalFatigue.lastUpdatedDate && activity.date < date)
            .forEach(activity => loads.push({
                date: activity.date,
                cost: fixedActivityCostProfileForDate([activity], activity.date),
            }));
        for (
            let cursor = addDaysToLocalDateString(externalFatigue.lastUpdatedDate, 1);
            cursor < date;
            cursor = addDaysToLocalDateString(cursor, 1)
        ) {
            const cost = scheduleOverlayCostProfileForDate(scheduleOverlays, cursor);
            if (Object.values(cost).some(value => value > 0)) loads.push({ date: cursor, cost });
        }
        applied.forEach(item => {
            const template = ENRICHED_TEMPLATES_BY_ID.get(item.templateId);
            if (!template) return;
            const effective = effectiveTemplateForProjection(template, item.activeDose);
            loads.push({ date: item.date, cost: effective.costProfile ?? enrichedCostProfile(item.templateId) });
            const projectedEntry = historyEntryFor(item.date, template, item.activeDose);
            history.push(projectedEntry);
            coverageHistory.push(...resolveCoverageHistory(undefined, [projectedEntry]));
        });
        const fatigue = loads
            .sort((left, right) => left.date.localeCompare(right.date))
            .reduce((state, load) => applyCompletedSessionLoad(state, load.date, load.cost, fatigueFusionPolicy), externalFatigue);
        const evaluation = evaluateProjectedDate(
            date,
            { microcycle, externalFatigue: fatigue, projectedHistory: history, coverageHistory },
            sharedProjection,
        );
        evaluationCache.set(cacheKey, evaluation);
        return evaluation;
    };

    const allocationEvaluator = (
        forecastDates: string[],
        extra: readonly ProjectedAssignment[] = [],
    ): AllocationDateEvaluator => ({
        forecastDates,
        evaluate: (assignments, date) => projectedDateOutcomeFrom(
            projectedEvaluation(date, [...extra, ...assignments].filter(item => item.date < date)),
        ),
    });

    const firstForecastOffset = resultDays.length + 1;
    const seedDates = new Set(resultDays.map(day => day.date).concat(todayDate));
    const allocationOccurrences = attachExactEligibleIdentities(
        deriveRequiredRoleOccurrences(
            projectedEvaluation(addDaysToLocalDateString(todayDate, firstForecastOffset), []).optimizationContext.coverageState,
        ),
        ENRICHED_TEMPLATES,
    );

    let allocation = resolveWeeklyRoleReservations(
        allocationOccurrences,
        allocationEvaluator(forecastDatesFrom(firstForecastOffset)),
        { unavailableDates: seedDates },
    );
    const nominatedDates = new Map<string, string | null>(
        allocation.outcomes.map(outcome => [outcome.occurrence.id, outcome.reservation.assignedDate]),
    );
    const settledOutcomes = new Map<string, WeeklyRoleAllocationOutcome>();
    const displacementReasons = new Map<string, WeeklyRoleMissReason>();

    const evaluateForecastDate = (offset: number) => {
        const date = addDaysToLocalDateString(todayDate, offset);
        const periodization = evaluatePeriodizationPhase(events, date, todayDate);

        const priorObjectiveIds = new Set(microcycle.objectives.map(objective => objective.id));
        const reconciled = reconcileObjectivesForDate(microcycle, events, date, todayDate, periodization, creditMemory, projectionExposures, authoredPlanBlocks, suppliedPlanDefinition);
        microcycle = reconciled.microcycle;
        accumulateNewDrops(droppedContributorObjectives, currentlyDroppedPairs, reconciled.droppedContributorObjectives);
        applyFixedActivityStimulus(date);

        const pendingOccurrences = allocationOccurrences.filter(occurrence => !settledOutcomes.has(occurrence.id));
        allocation = resolveWeeklyRoleReservations(
            pendingOccurrences,
            allocationEvaluator(forecastDatesFrom(offset)),
            { nominatedDates },
        );
        allocation.outcomes.forEach(outcome => {
            if (!nominatedDates.get(outcome.occurrence.id) && outcome.reservation.assignedDate) {
                nominatedDates.set(outcome.occurrence.id, outcome.reservation.assignedDate);
            }
        });
        const reservation = allocation.reservationsByDate.get(date);

        const evaluation = projectedEvaluation(date, []);
        const { anchorRole, eligible, fatigueGated, peakFatigue, fatigueTier, rankingFatigue, optimizationContext: optContext } = evaluation;

        const hasFatigueGatedRequiredCoverage = beganAfterHardRaceSpecificExposure && anchorRole === 'event-specific' && eligible.some(template =>
            !fatigueGated.includes(template)
            && (template.category === 'Race-Specific Endurance'
                || template.category === 'Hard Endurance'
                || template.category === 'Moderate Endurance')
            && coverageNeedTierForTemplate(optContext.coverageState, template, anchorRole) <= 1
        );
        const isRecoveryPersistedDate = isSevereAdverseRecovery && offset <= 3;
        let rankingCandidates = isRecoveryPersistedDate && offset === 1
            ? fatigueGated.filter(template => template.category === 'Rest' || template.category === 'Mobility/Recovery')
            : (isRecoveryPersistedDate && offset === 2
                ? fatigueGated.filter(template => template.category === 'Rest' || template.category === 'Mobility/Recovery' || template.systemicCost <= PROJECTED_MODIFY_MAX_SYSTEMIC_COST)
                : (isRecoveryPersistedDate && offset === 3
                    ? fatigueGated.filter(template => template.category === 'Rest' || template.category === 'Mobility/Recovery' || (template.systemicCost <= 0.65 && template.category !== 'Hard Endurance' && template.category !== 'Race-Specific Endurance'))
                    : (hasFatigueGatedRequiredCoverage
                        ? fatigueGated.filter(template => template.category === 'Rest' || template.category === 'Mobility/Recovery')
                        : fatigueGated)));

        const exactReserved = reservation
            ? rankingCandidates.filter(template => reservation.occurrence.eligibleTemplateIds.includes(template.id))
            : [];
        if (reservation && exactReserved.length > 0) rankingCandidates = exactReserved;

        const rankingResult = evaluation.rank(rankingCandidates);
        const ranked = rankingResult.accepted;

        const restFallback: SessionTemplate = ENRICHED_TEMPLATES.find(t => t.category === 'Rest') ?? {
            id: 'rest_01',
            category: 'Rest',
            modality: 'None',
            durationMin: 0,
            durationMax: 0,
            title: 'Rest Day',
            description: 'Full rest and recovery.',
            requiredEquipment: [],
            environment: 'either',
            safetyTags: [],
            systemicCost: 0,
        };

        const fallbackPick = {
            template: restFallback,
            utilityScore: 0,
            benefitScore: 0,
            costPenalty: 0,
            coverageNeedTier: 3 as const,
            rationale: 'Fallback rest day.',
        };

        const incumbentAssignments = [...allocation.reservationsByDate.entries()]
            .map(([reservedDate, item]) => ({ date: reservedDate, templateId: item.templateId }));
        const preservesAllocation = (template: SessionTemplate): boolean => {
            const candidateDose = resolveTimeCapDoseAdjustment(
                template,
                evaluation.availability.maxTimeMinutes,
                fatigueTier === 'modify',
            )?.activeDose;
            const evaluator = allocationEvaluator(
                forecastDatesFrom(offset + 1),
                [{ date, templateId: template.id, ...(candidateDose ? { activeDose: candidateDose } : {}) }],
            );
            if (allocationSurvives(incumbentAssignments, evaluator)) return true;
            const selfFulfils = occurrenceForTemplate(pendingOccurrences, template).length > 0 ? 1 : 0;
            const after = resolveWeeklyRoleReservations(
                pendingOccurrences.filter(occurrence => occurrenceForTemplate([occurrence], template).length === 0),
                evaluator,
                { nominatedDates },
            );
            return !after.budgetExhausted && after.fulfilledCount + selfFulfils >= allocation.fulfilledCount;
        };
        const viabilityApplies = fatigueTier !== 'recover' && allocation.fulfilledCount > 0 && ranked.length > 1;
        const pick = (viabilityApplies
            ? ranked.slice(0, WEEKLY_ALLOCATION_SEARCH_BUDGET.maxCandidatesPerOccurrence)
                .find(candidate => preservesAllocation(candidate.template))
            : undefined)
            ?? ranked[0] ?? fallbackPick;

        const bestBenefit = [...(ranked.length > 0 ? ranked : [{ template: restFallback, benefitScore: 0 }])].sort((a, b) => b.benefitScore - a.benefitScore)[0];
        const forecastDoseAdjustment = resolveTimeCapDoseAdjustment(pick.template, evaluation.availability.maxTimeMinutes, fatigueTier === 'modify');
        const forecastActiveDose = forecastDoseAdjustment?.activeDose;
        const pickCredits = creditingObjectivesFor(pick.template, forecastActiveDose);
        const addressed = pickCredits.map(item => item.objective.title);
        applyPick(date, pick.template, forecastActiveDose, pickCredits);
        applyFixedActivityCost(date);
        applyScheduleOverlayCost(date);

        const fulfilledKeys = new Set<string>();
        occurrenceForTemplate(pendingOccurrences, pick.template)
            .sort((left, right) => left.coverageKey.localeCompare(right.coverageKey) || left.ordinal - right.ordinal)
            .forEach(occurrence => {
                if (fulfilledKeys.has(occurrence.coverageKey)) return;
                fulfilledKeys.add(occurrence.coverageKey);
                const nominated = nominatedDates.get(occurrence.id) ?? null;
                const prior = allocation.outcomes.find(outcome => outcome.occurrence.id === occurrence.id);
                settledOutcomes.set(occurrence.id, {
                    occurrence,
                    reservation: {
                        occurrenceId: occurrence.id,
                        nominatedDate: nominated,
                        assignedDate: date,
                        templateId: pick.template.id,
                        workoutId: workoutIdForTemplateId(pick.template.id) ?? null,
                        wasMoved: nominated !== null && nominated !== date,
                    },
                    status: 'fulfilled',
                    ...(prior?.observedBlockers ? { observedBlockers: prior.observedBlockers } : {}),
                });
            });

        if (reservation && !settledOutcomes.has(reservation.occurrence.id)) {
            displacementReasons.set(
                reservation.occurrence.id,
                exactReserved.length === 0
                    ? (fatigueTier === 'recover' ? 'hard_safety_or_recovery' : fatigueTier === 'modify' ? 'projected_fatigue' : 'hard_safety_or_recovery')
                    : 'no_conflict_free_date',
            );
        }

        const forecastRationale = forecastDoseAdjustment ? `${pick.rationale} ${forecastDoseAdjustment.adjustment.rationale}` : pick.rationale;

        resultDays.push({
            date,
            dayOffset: offset,
            confidence: 'projected',
            phaseName: periodization.phase.phaseName,
            template: pick.template,
            mode: displayModeFromCategory(pick.template.category),
            rationale: forecastRationale,
            addressesObjectives: addressed,
            ...(forecastDoseAdjustment ? { activeDose: forecastDoseAdjustment.activeDose, adjustment: forecastDoseAdjustment.adjustment } : {}),
            diagnostics: {
                peakFatigue,
                fatigueTier,
                topUtilityScore: pick.utilityScore,
                runnerUpUtilityScore: ranked[1]?.utilityScore ?? null,
                selectedBenefitScore: pick.benefitScore,
                selectedCostPenalty: pick.costPenalty,
                bestBenefitTemplateId: bestBenefit.template.id,
                bestBenefitScore: bestBenefit.benefitScore,
                fatigue: rankingFatigue,
                activeObjectives: microcycle.objectives.map(objective => ({
                    key: objective.key,
                    completedCredit: objective.completedCredit ?? objective.completedExposures,
                    projectedCredit: objective.projectedCredit ?? 0,
                    requiredCredit: objective.requiredCredit ?? objective.targetExposures,
                })),
                contributorObjectiveChanges: {
                    added: microcycle.objectives.filter(objective => !priorObjectiveIds.has(objective.id)).map(objective => objective.key),
                    dropped: reconciled.droppedContributorObjectives
                        .filter(objective => objective.date === date)
                        .map(objective => objective.objectiveKey),
                },
                fixedActivity: fixedActivityTraceForDate(getFixedActivitiesForDate(date), date),
                rejectionCounts: rejectionCountsFor(evaluation),
            },
        });
    };

    for (let offset = resultDays.length + 1; offset <= totalDays; offset++) {
        evaluateForecastDate(offset);
    }

    const finalOutcomes: WeeklyRoleAllocationOutcome[] = allocationOccurrences.map(occurrence => {
        const settled = settledOutcomes.get(occurrence.id);
        if (settled) return settled;
        const latest = allocation.outcomes.find(outcome => outcome.occurrence.id === occurrence.id);
        if (!latest) {
            return {
                occurrence,
                reservation: {
                    occurrenceId: occurrence.id,
                    nominatedDate: nominatedDates.get(occurrence.id) ?? null,
                    assignedDate: null, templateId: null, workoutId: null, wasMoved: false,
                },
                status: 'unresolved_search_budget' as const,
            };
        }
        if (latest.status !== 'reserved') return latest;
        const reason = displacementReasons.get(occurrence.id);
        const reservation = { ...latest.reservation, assignedDate: null, templateId: null, workoutId: null };
        return reason
            ? { ...latest, reservation, status: 'missed' as const, reason }
            : { ...latest, reservation, status: 'unresolved_search_budget' as const };
    });

    return {
        startDate: addDaysToLocalDateString(todayDate, 1),
        days: resultDays,
        objectiveCredits,
        microcycleObjectives: microcycle.objectives ?? [],
        droppedContributorObjectives,
        allocationReport: {
            outcomes: finalOutcomes.sort((left, right) => left.occurrence.id.localeCompare(right.occurrence.id)),
        },
    };
}

export async function generateWeekAheadPlanWithIntent(
    userId: string,
    todayReadiness: DailyReadiness,
    context: UserContext,
    preferences: UserPreferences | null,
    events: UserEvent[],
    todayDate: string,
    todayRec: Recommendation,
    tomorrowRec: Recommendation | null,
    options: WeekAheadOptions = {},
    historyProvider?: TrainingHistoryProvider,
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
    trainingIntentProfile: TrainingIntentProfile | null = null,
): Promise<WeekAheadPlan> {
    const fatigueFusionPolicy = options.fatigueFusionPolicy ?? 'max';
    const intent = await resolveTrainingIntent(userId, events, todayDate, todayReadiness, 7, historyProvider, preparedHistorySnapshot, options.authoredPlanBlocks, trainingIntentProfile, fatigueFusionPolicy);
    const isAdverseRecovery = isSevereAdverseRecoveryReadiness(todayReadiness, todayRec.mode);
    const evergreen = resolveEvergreenPlan(
        intent.planningContext, intent.periodization.phase, intent.history, intent.historySnapshot,
        preferences, context, todayDate, options.fixedActivities ?? [], options.days ?? 7,
        isAdverseRecovery, options.scheduleOverlays ?? [],
    );
    return generateWeekAheadPlan(
        todayReadiness,
        context,
        preferences,
        todayDate,
        todayRec,
        tomorrowRec,
        {
            microcycle: evergreen?.microcycle ?? intent.microcycle,
            fatigue: intent.fatigue,
            trailingHistory: trailingHistoryFromCompletedExposures(intent.history, todayDate),
            completedCoverageHistory: resolveCoverageHistory(intent.performedTrainingFacts, intent.history),
            droppedContributorObjectives: intent.droppedContributorObjectives,
        },
        { ...options, fatigueFusionPolicy, events: intent.planningContext.mode === 'event_directed' ? events : [], ...(evergreen ? { planDefinition: evergreen.planDefinition } : {}) },
    );
}
