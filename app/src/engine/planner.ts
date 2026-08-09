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
} from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveMinimumDaysAfterHardLowerBody } from './planningCandidate';
import { resolvePlannedDoseForDate, resolveTrainingIntent } from './trainingIntent';
import { resolvePlanDefinitionForEvent } from './planSchedule';
import { deriveObjectiveCreditFromProfile } from './stimulus';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';

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
    /** Phase 5.6 contributor objectives dropped because they fell inadmissible during the
     *  taper authority's taper window -- see periodization.ts resolveMultiEventObjectives
     *  and each entry's own athlete-facing `message`. Empty in the overwhelmingly common
     *  single-or-no-event case. */
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

/** Project both fatigue signals to the exact date that will be ranked. External load is
 * stored as-of the last applied/completed session date, so reusing it without decay makes
 * tomorrow inherit yesterday's post-session value and systematically overstates fatigue. */
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

/** Fatigue dimensions are capped at 1.0 and the slowest modeled half-life is 48 h
 * (impactTissue, lowerBody -- see DECAY_HALF_LIVES_HOURS). After the reviewed fix
 * correctly decays external load before the next day's ranking, even a fully saturated
 * 48h-half-life dimension can be at most 1.0 * 0.5^(24/48) ≈ 0.707 after one day, so the
 * previous 0.8 recovery ceiling was unreachable at the daily planning cadence.
 *
 * A prior revision set this to 0.625, reasoning it sat "just below the one-day residual
 * of a saturated 36 h dimension (~0.63)" -- but that residual is for the 36 h
 * half-life group (systemic/upperBody/neuromuscular), not the slower 48 h group this
 * comment itself identifies as the binding case. maxFatigueDimension takes the max
 * across all six dimensions, so impactTissue/lowerBody (48 h) are what actually decide
 * the ceiling in practice, and their true one-day saturated residual is ~0.707, not
 * ~0.63. Verified empirically: a single moderate running/cycling session plus one easy
 * day was enough to push impactTissue/lowerBody to ~0.70 and keep it pinned there for
 * most of a simulated month (additive per-session accumulation combined with the slow
 * decay rarely lets it clear 0.625 again), which is why the projected-day gate defaulted
 * to hard recovery-only far more often than a realistic training week warrants -- not
 * because the athlete was ever actually at genuinely saturated, back-to-back-hard load.
 *
 * 0.65 sits between the two half-life groups' saturated one-day residuals (0.63 for the
 * 36 h group, 0.707 for the 48 h group) -- close enough to the correct (48 h-group)
 * figure to still reserve recovery for dimensions genuinely near that ceiling, with a
 * real margin below it rather than the previous value's razor-thin (and, per the
 * arithmetic above, actually miscalibrated-low) gap. Chosen empirically against the
 * Phase 0 simulation harness: 0.70 (exactly at the boundary) reopened enough training
 * days to occasionally leave a whole week with zero rest/recovery days at all (breaking
 * the "at least one rest day per week" invariant goldenWeek.test.ts/scenarios.test.ts
 * already assert); 0.625 (the prior value) fires on ordinary single-session fatigue and
 * drives the aggregate rest/recovery share well past the 40% ceiling. 0.65 keeps the
 * aggregate simulation-scenario rest/recovery share comfortably inside the documented
 * [5%, 40%] bound (~27% measured) while every scenario still clears at least one
 * rest/recovery day. 0.6 remains the modify boundary. */
export const PROJECTED_FATIGUE_RECOVER_THRESHOLD = 0.65;
export const PROJECTED_FATIGUE_MODIFY_THRESHOLD = 0.6;
// Exported for reuse by sequenceSearch.ts's beam-search prototype (Phase 5.1) -- these
// three are pure, stable helpers with no state of their own; exporting them keeps one
// source of truth instead of a second copy of the fatigue-tier gating logic.
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

/**
 * Forecast-only ledger mutation. Existing completed evidence is normalized into
 * completedCredit once when a legacy-only seed still carries only completedExposures;
 * future recommendations themselves accumulate exclusively in projectedCredit.
 * Subsequent projected days treat completed + projected credit as the outstanding-objective
 * authority.
 *
 * `completedExposures` remains a legacy/non-authoritative display projection. The exact
 * same fractional-credit-to-exposure projection is shared with the live ledger so a
 * forecast cannot display one full exposure for credit that the live path would still
 * show as partial.
 */
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

