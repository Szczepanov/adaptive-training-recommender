import type {
    DailyReadiness,
    DimensionalFatigue,
    FatigueState,
    FixedActivity,
    MicrocycleState,
    Recommendation,
    SessionHistoryEntry,
    SessionRole,
    SessionTemplate,
    UserContext,
    UserEvent,
    UserPreferences,
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
import { resolveAvailability } from './schedule';
import { isTemplatePhaseEligible, evaluatePeriodizationPhase, resolveMultiEventObjectives, type DroppedContributorObjective, type PeriodizationResult } from './periodization';
import { eligibleTemplates } from './eligibility';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import {
    createEmptyFatigue,
    applyCompletedSessionLoad,
    buildFatigueStateFromHistory,
    computeInternalResponseStrain,
    decayFatigue,
} from './fatigue';
import {
    buildMicrocycleState,
    creditObjectivesFromStimulus,
    generateWeeklyObjectives,
    getUnresolvedObjectives,
    projectCompatibilityExposures,
} from './microcycle';
import {
    type RecentHistoryEntry,
    ANCHOR_HISTORY_CATEGORIES,
    buildOptimizationContext,
    candidateMatchesAnchorRole,
    rankCandidates,
    resolveRecoveryStyle,
} from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveMinimumDaysAfterHardLowerBody } from './planningCandidate';
import { resolvePlannedDoseForDate, resolveTrainingIntent } from './trainingIntent';
import { resolvePlanDefinitionForEvent } from './planSchedule';
import { deriveObjectiveCreditFromProfile } from './stimulus';
import { coverageNeedTierForTemplate } from './coverage';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { resolveFixedActivityIdentity } from './fixedActivityIdentity';

export interface WeekAheadDay {
    date: string;
    dayOffset: number;
    confidence: 'provisional' | 'projected';
    phaseName: string;
    template: SessionTemplate;
    mode: 'train' | 'recover';
    rationale: string;
    addressesObjectives: string[];
    diagnostics?: {
        peakFatigue: number;
        fatigueTier: 'train' | 'modify' | 'recover';
        topUtilityScore: number;
        runnerUpUtilityScore: number | null;
        selectedBenefitScore: number;
        selectedCostPenalty: number;
        bestBenefitTemplateId: string;
        bestBenefitScore: number;
    };
}

export interface WeekAheadPlan {
    startDate: string;
    days: WeekAheadDay[];
    objectiveCredits: PlannedObjectiveCredit[];
    microcycleObjectives: WeeklyObjective[];
    droppedContributorObjectives: DroppedContributorObjective[];
}

export interface WeekAheadPlanSeed {
    microcycle: MicrocycleState;
    fatigue: FatigueState;
    trailingHistory?: (RecentHistoryEntry | SessionHistoryEntry)[];
    droppedContributorObjectives?: DroppedContributorObjective[];
}

