import type { SessionTemplate, TrainingIntentProfile, UserContext, UserPreferences } from './models';
import type { CompletedExposure } from './trainingHistory';
import type { MechanicalProgressionVerdict } from './mechanicalProgression';
import type { MechanicalSuspensionSource, PolicyWarning } from './evergreenStrategy';
import type { PlanningMode } from './models';
import { evaluateTemplateEligibility } from './eligibility';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { MECHANICAL_MAINTENANCE_WORKOUT_IDS, type MechanicalStage } from '../workouts/mechanicalExposure';
import { ATHLETIC_CAPABILITY_IDENTITIES } from '../workouts/athleticCapability';
import {
    capabilityProgressionTargetStage,
    evaluateCapabilityCadence,
    evaluateCapabilityMaintenance,
    type CapabilityExposureRecord,
    type CapabilityMaintenanceInput,
    type CapabilityMaintenanceResult,
} from './capabilityMaintenance';

/**
 * Issue #805 adapter between evergreen planning and the pure capability evaluator. It reads
 * the existing hard-gate authorities (template eligibility, preferences, resolved schedule
 * environment) and never re-implements them; #804 tissue progression stays in
 * `mechanicalProgression.ts`.
 */

/** Only one wide-enough window is used for eligibility: time fit is a placement concern. */
const UNBOUNDED_SESSION_MINUTES = 24 * 60;

function capabilityExposures(exposures: readonly CompletedExposure[]): CapabilityExposureRecord[] {
    return exposures.flatMap(exposure => exposure.workoutId ? [{ date: exposure.date, workoutId: exposure.workoutId }] : []);
}

/** D-C step 1: the stage #804 should aim for, from cadence alone. Undefined when opted out. */
export function capabilityTargetStage(
    profile: TrainingIntentProfile,
    date: string,
    planningHorizonDays: number,
    exposures: readonly CompletedExposure[],
    observedWindowDays: number,
): MechanicalStage | undefined {
    if (!profile.capabilityMaintenance?.enabled) return undefined;
    return capabilityProgressionTargetStage(evaluateCapabilityCadence({
        asOfDate: date,
        planningHorizonDays,
        preference: profile.capabilityMaintenance,
        exposures: capabilityExposures(exposures),
        observedWindowDays,
    }));
}

function templateForWorkout(workoutId: string): SessionTemplate | undefined {
    const templateId = WORKOUTS_BY_ID.get(workoutId)?.engineTemplateIds?.[0];
    return templateId ? ENRICHED_TEMPLATES_BY_ID.get(templateId) : undefined;
}

const hasModality = (list: readonly string[] | undefined, modality: string): boolean =>
    (list ?? []).some(item => item.toLowerCase() === modality.toLowerCase());

