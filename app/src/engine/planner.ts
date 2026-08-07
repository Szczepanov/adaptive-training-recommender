import type {
    DailyReadiness,
    DimensionalFatigue,
    FatigueState,
    FixedActivity,
    MicrocycleState,
    Recommendation,
    SessionTemplate,
    UserContext,
    UserEvent,
    UserPreferences,
    WeeklyObjective,
    WorkoutCostProfile,
    WorkoutStimulusProfile,
} from './models';
import { resolveAvailability } from './schedule';
import { evaluatePeriodizationPhase, isTemplatePhaseEligible, type PhaseWeights } from './periodization';
import { buildMicrocycleState, creditObjectivesFromStimulus, getUnresolvedObjectives, stimulusCoverage, STIMULUS_CREDIT_COVERAGE_THRESHOLD } from './microcycle';
import { applyCompletedSessionLoad, buildFatigueStateFromHistory, computeInternalResponseStrain, decayFatigue } from './fatigue';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import { rankCandidatesByUtility } from './optimizer';
import { eligibleTemplates } from './eligibility';
import { ENRICHED_TEMPLATES } from './templates';
import { addDaysToLocalDateString } from '../utils/localDate';
import { resolveTrainingIntent } from './trainingIntent';

/**
 * How much a projected day's session pick should be trusted, driven purely by how far
 * it sits from real biometric data:
 * - 'provisional': tomorrow -- schedule/location are known, but morning readiness isn't,
 *   so this mirrors the existing green/yellow/red preview branch (rules.ts evaluateNextDayPlan).
 * - 'projected': the day after tomorrow onward -- schedule/phase/objectives are known in advance, but
 *   nothing about actual recovery is, so the pick assumes the chain of earlier
 *   *projected* days gets followed at an average recovery rate. Best read as "which kind
 *   of session", not a precise prescription.
 */
export type PlanConfidence = 'confirmed' | 'provisional' | 'projected';

export interface WeekAheadDay {
    date: string;
    dayOffset: number; // 1 = tomorrow
    confidence: PlanConfidence;
    phaseName: PhaseWeights['phaseName'];
    template: SessionTemplate;
    /** Category-derived display mode for projected days ('Rest'/'Mobility/Recovery' ->
     *  recover, else train). This is NOT the readiness-driven mode rules.ts computes for
     *  today/tomorrow (see Recommendation.mode) -- there's no readiness signal this far
     *  out to compute that from, only a category-level pick. */
    mode: 'train' | 'recover';
    rationale: string;
    /** Weekly objective titles this pick's stimulus profile contributes toward. */
    addressesObjectives: string[];
    /** Internal ranking signal for a projected day, exposed so tooling (see
     *  engine/simulation/) can analyze real decision quality over time instead of
     *  reconstructing an approximation from the displayed pick alone -- e.g. "was this a
     *  landslide or a coin flip" and "how much of the week was spent fatigue-capped."
     *  Never populated for 'provisional'/'confirmed' days (those come from rules.ts's own
     *  evaluation, which doesn't compute these values in a comparable shape). Not read by
     *  any UI component -- purely a diagnostic, safe to ignore. */
    diagnostics?: {
        peakFatigue: number;
        fatigueTier: 'train' | 'modify' | 'recover';
        topUtilityScore: number;
        runnerUpUtilityScore: number | null;
    };
}

export interface WeekAheadPlan {
    startDate: string;
    days: WeekAheadDay[];
    /** Rolling-window objective ledger as walked forward through the forecast chain --
     *  lets the UI show e.g. "Threshold: 1/1 planned" across the whole strip. */
    microcycleObjectives: WeeklyObjective[];
}

/** Prepared, history-backed starting state for the otherwise pure projection core. */
export interface WeekAheadPlanSeed {
    microcycle: MicrocycleState;
    fatigue: FatigueState;
}

export interface WeekAheadOptions {
    /** Total future days in the strip, starting tomorrow. Default 7. */
    days?: number;
    /** No Firestore-backed source exists yet for events (see docs/adr/0008) -- passing
     *  none simply keeps periodization at its default 'Base' phase. */
    events?: UserEvent[];
    /** Same gap as `events` -- no fixed-activity persistence yet. */
    fixedActivities?: FixedActivity[];
}

/** Builds a deterministic seed for tests and other pure callers. */
export function prepareWeekAheadPlanSeed(
    todayReadiness: DailyReadiness,
    events: UserEvent[],
    todayDate: string,
    history: CompletedExposure[],
): WeekAheadPlanSeed {
    const phase = evaluatePeriodizationPhase(events, todayDate).phase;
    return {
        microcycle: buildMicrocycleState(phase, addDaysToLocalDateString(todayDate, -7), history),
        fatigue: buildFatigueStateFromHistory(history, computeInternalResponseStrain(todayReadiness), todayDate),
    };
}

