/**
 * ADR-0037 D-DOSE: translates confirmed `IntentBlock` progression revisions (H5c,
 * `services/progressionClaimService.ts`) into exact-workout-scoped duration overrides for
 * evergreen weekly dose packing (`weeklyDosePacking.ts`).
 *
 * `BlockObjectiveDefinition.coverageKey` already binds an objective to the same
 * `PlanCoverageKey` vocabulary used by evergreen packing. That is necessary, but not
 * sufficient: ADR-0037 also makes objective sport plus optional session/step bindings part
 * of prescription authority. Collapsing those facts to only `coverageKey -> minutes` can
 * accidentally apply a cycling progression to a running substitute, or a session-specific
 * progression to every workout in a role. This module therefore retains exact catalog
 * workout identity in the map key (`<coverageRoleId>::<workoutId>`).
 *
 * `requirement.floor`/`requirement.target` (the guideline/product-policy numbers in
 * `evergreenStrategy.ts`) remain one level above this adapter and are never modified.
 */

import type {
    BlockObjectiveDefinition,
    BlockProgressionContract,
    BlockSport,
    IntentBlock,
} from './blockIntent';
import { EVERGREEN_PACKING_COVERAGE } from './weeklyDosePacking';
import type { DoseVariation, ObjectiveKey, SessionTemplate } from './models';
import { SEPTEMBER_CYCLING_EVENT_COVERAGE_SET, type PlanCoverageKey } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { workoutForTemplate } from '../workouts/prescription';
import { progressionOverrideKey } from './progressionOverrideKey';

export { progressionOverrideKey };

export type UnsupportedProgressionReason =
    | 'coverage_not_wired'
    | 'no_exact_prescription_target'
    | 'session_binding_unresolved'
    | 'ambiguous_active_role_progression';

export interface UnsupportedProgressionObjective {
    blockId: string;
    objectiveId: string;
    coverageKey: PlanCoverageKey;
    adaptationScope: ObjectiveKey;
    reason?: UnsupportedProgressionReason;
}

export interface DerivedProgressionOverrides {
    /**
     * Production derivation uses exact scoped keys (`role::workoutId`). `packWeeklyDose`
     * intentionally still accepts a legacy direct role key for deterministic unit tests and
     * backwards-compatible injected callers.
     */
    overrides: ReadonlyMap<string, number>;
    unsupported: readonly UnsupportedProgressionObjective[];
}

interface ProgressionSelectionRole {
    /** Stable plan-role identity used by the authored progression binding. */
    id: PlanCoverageKey;
    exactWorkoutIds: readonly string[];
    durationMinutes: number;
}

/**
 * These roles are valid exact targets for a confirmed progression, but they are not
 * evergreen dose-packing roles. Keeping them in this separate selection registry lets an
 * authored event/taper progression change the dose of a matching selected session without
 * adding event-specific work to a plan-less evergreen weekly budget.
 */
const SELECTION_ONLY_ROLE_KEYS: readonly PlanCoverageKey[] = [
    'short_surges', 'gap_closing', 'outdoor_event_specific', 'taper_sharpening',
];

function minimumDuration(workoutIds: readonly string[]): number {
    return Math.min(...workoutIds.map(id => WORKOUTS_BY_ID.get(id)?.duration.minimumMin ?? Number.POSITIVE_INFINITY));
}

const EVENT_SELECTION_ROLES: readonly ProgressionSelectionRole[] =
    SEPTEMBER_CYCLING_EVENT_COVERAGE_SET.coverage
        .filter(coverage => SELECTION_ONLY_ROLE_KEYS.includes(coverage.key))
        .map(coverage => ({
            id: coverage.key,
            exactWorkoutIds: coverage.workoutIds,
            durationMinutes: minimumDuration(coverage.workoutIds),
        }));

const EVERGREEN_SELECTION_ROLES: readonly ProgressionSelectionRole[] =
    EVERGREEN_PACKING_COVERAGE.roles.map(role => ({
        id: role.id as PlanCoverageKey,
        exactWorkoutIds: role.exactWorkoutIds,
        durationMinutes: role.durationMinutes,
    }));

