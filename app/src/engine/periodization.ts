import type {
    DroppedContributorObjective,
    EventDemandProfile,
    EventPriority,
    GoalCategory,
    ObjectiveDropReason,
    ObjectiveKey,
    TemplatePhaseEligibility,
    SessionTemplate,
    UserEvent,
    UserGoal,
    WeeklyObjective,
} from './models';
import { resolveEventTaper } from './taperPolicy';
// Re-exported for existing importers (e.g. planner.ts, trainingIntent.ts) -- the
// canonical type definitions live in models.ts (see its own comment) so
// decisionTrace/RecommendationAudit there can reference them without a circular import.
export type { DroppedContributorObjective, ObjectiveDropReason };
import { resolveDemandProfile } from './eventPresets';

export interface PhaseWeights {
    phaseName: 'Base' | 'Build' | 'Specificity' | 'Peak/Taper' | 'Post-Event Recovery';
    targetDemandVector: EventDemandProfile;
    volumeScale: number;    // 0.5 - 1.2
    intensityScale: number; // 0.5 - 1.2
    taperActive: boolean;
}

/** The policy result for a single evaluation date, plus event-status information the
 * UI needs to present accurately without trying to reimplement event selection. */
export interface PeriodizationResult {
    phase: PhaseWeights;
    /** The one eligible event governing `phase`, or null when training is in Base. */
    focusEvent: UserEvent | null;
    /** Calendar days to `focusEvent`, never a count for some other event. */
    daysToEvent: number | null;
    /** Scheduled events whose dates have passed but whose outcome is still unknown. */
    staleEvents: UserEvent[];
    /** A DNF focus event gets the normal recovery window, but its load is uncertain. */
    partialEffort: boolean;
    /** Phase 5.6: two eligible events fully tied on priority, proximity, AND planning
     *  date -- decidable only by the id-lexicographic determinism backstop. Two A-events
     *  on the same day is a planning error, not something to blend; this surfaces it
     *  instead of silently picking one. Empty unless a genuine tie occurred. */
    governingEventTie: UserEvent[];
}

/** Modalities that constitute sport-specific exposure for a governing event. This is
 * deliberately separate from optimizer.ts's ranking-priority mapping. */
export function modalitiesForEventCategory(category: UserEvent['category']): SessionTemplate['modality'][] {
    switch (category) {
        case 'cycling_event': return ['Cycling'];
        case 'running_race': return ['Running'];
        case 'triathlon': return ['Cycling', 'Running'];
        case 'strength_meet': return ['Strength'];
        case 'general_target': return [];
    }
}

export const DEFAULT_BASE_DEMAND: EventDemandProfile = {
    aerobicEndurance: 0.8,
    thresholdPower: 0.5,
    vo2MaxPower: 0.3,
    repeatedSurges: 0.3,
    sprintPower: 0.2,
    fatigueResistance: 0.5,
    neuromuscular: 0.4,
};

/**
 * Phase 5.7: taper as an explicit contract, not an emergent side effect.
 *
 * Before this, a taper day either silently dropped the race_specific_endurance objective
 * entirely, or -- if reached via the full-volume qualification below -- demanded a bar
 * (`aerobicEndurance >= 0.6`) a genuine taper session structurally cannot clear. These two
 * constants give "preserve useful intensity and event-specific freshness" a name and a
 * real, reachable target -- calibrated against `end_taper_sharpen_01`'s own (deliberately
 * lower) stimulus profile in templates.ts, matching event-plan.ts's `taper_sharpening`
 * coverage role, rather than the peak-block `end_race_sim_01`/`end_event_specific_01` bar
 * `race_specific_endurance` uses everywhere else. Exported so both
 * `objectivesFromDemand` below and microcycle.ts's plan-derived branch share exactly one
 * calibration.
 */
export const TAPER_SHARPENING_TARGET_STIMULUS: WeeklyObjective['targetStimulus'] = { thresholdPower: 0.5, repeatedSurges: 0.4 };
export const TAPER_SHARPENING_QUALIFICATION: NonNullable<WeeklyObjective['qualification']> = {
    minimumStimulus: { thresholdPower: 0.3 },
    allowedModalities: ['Cycling'],
    allowedCategories: ['Race-Specific Endurance'],
};

