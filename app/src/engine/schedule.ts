import type {
    FixedActivity,
    SubjectiveInput,
    UserContext,
} from './models';
import { resolveMaximumSessionMinutes } from './eligibility';

export interface ResolvedAvailability {
    date: string;
    maxTimeMinutes: number;
    availableEquipment: string[];
    fixedActivities: FixedActivity[];
    reservedCapacityCost: number;
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

function resolveOwnedEquipment(constraints: UserContext['constraints'] | null | undefined): string[] {
    if (!constraints) return [];
    return Object.entries(EQUIPMENT_CONSTRAINT_MAP)
        .filter(([, flag]) => constraints[flag])
        .map(([equipment]) => equipment);
}

/**
 * Calculates reserved capacity cost from future fixed activities (e.g. evening football).
 * Reserves capacity for the day without injecting pre-mature fatigue before execution.
 */
function calculateReservedCapacity(futureActivities: FixedActivity[]): number {
    if (futureActivities.length === 0) return 0;
    return futureActivities.reduce((sum, act) => {
        const cost = act.expectedCost?.systemic ?? 0.2;
        return sum + cost;
    }, 0);
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
    const daysFixed = fixedActivities.filter(a => a.date === dateStr);
    const fixedDurationSum = daysFixed.reduce((sum, a) => sum + a.durationMin, 0);
    const remainingTimeMin = Math.max(0, baseTime - fixedDurationSum);

    // 4. Resolve Available Equipment
    const equipmentSet = new Set<string>(resolveOwnedEquipment(userContext?.constraints));

    // 5. Calculate Reserved Capacity (Future uncompleted fixed activities)
    const uncompletedFuture = daysFixed.filter(a => !a.isCompleted);
    const reservedCapacityCost = calculateReservedCapacity(uncompletedFuture);

    return {
        date: dateStr,
        maxTimeMinutes: remainingTimeMin,
        availableEquipment: Array.from(equipmentSet),
        fixedActivities: daysFixed,
        reservedCapacityCost,
    };
}
