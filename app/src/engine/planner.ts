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
}
import { resolveAvailability } from './schedule';
import { isTemplatePhaseEligible, evaluatePeriodizationPhase } from './periodization';
import { eligibleTemplates } from './eligibility';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import { createEmptyFatigue, applyCompletedSessionLoad, decayFatigue } from './fatigue';
import {
    creditObjectivesFromStimulus,
    generateWeeklyObjectives,
    getUnresolvedObjectives,
    qualifiesForObjective,
    stimulusCoverage,
    STIMULUS_CREDIT_COVERAGE_THRESHOLD,
} from './microcycle';
import {
    type RecentHistoryEntry,
    ANCHOR_HISTORY_CATEGORIES,
    buildOptimizationContext,
    rankCandidates,
} from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import { resolveTrainingIntent } from './trainingIntent';
import type { TrainingHistoryProvider } from './trainingHistory';
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
}

export interface WeekAheadPlanSeed {
    microcycle: MicrocycleState;
    fatigue: FatigueState;
    trailingHistory?: (RecentHistoryEntry | SessionHistoryEntry)[];
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
    aerobicCapacity: 0, thresholdDevelopment: 0, surgeRepeatability: 0, maxStrength: 0, hypertrophy: 0, mobilityRecovery: 0,
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

export const PROJECTED_FATIGUE_RECOVER_THRESHOLD = 0.8;
export const PROJECTED_FATIGUE_MODIFY_THRESHOLD = 0.6;
const PROJECTED_MODIFY_MAX_SYSTEMIC_COST = 0.5;

function maxFatigueDimension(fatigue: DimensionalFatigue): number {
    return Math.max(
        fatigue.systemic, fatigue.cardiovascular, fatigue.lowerBody,
        fatigue.upperBody, fatigue.impactTissue, fatigue.neuromuscular
    );
}

function fatigueTierFor(peakFatigue: number): 'train' | 'modify' | 'recover' {
    if (peakFatigue >= PROJECTED_FATIGUE_RECOVER_THRESHOLD) return 'recover';
    if (peakFatigue >= PROJECTED_FATIGUE_MODIFY_THRESHOLD) return 'modify';
    return 'train';
}

const NEUTRAL_PREFERENCES: UserPreferences = {
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

function displayModeFromCategory(category: SessionTemplate['category']): 'train' | 'recover' {
    return category === 'Rest' || category === 'Mobility/Recovery' ? 'recover' : 'train';
}

function enrichedCostProfile(templateId: string): WorkoutCostProfile {
    return ENRICHED_TEMPLATES.find(t => t.id === templateId)?.costProfile ?? ZERO_COST;
}

function enrichedStimulusProfile(template: SessionTemplate): WorkoutStimulusProfile {
    return template.stimulusProfile ?? ENRICHED_TEMPLATES.find(t => t.id === template.id)?.stimulusProfile ?? ZERO_STIMULUS;
}

function isAdjacentDate(date: string, anchorDate: string | null): boolean {
    if (!anchorDate) return false;
    return addDaysToLocalDateString(date, 1) === anchorDate || addDaysToLocalDateString(date, -1) === anchorDate;
}

export interface WeeklyAnchors {
    eventSpecificAnchorDate: string | null;
    qualityAnchorDate: string | null;
}

const QUALITY_ANCHOR_MIN_GAP_DAYS = 2;

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
        // Mirrors the quality-anchor pool's own gap check below, but in the other
        // direction: qualityAnchorDate can already be set here (from tomorrow's actual
        // pick, above) before this search runs, and without this check an
        // event-specific anchor could land immediately next to it.
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

    const events = (Array.isArray(eventsOrFatigue) ? eventsOrFatigue : []) as UserEvent[];
    const periodization = evaluatePeriodizationPhase(events, todayDate);
    let microcycle = generateWeeklyObjectives(periodization.phase, todayDate, periodization.focusEvent);
    history.forEach(h => {
        const typeStr = 'type' in h && typeof h.type === 'string' ? h.type : undefined;
        const modality = (h.modality ?? typeStr ?? 'None') as SessionTemplate['modality'];
        const category = h.category;
        microcycle = creditObjectivesFromStimulus(microcycle, { thresholdDevelopment: 0.8, aerobicCapacity: 0.5, surgeRepeatability: 0.5, maxStrength: 0.5, hypertrophy: 0.5, mobilityRecovery: 0.5 }, modality, category);
    });
    const fatigue = createEmptyFatigue(todayDate);
    return {
        microcycle,
        fatigue,
        trailingHistory: projectTrailingHistory(history),
    };
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
    // Seeded from today's actual readiness reading and never itself re-measured -- ADR-0008
    // has this signal fade via decayFatigue as the strip walks further from today (see the
    // per-projected-date decay below), same as externalFatigue does through applyPick's own
    // applyCompletedSessionLoad calls. Without that decay this would act as a permanent
    // fatigue ceiling across the entire forecast instead of fading out.
    //
    // This assumes today's readiness is a point-in-time snapshot likely to trend back to
    // normal -- correct for a real dashboard, where tomorrow gets its own fresh check-in
    // once it actually arrives. It does NOT hold for a caller that re-asserts the exact
    // same (e.g. sustained-stress) readiness for every day of a multi-day window without
    // ever re-measuring it: simulation/analyze.ts's runScenario samples readinessForWeek
    // only once per week and then projects the remaining 6 days from this single seed, so
    // a scenario modeling chronic stress will look progressively less conservative toward
    // the end of the week as this decays, even though the underlying readiness never
    // actually improved. Known, understood gap (surfaced by review) -- the real fix is
    // giving the simulation harness a per-day readiness re-evaluation path, not
    // reintroducing the undecayed-forever bug this replaced.
    const internalStrain: DimensionalFatigue = seed.fatigue?.internalResponseStrain ?? { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
    const internalStrainAsOf = todayDate;
    let externalFatigue: FatigueState = seed.fatigue?.externalLoadFatigue ? seed.fatigue : createEmptyFatigue(todayDate);

    const resultDays: WeekAheadDay[] = [];
    const objectiveCredits: PlannedObjectiveCredit[] = [];

    const anchors = resolveWeeklyAnchors(todayDate, totalDays, events, fixedActivities, context, tomorrowRec?.template.category, tomorrowRec?.template.modality);

    // Must mirror creditObjectivesFromStimulus's own coverage threshold and qualification
    // check exactly (same imports as microcycle.ts uses) -- otherwise the reported
    // objectiveCredits/addressesObjectives displayed to the user can claim a credit the
    // real microcycle ledger (advanced below via creditObjectivesFromStimulus in
    // applyPick) never actually applied.
    const creditingObjectivesFor = (template: SessionTemplate): WeeklyObjective[] => {
        const stimulus = enrichedStimulusProfile(template);
        return getUnresolvedObjectives(microcycle).filter(objective =>
            stimulusCoverage(stimulus, objective.targetStimulus) >= STIMULUS_CREDIT_COVERAGE_THRESHOLD
            && qualifiesForObjective(stimulus, template.modality, objective.qualification, template.category)
        );
    };

    const applyPick = (date: string, template: SessionTemplate) => {
        creditingObjectivesFor(template).forEach(objective => {
            objectiveCredits.push({
                date,
                objectiveKey: objective.key,
                objectiveTitle: objective.title,
                templateId: template.id,
                templateTitle: template.title,
                modality: template.modality,
            });
        });
        microcycle = creditObjectivesFromStimulus(microcycle, enrichedStimulusProfile(template), template.modality, template.category);
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, enrichedCostProfile(template.id));
    };

    applyPick(todayDate, todayRec.template);

    if (tomorrowRec) {
        const tomorrowDate = addDaysToLocalDateString(todayDate, 1);
        const tomorrowPeriodization = evaluatePeriodizationPhase(events, tomorrowDate);
        resultDays.push({
            date: tomorrowDate,
            dayOffset: 1,
            confidence: 'provisional',
            phaseName: tomorrowPeriodization.phase.phaseName,
            template: tomorrowRec.template,
            mode: tomorrowRec.mode === 'recover' ? 'recover' : 'train',
            rationale: tomorrowRec.rationale,
            addressesObjectives: creditingObjectivesFor(tomorrowRec.template).map(objective => objective.title),
        });
        applyPick(tomorrowDate, tomorrowRec.template);
    }

    for (let offset = resultDays.length + 1; offset <= totalDays; offset++) {
        const date = addDaysToLocalDateString(todayDate, offset);
        const periodization = evaluatePeriodizationPhase(events, date);
        const availability = resolveAvailability(date, null, fixedActivities, context);

        const decayedInternalStrain = decayFatigue(internalStrain, getDayDiff(date, internalStrainAsOf) * 24);
        const rankingFatigue: FatigueState = {
            lastUpdatedDate: date,
            externalLoadFatigue: externalFatigue.externalLoadFatigue,
            internalResponseStrain: decayedInternalStrain,
            combinedFatigue: combineMax(externalFatigue.externalLoadFatigue, decayedInternalStrain),
        };

        const unresolved = getUnresolvedObjectives(microcycle);

        const eligible = eligibleTemplates(ENRICHED_TEMPLATES, context, availability.maxTimeMinutes, date)
            .filter(t => isTemplatePhaseEligible(t, periodization));

        const peakFatigue = maxFatigueDimension(rankingFatigue.combinedFatigue);
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
                role: (ANCHOR_HISTORY_CATEGORIES.includes(todayRec.template.category) ? 'anchor' : 'supporting') as SessionRole,
                systemicCost: todayRec.template.systemicCost,
                lowerBodyCost: todayRec.template.costProfile?.lowerBody ?? 0,
                type: todayRec.template.title,
            },
            ...resultDays.map(d => ({
                date: d.date,
                templateId: d.template.id,
                category: d.template.category,
                modality: d.template.modality,
                role: (d.date === anchors.eventSpecificAnchorDate || d.date === anchors.qualityAnchorDate || ANCHOR_HISTORY_CATEGORIES.includes(d.template.category) ? 'anchor' : 'supporting') as SessionRole,
                systemicCost: d.template.systemicCost,
                lowerBodyCost: d.template.costProfile?.lowerBody ?? 0,
                type: d.template.title,
            })),
        ];

        const optContext = buildOptimizationContext(
            { unresolvedObjectives: unresolved, fatigue: rankingFatigue, periodization, history: projectedHistory },
            context,
            effectivePreferences,
            date,
            { anchorRole, adjacentToAnchor }
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

        const addressed = creditingObjectivesFor(pick.template).map(objective => objective.title);
        applyPick(date, pick.template);

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
            trailingHistory: intent.history.map(e => ({
                date: ('completedDate' in e && typeof e.completedDate === 'string' ? e.completedDate : 'date' in e && typeof e.date === 'string' ? e.date : todayDate),
                modality: e.modality,
                category: e.category,
                systemicCost: e.costProfile?.systemic ?? 0,
                lowerBodyCost: e.costProfile?.lowerBody ?? 0,
            })),
        },
        { ...options, events },
    );
}
