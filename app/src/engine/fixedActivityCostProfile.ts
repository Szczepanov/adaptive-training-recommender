/**
 * ADR-0036 (H4) D-LEDGER: "refactor... rather than subtracting again downstream." This
 * six-dimension `WorkoutCostProfile` reduce over a fixed activity's `expectedCost` was
 * previously duplicated near-verbatim in three places: `schedule.ts`'s
 * `calculateReservedCapacityProfile`, `planner.ts`'s `fixedActivityCostProfileForDate`,
 * and `rules.ts`'s `unrepresentedFixedActivityProjection`. This is a pure code-dedup
 * extraction only -- every call site keeps its own existing date/completion filtering
 * exactly as before, so behavior is unchanged (see `check-policy-drift.mjs`). It does not
 * change what counts as "reserved" or introduce the `engine/dailyLedger.ts` remainder/
 * admission semantics into any decision path; that remains a separate follow-up.
 *
 * D6-C: a missing `expectedCost` means "unknown/not modelled" and contributes zero -- a
 * prior revision defaulted the whole activity to `systemic: 0.2` when `expectedCost` was
 * absent, an invented heuristic this function must not reintroduce.
 */
import type { FixedActivity, WorkoutCostProfile } from './models';

export const ZERO_COST_PROFILE: WorkoutCostProfile = {
    systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
};

/** Sums `expectedCost` across the given activities with no filtering of its own --
 * callers pass an already-scoped list, matching each call site's own pre-existing
 * date/completion filtering contract exactly. */
export function sumFixedActivityCostProfiles(activities: readonly FixedActivity[]): WorkoutCostProfile {
    return activities.reduce((sum, activity) => {
        const cost = activity.expectedCost;
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
