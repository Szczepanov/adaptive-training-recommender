import type { UserGoal } from './models';
import { getPerformanceTargetPolicy, type PerformanceGoalFamily, type PerformanceSubjectRef } from './performanceTargetPolicy';

/**
 * Stage 2/PG5.1: the typed bridge from a stored goal to a planning-facing projection.
 * Deliberately imports ONLY from the pure engine/performanceTargetPolicy.ts (never
 * engine/performanceTargetValidation.ts or anything else reaching observations/*) --
 * this module is consumed by engine/adapters.ts, which is reachable from every
 * production selection/ranking module (optimizer.ts, planner.ts, rules.ts,
 * evergreenPlanning.ts, sequenceSearch.ts) via engine/eligibility.ts. See
 * observations/architecture.test.ts's OV1.4 boundary and
 * performanceGoalDemand.architecture.test.ts, which guards the other half of this
 * invariant: nothing in this projection is consumed by planning yet either.
 *
 * PG5.1 only: this is a typed, live-computed projection with no consumer. It does not
 * yet change what the weekly planner recommends -- see ADR-0041 and this capability's
 * plan doc (PG5 section) for why PG5.2 (planning-rule registry), PG5.3 (dose/coverage
 * refinement) and PG5.4's live wiring are deferred to follow-up work.
 */
export interface PerformanceGoalDemand {
    goalId: string;
    metricId: string;
    subjectRef: PerformanceSubjectRef;
    family: PerformanceGoalFamily;
    /** Context/progress only -- never dose, never allocation authority (PG5.1). */
    targetValue: number;
    /** Copied verbatim from UserGoal.priority (1-5). Used by the shared deterministic
     *  demand ordering below, but NOT itself an allocation tier or search authority:
     *  PG7 still applies stronger authorities before target competition. */
    priority: number;
    targetDate: string | null;
}

/**
 * PG5.4 forward declaration only: no function in this module constructs one. Exists so
 * PG7's allocation-authority wiring has a name to target rather than inventing a new
 * shortfall vocabulary at that point, mirroring the plan's own PG5.4 list of reasons.
 */
export type PerformanceGoalCoverageMissReason =
    | 'no_eligible_coverage_candidate'
    | 'equipment_unavailable'
    | 'injury_restriction'
    | 'readiness_spacing_restriction'
    | 'schedule_capacity'
    | 'higher_authority_external_event'
    | 'deterministic_conflict_with_higher_priority_target';

/**
 * Pure, null-returning single-goal mapper (styled after periodization.ts's
 * goalToUserEvent). Unlike that function, this one does NOT fall back to goal.title for
 * identity: a title is neither unique nor stable, and PG7's plan text requires
 * deterministic "ascending stable goalId lexical order" tie-breaking -- a title fallback
 * would silently violate that once PG7 lands. Production goals (sourced via
 * goalService.ts, which always attaches a real Firestore document id) are unaffected;
 * this only means a hand-built fixture without an id contributes no demand.
 *
 * Does not re-run semantic validation: a goal reaching this mapper already passed
 * goalService.ts's read-boundary validation (validateGoalForRead /
 * assertSemanticallyValidPerformanceTarget), which is allowed to import the observations
 * registries because goalService.ts is not reachable from any selection module. A
 * `null` policy lookup here (e.g. stale persisted data whose metric was since
 * deregistered) fails safe -- returns null -- rather than throwing, since this sits on a
 * path reachable from recommendation code, not a write boundary.
 */
export function goalToPerformanceGoalDemand(goal: UserGoal & { id?: string }): PerformanceGoalDemand | null {
    if (goal.status !== 'active' || !goal.performanceTarget || !goal.id) return null;
    const policy = getPerformanceTargetPolicy(goal.performanceTarget.metricId);
    if (!policy) return null;
    return {
        goalId: goal.id,
        metricId: goal.performanceTarget.metricId,
        subjectRef: goal.performanceTarget.subjectRef,
        family: policy.family,
        targetValue: goal.performanceTarget.targetValue,
        priority: goal.priority,
        targetDate: goal.targetDate ?? null,
    };
}

/**
 * Shared deterministic total order required by the plan's PG5/PG7 multi-target
 * contract. This ordering is deliberately established at the projection boundary so
 * Firestore/query/array iteration order can never become accidental authority later:
 *
 * 1. higher UserGoal.priority first;
 * 2. earlier non-null targetDate first;
 * 3. dated targets before open-ended targets;
 * 4. ascending stable goalId lexical order.
 *
 * The comparator does NOT grant planning authority in PG5.1; the projection is still
 * unread by selection/ranking code. PG7 must reuse this comparator after applying the
 * stronger safety/external-plan/capacity/broad-adaptation authorities rather than
 * reimplementing the tie policy ad hoc.
 */
export function comparePerformanceGoalDemands(a: PerformanceGoalDemand, b: PerformanceGoalDemand): number {
    if (a.priority !== b.priority) return b.priority - a.priority;

    if (a.targetDate !== b.targetDate) {
        if (a.targetDate === null) return 1;
        if (b.targetDate === null) return -1;
        return a.targetDate < b.targetDate ? -1 : 1;
    }

    if (a.goalId === b.goalId) return 0;
    return a.goalId < b.goalId ? -1 : 1;
}

/** Filters nulls and normalizes output into the shared deterministic demand order. */
export function mapGoalsToPerformanceGoalDemands(
    goals: readonly (UserGoal & { id?: string })[],
): PerformanceGoalDemand[] {
    return goals
        .map(goalToPerformanceGoalDemand)
        .filter((demand): demand is PerformanceGoalDemand => demand !== null)
        .sort(comparePerformanceGoalDemands);
}