/** Per-identity hard gates from the existing authorities, keyed by exact workout id. */
export function capabilityGates(
    context: UserContext,
    preferences: UserPreferences,
    date: string,
    /** Resolved schedule-overlay environment per plannable date (null = unconstrained). */
    environmentWindows: readonly { date: string; environmentOverride: string | null | undefined }[],
): CapabilityMaintenanceInput['gates'] {
    const guardrailBlocked = new Set<string>();
    const unavailable = new Set<string>();
    const avoided = new Set<string>();
    const environmentUnavailable = new Set<string>();
    const environmentAvailableDates = new Map<string, readonly string[]>();
    const minimumDurationMinutes = new Map<string, number>();
    const capabilityMinimumDurationMinutes = new Map<string, number>();
    for (const identity of ATHLETIC_CAPABILITY_IDENTITIES) {
        const workout = WORKOUTS_BY_ID.get(identity.workoutId);
        if (!workout) continue;
        const qualifyingDurations = workout.variants
            .filter(variant => identity.qualifyingVariants.includes(variant.id))
            .map(variant => variant.targetDurationMin);
        if (qualifyingDurations.length > 0) {
            capabilityMinimumDurationMinutes.set(
                `${identity.capability}:${identity.workoutId}`,
                Math.min(...qualifyingDurations),
            );
        }
    }
    const deprioritized = new Set<string>();
    for (const workoutId of MECHANICAL_MAINTENANCE_WORKOUT_IDS) {
        const workout = WORKOUTS_BY_ID.get(workoutId);
        const template = templateForWorkout(workoutId);
        if (workout?.duration.minimumMin !== undefined) minimumDurationMinutes.set(workoutId, workout.duration.minimumMin);
        if (!template) {
            environmentUnavailable.add(workoutId);
            environmentAvailableDates.set(workoutId, []);
            continue;
        }
        if (hasModality(preferences.unavailableModalities, template.modality)) unavailable.add(workoutId);
        if (hasModality(preferences.avoidedModalities, template.modality)) avoided.add(workoutId);
        if (hasModality(preferences.deprioritizedModalities, template.modality)) deprioritized.add(workoutId);
        const { reasons } = evaluateTemplateEligibility(template, context, UNBOUNDED_SESSION_MINUTES, date);
        if (reasons.includes('safety_guardrail') || reasons.includes('restricted_category')
            || (reasons.includes('restricted_modality') && !unavailable.has(workoutId))) {
            guardrailBlocked.add(workoutId);
        }
        if (reasons.includes('environment') || reasons.includes('equipment')) environmentUnavailable.add(workoutId);
        const environmentDates = environmentWindows
            .filter(window => !window.environmentOverride
                || template.environment === 'either'
                || template.environment === window.environmentOverride)
            .map(window => window.date);
        environmentAvailableDates.set(workoutId, environmentDates);
        if (environmentWindows.length > 0 && environmentDates.length === 0) environmentUnavailable.add(workoutId);
    }
    return {
        guardrailBlocked, unavailable, avoided, environmentUnavailable,
        environmentAvailableDates, minimumDurationMinutes, capabilityMinimumDurationMinutes, deprioritized,
    };
}

export interface CapabilityMaintenancePlanInput {
    profile: TrainingIntentProfile;
    mode: PlanningMode;
    date: string;
    planningHorizonDays: number;
    exposures: readonly CompletedExposure[];
    observedWindowDays: number;
    mechanicalSuspension: MechanicalSuspensionSource | null;
    mechanicalRequirementPresent: boolean;
    mechanicalVerdict: MechanicalProgressionVerdict | null;
    gates: CapabilityMaintenanceInput['gates'];
    supportCapacityDates: readonly string[];
    supportCapacityMinutesByDate?: ReadonlyMap<string, number>;
}

/** D-F/D-H: typed readout plus a warning only for owed-but-blocked/unknown capabilities.
 * A deliberate suspension stays visible in the result but is not a warning. */
export function resolveCapabilityMaintenancePlan(input: CapabilityMaintenancePlanInput): {
    result: CapabilityMaintenanceResult;
    warnings: PolicyWarning[];
} | null {
    if (!input.profile.capabilityMaintenance?.enabled) return null;
    const result = evaluateCapabilityMaintenance({
        asOfDate: input.date,
        planningHorizonDays: input.planningHorizonDays,
        preference: input.profile.capabilityMaintenance,
        exposures: capabilityExposures(input.exposures),
        observedWindowDays: input.observedWindowDays,
        mode: input.mode,
        mechanicalSuspension: input.mechanicalSuspension,
        mechanicalRequirementPresent: input.mechanicalRequirementPresent,
        mechanicalVerdict: input.mechanicalVerdict,
        gates: input.gates,
        supportCapacityDates: input.supportCapacityDates,
        supportCapacityMinutesByDate: input.supportCapacityMinutesByDate,
    });
    const warnings: PolicyWarning[] = result.capabilities
        .filter(item => (item.status === 'due' || item.status === 'overdue')
            && (item.fulfilment?.status === 'blocked' || item.fulfilment?.status === 'unknown'))
        .map(item => ({
            code: 'capability_maintenance_unfulfilled' as const,
            message: `${item.capability}: ${item.message}`,
        }));
    return { result, warnings };
}