export interface WeekAheadOptions {
    days?: number;
    events?: UserEvent[];
    fixedActivities?: FixedActivity[];
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

function combineMax(a: DimensionalFatigue, b: DimensionalFatigue): DimensionalFatigue {
    return {
        systemic: Math.max(a.systemic, b.systemic),
        cardiovascular: Math.max(a.cardiovascular, b.cardiovascular),
        lowerBody: Math.max(a.lowerBody, b.lowerBody),
        upperBody: Math.max(a.upperBody, b.upperBody),
        impactTissue: Math.max(a.impactTissue, b.impactTissue),
        neuromuscular: Math.max(a.neuromuscular, b.neuromuscular),
    };
}

export function projectFatigueForRankingDate(
    externalFatigue: FatigueState,
    internalStrain: DimensionalFatigue,
    internalStrainAsOf: string,
    date: string,
): FatigueState {
    const externalHours = Math.max(0, getDayDiff(date, externalFatigue.lastUpdatedDate) * 24);
    const internalHours = Math.max(0, getDayDiff(date, internalStrainAsOf) * 24);
    const decayedExternal = decayFatigue(externalFatigue.externalLoadFatigue, externalHours);
    const decayedInternal = decayFatigue(internalStrain, internalHours);
    return {
        lastUpdatedDate: date,
        externalLoadFatigue: decayedExternal,
        internalResponseStrain: decayedInternal,
        combinedFatigue: combineMax(decayedExternal, decayedInternal),
    };
}

export const PROJECTED_FATIGUE_RECOVER_THRESHOLD = 0.65;
export const PROJECTED_FATIGUE_MODIFY_THRESHOLD = 0.6;
export const PROJECTED_MODIFY_MAX_SYSTEMIC_COST = 0.5;

export function maxFatigueDimension(fatigue: DimensionalFatigue): number {
    return Math.max(
        fatigue.systemic, fatigue.cardiovascular, fatigue.lowerBody,
        fatigue.upperBody, fatigue.impactTissue, fatigue.neuromuscular
    );
}

export function fatigueTierFor(peakFatigue: number): 'train' | 'modify' | 'recover' {
    if (peakFatigue >= PROJECTED_FATIGUE_RECOVER_THRESHOLD) return 'recover';
    if (peakFatigue >= PROJECTED_FATIGUE_MODIFY_THRESHOLD) return 'modify';
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
    return ENRICHED_TEMPLATES.find(t => t.id === templateId)?.costProfile ?? ZERO_COST;
}

export function enrichedStimulusProfile(template: SessionTemplate): WorkoutStimulusProfile {
    return template.stimulusProfile ?? ENRICHED_TEMPLATES.find(t => t.id === template.id)?.stimulusProfile ?? ZERO_STIMULUS;
}

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

export function resolveWeeklyAnchors(
    todayDate: string,
    totalDays: number,
    events: UserEvent[],
    fixedActivities: FixedActivity[],
    context: UserContext,
    tomorrowCategory?: SessionTemplate['category'],
    tomorrowModality?: SessionTemplate['modality']
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
        maxTimeMinutes: number;
        periodization: ReturnType<typeof evaluatePeriodizationPhase>;
    }
    const dayInfo: AnchorDayInfo[] = [];
    for (let offset = 2; offset <= totalDays; offset++) {
        const date = addDaysToLocalDateString(todayDate, offset);
        const periodization = evaluatePeriodizationPhase(events, date);
        if (!periodization.focusEvent) continue;
        const availability = resolveAvailability(date, null, fixedActivities, context);
        dayInfo.push({ date, offset, maxTimeMinutes: availability.maxTimeMinutes, periodization });
    }

    const largestByTime = (pool: typeof dayInfo) =>
        pool.reduce((best, d) => (d.maxTimeMinutes > best.maxTimeMinutes ? d : best), pool[0]);

