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

import type { BlockObjectiveDefinition, IntentBlock } from './blockIntent';
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

/** Defense-in-depth only: `validateProgressionContract` already enforces this range at
 * confirm time. */
function clampToEnvelope(value: number, objective: BlockObjectiveDefinition): number {
    return Math.min(objective.doseEnvelope.max, Math.max(objective.doseEnvelope.min, value));
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

        // Deterministic collision handling: an athlete is expected to have at most one
        // active block per objective coverage key. If two collide, the lexicographically
        // first blockId wins (stable given the sort above) and the loser is dropped from
        // selection without erroring -- a pre-existing data-modeling edge case, not
        // something this module needs to arbitrate further.
        if (overrides.has(objective.coverageKey)) continue;

        overrides.set(objective.coverageKey, clampToEnvelope(contract.currentValue, objective));
    }

    return { overrides, unsupported };
}