/** Exact catalog roles available to the final recommendation selector. */
export const PROGRESSION_SELECTION_ROLES: readonly ProgressionSelectionRole[] = [
    ...EVERGREEN_SELECTION_ROLES,
    ...EVENT_SELECTION_ROLES,
];

/** Derived from the exact selector registry, so UI notices cannot drift from execution. */
export const SELECTION_WIRED_COVERAGE_KEYS: readonly PlanCoverageKey[] =
    PROGRESSION_SELECTION_ROLES.map(role => role.id);

function isActiveOn(block: IntentBlock, date: string): boolean {
    return date >= block.dateRange.startDate && date <= block.dateRange.endDate;
}

function findBoundObjective(block: IntentBlock, objectiveId: string): BlockObjectiveDefinition | null {
    return block.objectives.find(objective => objective.id === objectiveId) ?? null;
}

function roleFor(coverageKey: PlanCoverageKey) {
    return PROGRESSION_SELECTION_ROLES.find(role => role.id === coverageKey) ?? null;
}

function isWiredCoverageKey(coverageKey: PlanCoverageKey): boolean {
    return PROGRESSION_SELECTION_ROLES.some(role => role.id === coverageKey);
}

function workoutModalityMatchesSport(modality: string, sport: BlockSport): boolean {
    if (sport === 'multisport') return true;
    return modality === sport;
}

/**
 * Defense-in-depth only: persisted blocks are already validated. The objective envelope is
 * a second numeric bound only when it uses the same unit as the progression variable; an
 * objective may validly be expressed in sessions while `duration_min` remains minutes.
 */
function clampConfirmedDuration(
    contract: BlockProgressionContract,
    objective: BlockObjectiveDefinition,
): number {
    let lower = contract.permittedRange.min;
    let upper = contract.permittedRange.max;

    if (objective.doseEnvelope.unit === contract.unit) {
        lower = Math.max(lower, objective.doseEnvelope.min);
        upper = Math.min(upper, objective.doseEnvelope.max);
    }

    if (lower > upper) {
        lower = contract.permittedRange.min;
        upper = contract.permittedRange.max;
    }

    return Math.min(upper, Math.max(lower, contract.currentValue));
}

function exactWorkoutTargets(
    objective: BlockObjectiveDefinition,
    contract: BlockProgressionContract,
): string[] {
    const role = roleFor(objective.coverageKey);
    if (!role) return [];
    const duration = clampConfirmedDuration(contract, objective);

    return role.exactWorkoutIds.filter(workoutId => {
        const workout = WORKOUTS_BY_ID.get(workoutId);
        if (!workout || workout.status !== 'active') return false;
        if (!workoutModalityMatchesSport(workout.modality, objective.sport)) return false;
        // A confirmed authored target that no exact prescription can physically represent
        // must not be credited merely as accounting metadata.
        if (duration < workout.duration.minimumMin || duration > workout.duration.maximumMin) return false;
        return true;
    });
}

export function progressionSelectionUnsupportedReason(
    block: IntentBlock | null | undefined,
): UnsupportedProgressionReason | null {
    const contract = block?.progressionContract;
    if (!block || !contract) return null;
    const objective = findBoundObjective(block, contract.targetBinding.objectiveId);
    if (!objective) return null;
    if (contract.targetBinding.sessionId || contract.targetBinding.stepId) return 'session_binding_unresolved';
    if (!isWiredCoverageKey(objective.coverageKey)) return 'coverage_not_wired';
    if (contract.variable !== 'duration_min' || contract.unit !== 'minutes') return 'no_exact_prescription_target';
    return exactWorkoutTargets(objective, contract).length > 0 ? null : 'no_exact_prescription_target';
}

/**
 * Returns an executable dose only when the selected template resolves to one of the exact
 * workout identities authorized by the progression override. Runtime availability/safety
 * still decides whether callers actually use this dose on a given date.
 */
