import { addDaysToLocalDateString } from '../utils/localDate';
import type { AthleticCapabilityKey, CapabilityMaintenancePreference } from './models';
import type { MechanicalProgressionVerdict } from './mechanicalProgression';
import {
    ATHLETIC_CAPABILITY_WORKOUT_IDS,
    athleticCapabilitiesCreditedBy,
    athleticCapabilityStageFor,
    capabilityIdentitiesFor,
    grantsAthleticCapabilityCredit,
} from '../workouts/athleticCapability';
import type { MechanicalDoseVariant, MechanicalStage } from '../workouts/mechanicalExposure';
import { mechanicalIdentityFor } from '../workouts/mechanicalExposure';

/**
 * Issue #805: pure rolling evaluator for periodic broad-athleticism capability maintenance.
 *
 * No IO and no clock: every date arrives as input. Cadence (is a touch owed, and from which
 * date?) is kept separate from fulfilment (can it be delivered now, and if not, why?), as
 * ADR-0044 D9 requires: a blocked capability is suspended, never substituted.
 *
 * Owned by the `policy.evergreen.athletic_capability_maintenance_v1` knowledge claim.
 */

/** Fixed v1 product guardrail (D-G), not a validated physiological cliff: the maximum gap
 * between qualifying touches. It equals #804's mechanical continuity window, so a touch is due
 * one day before the gap would reach it (`ATHLETIC_CAPABILITY_DUE_OFFSET_DAYS`) -- otherwise the
 * due date itself would be a #804 re-entry day and reset the athlete to Stage 1. */
export const ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS = 14;
export const ATHLETIC_CAPABILITY_DUE_OFFSET_DAYS = ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS - 1;

export const ATHLETIC_CAPABILITIES: readonly AthleticCapabilityKey[] = [
    'linear_speed_skill', 'acceleration_deceleration', 'multidirectional_change_of_direction', 'sport_skill',
];

export type CapabilityCadenceStatus = 'disabled' | 'insufficient_history' | 'satisfied' | 'due' | 'overdue';
export type CapabilityFulfilmentStatus = 'plannable' | 'blocked' | 'deliberately_suspended' | 'unknown';

export type CapabilityBlockedReason =
    | 'mechanical_guardrail'
    | 'mechanical_stage_insufficient'
    | 'modality_unavailable'
    | 'modality_avoided'
    | 'environment_unavailable'
    | 'no_support_capacity';
export type CapabilitySuspendedReason =
    | 'mechanical_withheld'
    | 'adverse_recovery'
    | 'clinical_symptoms'
    | 'event_phase'
    | 'event_directed_mode';
export type CapabilityUnknownReason = 'mechanical_requirement_absent' | 'history_unavailable';
export type CapabilityFulfilmentReason = CapabilityBlockedReason | CapabilitySuspendedReason | CapabilityUnknownReason;

export interface CapabilityFulfilment {
    status: CapabilityFulfilmentStatus;
    reason?: CapabilityFulfilmentReason;
}

export interface CapabilityExposureRecord {
    date: string;
    workoutId?: string;
    variant?: MechanicalDoseVariant;
    isReadinessModifiedDose?: boolean;
}

export interface CapabilityCadence {
    capability: AthleticCapabilityKey;
    status: CapabilityCadenceStatus;
    lastQualifyingDate?: string;
    nextDueDate?: string;
    /** Placement authority (F12): a capability-bearing touch must not land before this date. */
    notBeforeDate?: string;
    /** Preferred placement date among feasible dates. */
    targetDate?: string;
    /** Lowest #804 stage at which any authored identity delivers this capability. */
    requiredStage: MechanicalStage;
}

export interface CapabilityMaintenanceStatus extends CapabilityCadence {
    /** Present only for `due`, `overdue` and `insufficient_history`. */
    fulfilment?: CapabilityFulfilment;
    /** Exact identities on this capability's delivery path, already gate-filtered. For a
     * plannable capability these are its stage-eligible identities; for a stage-insufficient
     * one they are the highest currently eligible #804 identities, so progression can occur. */
    supportWorkoutIds: readonly string[];
    message: string;
}

/** Date-scoped placement for the single #804 mechanical support occurrence (D-C/D-E, F12).
 * It never creates its own occurrence; it narrows and, for exact capability identities,
 * consents on dates on/after `notBeforeDate` until a qualifying touch is recorded. */
