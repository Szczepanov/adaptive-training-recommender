import type {
    FixedActivity,
    SubjectiveInput,
    TrainingEnvironment,
    UserContext,
    WorkoutCostProfile,
} from './models';
import { resolveMaximumSessionMinutes } from './eligibility';

export interface ResolvedAvailability {
    date: string;
    maxTimeMinutes: number;
    availableEquipment: string[];
    fixedActivities: FixedActivity[];
    /** Compatibility scalar, equal to `reservedCapacityCostProfile.systemic` -- kept so
     *  existing callers/tests reading a single number are unaffected by Phase 6.2b's move
     *  to a dimensional profile. Prefer `reservedCapacityCostProfile` in new code. */
    reservedCapacityCost: number;
    /** Phase 6.2b: dimensional reserved load from today's uncompleted fixed activities'
     *  own authored `expectedCost` -- never an invented default (D6-C). Consumed by
     *  planner.ts's ranking loop so same-day candidate selection can see it without
     *  marking it as already-completed load. */
    reservedCapacityCostProfile: WorkoutCostProfile;
    /** Phase 6.2b / D6-B: the day-wide environment restriction from an explicitly authored
     *  `FixedActivity.availabilityContextOverride`, or `null` when no fixed activity on
     *  this date declares one. A fixed activity's own `environment` never leaks into this
     *  field -- only an explicit override does. */
    environmentOverride: TrainingEnvironment | null;
}

/** Equipment keys sourced strictly from the athlete's own constraints -- no day-of-week
 *  or "preferred location" fabrication. There used to be a DEFAULT_WEEKLY_SCHEDULE that
 *  hardcoded Tue/Thu as "gym" days and granted a full commercial-gym equipment bundle
 *  (cable machine, treadmill, indoor bike) on those days regardless of what the athlete
 *  actually has access to, and 'home' as the fallback that granted free_weights
 *  unconditionally. Nothing in the app ever let a user configure that schedule, so it
 *  silently invented equipment access every single day. Equipment must be a hard fact
 *  the athlete set in Training Settings, not a fiction tied to the calendar.
 */
const EQUIPMENT_CONSTRAINT_MAP: Record<string, keyof Pick<UserContext['constraints'], 'hasFreeWeights' | 'hasCableMachine' | 'hasTreadmill' | 'hasIndoorBike'>> = {
    free_weights: 'hasFreeWeights',
    cable_machine: 'hasCableMachine',
    treadmill: 'hasTreadmill',
    indoor_bike: 'hasIndoorBike',
};

/** Only used when no UserContext at all is supplied (e.g. a bare/legacy call site) and
 *  there's no real check-in either -- matches the previous unconfigured-schedule default. */
const NO_CONTEXT_FALLBACK_MINUTES = 60;

/** Additive sport-access keys exist only on `TrainingSettings.equipment` -- there is no
 *  legacy `UserContext.constraints` boolean for them (unlike free_weights/cable_machine/
 *  treadmill/indoor_bike, which both shapes carry). Without this, granting
 *  `outdoor_bike`/`swim_access` in Training Settings would never reach the schedule this
 *  function builds, so every outdoor-cycling and swimming template stays permanently
 *  unavailable regardless of what the athlete declared. */
const ADDITIVE_SPORT_ACCESS_KEYS = ['outdoor_bike', 'swim_access'] as const;

function resolveOwnedEquipment(
    constraints: UserContext['constraints'] | null | undefined,
    trainingSettings: UserContext['trainingSettings'] | null | undefined
): string[] {
    const owned = constraints
        ? Object.entries(EQUIPMENT_CONSTRAINT_MAP)
            .filter(([, flag]) => constraints[flag])
            .map(([equipment]) => equipment)
        : [];
    if (trainingSettings?.equipment) {
        for (const key of ADDITIVE_SPORT_ACCESS_KEYS) {
            if (trainingSettings.equipment[key]) owned.push(key);
        }
    }
    return owned;
}

const ZERO_COST_PROFILE: WorkoutCostProfile = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};

/**
 * Sums reserved dimensional load from future (uncompleted) fixed activities, e.g. evening
 * football. Reserves capacity for the day without injecting pre-mature fatigue before
 * execution -- see planner.ts for where it is folded into same-day ranking and, at end of
 * day, into next-day external fatigue.
 *
 * D6-C: a missing `expectedCost` means "unknown/not modelled" and contributes zero. A
 * prior revision defaulted the whole activity to `systemic: 0.2` when `expectedCost` was
 * absent -- an invented heuristic this function must not reintroduce; the activity's time
 * is still reserved via `durationMin`/`availabilityOverride` regardless.
 */
function calculateReservedCapacityProfile(futureActivities: FixedActivity[]): WorkoutCostProfile {
    return futureActivities.reduce((sum, act) => {
        const cost = act.expectedCost;
        if (!cost) return sum;
        return {
            systemic: sum.systemic + (cost.systemic ?? 0),
            cardiovascular: sum.cardiovascular + (cost.cardiovascular ?? 0),
            lowerBody: sum.lowerBody + (cost.lowerBody ?? 0),
            upperBody: sum.upperBody + (cost.upperBody ?? 0),
            impactTissue: sum.impactTissue + (cost.impactTissue ?? 0),
            neuromuscular: sum.neuromuscular + (cost.neuromuscular ?? 0),
        };
    }, ZERO_COST_PROFILE);
}

/** Phase 6.2b / D6-B: an activity's own `environment`/`equipment` describe itself, not the
 *  whole day -- only an explicitly authored `availabilityContextOverride` restricts other
 *  sessions on the same date. Multiple same-day overrides intersect (equipment) / the
 *  first non-'either' value wins (environment), matching `availabilityOverride`'s existing
 *  "most restrictive wins" philosophy rather than optimistically picking the widest one. */
