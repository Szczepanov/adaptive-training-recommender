import type {
    FixedActivity,
    ScheduleOverlay,
    SubjectiveInput,
    TrainingEnvironment,
    UserContext,
    WorkoutCostProfile,
} from './models';
import { resolveMaximumSessionMinutes } from './eligibility';
import { sumFixedActivityCostProfiles } from './fixedActivityCostProfile';

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
     *  own authored `expectedCost` plus active schedule-overlay load. Consumed by the
     *  ranking path as same-day reserved capacity, then carried into subsequent projected
     *  dates only after that date is passed. */
    reservedCapacityCostProfile: WorkoutCostProfile;
    /** Product of all active schedule-overlay volume/intensity multipliers. Real
     *  `resolveAvailability()` results always emit both fields. They remain optional on
     *  the interface for legacy/synthetic resolved-availability fixtures created before
     *  schedule overlays existed; consumers must treat absence as the neutral scale 1. */
    volumeScale?: number;
    intensityScale?: number;
    /** Day-wide hard environment restriction. `null` is unrestricted. A resolved value of
     *  `either` is used only as a conservative conflict sentinel when simultaneous hard
     *  constraints disagree (for example one overlay says indoor and another outdoor):
     *  downstream gates then admit only environment-neutral (`either`) templates. Input
     *  `either` values remain neutral and do not create a restriction on their own. */
    environmentOverride: TrainingEnvironment | null;
}

/** Equipment keys sourced strictly from the athlete's own constraints -- no day-of-week
 *  or "preferred location" fabrication. Equipment must be a hard fact the athlete set in
 *  Training Settings, not a fiction tied to the calendar. */
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
 *  legacy `UserContext.constraints` boolean for them. */
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

function activeScheduleOverlaysForDate(scheduleOverlays: readonly ScheduleOverlay[], date: string): ScheduleOverlay[] {
    return scheduleOverlays.filter(overlay => overlay.startDate <= date && date <= overlay.endDate);
}

function addCostProfileClamped(base: WorkoutCostProfile, extra: WorkoutCostProfile): WorkoutCostProfile {
    return {
        systemic: Math.min(1, base.systemic + extra.systemic),
        cardiovascular: Math.min(1, base.cardiovascular + extra.cardiovascular),
        lowerBody: Math.min(1, base.lowerBody + extra.lowerBody),
        upperBody: Math.min(1, base.upperBody + extra.upperBody),
        impactTissue: Math.min(1, base.impactTissue + extra.impactTissue),
        neuromuscular: Math.min(1, base.neuromuscular + extra.neuromuscular),
    };
}

/** Aggregate the planned non-training load contributed by all overlays active on a date.
 * It is exported so the rolling planner and tomorrow projection can carry exactly the
 * same per-day cost that same-day availability/ranking sees, instead of inventing a
 * second interpretation of ScheduleOverlay.expectedCost. */
export function scheduleOverlayCostProfileForDate(
    scheduleOverlays: readonly ScheduleOverlay[],
    date: string,
): WorkoutCostProfile {
    return activeScheduleOverlaysForDate(scheduleOverlays, date).reduce(
        (sum, overlay) => addCostProfileClamped(sum, overlay.expectedCost),
        { ...ZERO_COST_PROFILE },
    );
}

/** Sums reserved dimensional load from future (uncompleted) fixed activities. Missing
 * expectedCost contributes zero; filtering by date/completion remains the caller's job. */
function calculateReservedCapacityProfile(futureActivities: FixedActivity[]): WorkoutCostProfile {
    return sumFixedActivityCostProfiles(futureActivities);
}

/** Equipment overrides describe which of the athlete's standing equipment is reachable
 * that day. Multiple explicit same-day lists intersect; omission means no new restriction.
 * Environment is resolved separately so *all* hard sources can participate in conflict
 * detection rather than depending on document order. */
function resolveDayEquipmentOverride(dayActivities: FixedActivity[]): string[] | null {
    const overrides = dayActivities
        .map(activity => activity.availabilityContextOverride?.equipment)
        .filter((equipment): equipment is string[] => Array.isArray(equipment));
    let equipment: string[] | null = null;
    for (const available of overrides) {
        equipment = equipment === null ? available : equipment.filter(item => available.includes(item));
    }
    return equipment;
}