export interface CapabilityPlacement {
    capability: AthleticCapabilityKey;
    notBeforeDate: string;
    targetDate: string;
    /** Narrowed allow-list for the support occurrence on/after `notBeforeDate`. */
    workoutIds: readonly string[];
    /** The subset that are exact athletic-capability identities: these alone may satisfy
     * `requiresExplicitModalityPreference` through the opt-in. */
    consentWorkoutIds: readonly string[];
    /** True when the touch steers #804 progression rather than delivering the capability. */
    progressionOnly: boolean;
    /** The planning date the placement was resolved on. Any qualifying touch from this date on
     * closes it, so a touch that already credited the capability earlier in the horizon is
     * never followed by a second, forced session. */
    plannedOnDate: string;
}

export interface CapabilityMaintenanceResult {
    enabled: boolean;
    intervalDays: number;
    capabilities: CapabilityMaintenanceStatus[];
    placements: CapabilityPlacement[];
    /** Soft context only (e.g. a deprioritized modality); never a block. */
    softContext: string[];
}

export interface CapabilityCadenceInput {
    asOfDate: string;
    /** Dates `[asOfDate, asOfDate + planningHorizonDays - 1]` are plannable. */
    planningHorizonDays: number;
    preference: CapabilityMaintenancePreference | null | undefined;
    exposures: readonly CapabilityExposureRecord[];
    observedWindowDays: number;
}

export type CapabilitySuspensionSource = 'adverse_recovery' | 'clinical_symptoms' | 'event_phase' | 'mechanical_withheld';

export interface CapabilityMaintenanceInput extends CapabilityCadenceInput {
    /** Effective mode from `PlanningContext.mode` (ADR-0017); never re-derived here. */
    mode: 'evergreen' | 'event_directed' | 'externally_planned';
    /** Why the #804 source policy deliberately withheld mechanical exposure, if it did. */
    mechanicalSuspension: CapabilitySuspensionSource | null;
    /** Whether the evergreen strategy carries a mechanical requirement for this window. */
    mechanicalRequirementPresent: boolean;
    mechanicalVerdict: MechanicalProgressionVerdict | null;
    /** Per-identity hard gates computed by the existing authorities (never re-derived here). */
    gates: {
        guardrailBlocked: ReadonlySet<string>;
        unavailable: ReadonlySet<string>;
        avoided: ReadonlySet<string>;
        environmentUnavailable: ReadonlySet<string>;
        /** Dates on which the existing schedule/environment authority permits each identity.
         * Optional for pure/unit callers; when present, fulfilment is evaluated only inside the
         * capability's not-before/due window rather than across the whole planning horizon. */
        environmentAvailableDates?: ReadonlyMap<string, readonly string[]>;
        /** Canonical minimum executable duration per mechanical workout identity. */
        minimumDurationMinutes?: ReadonlyMap<string, number>;
        deprioritized: ReadonlySet<string>;
    };
    /** Plannable dates that still have usable training capacity. */
    supportCapacityDates: readonly string[];
    /** Resolved positive minutes on each usable date. Optional only for pure legacy fixtures. */
    supportCapacityMinutesByDate?: ReadonlyMap<string, number>;
}

function requiredStageFor(capability: AthleticCapabilityKey): MechanicalStage {
    const stages = capabilityIdentitiesFor(capability)
        .map(identity => athleticCapabilityStageFor(identity.workoutId))
        .filter((stage): stage is MechanicalStage => stage !== undefined);
    return (stages.length > 0 ? Math.min(...stages) : 4) as MechanicalStage;
}

function isEnabled(preference: CapabilityMaintenancePreference | null | undefined, capability: AthleticCapabilityKey): boolean {
    return Boolean(preference?.enabled && preference.capabilities.includes(capability));
}

/** Cadence only: which capabilities are owed and from which date. Needs no mechanical
 * verdict, so the caller can steer #804 progression (`targetStage`) before resolving it. */
