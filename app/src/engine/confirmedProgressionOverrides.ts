/**
 * ADR-0037 D-DOSE: translates confirmed `IntentBlock` progression revisions (H5c,
 * `services/progressionClaimService.ts`) into per-role duration overrides for evergreen
 * weekly dose packing (`weeklyDosePacking.ts`).
 *
 * `BlockObjectiveDefinition.coverageKey` (`blockIntent.ts`) already binds an objective to a
 * concrete coverage role, using the same `PlanCoverageKey` vocabulary
 * `EVERGREEN_PACKING_COVERAGE` uses to bind a role to an `AdaptationKey` -- there is no
 * separate `ObjectiveKey -> AdaptationKey` table to maintain here. The real constraint is
 * that `EVERGREEN_PACKING_COVERAGE` only defines roles for 3 of the 18 `PlanCoverageKey`s.
 * A confirmed progression bound to any other coverage key has no role to attach to in
 * evergreen packing yet, so it is reported as `unsupported` rather than silently dropped --
 * a decision-affecting change must fail visibly, never invisibly (CLAUDE.md I5).
 *
 * `requirement.floor`/`requirement.target` (the WHO-guideline numbers in
 * `evergreenStrategy.ts`) are one level above `CoverageRoleDescriptor.durationMinutes` and
 * are never touched here -- overriding a role's assumed per-session minutes never lowers or
 * bypasses a guideline floor.
 *
 * `develop` vs `maintain` needs no special-casing here: that distinction lives entirely in
 * `progressionReview.ts` (H5b), which governs how `currentValue` is proposed to move over
 * time. This module only ever consumes whatever the currently-confirmed value is.
 */

import type { BlockObjectiveDefinition, BlockProgressionContract, IntentBlock } from './blockIntent';
import { EVERGREEN_PACKING_COVERAGE } from './weeklyDosePacking';
import type { ObjectiveKey } from './models';
import type { PlanCoverageKey } from '../workouts/event-plan';

/** Derived, not hardcoded, so it can never drift out of sync with the roles the packer
 * actually iterates over. Every `EVERGREEN_PACKING_COVERAGE` role's `id` today is identical
 * to its `PlanCoverageKey`. */
export const SELECTION_WIRED_COVERAGE_KEYS: readonly PlanCoverageKey[] =
    EVERGREEN_PACKING_COVERAGE.roles.map(role => role.id as PlanCoverageKey);

export interface UnsupportedProgressionObjective {
    blockId: string;
    objectiveId: string;
    coverageKey: PlanCoverageKey;
    adaptationScope: ObjectiveKey;
}

export interface DerivedProgressionOverrides {
    overrides: ReadonlyMap<PlanCoverageKey, number>;
    unsupported: readonly UnsupportedProgressionObjective[];
}

function isActiveOn(block: IntentBlock, date: string): boolean {
    return date >= block.dateRange.startDate && date <= block.dateRange.endDate;
}

function findBoundObjective(block: IntentBlock, objectiveId: string): BlockObjectiveDefinition | null {
    return block.objectives.find(objective => objective.id === objectiveId) ?? null;
}

function isWiredCoverageKey(coverageKey: PlanCoverageKey): boolean {
    return SELECTION_WIRED_COVERAGE_KEYS.includes(coverageKey);
}

/**
 * Defense-in-depth only: `validateProgressionContract` already enforces `currentValue`
 * against `permittedRange` at author/confirm/read time. The objective dose envelope is a
 * second bound only when it uses the *same unit* as the progression variable. ADR-0037
 * deliberately allows an objective to be expressed in (for example) sessions while the
 * one registered progression variable changes per-session duration in minutes; clamping a
 * minute value against a session-count envelope would be a unit error.
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

    // A validated block cannot produce an inverted intersection. Keep this helper total for
    // defense-in-depth callers nevertheless: fall back to the progression contract's own
    // validated range instead of inventing a cross-unit/objective bound.
    if (lower > upper) {
        lower = contract.permittedRange.min;
        upper = contract.permittedRange.max;
    }

    return Math.min(upper, Math.max(lower, contract.currentValue));
}

/** Pure. No Firestore, no `Date.now()` -- `blocks` and `date` are both caller-supplied. */
export function deriveDurationOverridesForDate(
    blocks: readonly IntentBlock[],
    date: string,
): DerivedProgressionOverrides {
    const overrides = new Map<PlanCoverageKey, number>();
    const unsupported: UnsupportedProgressionObjective[] = [];

    const activeWithContract = blocks
        .filter(block => block.progressionContract && isActiveOn(block, date))
        .sort((left, right) => left.id.localeCompare(right.id));

    for (const block of activeWithContract) {
        const contract = block.progressionContract!;
        const objective = findBoundObjective(block, contract.targetBinding.objectiveId);
        if (!objective) continue;

        if (!isWiredCoverageKey(objective.coverageKey)) {
            unsupported.push({
                blockId: block.id,
                objectiveId: objective.id,
                coverageKey: objective.coverageKey,
                adaptationScope: objective.adaptationScope,
            });
            continue;
        }

        // The persisted service revalidates this before returning a block, but keep the
        // selection boundary fail-closed if a non-service caller supplies malformed runtime
        // data. `duration_min` is the only registered variable and it is minute-valued.
        if (contract.variable !== 'duration_min' || contract.unit !== 'minutes') continue;

        // Deterministic collision handling: an athlete is expected to have at most one
        // active block per objective coverage key. If two collide, the lexicographically
        // first blockId wins (stable given the sort above) and the loser is dropped from
        // selection without erroring -- a pre-existing data-modeling edge case, not
        // something this module needs to arbitrate further.
        if (overrides.has(objective.coverageKey)) continue;

        overrides.set(objective.coverageKey, clampConfirmedDuration(contract, objective));
    }

    return { overrides, unsupported };
}