const ZERO_COST: WorkoutCostProfile = {
    systemic: 0,
    cardiovascular: 0,
    lowerBody: 0,
    upperBody: 0,
    impactTissue: 0,
    neuromuscular: 0,
};

const ZERO_STIMULUS: WorkoutStimulusProfile = {
    aerobicCapacity: 0,
    thresholdDevelopment: 0,
    surgeRepeatability: 0,
    maxStrength: 0,
    hypertrophy: 0,
    mobilityRecovery: 0,
};

/** Mirrors rules.ts's mode-driven systemic-cost ceilings (MODIFY_MAX_SYSTEMIC_COST /
 *  PLAN_TIER_SYSTEMIC_COST_CEILING) but keyed off projected *fatigue* rather than a real
 *  morning check-in, since no readiness signal exists this far out. Without a hard
 *  ceiling here, utility = benefit/(1+cost) is asymptotic: rising cost can push a
 *  candidate's score arbitrarily close to zero but never below Rest's floor score, so
 *  the projected loop had no fatigue level -- including 100% across every dimension --
 *  at which it would actually recommend rest. */
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

/** Preference-neutral fallback matching adapters.ts's null-preferences convention
 *  (all-empty/false) rather than preferencesService's pre-filled create-time defaults --
 *  a user who hasn't set preferences yet shouldn't have modality opinions invented for them. */
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

/** Looks up the 6D-enriched version of a template picked by an engine that doesn't
 *  itself enrich (rules.ts selects from the raw TEMPLATES array) so fatigue chaining
 *  always has real cost/stimulus numbers to work with instead of silently zeroing out. */
function enrichedCostProfile(templateId: string): WorkoutCostProfile {
    return ENRICHED_TEMPLATES.find(t => t.id === templateId)?.costProfile ?? ZERO_COST;
}

/** Same enrichment fallback as enrichedCostProfile, for the stimulus side -- used to
 *  credit objectives directly from a pick's own numeric profile (see
 *  microcycle.ts's creditObjectivesFromStimulus) instead of round-tripping through a
 *  free-text description and keyword-matching it back apart. */
function enrichedStimulusProfile(template: SessionTemplate): WorkoutStimulusProfile {
    return template.stimulusProfile ?? ENRICHED_TEMPLATES.find(t => t.id === template.id)?.stimulusProfile ?? ZERO_STIMULUS;
}

function hoursBetween(dateStr1: string, dateStr2: string): number {
    const d1 = new Date(dateStr1 + 'T00:00:00').getTime();
    const d2 = new Date(dateStr2 + 'T00:00:00').getTime();
    return Math.max(0, (d2 - d1) / (1000 * 60 * 60));
}

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

function isAdjacentDate(date: string, anchorDate: string | null): boolean {
    if (!anchorDate) return false;
    return addDaysToLocalDateString(date, 1) === anchorDate || addDaysToLocalDateString(date, -1) === anchorDate;
}

export interface WeeklyAnchors {
    /** The day nominated for the weekend-style race-specific/race-simulation session. */
    eventSpecificAnchorDate: string | null;
    /** The day nominated for the midweek structured threshold/over-under session. */
    qualityAnchorDate: string | null;
}

const QUALITY_ANCHOR_MIN_GAP_DAYS = 2;

/**
 * Pure pre-pass, run once before the day-by-day fatigue loop: nominates up to two future
 * days as deliberate "key session" anchors, rather than leaving which day gets which role
 * entirely to independent greedy per-day ranking. Only ever nominates anchors when a real
 * focus event governs at least one candidate day -- a Base-phase/no-event user gets
 * `{ null, null }` and the rest of generateWeekAheadPlan behaves exactly as it did before
 * this existed.
 *
 * Scans offsets 2..N only: offset 1 (tomorrow) reuses rules.ts's own evaluation, which has
 * no anchor concept and isn't touched by this feature, so tomorrow can never be nominated.
 *
 * Both time budget (resolveAvailability) and phase eligibility (evaluatePeriodizationPhase)
 * are independent of fatigue, so this can run ahead of the stateful loop that tracks it.
 */