export function evaluateCapabilityCadence(input: CapabilityCadenceInput): CapabilityCadence[] {
    const horizonEnd = addDaysToLocalDateString(input.asOfDate, Math.max(1, input.planningHorizonDays) - 1);
    return ATHLETIC_CAPABILITIES.map(capability => {
        const requiredStage = requiredStageFor(capability);
        if (!isEnabled(input.preference, capability)) return { capability, status: 'disabled', requiredStage };
        const lastQualifyingDate = input.exposures
            .filter(exposure => exposure.date < input.asOfDate)
            .filter(exposure => grantsAthleticCapabilityCredit({ ...exposure, capability }))
            .map(exposure => exposure.date)
            .sort()
            .at(-1);
        // Never infer `due` from partial history: an unobserved fortnight is not absence.
        if (input.observedWindowDays < ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS) {
            return { capability, status: 'insufficient_history', requiredStage, ...(lastQualifyingDate ? { lastQualifyingDate } : {}) };
        }
        if (!lastQualifyingDate) {
            // A complete observed interval contains no qualifying exposure.
            return { capability, status: 'overdue', requiredStage, notBeforeDate: input.asOfDate, targetDate: input.asOfDate };
        }
        const nextDueDate = addDaysToLocalDateString(lastQualifyingDate, ATHLETIC_CAPABILITY_DUE_OFFSET_DAYS);
        if (input.asOfDate > nextDueDate) {
            return { capability, status: 'overdue', requiredStage, lastQualifyingDate, nextDueDate, notBeforeDate: input.asOfDate, targetDate: input.asOfDate };
        }
        if (nextDueDate <= horizonEnd) {
            return { capability, status: 'due', requiredStage, lastQualifyingDate, nextDueDate, notBeforeDate: nextDueDate, targetDate: nextDueDate };
        }
        return { capability, status: 'satisfied', requiredStage, lastQualifyingDate, nextDueDate };
    });
}

const isOwed = (cadence: CapabilityCadence): boolean => cadence.status === 'due' || cadence.status === 'overdue';

/** D-C: the highest required stage among owed capabilities, passed to #804 as `targetStage`.
 * #804 still caps advancement at one stage and requires its own response evidence. */
export function capabilityProgressionTargetStage(cadence: readonly CapabilityCadence[]): MechanicalStage | undefined {
    const stages = cadence.filter(isOwed).map(item => item.requiredStage);
    return stages.length > 0 ? Math.max(...stages) as MechanicalStage : undefined;
}

const SUSPENSION_MESSAGES: Record<CapabilitySuspendedReason, string> = {
    event_directed_mode: 'event-directed planning owns programming; capability maintenance is reported only',
    adverse_recovery: 'suspended during acute adverse recovery; not owed as catch-up work',
    clinical_symptoms: 'suspended while pain, injury, illness or red-flag symptoms are reported',
    event_phase: 'suspended for peak/taper or post-event recovery; event specificity takes priority',
    mechanical_withheld: 'suspended because #804 is withholding mechanical exposure',
};
const BLOCKED_MESSAGES: Record<CapabilityBlockedReason, string> = {
    mechanical_guardrail: 'blocked by an active mechanical/impact safety limit; nothing substitutes for it',
    mechanical_stage_insufficient: 'mechanical capacity is not yet at the required stage; the support slot carries the safest eligible progression identity',
    modality_unavailable: 'every otherwise safety-eligible qualifying identity is in an unavailable training type',
    modality_avoided: 'every otherwise eligible qualifying identity is in a training type the athlete avoids',
    environment_unavailable: 'the configured or scheduled training environment excludes every otherwise eligible qualifying identity',
    no_support_capacity: 'no usable training window exists on or after the due date in this horizon',
};
const UNKNOWN_MESSAGES: Record<CapabilityUnknownReason, string> = {
    mechanical_requirement_absent: 'no #804 mechanical requirement exists for this window to carry it',
    history_unavailable: `fewer than ${ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS} observed days; due status cannot be established`,
};

function messageFor(cadence: CapabilityCadence, fulfilment: CapabilityFulfilment | undefined): string {
    const when = cadence.status === 'due'
        ? `due from ${cadence.notBeforeDate}`
        : cadence.status === 'overdue'
            ? cadence.lastQualifyingDate ? `overdue since ${cadence.nextDueDate}` : 'overdue: no qualifying exposure in the observed window'
            : cadence.status === 'satisfied' ? `satisfied until ${cadence.nextDueDate}` : cadence.status.replace('_', ' ');
    if (!fulfilment?.reason) return fulfilment ? `${when}; plannable` : when;
    const reason = fulfilment.reason;
    const detail = (SUSPENSION_MESSAGES as Record<string, string>)[reason]
        ?? (BLOCKED_MESSAGES as Record<string, string>)[reason]
        ?? (UNKNOWN_MESSAGES as Record<string, string>)[reason];
    return `${when}; ${fulfilment.status.replace('_', ' ')} (${reason}): ${detail}`;
}

/** Highest-stage #804 maintenance identities the verdict allows, after hard gates. */
function progressionWorkoutIds(verdict: MechanicalProgressionVerdict | null, gated: (workoutId: string) => boolean): string[] {
    if (!verdict?.eligible) return [];
    const open = verdict.eligibleWorkoutIds.filter(workoutId => !gated(workoutId));
    const stages = open.map(workoutId => mechanicalIdentityFor(workoutId)?.stage ?? 0);
    const highest = Math.max(0, ...stages);
    return open.filter(workoutId => (mechanicalIdentityFor(workoutId)?.stage ?? 0) === highest).sort();
}

