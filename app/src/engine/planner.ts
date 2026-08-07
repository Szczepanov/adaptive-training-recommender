import type {
    DailyReadiness,
    DimensionalFatigue,
    FatigueState,
    FixedActivity,
    LocationContext,
    MicrocycleState,
    Recommendation,
    SessionTemplate,
    UserContext,
    UserEvent,
    UserPreferences,
    WeeklyObjective,
    WorkoutCostProfile,
} from './models';
import type { DayOfWeekSchedule } from './models';
import { DEFAULT_LOCATIONS, DEFAULT_WEEKLY_SCHEDULE, resolveAvailability } from './schedule';
import { evaluatePeriodizationPhase, type PhaseWeights } from './periodization';
import { generateWeeklyObjectives, getUnresolvedObjectives, updateMicrocycleProgress } from './microcycle';
import { applyCompletedSessionLoad, computeInternalResponseStrain, createEmptyFatigue, decayFatigue } from './fatigue';
import { rankCandidatesByUtility } from './optimizer';
import { ENRICHED_TEMPLATES } from './templates';
import { addDaysToLocalDateString } from '../utils/localDate';

/**
 * How much a projected day's session pick should be trusted, driven purely by how far
 * it sits from real biometric data:
 * - 'confirmed': today -- the actual synced recovery snapshot + check-in.
 * - 'provisional': tomorrow -- schedule/location are known, but morning readiness isn't,
 *   so this mirrors the existing green/yellow/red preview branch (rules.ts evaluateNextDayPlan).
 * - 'projected': 2+ days out -- schedule/phase/objectives are known in advance, but
 *   nothing about actual recovery is, so the pick assumes the chain of earlier
 *   *projected* days gets followed at an average recovery rate. Best read as "which kind
 *   of session", not a precise prescription.
 */
export type PlanConfidence = 'confirmed' | 'provisional' | 'projected';

export interface WeekAheadDay {
    date: string;
    dayOffset: number; // 0 = today
    confidence: PlanConfidence;
    phaseName: PhaseWeights['phaseName'];
    location: LocationContext;
    template: SessionTemplate;
    /** Category-derived display mode for offset >= 2 days ('Rest'/'Mobility/Recovery' ->
     *  recover, else train). This is NOT the readiness-driven mode rules.ts computes for
     *  today/tomorrow (see Recommendation.mode) -- there's no readiness signal this far
     *  out to compute that from, only a category-level pick. */
    mode: 'train' | 'recover';
    rationale: string;
    /** Weekly objective titles this pick's stimulus profile contributes toward. */
    addressesObjectives: string[];
}

export interface WeekAheadPlan {
    startDate: string;
    days: WeekAheadDay[];
    /** Rolling-window objective ledger as walked forward through the projected chain --
     *  lets the UI show e.g. "Threshold: 1/1 planned" across the whole strip, not just today. */
    microcycleObjectives: WeeklyObjective[];
}

export interface WeekAheadOptions {
    /** Total days in the strip, including today. Default 7. */
    days?: number;
    /** No Firestore-backed source exists yet for events (see docs/adr/0008) -- passing
     *  none simply keeps periodization at its default 'Base' phase. */
    events?: UserEvent[];
    /** Same gap as `events` -- no fixed-activity persistence yet. */
    fixedActivities?: FixedActivity[];
    weeklySchedule?: DayOfWeekSchedule[];
}

const ZERO_COST: WorkoutCostProfile = {
    systemic: 0,
    cardiovascular: 0,
    lowerBody: 0,
    upperBody: 0,
    impactTissue: 0,
    neuromuscular: 0,
};

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

/** Adapts a picked template into the shape microcycle.ts's keyword matcher expects
 *  (it reads `'type' in activity ? activity.type : activity.title`) so a projected
 *  day's pick credits the same weekly objective a real completed session of that
 *  category/modality would. */
function toTrainingRecordLike(template: SessionTemplate) {
    return {
        type: `${template.modality} ${template.category}`,
        duration_min: template.durationMin,
        training_effect: 0,
        intensity_tag: '',
    };
}