/** Same rationale as TAPER_SHARPENING_TARGET_STIMULUS above, for event-plan.ts's
 *  `race_week_strength` role: a taper day's strength_maintenance objective should pull
 *  toward a short, low-volume primer (strength_race_week_primer_01's own intent) rather
 *  than the same full-volume target every other phase uses. */
export const TAPER_STRENGTH_TARGET_STIMULUS: WeeklyObjective['targetStimulus'] = { maxStrength: 0.3, hypertrophy: 0.2 };

/** Exported alongside the taper target-stimulus constants above so `objectivesFromDemand`
 *  below and microcycle.ts's plan-derived branch use exactly the same title text for the
 *  same taper-phase objective, rather than two independently-typed string literals that
 *  could silently drift apart. */
export const TAPER_STRENGTH_PRIMER_TITLE = 'Race-Week Strength Primer';
export const TAPER_SHARPENING_TITLE = 'Taper Sharpening (event-specific freshness)';

/**
 * Translates one event's demand vector + category into the generic (non-plan-derived)
 * objective set a day governed by it would want. Pure function of the event's OWN
 * profile -- never a blended vector -- so it can be reused for both:
 *   - the taper authority's own objectives (generateWeeklyObjectives's generic branch,
 *     unchanged behavior from before this function was extracted); and
 *   - Phase 5.6's per-contributor objectives (resolveMultiEventObjectives below), each
 *     derived from that contributor's own demand/category/taper state, never a blend
 *     with the authority's.
 */
export function objectivesFromDemand(
    demand: EventDemandProfile,
    category: UserEvent['category'] | undefined,
    taperActive: boolean,
    isPostEventRecovery: boolean,
    allowedModalities: SessionTemplate['modality'][]
): WeeklyObjective[] {
    const objectives: WeeklyObjective[] = [];

    if (demand.aerobicEndurance >= 0.4) {
        objectives.push({
            id: 'obj_z2_aerobic', key: 'zone2_aerobic', title: 'Aerobic Base (Zone 2)',
            targetExposures: demand.aerobicEndurance >= 0.7 ? 2 : 1,
            completedExposures: 0,
            targetStimulus: { aerobicEndurance: 0.8 },
        });
    }

    if (demand.thresholdPower >= 0.5 && !taperActive) {
        objectives.push({
            id: 'obj_threshold', key: 'threshold_quality', title: 'Threshold Development',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { thresholdPower: 0.9 },
            qualification: {
                minimumStimulus: { thresholdPower: 0.6 },
                ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
            },
        });
    }

    if ((demand.vo2MaxPower >= 0.6 || demand.repeatedSurges >= 0.6) && !isPostEventRecovery) {
        objectives.push({
            id: 'obj_surges', key: 'surge_repeatability', title: 'Surge & High-Intensity Repeatability',
            targetExposures: 1, completedExposures: 0,
            targetStimulus: { repeatedSurges: 0.9, aerobicEndurance: 0.5 },
            qualification: {
                minimumStimulus: { repeatedSurges: 0.6 },
                ...(allowedModalities.length > 0 ? { allowedModalities } : {}),
            },
        });
    }

    objectives.push({
        id: 'obj_strength', key: 'strength_maintenance',
        title: taperActive ? TAPER_STRENGTH_PRIMER_TITLE : 'Strength & Neuromuscular Maintenance',
        targetExposures: 1, completedExposures: 0,
        targetStimulus: taperActive ? TAPER_STRENGTH_TARGET_STIMULUS : { maxStrength: 0.7, hypertrophy: 0.5 },
    });

    if (category === 'cycling_event' && !isPostEventRecovery) {
        if (!taperActive) {
            if (demand.fatigueResistance >= 0.8 && demand.aerobicEndurance >= 0.8 && (demand.repeatedSurges ?? 0) < 0.6) {
                // High-durability / Gran Fondo profile: emphasize sustained aerobic durability and fatigue resistance
                objectives.push({
                    id: 'obj_cycling_gran_fondo_durability', key: 'race_specific_endurance', title: 'Cycling Aerobic Durability & Tempo',
                    targetExposures: 1, completedExposures: 0,
                    targetStimulus: { aerobicEndurance: 0.9, fatigueResistance: 0.85, thresholdPower: 0.6 },
                    qualification: {
                        minimumStimulus: { aerobicEndurance: 0.6 },
                        allowedModalities: ['Cycling'],
                    },
                });
            } else if (demand.fatigueResistance >= 0.7 || (demand.repeatedSurges ?? 0) >= 0.6) {
                objectives.push({
                    id: 'obj_cycling_race_specific', key: 'race_specific_endurance', title: 'Cycling Race-Specific Endurance',
                    targetExposures: 1, completedExposures: 0,
                    targetStimulus: { aerobicEndurance: 0.6, repeatedSurges: 0.6 },
                    qualification: {
                        minimumStimulus: { aerobicEndurance: 0.6 },
                        allowedModalities: ['Cycling'],
                        allowedCategories: ['Race-Specific Endurance'],
                    },
                });
            }
        } else if (taperActive) {
            objectives.push({
                id: 'obj_taper_sharpening', key: 'race_specific_endurance', title: TAPER_SHARPENING_TITLE,
                targetExposures: 1, completedExposures: 0,
                targetStimulus: TAPER_SHARPENING_TARGET_STIMULUS,
                qualification: TAPER_SHARPENING_QUALIFICATION,
            });
        }
    }

    return objectives;
}