export function resolveWeeklyAnchors(
    todayDate: string,
    totalDays: number,
    events: UserEvent[],
    fixedActivities: FixedActivity[],
    context: UserContext,
): WeeklyAnchors {
    // Deliberately excludes the taper-family Race-Specific Endurance templates
    // (end_taper_sharpen_01/end_pre_race_openers_01): those are short, freshness-preserving
    // sessions by design and don't need -- or deserve -- a dedicated "big anchor day"
    // designation the way the weekend event-specific ride / race simulation progression does.
    const raceSpecificTemplates = ENRICHED_TEMPLATES.filter(t => t.category === 'Race-Specific Endurance' && !t.phaseEligibility?.requiresTaper);
    const qualityTemplates = ENRICHED_TEMPLATES.filter(t => t.modality === 'Cycling' && (t.category === 'Moderate Endurance' || t.category === 'Hard Endurance'));

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
    if (dayInfo.length === 0) return { eventSpecificAnchorDate: null, qualityAnchorDate: null };

    const largestByTime = (pool: typeof dayInfo) =>
        pool.reduce((best, d) => (d.maxTimeMinutes > best.maxTimeMinutes ? d : best), pool[0]);

    // Full hard-gate (duration + equipment + environment + guardrails), the same
    // eligibleTemplates primitive the real loop uses -- an anchor is only nominated on a
    // day where the real loop could actually deliver on it (e.g. an "indoor only"
    // TrainingSettings default correctly rules out an outdoor-only race-specific ride,
    // rather than nominating an anchor day the loop would immediately fall through on).
    const eventSpecificPool = dayInfo.filter(d =>
        eligibleTemplates(raceSpecificTemplates, context, d.maxTimeMinutes, d.date).some(t => isTemplatePhaseEligible(t, d.periodization))
    );
    const eventSpecificAnchor = eventSpecificPool.length > 0 ? largestByTime(eventSpecificPool) : null;

    const remaining = dayInfo.filter(d => !eventSpecificAnchor || d.date !== eventSpecificAnchor.date);
    const farEnough = (d: AnchorDayInfo, minGap: number) =>
        !eventSpecificAnchor || Math.abs(d.offset - eventSpecificAnchor.offset) >= minGap;
    const fitsQuality = (d: AnchorDayInfo) => eligibleTemplates(qualityTemplates, context, d.maxTimeMinutes, d.date).length > 0;

    const qualityPoolFar = remaining.filter(d => farEnough(d, QUALITY_ANCHOR_MIN_GAP_DAYS) && fitsQuality(d));
    const qualityPoolNear = remaining.filter(d => farEnough(d, 1) && fitsQuality(d));
    const qualityPool = qualityPoolFar.length > 0 ? qualityPoolFar : qualityPoolNear;
    const qualityAnchor = qualityPool.length > 0 ? largestByTime(qualityPool) : null;

    return {
        eventSpecificAnchorDate: eventSpecificAnchor?.date ?? null,
        qualityAnchorDate: qualityAnchor?.date ?? null,
    };
}