function resolveEnvironmentOverride(
    dayActivities: readonly FixedActivity[],
    activeOverlays: readonly ScheduleOverlay[],
    userEnvironment: TrainingEnvironment | null,
): TrainingEnvironment | null {
    const hardEnvironments: TrainingEnvironment[] = [];
    if (userEnvironment && userEnvironment !== 'either') hardEnvironments.push(userEnvironment);
    for (const activity of dayActivities) {
        const environment = activity.availabilityContextOverride?.environment;
        if (environment && environment !== 'either') hardEnvironments.push(environment);
    }
    for (const overlay of activeOverlays) {
        if (overlay.environment && overlay.environment !== 'either') hardEnvironments.push(overlay.environment);
    }
    const unique = Array.from(new Set(hardEnvironments));
    if (unique.length === 0) return null;
    if (unique.length === 1) return unique[0];
    // Conservative resolved-only conflict sentinel: existing environment gates interpret
    // this as "only a template authored for either environment is safe to keep".
    return 'either';
}

/**
 * Resolves availability for a given date by combining the athlete's own time/equipment
 * constraints, explicit fixed activities, and persisted schedule overlays. Schedule
 * overlays are planning constraints, not completed training: their cost reserves today's
 * capacity here and is carried forward by the forecast only after each covered date.
 */
export function resolveAvailability(
    dateStr: string,
    checkin: SubjectiveInput | null,
    fixedActivities: FixedActivity[] = [],
    userContext?: UserContext | null,
    scheduleOverlays: readonly ScheduleOverlay[] = [],
): ResolvedAvailability {
    const checkinMinutes = (checkin && checkin.timeAvailable !== undefined && checkin.timeAvailable !== null)
        ? checkin.timeAvailable
        : Number.POSITIVE_INFINITY;
    const baseTime = userContext
        ? resolveMaximumSessionMinutes(userContext, checkinMinutes, dateStr)
        : (Number.isFinite(checkinMinutes) ? checkinMinutes : NO_CONTEXT_FALLBACK_MINUTES);

    const daysFixed = fixedActivities.filter(activity => activity.date === dateStr);
    const activeOverlays = activeScheduleOverlaysForDate(scheduleOverlays, dateStr);

    const fixedOverrides = daysFixed
        .map(activity => activity.availabilityOverride)
        .filter((value): value is number => typeof value === 'number');
    const overlayOverrides = activeOverlays.map(overlay => overlay.dailyAvailabilityMinutes);
    const allOverrides = [...fixedOverrides, ...overlayOverrides];

    const overriddenBaseTime = allOverrides.length > 0 ? Math.min(baseTime, ...allOverrides) : baseTime;
    const fixedDurationSum = daysFixed.reduce((sum, activity) => sum + activity.durationMin, 0);
    const remainingTimeMin = Math.max(0, overriddenBaseTime - fixedDurationSum);

    const dayEquipment = resolveDayEquipmentOverride(daysFixed);
    const ownedEquipment = resolveOwnedEquipment(userContext?.constraints, userContext?.trainingSettings);
    let effectiveEquipment = dayEquipment ? ownedEquipment.filter(item => dayEquipment.includes(item)) : ownedEquipment;
    for (const overlay of activeOverlays) {
        // Omission means "no new restriction"; an explicitly authored [] deliberately
        // means there is no usable equipment during this block.
        if (overlay.equipment) {
            effectiveEquipment = effectiveEquipment.filter(item => overlay.equipment!.includes(item));
        }
    }

    const uncompletedFuture = daysFixed.filter(activity => !activity.isCompleted);
    const fixedCost = calculateReservedCapacityProfile(uncompletedFuture);
    const overlayCost = scheduleOverlayCostProfileForDate(scheduleOverlays, dateStr);
    const reservedCapacityCostProfile = addCostProfileClamped(fixedCost, overlayCost);
    const volumeScale = activeOverlays.reduce((scale, overlay) => scale * overlay.volumeScale, 1);
    const intensityScale = activeOverlays.reduce((scale, overlay) => scale * overlay.intensityScale, 1);

    const userEnvironment = (userContext as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? (userContext?.constraints as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? null;
    const environmentOverride = resolveEnvironmentOverride(daysFixed, activeOverlays, userEnvironment);

    return {
        date: dateStr,
        maxTimeMinutes: remainingTimeMin,
        availableEquipment: Array.from(new Set(effectiveEquipment)),
        fixedActivities: daysFixed,
        reservedCapacityCost: reservedCapacityCostProfile.systemic,
        reservedCapacityCostProfile,
        volumeScale,
        intensityScale,
        environmentOverride,
    };
}
