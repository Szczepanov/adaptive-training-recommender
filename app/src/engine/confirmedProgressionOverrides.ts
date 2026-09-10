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
import type { PlanCoverageKey } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { workoutForTemplate } from '../workouts/prescription';
import { progressionOverrideKey } from './progressionOverrideKey';

export { progressionOverrideKey };

/** Derived, not hardcoded, so it cannot drift from the roles the packer actually iterates. */
export const SELECTION_WIRED_COVERAGE_KEYS: readonly PlanCoverageKey[] =
    EVERGREEN_PACKING_COVERAGE.roles.map(role => role.id as PlanCoverageKey);

export type UnsupportedProgressionReason =
    | 'coverage_not_wired'
    | 'no_exact_prescription_target'
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

function isActiveOn(block: IntentBlock, date: string): boolean {
    return date >= block.dateRange.startDate && date <= block.dateRange.endDate;
}

function findBoundObjective(block: IntentBlock, objectiveId: string): BlockObjectiveDefinition | null {
    return block.objectives.find(objective => objective.id === objectiveId) ?? null;
}

function roleFor(coverageKey: PlanCoverageKey) {
    return EVERGREEN_PACKING_COVERAGE.roles.find(role => role.id === coverageKey) ?? null;
}

function isWiredCoverageKey(coverageKey: PlanCoverageKey): boolean {
    return SELECTION_WIRED_COVERAGE_KEYS.includes(coverageKey);
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
    const { sessionId, stepId } = contract.targetBinding;

    return role.exactWorkoutIds.filter(workoutId => {
        const workout = WORKOUTS_BY_ID.get(workoutId);
        if (!workout || workout.status !== 'active') return false;
        if (!workoutModalityMatchesSport(workout.modality, objective.sport)) return false;
        // In generated evergreen planning, a session binding can only be honored without
        // guessing when it names the exact catalog workout identity used by coverage.
        if (sessionId && sessionId !== workoutId) return false;
        if (stepId && !workout.blocks.some(block => block.steps.some(step => step.id === stepId))) return false;
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
    const role = EVERGREEN_PACKING_COVERAGE.roles.find(item => item.exactWorkoutIds.includes(workout.id));
    if (!role) return null;
    const duration = overrides.get(progressionOverrideKey(role.id, workout.id)) ?? overrides.get(role.id);
    if (duration === undefined || !Number.isFinite(duration)) return null;
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
    const claimedRoles = new Map<string, { block: IntentBlock; objective: BlockObjectiveDefinition; keys: string[] }>();
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
        const keys = exactWorkoutTargets(objective, contract).map(workoutId => progressionOverrideKey(roleId, workoutId));
        keys.forEach(key => overrides.set(key, duration));
        claimedRoles.set(roleId, { block, objective, keys });
    }

    return { overrides, unsupported };
}