    if (!eventSpecificAnchorDate && dayInfo.length > 0) {
        const farEnoughFromQuality = (d: AnchorDayInfo) => {
            if (!qualityAnchorDate) return true;
            const qualityOffset = qualityAnchorDate === tomorrowDate ? 1 : (dayInfo.find(di => di.date === qualityAnchorDate)?.offset ?? 0);
            return Math.abs(d.offset - qualityOffset) >= QUALITY_ANCHOR_MIN_GAP_DAYS;
        };
        const eventSpecificPool = dayInfo.filter(d =>
            farEnoughFromQuality(d) &&
            eligibleTemplates(raceSpecificTemplates, context, d.maxTimeMinutes, d.date).some(t => isTemplatePhaseEligible(t, d.periodization))
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
        const fitsQuality = (d: AnchorDayInfo) => eligibleTemplates(qualityTemplates, context, d.maxTimeMinutes, d.date).length > 0;
        const qualityPool = remaining.filter(d => farEnough(d) && fitsQuality(d));
        if (qualityPool.length > 0) qualityAnchorDate = largestByTime(qualityPool).date;
    }

    return { eventSpecificAnchorDate, qualityAnchorDate };
}

export function projectTrailingHistory(
    history: (RecentHistoryEntry | SessionHistoryEntry)[]
): (RecentHistoryEntry | SessionHistoryEntry)[] {
    return history.map(e => {
        const completedDate = 'completedDate' in e && typeof e.completedDate === 'string' ? e.completedDate : undefined;
        const rec = e as Record<string, unknown>;
        const recordType = rec.trainingRecordLike && typeof rec.trainingRecordLike === 'object' && 'type' in (rec.trainingRecordLike as object) ? (rec.trainingRecordLike as { type?: string }).type : undefined;
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
        });
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
    creditMemory: Map<WeeklyObjective['key'], ObjectiveCreditSnapshot>,
    priorExposures: readonly ProjectionExposure[] = [],
): { microcycle: MicrocycleState; droppedContributorObjectives: DroppedContributorObjective[] } {
    const planDefinitionForDate = resolvePlanDefinitionForEvent(periodization.focusEvent);
    const skeleton = generateWeeklyObjectives(periodization.phase, todayDate, periodization.focusEvent, planDefinitionForDate, date);
    const fresh = resolveMultiEventObjectives(events, date, periodization, skeleton.objectives);

    const existingByKey = new Map(microcycle.objectives.map(objective => [objective.key, objective]));
    const freshKeys = new Set(fresh.objectives.map(objective => objective.key));

    microcycle.objectives.forEach(objective => {
        if (!freshKeys.has(objective.key)) creditMemory.set(objective.key, snapshotObjectiveCredit(objective));
    });

    const objectives = fresh.objectives.map(definition => {
        const existing = existingByKey.get(definition.key);
        const carried = existing ? snapshotObjectiveCredit(existing) : creditMemory.get(definition.key);
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

/**
 * A fixed activity may reserve time/cost without exact identity. Objective credit is more
 * demanding: expectedStimulus earns credit only when templateId/workoutId resolve to one
 * exact catalog prescription. This prevents both under-attribution of known cycling work
 * and over-attribution of untyped football/general activity to unqualified aerobic axes.
 */
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
        exposures.push({
            occurrenceKey: identity.occurrenceKey,
            date,
            stimulus,
            templateId: identity.templateId,
            workoutId: identity.workoutId,
            modality: identity.modality,
            category: identity.category,
        });

        const derivedCredits = getUnresolvedObjectives(nextMicrocycle, true).flatMap(objective => {
            const credit = deriveObjectiveCreditFromProfile(objective, stimulus, {}, {
                modality: identity.modality,
                category: identity.category,
            });
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
    return dayActivities.reduce((sum, activity) => {
        const cost = activity.expectedCost;
        if (!cost) return sum;
        return {
            systemic: sum.systemic + (cost.systemic ?? 0),
            cardiovascular: sum.cardiovascular + (cost.cardiovascular ?? 0),
            lowerBody: sum.lowerBody + (cost.lowerBody ?? 0),
            upperBody: sum.upperBody + (cost.upperBody ?? 0),
            impactTissue: sum.impactTissue + (cost.impactTissue ?? 0),
            neuromuscular: sum.neuromuscular + (cost.neuromuscular ?? 0),
        };
    }, ZERO_COST);
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
    void todayReadiness;
    const totalDays = Math.max(1, options.days ?? 7);
    const events = options.events ?? [];
    const fixedActivities = options.fixedActivities ?? [];
    const effectivePreferences = preferences ?? { ...NEUTRAL_PREFERENCES, preferredRecoveryStyle: resolveRecoveryStyle(context) };

    const periodizationToday = evaluatePeriodizationPhase(events, todayDate);
    let microcycle: MicrocycleState = seed.microcycle ?? generateWeeklyObjectives(periodizationToday.phase, todayDate, periodizationToday.focusEvent);
    const internalStrain: DimensionalFatigue = seed.fatigue?.internalResponseStrain ?? { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
    const internalStrainAsOf = todayDate;
    let externalFatigue: FatigueState = seed.fatigue?.externalLoadFatigue ? seed.fatigue : createEmptyFatigue(todayDate);

    const resultDays: WeekAheadDay[] = [];
    const objectiveCredits: PlannedObjectiveCredit[] = [];
    const anchors = resolveWeeklyAnchors(todayDate, totalDays, events, fixedActivities, context, tomorrowRec?.template.category, tomorrowRec?.template.modality);
    const beganAfterHardRaceSpecificExposure = todayRec.mode === 'recover' && (seed.trailingHistory ?? []).some(entry =>
        entry.date === addDaysToLocalDateString(todayDate, -1)
        && entry.category === 'Race-Specific Endurance'
        && (entry.systemicCost ?? 0) >= PROJECTED_MODIFY_MAX_SYSTEMIC_COST
    );

    const creditMemory = new Map<WeeklyObjective['key'], ObjectiveCreditSnapshot>();
    const droppedContributorObjectives: DroppedContributorObjective[] = [...(seed.droppedContributorObjectives ?? [])];
    const currentlyDroppedPairs = new Set<string>(
        droppedContributorObjectives.map(d => `${d.eventId}:${d.objectiveKey}`)
    );
    const projectionExposures: ProjectionExposure[] = [];
    const appliedProjectionOccurrences = new Set<string>();
    const appliedFixedCostOccurrences = new Set<string>();

    type DerivedPlanningCredit = {
        objective: WeeklyObjective;
        earnedCredit: number;
    };

    const creditingObjectivesFor = (template: SessionTemplate): DerivedPlanningCredit[] => {
        const stimulus = enrichedStimulusProfile(template);
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
        derivedCredits: DerivedPlanningCredit[] = creditingObjectivesFor(template),
    ) => {
        const occurrenceKey = `recommendation:${date}`;
        if (appliedProjectionOccurrences.has(occurrenceKey)) return;
        appliedProjectionOccurrences.add(occurrenceKey);

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
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, enrichedCostProfile(template.id));
        projectionExposures.push({
            occurrenceKey,
            date,
            stimulus: enrichedStimulusProfile(template),
            templateId: template.id,
            modality: template.modality,
            category: template.category,
        });
    };

    const applyFixedActivityStimulus = (date: string) => {
        const result = applyFixedActivityStimulusCredit(microcycle, fixedActivities, date);
        const freshExposures = result.exposures.filter(exposure => !appliedProjectionOccurrences.has(exposure.occurrenceKey));
        if (freshExposures.length === 0) return;
        freshExposures.forEach(exposure => appliedProjectionOccurrences.add(exposure.occurrenceKey));
        // applyFixedActivityStimulusCredit already dedupes within the date and returns the
        // microcycle after exactly those identities were credited. Because this helper is
        // called once per date in the greedy path, taking its state is safe and idempotent.
        microcycle = result.microcycle;
        objectiveCredits.push(...result.credits);
        projectionExposures.push(...freshExposures);
    };

    const applyFixedActivityCost = (date: string) => {
        const dayActivities = fixedActivities.filter(a => a.date === date && !a.isCompleted && a.expectedCost);
        const freshActivities = dayActivities.filter(activity => {
            const key = `fixed:${activity.id}:cost`;
            if (appliedFixedCostOccurrences.has(key)) return false;
            appliedFixedCostOccurrences.add(key);
            return true;
        });
        if (freshActivities.length === 0) return;
        const costProfile = fixedActivityCostProfileForDate(freshActivities, date);
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, costProfile);
    };

    applyFixedActivityStimulus(todayDate);
    applyPick(todayDate, todayRec.template);
    applyFixedActivityCost(todayDate);

    if (tomorrowRec) {
        const tomorrowDate = addDaysToLocalDateString(todayDate, 1);
        const tomorrowPeriodization = evaluatePeriodizationPhase(events, tomorrowDate);
        const tomorrowReconciled = reconcileObjectivesForDate(microcycle, events, tomorrowDate, todayDate, tomorrowPeriodization, creditMemory, projectionExposures);
        microcycle = tomorrowReconciled.microcycle;
        accumulateNewDrops(droppedContributorObjectives, currentlyDroppedPairs, tomorrowReconciled.droppedContributorObjectives);
        applyFixedActivityStimulus(tomorrowDate);
        const tomorrowCredits = creditingObjectivesFor(tomorrowRec.template);
        resultDays.push({
            date: tomorrowDate,
            dayOffset: 1,
            confidence: 'provisional',
            phaseName: tomorrowPeriodization.phase.phaseName,
            template: tomorrowRec.template,
            mode: tomorrowRec.mode === 'recover' ? 'recover' : 'train',
            rationale: tomorrowRec.rationale,
            addressesObjectives: tomorrowCredits.map(item => item.objective.title),
        });
        applyPick(tomorrowDate, tomorrowRec.template, tomorrowCredits);
        applyFixedActivityCost(tomorrowDate);
    }

    for (let offset = resultDays.length + 1; offset <= totalDays; offset++) {
        const date = addDaysToLocalDateString(todayDate, offset);
        const periodization = evaluatePeriodizationPhase(events, date);
        const availability = resolveAvailability(date, null, fixedActivities, context);

        const reconciled = reconcileObjectivesForDate(microcycle, events, date, todayDate, periodization, creditMemory, projectionExposures);
        microcycle = reconciled.microcycle;
        accumulateNewDrops(droppedContributorObjectives, currentlyDroppedPairs, reconciled.droppedContributorObjectives);
        applyFixedActivityStimulus(date);

        const rankingFatigue = projectFatigueForRankingDate(
            externalFatigue,
            internalStrain,
            internalStrainAsOf,
            date,
        );
        const rankingFatigueForDate: FatigueState = applyCompletedSessionLoad(
            rankingFatigue,
            date,
            availability.reservedCapacityCostProfile,
        );

        const unresolved = getUnresolvedObjectives(microcycle, true);
        const eligible = eligibleTemplates(ENRICHED_TEMPLATES, context, availability.maxTimeMinutes, date)
            .filter(t => isTemplatePhaseEligible(t, periodization))
            .filter(t => !availability.environmentOverride || t.environment === 'either' || t.environment === availability.environmentOverride);

        const peakFatigue = maxFatigueDimension(rankingFatigueForDate.combinedFatigue);
        const fatigueGated = eligible.filter(t => {
            if (peakFatigue >= PROJECTED_FATIGUE_RECOVER_THRESHOLD) {
                return t.category === 'Rest' || t.category === 'Mobility/Recovery';
            }
            if (peakFatigue >= PROJECTED_FATIGUE_MODIFY_THRESHOLD) {
                return t.systemicCost <= PROJECTED_MODIFY_MAX_SYSTEMIC_COST;
            }
            return true;
        });

        const anchorRole = date === anchors.eventSpecificAnchorDate ? 'event-specific'
            : date === anchors.qualityAnchorDate ? 'quality' : null;
        const adjacentToAnchor = isAdjacentDate(date, anchors.eventSpecificAnchorDate)
            || isAdjacentDate(date, anchors.qualityAnchorDate);

        const projectedHistory: (RecentHistoryEntry | SessionHistoryEntry)[] = [
            ...(seed.trailingHistory ?? []),
            {
                date: todayDate,
                templateId: todayRec.template.id,
                category: todayRec.template.category,
                modality: todayRec.template.modality,
                role: realizedSessionRole(todayDate, todayRec.template, anchors),
                systemicCost: todayRec.template.systemicCost,
                lowerBodyCost: todayRec.template.costProfile?.lowerBody ?? 0,
                type: todayRec.template.title,
            },
            ...resultDays.map(d => ({
                date: d.date,
                templateId: d.template.id,
                category: d.template.category,
                modality: d.template.modality,
                role: realizedSessionRole(d.date, d.template, anchors),
                systemicCost: d.template.systemicCost,
                lowerBodyCost: d.template.costProfile?.lowerBody ?? 0,
                type: d.template.title,
            })),
        ];

        const planDefinition = resolvePlanDefinitionForEvent(periodization.focusEvent);
        const optContext = buildOptimizationContext(
            {
                unresolvedObjectives: unresolved,
                fatigue: rankingFatigueForDate,
                periodization,
                history: projectedHistory,
                plannedDose: resolvePlannedDoseForDate(
                    periodization.phase,
                    microcycle.objectives,
                    unresolved,
                    planDefinition,
                    date,
                ),
            },
            context,
            effectivePreferences,
            date,
            { anchorRole, adjacentToAnchor, resolveMinimumDaysAfterHardLowerBody, fatigueTier: fatigueTierFor(peakFatigue) },
            fixedActivities,
        );

        // If a required developmental role is temporarily excluded by the projected
        // fatigue ceiling, do not spend the recovery opportunity on unrelated work.
        // A rest/recovery pick lets the greedy horizon reconsider that exact role on a
        // later, safer date instead of silently losing it after its pre-pass anchor.
        const hasFatigueGatedRequiredCoverage = beganAfterHardRaceSpecificExposure && anchorRole === 'event-specific' && eligible.some(template =>
            !fatigueGated.includes(template)
            && (template.category === 'Race-Specific Endurance'
                || template.category === 'Hard Endurance'
                || template.category === 'Moderate Endurance')
            && coverageNeedTierForTemplate(optContext.coverageState, template, anchorRole) <= 1
        );
        const rankingCandidates = hasFatigueGatedRequiredCoverage
            ? fatigueGated.filter(template => template.category === 'Rest' || template.category === 'Mobility/Recovery')
            : fatigueGated;

        const rankingResult = rankCandidates(
            rankingCandidates,
            optContext.unresolvedObjectives,
            optContext.fatigueState,
            optContext.availability,
            optContext.injuryConstraints,
            optContext.preferences,
            optContext.options
        );
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

        const pick = ranked[0] ?? {
            template: restFallback,
            utilityScore: 0,
            benefitScore: 0,
            costPenalty: 0,
            coverageNeedTier: 3 as const,
            rationale: 'Fallback rest day.',
        };

        const bestBenefit = [...(ranked.length > 0 ? ranked : [{ template: restFallback, benefitScore: 0 }])].sort((a, b) => b.benefitScore - a.benefitScore)[0];

        const pickCredits = creditingObjectivesFor(pick.template);
        const addressed = pickCredits.map(item => item.objective.title);
        applyPick(date, pick.template, pickCredits);
        applyFixedActivityCost(date);

        resultDays.push({
            date,
            dayOffset: offset,
            confidence: 'projected',
            phaseName: periodization.phase.phaseName,
            template: pick.template,
            mode: displayModeFromCategory(pick.template.category),
            rationale: pick.rationale,
            addressesObjectives: addressed,
            diagnostics: {
                peakFatigue,
                fatigueTier: fatigueTierFor(peakFatigue),
                topUtilityScore: pick.utilityScore,
                runnerUpUtilityScore: ranked[1]?.utilityScore ?? null,
                selectedBenefitScore: pick.benefitScore,
                selectedCostPenalty: pick.costPenalty,
                bestBenefitTemplateId: bestBenefit.template.id,
                bestBenefitScore: bestBenefit.benefitScore,
            },
        });
    }

    return {
        startDate: addDaysToLocalDateString(todayDate, 1),
        days: resultDays,
        objectiveCredits,
        microcycleObjectives: microcycle.objectives ?? [],
        droppedContributorObjectives,
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
): Promise<WeekAheadPlan> {
    const intent = await resolveTrainingIntent(userId, events, todayDate, todayReadiness, 7, historyProvider, preparedHistorySnapshot);
    return generateWeekAheadPlan(
        todayReadiness,
        context,
        preferences,
        todayDate,
        todayRec,
        tomorrowRec,
        {
            microcycle: intent.microcycle,
            fatigue: intent.fatigue,
            trailingHistory: trailingHistoryFromCompletedExposures(intent.history, todayDate),
            droppedContributorObjectives: intent.droppedContributorObjectives,
        },
        { ...options, events },
    );
}
