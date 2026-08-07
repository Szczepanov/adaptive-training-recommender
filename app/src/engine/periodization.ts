import type {
    EventDemandProfile,
    EventPriority,
    GoalCategory,
    UserEvent,
    UserGoal,
} from './models';
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

    const datedEvents = events.map(event => ({
        event,
        daysToEvent: getDaysBetween(currentDateStr, event.date),
    }));

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
        };
    }

    // Resolve focus event by Priority (A > B > C) and then Proximity.
    const sortedEvents = [...eligibleEvents].sort((a, b) => {
        const prioMap = { A: 1, B: 2, C: 3 };
        if (prioMap[a.event.priority] !== prioMap[b.event.priority]) {
            return prioMap[a.event.priority] - prioMap[b.event.priority];
        }
        return a.daysToEvent - b.daysToEvent;
    });

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
        // Taper threshold: A-Events taper up to 14 days, B-Events up to 5 days,
        // C-Events train through.
        const taperWindowDays = focusEvent.priority === 'A' ? 14 : (focusEvent.priority === 'B' ? 5 : 0);

        if (taperWindowDays > 0 && daysToEvent <= taperWindowDays) {
            const taperProgress = 1 - (daysToEvent / taperWindowDays);
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
    };
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
    };
}