/**
 * Projects a rolling multi-day plan forward from tomorrow, chaining the 6-tier engine
 * (schedule -> periodization -> microcycle -> fatigue -> optimizer, see ADR-0007) day by
 * day. Today's recommendation seeds the projected load but is not displayed. Tomorrow
 * reuses whatever the readiness-driven engine (rules.ts) already produced rather than
 * re-deciding it; this function then extends the horizon past tomorrow, since rules.ts
 * has no multi-day mode and there's no real readiness signal to feed it 2+ days out.
 *
 * Nothing here is persisted: callers should recompute on every load and whenever goals,
 * constraints, preferences, or today's check-in change, so a mid-week goal edit
 * immediately reshapes the rest of the strip. See docs/adr/0008-week-ahead-planning.md.
 *
 * Events are derived from persisted goal inputs by the caller. Fixed activities still
 * have no Firestore-backed source, so schedule falls back to the generic weekly template.
 */
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
    const injuries = context.constraints.injuries;

    // Rolling window (not calendar Mon-Sun): objectives reset relative to *today* so the
    // strip never shows a seam where a later day suddenly looks unbalanced just because a
    // new calendar week started mid-strip.
    let microcycle: MicrocycleState = seed.microcycle;

    // External load (from completed/projected sessions) and internal strain (today's
    // actual subjective+objective reading) are tracked -- and decayed -- separately, then
    // combined for ranking. Only `internalStrain` is ever seeded from a real readiness
    // signal; nothing resets it, so its influence fades via decayFatigue as the strip
    // walks further from today rather than acting as a permanent ceiling.
    const internalStrain: DimensionalFatigue = seed.fatigue.internalResponseStrain;
    let externalFatigue: FatigueState = seed.fatigue;
    const internalStrainAsOf = todayDate;

    const resultDays: WeekAheadDay[] = [];

    // Weekly-architecture pre-pass -- pure, fatigue-independent, computed once. See
    // resolveWeeklyAnchors's own docstring: both anchors stay null (fully inert) unless a
    // real focus event governs at least one future day.
    const anchors = resolveWeeklyAnchors(todayDate, totalDays, events, fixedActivities, context);

    const applyPick = (date: string, template: SessionTemplate) => {
        microcycle = creditObjectivesFromStimulus(microcycle, enrichedStimulusProfile(template));
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, enrichedCostProfile(template.id));
    };

    // Today's actual recommendation affects the future load/objective chain, but the
    // forecast deliberately starts tomorrow so it never repeats today's dashboard card.
    applyPick(todayDate, todayRec.template);

    // Day 1: tomorrow -- reuse the existing (selected) green/yellow/red preview pick, if any (Provisional).
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
            addressesObjectives: [],
        });
        applyPick(tomorrowDate, tomorrowRec.template);
    }

    // Days 2..N (or 1..N if no tomorrowRec was supplied): no real readiness signal --
    // walk the optimizer forward, assuming each projected pick gets followed at an
    // average recovery rate.
    for (let offset = resultDays.length + 1; offset <= totalDays; offset++) {
        const date = addDaysToLocalDateString(todayDate, offset);
        const periodization = evaluatePeriodizationPhase(events, date);

        const decayedExternal = decayFatigue(externalFatigue.externalLoadFatigue, hoursBetween(externalFatigue.lastUpdatedDate, date));
        const decayedInternal = decayFatigue(internalStrain, hoursBetween(internalStrainAsOf, date));
        const rankingFatigue: FatigueState = {
            lastUpdatedDate: date,
            externalLoadFatigue: decayedExternal,
            internalResponseStrain: decayedInternal,
            combinedFatigue: combineMax(decayedExternal, decayedInternal),
        };

        const availability = resolveAvailability(date, null, fixedActivities, context);
        const unresolved = getUnresolvedObjectives(microcycle);
        const projectedHistory = resultDays.map(d => ({
            modality: d.template.modality,
            type: d.template.title,
            systemicCost: d.template.systemicCost,
        }));

        // Real hard-gate feasibility first (equipment actually owned, guardrails,
        // indoor/outdoor boundary, weekday/weekend time budget) -- this used to be
        // skipped entirely for projected days: the raw catalog went straight into
        // ranking with only a location-fabricated equipment set and duration filter,
        // so the 7-day strip could recommend sessions today's own dashboard would
        // never allow (banned modalities, wrong environment, equipment the athlete
        // doesn't own). See eligibility.ts -- this is the same gate rules.ts already
        // runs for today and tomorrow.
        const eligible = eligibleTemplates(ENRICHED_TEMPLATES, context, availability.maxTimeMinutes, date)
            .filter(t => isTemplatePhaseEligible(t, periodization));

        // Then a hard fatigue-tier ceiling, mirroring rules.ts's readiness-driven mode
        // ceiling but keyed off projected fatigue (see PROJECTED_FATIGUE_*_THRESHOLD
        // above) -- makes rest/easy days actually reachable instead of relying on a
        // utility formula that can only approach zero, never lose to Rest's floor score.
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

        const ranked = rankCandidatesByUtility(
            fatigueGated,
            unresolved,
            rankingFatigue,
            availability,
            injuries,
            effectivePreferences,
            { focusEvent: periodization.focusEvent, recentHistory: projectedHistory, anchorRole, adjacentToAnchor }
        );
        const pick = ranked[0];

        if (!pick) {
            // No candidate survives filtering (e.g. zero time available that day) -- fall
            // back to rest rather than silently dropping the day from the strip.
            const restTemplate = ENRICHED_TEMPLATES.find(t => t.category === 'Rest') ?? ENRICHED_TEMPLATES[0];
            resultDays.push({
                date,
                dayOffset: offset,
                confidence: 'projected',
                phaseName: periodization.phase.phaseName,
                template: restTemplate,
                mode: 'recover',
                rationale: "No session fits this day's projected time/equipment window -- defaulting to rest.",
                addressesObjectives: [],
                diagnostics: { peakFatigue, fatigueTier: fatigueTierFor(peakFatigue), topUtilityScore: 0, runnerUpUtilityScore: null },
            });
            applyPick(date, restTemplate);
            continue;
        }

        const pickStimulus = enrichedStimulusProfile(pick.template);
        const addressed = unresolved
            .filter(o => stimulusCoverage(pickStimulus, o.targetStimulus) >= STIMULUS_CREDIT_COVERAGE_THRESHOLD)
            .map(o => o.title);
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
            },
        });
    }

    return {
        startDate: addDaysToLocalDateString(todayDate, 1),
        days: resultDays,
        microcycleObjectives: microcycle.objectives,
    };
}

/**
 * Production entry point: retrieve rolling adherence once, turn it into a prepared
 * seed, then delegate the entire projected-day chain to the pure planner core.
 */
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
): Promise<WeekAheadPlan> {
    const intent = await resolveTrainingIntent(userId, events, todayDate, todayReadiness, 7, historyProvider);
    return generateWeekAheadPlan(
        todayReadiness,
        context,
        preferences,
        todayDate,
        todayRec,
        tomorrowRec,
        { microcycle: intent.microcycle, fatigue: intent.fatigue },
        { ...options, events },
    );
}