function getDaysBetween(date1Str: string, date2Str: string): number {
    // These are calendar dates, not instants. Local-midnight timestamps differ by 23
    // or 25 hours across Europe/Warsaw DST changes, which makes elapsed-ms/24h math
    // report 0 or 2 days for neighbouring dates. UTC is used only as a timezone-free
    // ordinal representation of the already-local YYYY-MM-DD parts.
    const toOrdinal = (dateStr: string): number => {
        const [year, month, day] = dateStr.split('-').map(Number);
        return Date.UTC(year, month - 1, day);
    };
    return (toOrdinal(date2Str) - toOrdinal(date1Str)) / (1000 * 60 * 60 * 24);
}

function blendDemand(base: EventDemandProfile, eventDemand: EventDemandProfile, eventWeight: number): EventDemandProfile {
    const w = Math.max(0, Math.min(1, eventWeight));
    const bW = 1 - w;
    return {
        aerobicEndurance: base.aerobicEndurance * bW + eventDemand.aerobicEndurance * w,
        thresholdPower: base.thresholdPower * bW + eventDemand.thresholdPower * w,
        vo2MaxPower: base.vo2MaxPower * bW + eventDemand.vo2MaxPower * w,
        repeatedSurges: base.repeatedSurges * bW + eventDemand.repeatedSurges * w,
        sprintPower: base.sprintPower * bW + eventDemand.sprintPower * w,
        fatigueResistance: base.fatigueResistance * bW + eventDemand.fatigueResistance * w,
        neuromuscular: base.neuromuscular * bW + eventDemand.neuromuscular * w,
    };
}

/**
 * Evaluates training phase & continuous demand weights for a given date.
 * Resolves multi-event conflicts:
 * - A-Events dictate primary taper and phase transitions
 * - B-Events receive targeted specificity without compromising A-event tapers
 * - C-Events are train-through / participation (do not trigger tapers)
 * - Ignores non-active event lifecycles (cancelled, DNS)
 */