export function progressionDoseForTemplate(
    template: SessionTemplate,
    overrides: ReadonlyMap<string, number>,
): DoseVariation | null {
    const workout = workoutForTemplate(template.id);
    if (!workout) return null;
    const roles = PROGRESSION_SELECTION_ROLES.filter(item => item.exactWorkoutIds.includes(workout.id));
    const applicableDurations: number[] = [];
    for (const role of roles) {
        const exact = overrides.get(progressionOverrideKey(role.id, workout.id));
        const direct = overrides.get(role.id);
        const duration = exact ?? direct;
        if (duration === undefined) continue;
        if (!Number.isFinite(duration)) return null;
        applicableDurations.push(duration);
    }
    if (applicableDurations.length !== 1) return null;
    const duration = applicableDurations[0];
    if (duration < workout.duration.minimumMin || duration > workout.duration.maximumMin) return null;
    const fullDuration = workout.variants.find(variant => variant.id === 'full')?.targetDurationMin
        ?? workout.duration.defaultMin
        ?? template.durationMin;
    const doseRatio = fullDuration > 0 ? duration / fullDuration : 1;
    return {
        label: `Confirmed progression · ${duration} min`,
        durationMin: duration,
        durationMax: duration,
        doseRatio,
        prescriptionSummary: `Use the confirmed ${duration}-minute progression dose for ${workout.name}.`,
    };
}

function unsupportedEntry(
    block: IntentBlock,
    objective: BlockObjectiveDefinition,
    reason: UnsupportedProgressionReason,
): UnsupportedProgressionObjective {
    return {
        blockId: block.id,
        objectiveId: objective.id,
        coverageKey: objective.coverageKey,
        adaptationScope: objective.adaptationScope,
        reason,
    };
}

/** Pure. No Firestore, no `Date.now()` -- `blocks` and `date` are caller-supplied. */
export function deriveDurationOverridesForDate(
    blocks: readonly IntentBlock[],
    date: string,
): DerivedProgressionOverrides {
    const overrides = new Map<string, number>();
    const unsupported: UnsupportedProgressionObjective[] = [];
    const claimedRoles = new Map<string, { block: IntentBlock; objective: BlockObjectiveDefinition; keys: string[]; workoutIds: string[] }>();
    const conflictedRoles = new Set<string>();

    const activeWithContract = blocks
        .filter(block => block.progressionContract && isActiveOn(block, date))
        .sort((left, right) => left.id.localeCompare(right.id));

    for (const block of activeWithContract) {
        const contract = block.progressionContract!;
        const objective = findBoundObjective(block, contract.targetBinding.objectiveId);
        if (!objective) continue;

        const reason = progressionSelectionUnsupportedReason(block);
        if (reason) {
            unsupported.push(unsupportedEntry(block, objective, reason));
            continue;
        }

        const roleId = objective.coverageKey;
        if (conflictedRoles.has(roleId)) {
            unsupported.push(unsupportedEntry(block, objective, 'ambiguous_active_role_progression'));
            continue;
        }
        const prior = claimedRoles.get(roleId);
        if (prior) {
            prior.keys.forEach(key => overrides.delete(key));
            unsupported.push(unsupportedEntry(prior.block, prior.objective, 'ambiguous_active_role_progression'));
            unsupported.push(unsupportedEntry(block, objective, 'ambiguous_active_role_progression'));
            claimedRoles.delete(roleId);
            conflictedRoles.add(roleId);
            continue;
        }

        const duration = clampConfirmedDuration(contract, objective);
        const workoutIds = exactWorkoutTargets(objective, contract);
        const keys = workoutIds.map(workoutId => progressionOverrideKey(roleId, workoutId));
        keys.forEach(key => overrides.set(key, duration));
        claimedRoles.set(roleId, { block, objective, keys, workoutIds });
    }

    const roleClaims = [...claimedRoles.entries()];
    const overlappingRoleIds = new Set<string>();
    for (let leftIndex = 0; leftIndex < roleClaims.length; leftIndex += 1) {
        const [leftRoleId, left] = roleClaims[leftIndex];
        for (const [rightRoleId, right] of roleClaims.slice(leftIndex + 1)) {
            if (!left.workoutIds.some(workoutId => right.workoutIds.includes(workoutId))) continue;
            overlappingRoleIds.add(leftRoleId);
            overlappingRoleIds.add(rightRoleId);
        }
    }
    for (const [roleId, claim] of roleClaims) {
        if (!overlappingRoleIds.has(roleId)) continue;
        claim.keys.forEach(key => overrides.delete(key));
        unsupported.push(unsupportedEntry(claim.block, claim.objective, 'ambiguous_active_role_progression'));
    }

    return { overrides, unsupported };
}