function resolveDayContextOverride(dayActivities: FixedActivity[]): {
    environment: TrainingEnvironment | null;
    equipment: string[] | null;
} {
    const overrides = dayActivities
        .map(a => a.availabilityContextOverride)
        .filter((o): o is NonNullable<FixedActivity['availabilityContextOverride']> => !!o);

    let environment: TrainingEnvironment | null = null;
    for (const o of overrides) {
        if (!o.environment || o.environment === 'either') continue;
        if (environment === null) environment = o.environment;
        // A second, conflicting non-'either' override the same day is a data problem, not
        // something to silently resolve by picking one -- keep the first found rather than
        // flip-flop, but do not widen back to unrestricted either.
    }

    let equipment: string[] | null = null;
    for (const o of overrides) {
        if (!o.equipment) continue;
        equipment = equipment === null ? o.equipment : equipment.filter(item => o.equipment!.includes(item));
    }

    return { environment, equipment };
}

/**
 * Resolves availability for a given date by combining:
 * 1. The athlete's own weekday/weekend time budget (TrainingSettings.defaults, the same
 *    ceiling resolveMaximumSessionMinutes already applies for today -- see eligibility.ts)
 * 2. Today's check-in time, when present, capped by that same profile ceiling rather
 *    than blindly overriding it
 * 3. Scheduled fixed activities (deducting duration & reserving capacity)
 * 4. Equipment actually owned, per constraints -- see resolveOwnedEquipment above
 */
export function resolveAvailability(
    dateStr: string,
    checkin: SubjectiveInput | null,
    fixedActivities: FixedActivity[] = [],
    userContext?: UserContext | null
): ResolvedAvailability {
    // 1 & 2. Resolve Base Time Available -- a real check-in still wins over the profile
    // default, but is now capped by it (matching eligibility.ts's resolveMaximumSessionMinutes,
    // which already enforced this same cap for today's hard eligibility gate; this used
    // to be a second, looser, uncapped implementation of the same "how much time do you
    // have" question). With no real check-in, the "checkin" ceiling is left unbounded so
    // resolveMaximumSessionMinutes's own weekday/weekend profile default -- or, lacking a
    // profile, the athlete's constraints.maxTimeMinutes -- is what actually decides, with
    // nothing artificially capping it first.
    const checkinMinutes = (checkin && checkin.timeAvailable !== undefined && checkin.timeAvailable !== null)
        ? checkin.timeAvailable
        : Number.POSITIVE_INFINITY;
    const baseTime = userContext
        ? resolveMaximumSessionMinutes(userContext, checkinMinutes, dateStr)
        : (Number.isFinite(checkinMinutes) ? checkinMinutes : NO_CONTEXT_FALLBACK_MINUTES);

    // 3. Process Fixed Activities on Target Date
    // Deliberately not filtered by `fixed: true/false` -- a movable placeholder still
    // occupies real time on the date it is currently scheduled for, so it must reduce
    // availability exactly like an immovable commitment does. `fixed` (movable vs
    // immovable) is captured on the model but not yet consumed here: it becomes
    // load-bearing once sequence search (Phase 5.1/5.2) can reason about shifting a
    // movable placeholder to a different day, at which point *that* code -- not this
    // availability calculation -- is what should treat movable and immovable differently.
    const daysFixed = fixedActivities.filter(a => a.date === dateStr);
    // An availabilityOverride caps the whole day's budget outright (e.g. a travel day
    // where the normal weekday/weekend profile default no longer applies) *before* any
    // individual activity's own duration is deducted below. Several overrides on the same
    // day take the most restrictive (min) -- optimistic combination would understate how
    // constrained the day actually is.
    const overrides = daysFixed
        .map(a => a.availabilityOverride)
        .filter((value): value is number => typeof value === 'number');
    const overriddenBaseTime = overrides.length > 0 ? Math.min(baseTime, ...overrides) : baseTime;
    const fixedDurationSum = daysFixed.reduce((sum, a) => sum + a.durationMin, 0);
    const remainingTimeMin = Math.max(0, overriddenBaseTime - fixedDurationSum);

    // 4. Resolve Available Equipment -- an explicit availabilityContextOverride (D6-B)
    // intersects the athlete's standing equipment with what is actually reachable that
    // day (e.g. a hotel gym's limited rack); absent any override, standing equipment is
    // unrestricted, same as before.
    const dayContext = resolveDayContextOverride(daysFixed);
    const ownedEquipment = resolveOwnedEquipment(userContext?.constraints, userContext?.trainingSettings);
    const equipmentSet = new Set<string>(
        dayContext.equipment ? ownedEquipment.filter(item => dayContext.equipment!.includes(item)) : ownedEquipment
    );

    // 5. Calculate Reserved Capacity (Future uncompleted fixed activities)
    const uncompletedFuture = daysFixed.filter(a => !a.isCompleted);
    const reservedCapacityCostProfile = calculateReservedCapacityProfile(uncompletedFuture);

    const userEnvironment = (userContext as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? (userContext?.constraints as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? null;
    const normalizedUserEnvironment = userEnvironment === 'either' ? null : userEnvironment;

    return {
        date: dateStr,
        maxTimeMinutes: remainingTimeMin,
        availableEquipment: Array.from(equipmentSet),
        fixedActivities: daysFixed,
        reservedCapacityCost: reservedCapacityCostProfile.systemic,
        reservedCapacityCostProfile,
        environmentOverride: dayContext.environment ?? normalizedUserEnvironment,
    };
}