export function evaluatePeriodizationPhase(
    events: UserEvent[],
    currentDateStr: string
): PeriodizationResult {
    const basePhase: PhaseWeights = {
        phaseName: 'Base',
        targetDemandVector: DEFAULT_BASE_DEMAND,
        volumeScale: 1.0,
        intensityScale: 0.8,
        taperActive: false,
    };

    const datedEvents = events.map(event => {
        const targetDate = event.timing?.planningDate ?? event.date;
        return {
            event,
            targetDate,
            daysToEvent: getDaysBetween(currentDateStr, targetDate),
        };
    });

    // A scheduled event that has passed is intentionally not treated as a completed
    // race. It needs an explicit outcome before granting post-event recovery.
    const staleEvents = datedEvents
        .filter(({ event, daysToEvent }) => event.lifecycle === 'scheduled' && daysToEvent < 0)
        .map(({ event }) => event);

    // Scheduled events direct their normal progression through their event day. A
    // completed/DNF event is eligible only for the existing three-day recovery window.
    // DNS/cancelled (and the legacy rescheduled lifecycle) do not direct training.
    const eligibleEvents = datedEvents.filter(({ event, daysToEvent }) =>
        (event.lifecycle === 'scheduled' && daysToEvent >= 0)
        || ((event.lifecycle === 'completed' || event.lifecycle === 'DNF') && daysToEvent < 0 && daysToEvent >= -3)
    );

    if (eligibleEvents.length === 0) {
        return {
            phase: basePhase,
            focusEvent: null,
            daysToEvent: null,
            staleEvents,
            partialEffort: false,
            governingEventTie: [],
        };
    }

    // Resolve the taper authority (Phase 5.6 terminology) by a full total order --
    // otherwise this is less deterministic than the single-governing-event rule it
    // replaces. In order: (1) priority A > B > C; (2) proximity, fewer days first;
    // (3) planning date ascending; (4) event id, lexicographic. (4) is not a real
    // criterion -- it is a determinism backstop for a genuine tie, commented as such
    // rather than left to look like a meaningful ranking signal.
    const sortedEvents = [...eligibleEvents].sort((a, b) => {
        const prioMap = { A: 1, B: 2, C: 3 };
        if (prioMap[a.event.priority] !== prioMap[b.event.priority]) {
            return prioMap[a.event.priority] - prioMap[b.event.priority];
        }
        if (a.daysToEvent !== b.daysToEvent) {
            return a.daysToEvent - b.daysToEvent;
        }
        if (a.targetDate !== b.targetDate) {
            return a.targetDate < b.targetDate ? -1 : 1;
        }
        return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
    });

    // Two A-events on the same day is a planning error, not something to blend --
    // surfaced here rather than silently resolved by the id backstop above. Empty
    // unless 2+ events are genuinely tied through every real criterion.
    const tiedWithTop = sortedEvents.filter(({ event, daysToEvent, targetDate }) => {
        const top = sortedEvents[0];
        return event.priority === top.event.priority && daysToEvent === top.daysToEvent && targetDate === top.targetDate;
    });
    const governingEventTie = tiedWithTop.length > 1 ? tiedWithTop.map(({ event }) => event) : [];

    const { event: focusEvent, daysToEvent } = sortedEvents[0];
    const partialEffort = focusEvent.lifecycle === 'DNF';
    let phase: PhaseWeights;

    // 3. Evaluate Phase Transitions & Continuous Demand Weightings
    if (daysToEvent < 0) {
        if (focusEvent.priority === 'A') {
            phase = {
                phaseName: 'Post-Event Recovery',
                targetDemandVector: DEFAULT_BASE_DEMAND,
                volumeScale: 0.4,
                intensityScale: 0.4,
                taperActive: false,
            };
        } else {
            phase = basePhase;
        }
    } else {
        const taper = resolveEventTaper(focusEvent);

        if (taper && currentDateStr >= taper.startDate) {
            const taperProgress = 1 - (daysToEvent / taper.durationDays);
            phase = {
                phaseName: 'Peak/Taper',
                targetDemandVector: focusEvent.demandProfile,
                volumeScale: 1.0 - (0.4 * taperProgress),
                intensityScale: 1.0,
                taperActive: true,
            };
        } else if (daysToEvent <= 35) {
            phase = {
                phaseName: 'Specificity',
                targetDemandVector: focusEvent.demandProfile,
                volumeScale: 1.0,
                intensityScale: 1.1,
                taperActive: false,
            };
        } else if (daysToEvent <= 84) {
            phase = {
                phaseName: 'Build',
                targetDemandVector: blendDemand(DEFAULT_BASE_DEMAND, focusEvent.demandProfile, 0.6),
                volumeScale: 1.1,
                intensityScale: 0.9,
                taperActive: false,
            };
        } else {
            phase = {
                phaseName: 'Base',
                targetDemandVector: blendDemand(DEFAULT_BASE_DEMAND, focusEvent.demandProfile, 0.3),
                volumeScale: 1.0,
                intensityScale: 0.8,
                taperActive: false,
            };
        }
    }

    return {
        phase,
        focusEvent,
        daysToEvent,
        staleEvents,
        partialEffort,
        governingEventTie,
    };
}