function fulfilmentFor(
    cadence: CapabilityCadence,
    input: CapabilityMaintenanceInput,
): { fulfilment: CapabilityFulfilment; supportWorkoutIds: string[] } {
    const none = { supportWorkoutIds: [] as string[] };
    if (input.mode !== 'evergreen') {
        return { fulfilment: { status: 'deliberately_suspended', reason: 'event_directed_mode' }, ...none };
    }
    if (input.mechanicalSuspension) {
        return { fulfilment: { status: 'deliberately_suspended', reason: input.mechanicalSuspension }, ...none };
    }
    const identities = capabilityIdentitiesFor(cadence.capability).map(identity => identity.workoutId);
    const { gates } = input;
    // Classify hard blocks in the same precedence order the candidate set is actually
    // narrowed. This matters when different identities are blocked by different authorities:
    // a guardrail on one identity plus an unavailable modality on another must not fall
    // through and be mislabeled as an environment block (ADR-0044 D9).
    let deliverable = identities.filter(id => !gates.guardrailBlocked.has(id));
    if (deliverable.length === 0) {
        return { fulfilment: { status: 'blocked', reason: 'mechanical_guardrail' }, ...none };
    }
    if (input.mechanicalVerdict && !input.mechanicalVerdict.eligible) {
        // #804 blocked on a same-day pain flag / acute symptom, or withheld on spacing,
        // illness or severe tissue response: a deliberate source suspension, not neglect.
        const reason: CapabilitySuspendedReason = input.mechanicalVerdict.status === 'blocked' ? 'clinical_symptoms' : 'mechanical_withheld';
        return { fulfilment: { status: 'deliberately_suspended', reason }, ...none };
    }
    deliverable = deliverable.filter(id => !gates.unavailable.has(id));
    if (deliverable.length === 0) {
        return { fulfilment: { status: 'blocked', reason: 'modality_unavailable' }, ...none };
    }
    deliverable = deliverable.filter(id => !gates.avoided.has(id));
    if (deliverable.length === 0) {
        return { fulfilment: { status: 'blocked', reason: 'modality_avoided' }, ...none };
    }
    if (!input.mechanicalRequirementPresent || !input.mechanicalVerdict) {
        return { fulfilment: { status: 'unknown', reason: 'mechanical_requirement_absent' }, ...none };
    }
    deliverable = deliverable.filter(id => !gates.environmentUnavailable.has(id));
    if (deliverable.length === 0) {
        return { fulfilment: { status: 'blocked', reason: 'environment_unavailable' }, ...none };
    }
    const notBeforeDate = cadence.notBeforeDate ?? input.asOfDate;
    const dueWindowCapacityDates = input.supportCapacityDates.filter(date => date >= notBeforeDate);
    if (dueWindowCapacityDates.length === 0) {
        return { fulfilment: { status: 'blocked', reason: 'no_support_capacity' }, ...none };
    }
    const environmentFeasibleInDueWindow = (id: string): boolean => {
        const availableDates = gates.environmentAvailableDates?.get(id);
        if (availableDates === undefined) return true;
        return dueWindowCapacityDates.some(date => availableDates.includes(date));
    };
    deliverable = deliverable.filter(environmentFeasibleInDueWindow);
    if (deliverable.length === 0) {
        return { fulfilment: { status: 'blocked', reason: 'environment_unavailable' }, ...none };
    }
    const hardGated = (id: string) => gates.guardrailBlocked.has(id) || gates.unavailable.has(id)
        || gates.avoided.has(id) || gates.environmentUnavailable.has(id) || !environmentFeasibleInDueWindow(id);
    const hasCapacityInDueWindow = (id: string): boolean => {
        const capacity = input.supportCapacityMinutesByDate;
        const minimum = gates.minimumDurationMinutes?.get(id);
        // Legacy/pure callers that supplied only dates preserve the old contract. Production
        // supplies both maps and therefore proves that a qualifying identity can actually fit.
        if (!capacity || minimum === undefined) return true;
        const availableDates = gates.environmentAvailableDates?.get(id);
        return dueWindowCapacityDates.some(date =>
            (availableDates === undefined || availableDates.includes(date))
            && (capacity.get(date) ?? 0) >= minimum);
    };
    const verdict = input.mechanicalVerdict;
    const stageEligible = deliverable
        .filter(id => (athleticCapabilityStageFor(id) ?? 5) <= verdict.stage && verdict.eligibleWorkoutIds.includes(id))
        .sort();
    if (stageEligible.length === 0) {
        const progression = progressionWorkoutIds(verdict, hardGated);
        const capacityEligibleProgression = progression.filter(hasCapacityInDueWindow);
        if (progression.length > 0 && capacityEligibleProgression.length === 0) {
            return { fulfilment: { status: 'blocked', reason: 'no_support_capacity' }, ...none };
        }
        return {
            fulfilment: { status: 'blocked', reason: 'mechanical_stage_insufficient' },
            supportWorkoutIds: capacityEligibleProgression,
        };
    }
    const capacityEligible = stageEligible.filter(hasCapacityInDueWindow);
    if (capacityEligible.length === 0) {
        return { fulfilment: { status: 'blocked', reason: 'no_support_capacity' }, ...none };
    }
    return { fulfilment: { status: 'plannable' }, supportWorkoutIds: capacityEligible };
}