function stimulusOverlaps(template: SessionTemplate, objective: WeeklyObjective): boolean {
    const stimulus = template.stimulusProfile ?? ENRICHED_TEMPLATES.find(t => t.id === template.id)?.stimulusProfile;
    if (!stimulus) return false;
    return Object.entries(objective.targetStimulus).some(([key, target]) => {
        if (!target) return false;
        const value = (stimulus as unknown as Record<string, number>)[key];
        return typeof value === 'number' && value > 0;
    });
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

/**
 * Projects a rolling multi-day plan forward from today, chaining the 6-tier engine
 * (schedule -> periodization -> microcycle -> fatigue -> optimizer, see ADR-0007) day by
 * day. Days 0-1 (today/tomorrow) reuse whatever the readiness-driven engine (rules.ts)
 * already produced rather than re-deciding them -- this function only extends the
 * horizon past tomorrow, since rules.ts has no multi-day mode and there's no real
 * readiness signal to feed it 2+ days out.
 *
 * Nothing here is persisted: callers should recompute on every load and whenever goals,
 * constraints, preferences, or today's check-in change, so a mid-week goal edit
 * immediately reshapes the rest of the strip. See docs/adr/0008-week-ahead-planning.md.
 *
 * Known gap: `events`/`fixedActivities` have no Firestore-backed source yet, so
 * periodization defaults to a flat 'Base' phase and schedule defaults to the generic
 * weekly template until that persistence layer exists.
 */
export function generateWeekAheadPlan(
    todayReadiness: DailyReadiness,
    context: UserContext,
    preferences: UserPreferences | null,
    todayDate: string,
    todayRec: Recommendation,
    tomorrowRec: Recommendation | null,
    options: WeekAheadOptions = {}
): WeekAheadPlan {
    const totalDays = Math.max(1, options.days ?? 7);
    const events = options.events ?? [];
    const fixedActivities = options.fixedActivities ?? [];
    const weeklySchedule = options.weeklySchedule ?? DEFAULT_WEEKLY_SCHEDULE;
    const effectivePreferences = preferences ?? NEUTRAL_PREFERENCES;
    const injuries = context.constraints.injuries;

    const phaseWeights = evaluatePeriodizationPhase(events, todayDate);
    // Rolling window (not calendar Mon-Sun): objectives reset relative to *today* so the
    // strip never shows a seam where a later day suddenly looks unbalanced just because a
    // new calendar week started mid-strip.
    let microcycle: MicrocycleState = generateWeeklyObjectives(phaseWeights, todayDate);

    // External load (from completed/projected sessions) and internal strain (today's
    // actual subjective+objective reading) are tracked -- and decayed -- separately, then
    // combined for ranking. Only `internalStrain` is ever seeded from a real readiness
    // signal; nothing resets it, so its influence fades via decayFatigue as the strip
    // walks further from today rather than acting as a permanent ceiling.
    let externalFatigue: FatigueState = createEmptyFatigue(todayDate);
    const internalStrain: DimensionalFatigue = computeInternalResponseStrain(todayReadiness);
    const internalStrainAsOf = todayDate;

    const resultDays: WeekAheadDay[] = [];

    const applyPick = (date: string, template: SessionTemplate) => {
        microcycle = updateMicrocycleProgress(microcycle, toTrainingRecordLike(template));
        externalFatigue = applyCompletedSessionLoad(externalFatigue, date, enrichedCostProfile(template.id));
    };

    // Day 0: today -- reuse the real recommendation as-is (Confirmed).
    const todayLocation = resolveAvailability(todayDate, null, weeklySchedule, DEFAULT_LOCATIONS, fixedActivities).location;
    resultDays.push({
        date: todayDate,
        dayOffset: 0,
        confidence: 'confirmed',
        phaseName: phaseWeights.phaseName,
        location: todayLocation,
        template: todayRec.template,
        mode: todayRec.mode === 'recover' ? 'recover' : 'train',
        rationale: todayRec.rationale,
        addressesObjectives: [],
    });
    applyPick(todayDate, todayRec.template);

    // Day 1: tomorrow -- reuse the existing (selected) green/yellow/red preview pick, if any (Provisional).
    if (totalDays > 1 && tomorrowRec) {
        const tomorrowDate = addDaysToLocalDateString(todayDate, 1);
        const tomorrowLocation = resolveAvailability(tomorrowDate, null, weeklySchedule, DEFAULT_LOCATIONS, fixedActivities).location;
        resultDays.push({
            date: tomorrowDate,
            dayOffset: 1,
            confidence: 'provisional',
            phaseName: phaseWeights.phaseName,
            location: tomorrowLocation,
            template: tomorrowRec.template,
            mode: tomorrowRec.mode === 'recover' ? 'recover' : 'train',
            rationale: tomorrowRec.rationale,
            addressesObjectives: [],
        });
        applyPick(tomorrowDate, tomorrowRec.template);
    }

    // Days 2..N-1 (or 1..N-1 if no tomorrowRec was supplied): no real readiness signal --
    // walk the optimizer forward, assuming each projected pick gets followed at an
    // average recovery rate.
    for (let offset = resultDays.length; offset < totalDays; offset++) {
        const date = addDaysToLocalDateString(todayDate, offset);

        const decayedExternal = decayFatigue(externalFatigue.externalLoadFatigue, hoursBetween(externalFatigue.lastUpdatedDate, date));
        const decayedInternal = decayFatigue(internalStrain, hoursBetween(internalStrainAsOf, date));
        const rankingFatigue: FatigueState = {
            lastUpdatedDate: date,
            externalLoadFatigue: decayedExternal,
            internalResponseStrain: decayedInternal,
            combinedFatigue: combineMax(decayedExternal, decayedInternal),
        };

        const availability = resolveAvailability(date, null, weeklySchedule, DEFAULT_LOCATIONS, fixedActivities);
        const unresolved = getUnresolvedObjectives(microcycle);
        const ranked = rankCandidatesByUtility(ENRICHED_TEMPLATES, unresolved, rankingFatigue, availability, injuries, effectivePreferences);
        const pick = ranked[0];

        if (!pick) {
            // No candidate survives filtering (e.g. zero time available that day) -- fall
            // back to rest rather than silently dropping the day from the strip.
            const restTemplate = ENRICHED_TEMPLATES.find(t => t.category === 'Rest') ?? ENRICHED_TEMPLATES[0];
            resultDays.push({
                date,
                dayOffset: offset,
                confidence: 'projected',
                phaseName: phaseWeights.phaseName,
                location: availability.location,
                template: restTemplate,
                mode: 'recover',
                rationale: "No session fits this day's projected time/equipment window -- defaulting to rest.",
                addressesObjectives: [],
            });
            applyPick(date, restTemplate);
            continue;
        }

        const addressed = unresolved.filter(o => stimulusOverlaps(pick.template, o)).map(o => o.title);
        applyPick(date, pick.template);

        resultDays.push({
            date,
            dayOffset: offset,
            confidence: 'projected',
            phaseName: phaseWeights.phaseName,
            location: availability.location,
            template: pick.template,
            mode: displayModeFromCategory(pick.template.category),
            rationale: pick.rationale,
            addressesObjectives: addressed,
        });
    }

    return {
        startDate: todayDate,
        days: resultDays,
        microcycleObjectives: microcycle.objectives,
    };
}