/**
 * Whether a template is selectable given how the athlete's governing event is unfolding.
 * Pure and total: a template with no `phaseEligibility` is always eligible (existing
 * templates are unaffected). A day-bound rule (`min`/`maxDaysToEvent`) is never satisfied
 * when `daysToEvent` is null (no governing event) -- there is no "close to nothing" case.
 */
export function isTemplatePhaseEligible(
    template: { phaseEligibility?: TemplatePhaseEligibility },
    result: PeriodizationResult
): boolean {
    const rule = template.phaseEligibility;
    if (!rule) return true;

    if (rule.requiresFocusEvent && !result.focusEvent) return false;
    if (rule.requiresTaper && !result.phase.taperActive) return false;
    if (rule.excludeTaper && result.phase.taperActive) return false;
    if (rule.maxDaysToEvent !== undefined && (result.daysToEvent === null || result.daysToEvent > rule.maxDaysToEvent)) return false;
    if (rule.minDaysToEvent !== undefined && (result.daysToEvent === null || result.daysToEvent < rule.minDaysToEvent)) return false;

    return true;
}

/** Days from `evaluationDate` to `eventDate` (negative once the date has passed). Pure,
 *  standalone from `evaluatePeriodizationPhase` on purpose -- a goal/event list can show
 *  several events' day-counts at once (e.g. an Active Goals card), and only the single
 *  *governing* event's day-count comes from evaluatePeriodizationPhase's own result. */
export function getDaysToEvent(eventDate: string, evaluationDate: string): number {
    return getDaysBetween(evaluationDate, eventDate);
}

/**
 * Time-horizon bucket for a *dated* goal, purely a function of how far away that date
 * is -- recomputed on every read (see goalService), never persisted, so it can't go
 * stale as the date approaches. Thresholds are coarser than evaluatePeriodizationPhase's
 * own phase boundaries on purpose: this is a simple, user-facing label ("how far off is
 * this"), not a training-policy decision.
 */
export function deriveGoalCategory(targetDate: string, todayStr: string): GoalCategory {
    const daysAway = getDaysBetween(todayStr, targetDate);
    if (daysAway <= 56) return 'short-term';
    if (daysAway <= 182) return 'mid-term';
    return 'long-term';
}

/** Maps the existing 1-5 star "priority" control onto taper aggressiveness (A/B/C) so
 *  goal-setting doesn't need to teach a second, unrelated priority vocabulary. */
export function deriveEventPriority(starPriority: number): EventPriority {
    if (starPriority >= 5) return 'A';
    if (starPriority >= 3) return 'B';
    return 'C';
}

/**
 * Adapts a goal into the engine-internal `UserEvent` shape `evaluatePeriodizationPhase`
 * consumes. Returns `null` for anything that isn't a currently-active, dated, categorized
 * event goal -- callers should `.filter((e): e is UserEvent => e != null)` over
 * `activeGoals.map(goalToUserEvent)`. No lifecycle filtering happens here
 * (e.g. excluding 'cancelled'/'DNS') -- that's evaluatePeriodizationPhase's job, since it
 * needs to see the full lifecycle to resolve stale/post-event cases correctly.
 */