/** Full evaluation. Call `evaluateCapabilityCadence` + `capabilityProgressionTargetStage`
 * first to steer #804, then pass the resulting verdict here. */
export function evaluateCapabilityMaintenance(input: CapabilityMaintenanceInput): CapabilityMaintenanceResult {
    const cadence = evaluateCapabilityCadence(input);
    const capabilities: CapabilityMaintenanceStatus[] = cadence.map(item => {
        if (item.status === 'insufficient_history') {
            const fulfilment: CapabilityFulfilment = { status: 'unknown', reason: 'history_unavailable' };
            return { ...item, fulfilment, supportWorkoutIds: [], message: messageFor(item, fulfilment) };
        }
        if (!isOwed(item)) return { ...item, supportWorkoutIds: [], message: messageFor(item, undefined) };
        const { fulfilment, supportWorkoutIds } = fulfilmentFor(item, input);
        return { ...item, fulfilment, supportWorkoutIds, message: messageFor(item, fulfilment) };
    });
    // Deliberate suspension produces no placement at all: it never becomes catch-up debt,
    // so at most one touch per capability is ever owed (D-H).
    const placements: CapabilityPlacement[] = capabilities
        .filter(item => isOwed(item) && item.supportWorkoutIds.length > 0 && item.notBeforeDate && item.targetDate)
        .map(item => ({
            capability: item.capability,
            notBeforeDate: item.notBeforeDate!,
            targetDate: item.targetDate!,
            workoutIds: item.supportWorkoutIds,
            // D-E: consent only exact identities that deliver an enabled capability. A
            // progression-only touch may consent an enabled capability's identity that is not
            // itself due (recorded deviation): it is the only path to the owed higher stage.
            consentWorkoutIds: item.supportWorkoutIds.filter(id => ATHLETIC_CAPABILITY_WORKOUT_IDS.includes(id)
                && athleticCapabilitiesCreditedBy({ workoutId: id }).some(capability => isEnabled(input.preference, capability))),
            progressionOnly: item.fulfilment?.status !== 'plannable',
            plannedOnDate: input.asOfDate,
        }));
    const deprioritized = capabilities.some(item => isOwed(item)
        && capabilityIdentitiesFor(item.capability).some(identity => input.gates.deprioritized.has(identity.workoutId)));
    return {
        enabled: Boolean(input.preference?.enabled),
        intervalDays: ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS,
        capabilities,
        placements,
        softContext: deprioritized ? ['The qualifying modality is deprioritized: a soft ranking preference, not a block.'] : [],
    };
}

/** Exact identities a placement set narrows to / consents on `date`, excluding placements
 * already fulfilled by a qualifying touch on or after their not-before date. */
export function activeCapabilityPlacements(
    placements: readonly CapabilityPlacement[],
    date: string,
    touches: readonly CapabilityExposureRecord[],
): CapabilityPlacement[] {
    return placements.filter(placement => placement.notBeforeDate <= date
        && !isCapabilityPlacementFulfilled(placement, date, touches));
}

/** A placement is fulfilled once a qualifying touch lands on/after the planning date it was
 * resolved on (not only on/after its not-before date) and before `date`. */
export function isCapabilityPlacementFulfilled(
    placement: CapabilityPlacement,
    date: string,
    touches: readonly CapabilityExposureRecord[],
): boolean {
    const from = placement.plannedOnDate < placement.notBeforeDate ? placement.plannedOnDate : placement.notBeforeDate;
    return touches.some(touch => touch.date >= from && touch.date < date
            && (placement.progressionOnly
                ? placement.workoutIds.includes(touch.workoutId ?? '')
                : grantsAthleticCapabilityCredit({ ...touch, capability: placement.capability })));
}
