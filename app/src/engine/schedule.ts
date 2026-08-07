import type {
    DayOfWeekSchedule,
    FixedActivity,
    LocationContext,
    LocationProfile,
    SubjectiveInput,
} from './models';

export interface ResolvedAvailability {
    date: string;
    maxTimeMinutes: number;
    location: LocationContext;
    availableEquipment: string[];
    fixedActivities: FixedActivity[];
    reservedCapacityCost: number;
}

export const DEFAULT_LOCATIONS: Record<LocationContext, LocationProfile> = {
    home: {
        id: 'home',
        displayName: 'Home Gym',
        availableEquipment: ['free_weights'],
    },
    gym: {
        id: 'gym',
        displayName: 'Commercial Gym',
        availableEquipment: ['free_weights', 'cable_machine', 'treadmill', 'indoor_bike'],
    },
    travel: {
        id: 'travel',
        displayName: 'Hotel / Travel',
        availableEquipment: [],
    },
};

export const DEFAULT_WEEKLY_SCHEDULE: DayOfWeekSchedule[] = [
    { dayOfWeek: 0, defaultMaxTimeMin: 120, preferredLocation: 'home' }, // Sun
    { dayOfWeek: 1, defaultMaxTimeMin: 45, preferredLocation: 'home' },  // Mon
    { dayOfWeek: 2, defaultMaxTimeMin: 60, preferredLocation: 'gym' },   // Tue
    { dayOfWeek: 3, defaultMaxTimeMin: 45, preferredLocation: 'home' },  // Wed
    { dayOfWeek: 4, defaultMaxTimeMin: 60, preferredLocation: 'gym' },   // Thu
    { dayOfWeek: 5, defaultMaxTimeMin: 45, preferredLocation: 'home' },  // Fri
    { dayOfWeek: 6, defaultMaxTimeMin: 120, preferredLocation: 'home' }, // Sat
];

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
 * 1. Default day-of-week schedule & time limits
 * 2. Target day check-in time overrides (if present)
 * 3. Scheduled fixed activities (deducting duration & reserving capacity)
 * 4. Location & available equipment profile
 */
export function resolveAvailability(
    dateStr: string,
    checkin: SubjectiveInput | null,
    weeklySchedule: DayOfWeekSchedule[] = DEFAULT_WEEKLY_SCHEDULE,
    locations: Record<LocationContext, LocationProfile> = DEFAULT_LOCATIONS,
    fixedActivities: FixedActivity[] = [],
    currentLocationOverride?: LocationContext
): ResolvedAvailability {
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = dateObj.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const daySchedule = weeklySchedule.find(s => s.dayOfWeek === dayOfWeek);

    // 1. Resolve Base Time Available
    let baseTime = daySchedule ? daySchedule.defaultMaxTimeMin : 60;
    if (checkin && checkin.timeAvailable !== undefined && checkin.timeAvailable !== null) {
        baseTime = checkin.timeAvailable;
    }

    // 2. Process Fixed Activities on Target Date
    const daysFixed = fixedActivities.filter(a => a.date === dateStr);
    const fixedDurationSum = daysFixed.reduce((sum, a) => sum + a.durationMin, 0);
    const remainingTimeMin = Math.max(0, baseTime - fixedDurationSum);

    // 3. Resolve Location & Available Equipment
    const locationKey = currentLocationOverride || daySchedule?.preferredLocation || 'home';
    const locationProfile = locations[locationKey] || locations['home'];

    // 4. Calculate Reserved Capacity (Future uncompleted fixed activities)
    const uncompletedFuture = daysFixed.filter(a => !a.isCompleted);
    const reservedCapacityCost = calculateReservedCapacity(uncompletedFuture);

    return {
        date: dateStr,
        maxTimeMinutes: remainingTimeMin,
        location: locationKey,
        availableEquipment: locationProfile.availableEquipment,
        fixedActivities: daysFixed,
        reservedCapacityCost,
    };
}