export function goalToUserEvent(goal: UserGoal & { id?: string }): UserEvent | null {
    if (goal.status !== 'active' || !goal.targetDate || !goal.eventCategory) return null;
    return {
        id: goal.id ?? goal.title, // prefer the Firestore doc id when the caller has one; title is a reasonable fallback for bare UserGoal fixtures (tests, etc.)
        title: goal.title,
        date: goal.targetDate,
        priority: deriveEventPriority(goal.priority),
        lifecycle: goal.eventLifecycle ?? 'scheduled',
        category: goal.eventCategory,
        demandProfile: resolveDemandProfile(goal.eventCategory, goal.eventPreset),
        // goal.timing already passed validateGoal's validateEventTiming check on write
        // (see validation.ts) -- not re-validated here, same trust boundary as every
        // other already-typed UserGoal field this function reads.
        ...(goal.timing ? { timing: goal.timing } : {}),
        ...(goal.taper ? { taper: goal.taper } : {}),
    };
}

// --- Phase 5.6: one taper authority, multiple demand contributors ---

/** A contributor event within its own contribution window (see CONTRIBUTION_WINDOW_DAYS
 *  below), close enough to matter but not the taper authority. Matches
 *  evaluatePeriodizationPhase's own Specificity-phase threshold -- the same "close
 *  enough to shape training" boundary already used for a single governing event. */
const CONTRIBUTION_WINDOW_DAYS = 35;

export interface MultiEventObjectiveResolution {
    objectives: WeeklyObjective[];
    droppedContributorObjectives: DroppedContributorObjective[];
}

/** Objective keys a contributor may never inject while the taper authority is tapering --
 *  a full-volume quality session landing inside the authority's race week is a safety/
 *  freshness conflict, not a preference to weigh. Extensible: add a key here (with the
 *  drop message updated below) if another key needs the same protection. */
const INADMISSIBLE_DURING_AUTHORITY_TAPER: ReadonlySet<ObjectiveKey> = new Set(['threshold_quality']);

/**
 * Phase 5.6: one taper authority, multiple demand contributors.
 *
 * `authorityResult` must be the SAME `PeriodizationResult` used to produce
 * `authorityObjectives` (e.g. via `generateWeeklyObjectives`) -- its `focusEvent`/`phase`
 * are the taper authority, already resolved by `evaluatePeriodizationPhase`'s total order.
 * Only the authority sets `volumeScale`/`intensityScale`; this function never touches
 * `phase` at all, only the objective list.
 *
 * Every OTHER eligible, scheduled event within `CONTRIBUTION_WINDOW_DAYS` contributes
 * objectives derived from its OWN demand vector, category and OWN taper state via
 * `objectivesFromDemand` -- never a blended demand vector, which is the point of doing
 * this after Phase 2's explicit objectives. Where a contributor's objective key collides
 * with an existing one, the existing (authority-first, then earlier contributors) entry's
 * fields win on everything except its required amount, which takes
 * `max(existing, contributor)` -- never summed, or two similar B-events would demand
 * double the work of one. A contributor objective inadmissible under the authority's
 * current phase (today: any `threshold_quality` while the authority is tapering) is
 * dropped with a recorded, athlete-facing reason rather than silently reweighted.
 */