/** Role is derived from the realized session. A nominated date only becomes an anchor
 * when the pick actually fulfils its nominated Cycling role; otherwise the session keeps
 * whatever intrinsic role its own category carries. */
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
    /** Both the event-specific and quality anchor mechanisms are deliberately scoped to
     *  Cycling only (same athlete/event-specific progression they were built for -- see
     *  ANCHOR_ROLE_BOOST in optimizer.ts). Without this, a Running Hard/Moderate
     *  Endurance day tomorrow would get treated as a Cycling quality anchor and could
     *  suppress selection of the real Cycling anchor elsewhere in the week. */
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
        if (eventSpecificPool.length > 0) {
            eventSpecificAnchorDate = largestByTime(eventSpecificPool).date;
        }
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
        if (qualityPool.length > 0) {
            qualityAnchorDate = largestByTime(qualityPool).date;
        }
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

/** Shared `CompletedExposure[]` -> trailing-history projection for `resolveTrainingIntent`
 *  callers. Used by both the live greedy entry point (`generateWeekAheadPlanWithIntent`
 *  below) and the beam-search comparison entry point
 *  (`sequenceSearch.ts`'s `generateWeekAheadPlanWithIntentBeamSearch`) so ADR-0015's
 *  comparison stays apples-to-apples -- if this mapping ever drifted between the two call
 *  sites, the comparison would silently stop being fair. */