export function resolveMultiEventObjectives(
    events: UserEvent[],
    currentDateStr: string,
    authorityResult: PeriodizationResult,
    authorityObjectives: WeeklyObjective[]
): MultiEventObjectiveResolution {
    const merged: WeeklyObjective[] = authorityObjectives.map(objective => ({ ...objective }));
    const byKey = new Map<ObjectiveKey, WeeklyObjective>(merged.map(objective => [objective.key, objective]));
    // Tracks which keys are the authority's own (always wins its fields outright) versus a
    // previously-merged contributor's (eligible for the union merge below) -- see the loop.
    const authorityKeys = new Set(authorityObjectives.map(objective => objective.key));
    const droppedContributorObjectives: DroppedContributorObjective[] = [];

    const authorityEventId = authorityResult.focusEvent?.id ?? null;
    if (!authorityEventId) {
        return { objectives: merged, droppedContributorObjectives };
    }

    // Deterministic contributor order -- mirrors evaluatePeriodizationPhase's own total
    // order (priority, then proximity, then planning date, then id) so which contributor
    // "wins" a same-key collision below never depends on the caller-supplied `events`
    // array order. Without this, two contributors of different modalities producing the
    // same objective key (e.g. a Running B-event and a Cycling B-event both needing
    // threshold_quality) could see the winner -- and therefore the merged qualification's
    // allowedModalities -- flip depending on array order alone.
    const contributors = events
        .filter(event => event.id !== authorityEventId && event.lifecycle === 'scheduled')
        .map(event => {
            const targetDate = event.timing?.planningDate ?? event.date;
            return { event, targetDate, daysToEvent: getDaysBetween(currentDateStr, targetDate) };
        })
        .filter(({ daysToEvent }) => daysToEvent >= 0 && daysToEvent <= CONTRIBUTION_WINDOW_DAYS)
        .sort((a, b) => {
            const prioMap = { A: 1, B: 2, C: 3 };
            if (prioMap[a.event.priority] !== prioMap[b.event.priority]) {
                return prioMap[a.event.priority] - prioMap[b.event.priority];
            }
            if (a.daysToEvent !== b.daysToEvent) return a.daysToEvent - b.daysToEvent;
            if (a.targetDate !== b.targetDate) return a.targetDate < b.targetDate ? -1 : 1;
            return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
        });

    for (const { event, daysToEvent } of contributors) {
        const contributorTaperWindowDays = event.priority === 'A' ? 14 : (event.priority === 'B' ? 5 : 0);
        const contributorTaperActive = contributorTaperWindowDays > 0 && daysToEvent <= contributorTaperWindowDays;
        const allowedModalities = modalitiesForEventCategory(event.category);

        const contributorObjectives = objectivesFromDemand(
            event.demandProfile,
            event.category,
            contributorTaperActive,
            false, // a forward-looking contributor (daysToEvent >= 0) is never Post-Event Recovery
            allowedModalities
        );

        for (const objective of contributorObjectives) {
            if (authorityResult.phase.taperActive && INADMISSIBLE_DURING_AUTHORITY_TAPER.has(objective.key)) {
                droppedContributorObjectives.push({
                    eventId: event.id,
                    eventTitle: event.title,
                    objectiveKey: objective.key,
                    reason: 'inadmissible_during_taper',
                    message: `${event.title}'s ${objective.title} session was dropped because it fell in ${authorityResult.focusEvent?.title ?? 'the governing event'}'s taper window.`,
                    date: currentDateStr,
                });
                continue;
            }

            const existing = byKey.get(objective.key);
            if (!existing) {
                const added = { ...objective };
                merged.push(added);
                byKey.set(objective.key, added);
                continue;
            }
            const existingRequired = existing.requiredCredit ?? existing.targetExposures;
            const contributorRequired = objective.requiredCredit ?? objective.targetExposures;
            if (contributorRequired > existingRequired) {
                // The existing entry's other fields (title/qualification/targetStimulus/id)
                // win -- only the required amount is allowed to grow, and only grow.
                existing.requiredCredit = contributorRequired;
                existing.targetExposures = Math.max(existing.targetExposures, objective.targetExposures);
            }

            // Contributor-vs-contributor collisions only (never the authority's own entry,
            // which always wins its fields outright per the doc comment above): union
            // compatible modality qualifiers rather than letting the first-processed
            // contributor's allowedModalities silently exclude a later contributor's
            // sessions from satisfying the same key. Undefined on either side means "any
            // modality accepted" -- unioning "any" with anything is still "any", so the
            // restriction is dropped rather than merged with the other list.
            if (!authorityKeys.has(objective.key) && existing.qualification) {
                const existingModalities = existing.qualification.allowedModalities;
                const contributorModalities = objective.qualification?.allowedModalities;
                if (existingModalities && contributorModalities) {
                    existing.qualification = {
                        ...existing.qualification,
                        allowedModalities: Array.from(new Set([...existingModalities, ...contributorModalities])),
                    };
                } else if (existingModalities || contributorModalities) {
                    const widened = { ...existing.qualification };
                    delete widened.allowedModalities;
                    existing.qualification = widened;
                }
            }
        }
    }

    return { objectives: merged, droppedContributorObjectives };
}