export function trailingHistoryFromCompletedExposures(
    history: CompletedExposure[],
    todayDate: string
): RecentHistoryEntry[] {
    return history.map(e => ({
        date: ('completedDate' in e && typeof e.completedDate === 'string' ? e.completedDate : 'date' in e && typeof e.date === 'string' ? e.date : todayDate),
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
        // Phase 5.6: one taper authority (periodization.focusEvent, already resolved by
        // evaluatePeriodizationPhase's total order above), multiple demand contributors.
        // A no-op for the common single-or-no-event case (nothing else in `events` falls
        // in another event's contribution window).
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
    // Phase 5.6: see the completed-history branch above for the same wiring.
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

/** Phase 6.2a follow-up (D6-A): one already-applied pick or fixed-activity stimulus,
 *  dated, kept around so a LATER-admitted objective can be checked against days that
 *  already happened earlier in this same projection -- see backfillCreditFromPriorExposures. */
export interface ProjectionExposure {
    date: string;
    stimulus: WorkoutStimulusProfile;
    modality?: SessionTemplate['modality'];
    category?: SessionTemplate['category'];
}

/**
 * Phase 6.2a follow-up: `reconcileObjectivesForDate`'s "Generating the week on day 1 and
 * inspecting day N yields the same objective admissibility as generating a fresh plan on
 * day N" contract requires more than starting a newly-admitted key at zero -- a fresh
 * build on day N replays real completed history through the objective, so an equivalent
 * projected history (this run's own earlier picks/fixed-activity stimuli) must be replayed
 * too. Sums how much credit `priorExposures` would earn against `definition` via the same
 * canonical credit primitive used everywhere else, capped at the objective's own required
 * amount. Confidence is 'exact' (the default) throughout -- every exposure here is this
 * run's own first-party pick or authored fixed-activity stimulus, not external evidence. */
function backfillCreditFromPriorExposures(
    definition: WeeklyObjective,
    priorExposures: readonly ProjectionExposure[],
): number {
    const requiredCredit = definition.requiredCredit ?? definition.targetExposures;
    let total = 0;
    for (const exposure of priorExposures) {
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

/**
 * Phase 6.2a / D6-A: re-resolves which objectives are admissible for `date` from scratch --
 * mirroring resolveTrainingIntent's own construction (generic-vs-plan-derived branching via
 * generateWeeklyObjectives, then resolveMultiEventObjectives for contributors) -- instead of
 * carrying the `todayDate`-seeded set unchanged through the whole horizon (the gap
 * planner.ts's per-day loop used to document but not fix).
 *
 * The credit LEDGER (completedCredit/projectedCredit/completedExposures) is never
 * recomputed from history here -- only the objective DEFINITION (title, qualification,
 * targetStimulus, priority, requiredCredit, window) is refreshed, then the existing
 * ledger is carried onto it by `ObjectiveKey`, never by generated id (ids are an
 * implementation detail -- see periodization.ts's own comment on this). A key that drops
 * out has its last known credit remembered in `creditMemory` so a later re-entry within
 * the SAME projection restores it instead of restarting at zero; a key this projection has
 * never seen starts at zero, same as generating fresh.
 */
export function reconcileObjectivesForDate(
    microcycle: MicrocycleState,
    events: UserEvent[],
    date: string,
    todayDate: string,
    periodization: PeriodizationResult,
    creditMemory: Map<WeeklyObjective['key'], ObjectiveCreditSnapshot>,
    priorExposures: readonly ProjectionExposure[] = [],
): { microcycle: MicrocycleState; droppedContributorObjectives: DroppedContributorObjective[] } {
    // Phase 5's own scope boundary: only the generic days-to-event objective set gains
    // contributor demand (see resolveMultiEventObjectives's doc comment); generateWeeklyObjectives
    // already branches to the plan-derived block schedule when one is authored for this event.
    const planDefinitionForDate = resolvePlanDefinitionForEvent(periodization.focusEvent);
    const skeleton = generateWeeklyObjectives(periodization.phase, todayDate, periodization.focusEvent, planDefinitionForDate, date);
    const fresh = resolveMultiEventObjectives(events, date, periodization, skeleton.objectives);

    const existingByKey = new Map(microcycle.objectives.map(objective => [objective.key, objective]));
    const freshKeys = new Set(fresh.objectives.map(objective => objective.key));

    // Objectives no longer admissible today: remember their credit before they're dropped
    // from the live set, so a later re-entry this same projection can restore it (D6-A).
    microcycle.objectives.forEach(objective => {
        if (!freshKeys.has(objective.key)) {
            creditMemory.set(objective.key, snapshotObjectiveCredit(objective));
        }
    });

    const objectives = fresh.objectives.map(definition => {
        const existing = existingByKey.get(definition.key);
        const carried = existing ? snapshotObjectiveCredit(existing) : creditMemory.get(definition.key);
        if (carried) return { ...definition, ...carried };

        // A key genuinely new to this projection: check whether an earlier day's pick or
        // fixed-activity stimulus already qualifies for it, rather than assuming zero (see
        // backfillCreditFromPriorExposures's doc comment for why this is required, not an
        // enhancement).
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
 * Phase 6.2b / D6-C: credits `date`'s uncompleted fixed activities' `expectedStimulus`, if
 * any, against currently-unresolved objectives through the same canonical credit primitive
 * as a structured exposure (`deriveObjectiveCreditFromProfile`). Pure -- returns the
 * updated microcycle rather than mutating anything, so both `generateWeekAheadPlan`'s
 * multi-day loop and a single-day live evaluation (rules.ts) can share it.
 *
 * Callers MUST apply this before that day's own ranking/pick, not after -- crediting it
 * only afterward (an earlier revision's bug) meant a booked evening session that already
 * satisfied e.g. `strength_maintenance` could not stop the optimizer from separately
 * prescribing more work for that same still-"unresolved" objective, only marking it
 * resolved after both had already been scheduled.
 *
 * A missing `expectedStimulus` contributes zero, never an invented default. A
 * `FixedActivity` carries no `SessionTemplate.modality`, so a modality-scoped objective
 * correctly fails closed here exactly as it would for any other exposure of unknown
 * modality (stimulus.ts). Completed activities are skipped: their load already reached the
 * athlete's real completed-training ledger elsewhere, so crediting them again here would
 * double it.
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

    dayActivities.forEach(activity => {
        const stimulus: WorkoutStimulusProfile = { ...ZERO_STIMULUS, ...activity.expectedStimulus };
        exposures.push({ date, stimulus, modality: undefined, category: undefined });

        const derivedCredits = getUnresolvedObjectives(nextMicrocycle, true).flatMap(objective => {
            const credit = deriveObjectiveCreditFromProfile(objective, stimulus);
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
                templateId: activity.id,
                templateTitle: activity.title,
                modality: 'None',
                earnedCredit: allocated,
            });
        });
        nextMicrocycle = projected.microcycle;
    });

    return { microcycle: nextMicrocycle, credits, exposures };
}

/** Phase 6.2b / D6-C: sums `date`'s uncompleted fixed activities' authored `expectedCost`
 *  -- never an invented default. Pure; callers apply the result to a fatigue state
 *  themselves (via `applyCompletedSessionLoad` for "this became real load", or folded
 *  transiently for "same-day ranking should see this reservation" -- see planner.ts's loop
 *  and rules.ts's `evaluateTrainingWithIntent` for the two use sites). */
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

/** Phase 6.2a: `resolveMultiEventObjectives` reports every currently-inadmissible
 *  contributor objective on every day it stays inadmissible, not just the day it first
 *  transitioned -- otherwise a 12-day taper would log the same drop reason a dozen times.
 *  Tracks which (eventId, objectiveKey) pairs are dropped *as of the last processed day* so
 *  only a genuine transition (admissible -> inadmissible) is appended to the trace; a pair
 *  that becomes admissible again and later drops once more is treated as a new transition. */
function accumulateNewDrops(
    accumulated: DroppedContributorObjective[],
    currentlyDropped: Set<string>,
    freshDrops: DroppedContributorObjective[],
): void {
    const dropKey = (d: DroppedContributorObjective) => `${d.eventId}:${d.objectiveKey}`;
    const freshKeys = new Set(freshDrops.map(dropKey));

    freshDrops.forEach(drop => {
        if (!currentlyDropped.has(dropKey(drop))) {
            accumulated.push(drop);
        }
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
    const effectivePreferences = preferences ?? NEUTRAL_PREFERENCES;

    const periodizationToday = evaluatePeriodizationPhase(events, todayDate);
    let microcycle: MicrocycleState = seed.microcycle ?? generateWeeklyObjectives(periodizationToday.phase, todayDate, periodizationToday.focusEvent);
    const internalStrain: DimensionalFatigue = seed.fatigue?.internalResponseStrain ?? { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
    const internalStrainAsOf = todayDate;
    let externalFatigue: FatigueState = seed.fatigue?.externalLoadFatigue ? seed.fatigue : createEmptyFatigue(todayDate);

    const resultDays: WeekAheadDay[] = [];
    const objectiveCredits: PlannedObjectiveCredit[] = [];

    const anchors = resolveWeeklyAnchors(todayDate, totalDays, events, fixedActivities, context, tomorrowRec?.template.category, tomorrowRec?.template.modality);

    // Phase 6.2a: per-key credit memory (see reconcileObjectivesForDate) and an
    // append-only drop trace seeded from the seed date's own resolution, deduped so a
    // taper that stays active for the whole horizon logs one dated entry, not one per day.
    const creditMemory = new Map<WeeklyObjective['key'], ObjectiveCreditSnapshot>();
    const droppedContributorObjectives: DroppedContributorObjective[] = [...(seed.droppedContributorObjectives ?? [])];
    const currentlyDroppedPairs = new Set<string>(
        droppedContributorObjectives.map(d => `${d.eventId}:${d.objectiveKey}`)
    );
    // Phase 6.2a follow-up: every pick's/fixed-activity's own stimulus, dated, so a
    // newly-admitted objective can be backfilled against earlier days in this same
    // projection -- see reconcileObjectivesForDate/backfillCreditFromPriorExposures.
    const projectionExposures: ProjectionExposure[] = [];

    type DerivedPlanningCredit = {
        objective: WeeklyObjective;
        earnedCredit: number;
    };

    // Template profiles are already canonical engine-owned data, so planner fan-out can
    // use the validated-profile credit primitive directly instead of reparsing/logging the
    // same profile once per objective.
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
            date,
            stimulus: enrichedStimulusProfile(template),
            modality: template.modality,
            category: template.category,
        });
    };

    // Stimulus credit before the pick (prevents redundant same-day work); cost after it
    // (becomes real load only once the day has actually happened) -- see
    // applyFixedActivityStimulusCredit's/fixedActivityCostProfileForDate's own doc comments
    // for why the order matters. Extracted to module level so rules.ts's single-day live
    // evaluation (`evaluateTrainingWithIntent`) can apply the identical treatment to
    // today's/tomorrow's own fixed activities, not just this multi-day forecast.
    const applyFixedActivityStimulus = (date: string) => {
        const result = applyFixedActivityStimulusCredit(microcycle, fixedActivities, date);
        microcycle = result.microcycle;
        objectiveCredits.push(...result.credits);
        projectionExposures.push(...result.exposures);
    };

    const applyFixedActivityCost = (date: string) => {
        const costProfile = fixedActivityCostProfileForDate(fixedActivities, date);
        const hasActivityToday = fixedActivities.some(a => a.date === date && !a.isCompleted);
        if (!hasActivityToday) return;
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, costProfile);
    };

    // Stimulus credit before the pick (prevents redundant same-day work); cost after it
    // (becomes real load only once the day has actually happened) -- see each function's
    // own doc comment for why the order matters.
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
        // Recomputed per day for template eligibility (isTemplatePhaseEligible below) and
        // fatigue/anchor logic. Phase 6.2a: the objective SET itself is now ALSO
        // re-resolved per day (reconcileObjectivesForDate below), rather than carrying the
        // `todayDate`-seeded set unchanged through the whole horizon -- a taper
        // authority/contributor window transition that falls strictly inside the horizon
        // (e.g. the authority enters its 14-day taper on day 3 of a 7-day plan) now changes
        // which objectives are admissible starting the day it actually happens, with
        // already-accrued credit for a still-relevant key carried forward rather than lost
        // (D6-A).
        const periodization = evaluatePeriodizationPhase(events, date);
        const availability = resolveAvailability(date, null, fixedActivities, context);

        const reconciled = reconcileObjectivesForDate(microcycle, events, date, todayDate, periodization, creditMemory, projectionExposures);
        microcycle = reconciled.microcycle;
        accumulateNewDrops(droppedContributorObjectives, currentlyDroppedPairs, reconciled.droppedContributorObjectives);

        // Phase 6.2b ordering fix: credit today's booked fixed activities BEFORE computing
        // `unresolved`/ranking below, not after picking -- otherwise an activity that
        // already satisfies an objective cannot stop the optimizer from separately ranking
        // and picking more work for that same still-"unresolved" objective (see
        // applyFixedActivityStimulus's own doc comment).
        applyFixedActivityStimulus(date);

        const rankingFatigue = projectFatigueForRankingDate(
            externalFatigue,
            internalStrain,
            internalStrainAsOf,
            date,
        );
        // Phase 6.2b: fold today's reserved (not-yet-happened) fixed-activity load into the
        // fatigue signal used for THIS DAY's ranking/gating only -- externalFatigue itself
        // (the carried-forward ledger) is untouched here (this result is never assigned
        // back to it), so this never marks the load as already completed before the
        // activity occurs (D6-B/6.2b item 2). Its cost only becomes real, carried-forward
        // load at the end of the day, via applyFixedActivityCost below.
        //
        // Reused via applyCompletedSessionLoad rather than combineMax(combinedFatigue,
        // reservedCost): the reservation is genuinely ADDITIONAL external load stacking on
        // top of whatever is already there, not an independent signal to take the max
        // against. max(existing, reserved) silently masks the reservation whenever
        // existing fatigue already exceeds it (e.g. max(0.6, 0.5) = 0.6, reserving no
        // extra capacity for a booked hard evening session) -- applyCompletedSessionLoad's
        // additive-then-clamped-then-max-with-internal-response semantics are exactly
        // right here, called with elapsedHours=0 (same date as rankingFatigue was already
        // decayed to) so it adds the reservation without any further decay.
        const rankingFatigueForDate: FatigueState = applyCompletedSessionLoad(
            rankingFatigue,
            date,
            availability.reservedCapacityCostProfile,
        );

        const unresolved = getUnresolvedObjectives(microcycle, true);

        // Phase 6.2b / D6-B: an explicit day-wide availabilityContextOverride (e.g. a true
        // travel day) restricts which environment is reachable; a fixed activity's own
        // environment never does this on its own -- see resolveAvailability/D6-B.
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
            { anchorRole, adjacentToAnchor, resolveMinimumDaysAfterHardLowerBody },
            fixedActivities,
        );

        const rankingResult = rankCandidates(
            fatigueGated,
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
