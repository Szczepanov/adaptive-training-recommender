import type { PlanCoverageKey, PlanPhase } from '../workouts/event-plan';
import type { SessionTemplate } from './models';
import {
    authoredSessionIdentityFor,
    coverageKeysForTemplate,
    workoutIdForTemplateId,
    type CoverageState,
    type WeeklyCoverageRequirement,
} from './coverage';

/**
 * ADR-0018's forecast-only role ledger. It deliberately describes authored coverage
 * occurrences, rather than objective credit or a selected workout.
 *
 * This module owns allocation *semantics* only. Every feasibility answer arrives through
 * the injected `AllocationDateEvaluator`, which `planner.ts` implements on top of its
 * single `evaluateProjectedDate` seam, so there is exactly one hard-gate path
 * (D-FEASIBILITY) rather than a second rules engine here.
 */
export interface RequiredRoleOccurrence {
    id: string;
    coverageSetId: string;
    coverageKey: PlanCoverageKey;
    /** Stable `EventPlanSessionCoverage` record identity, never a selected candidate. */
    authoredSessionIdentity: string;
    phase: PlanPhase;
    windowStart: string;
    windowEnd: string;
    ordinal: number;
    label: string;
    eligibleTemplateIds: string[];
    eligibleWorkoutIds: string[];
}

export type WeeklyRoleAllocationStatus = 'reserved' | 'fulfilled' | 'missed' | 'unresolved_search_budget';
export type WeeklyRoleMissReason = 'no_exact_candidate' | 'hard_safety_or_recovery' | 'projected_fatigue' | 'fixed_seed' | 'no_conflict_free_date';

export interface RoleReservation {
    occurrenceId: string;
    nominatedDate: string | null;
    assignedDate: string | null;
    templateId: string | null;
    workoutId: string | null;
    wasMoved: boolean;
}

export interface WeeklyRoleAllocationOutcome {
    occurrence: RequiredRoleOccurrence;
    reservation: RoleReservation;
    status: WeeklyRoleAllocationStatus;
    reason?: WeeklyRoleMissReason;
    observedBlockers?: string[];
}

export interface WeeklyRoleAllocationReport {
    outcomes: WeeklyRoleAllocationOutcome[];
}

export interface WeeklyAllocationSearchBudget {
    maxDates: number;
    maxOccurrences: number;
    maxCandidatesPerOccurrence: number;
    maxTransitions: number;
}

/** ADR-0018 D-BOUND. These are semantic caps, not a wall-clock cut-off: identical input
 * must produce an identical allocation on every device. */
export const WEEKLY_ALLOCATION_SEARCH_BUDGET: WeeklyAllocationSearchBudget = {
    maxDates: 7,
    maxOccurrences: 14,
    maxCandidatesPerOccurrence: 4,
    maxTransitions: 1024,
};

/** One tentative forecast selection. The allocator's state is an *unordered set* of these,
 * so the evaluator rebuilds the projected transition in real date order and the result
 * cannot depend on the order occurrences happened to be examined in. */
export interface AllocationAssignment {
    date: string;
    templateId: string;
}

export interface ProjectedDateOutcome {
    date: string;
    fatigueTier: 'train' | 'modify' | 'recover';
    /** Template ids that survive every production hard gate on this date. */
    acceptedTemplateIds: readonly string[];
    /** Template ids removed by the projected fatigue ceiling before ranking. */
    fatigueExcludedTemplateIds: readonly string[];
    /** `rankCandidates` exclusion reasons, keyed by rejected template id. */
    exclusionReasons: ReadonlyMap<string, readonly string[]>;
}

export interface AllocationDateEvaluator {
    /** Forecast dates the allocator may reserve, ascending. */
    forecastDates: readonly string[];
    /** Runs the production projected-date evaluation for `date` given the tentative
     * assignments so far. Implementations must be pure and order-independent. */
    evaluate(assignments: readonly AllocationAssignment[], date: string): ProjectedDateOutcome;
}

export interface WeeklyRoleAllocationResult {
    outcomes: WeeklyRoleAllocationOutcome[];
    /** Reserved occurrence per forecast date, for the greedy loop to protect. */
    reservationsByDate: Map<string, { occurrence: RequiredRoleOccurrence; templateId: string }>;
    fulfilledCount: number;
    transitionsUsed: number;
    budgetExhausted: boolean;
}

/** Hard-gate exclusions that are genuinely safety/feasibility outcomes rather than a
 * scheduling conflict. Anything unrecognised stays an observed blocker only. */
const SAFETY_EXCLUSION_REASONS = new Set([
    'INJURY_RESTRICTION',
    'QUALITY_SPACING_VIOLATION',
    'HARD_LOWER_BODY_SPACING_VIOLATION',
    'ROLLING_HARD_CAP_EXCEEDED',
    'ANCHOR_PROTECTION_VIOLATION',
]);

const FATIGUE_CEILING_BLOCKER = 'PROJECTED_FATIGUE_CEILING';

function canonicalOccurrenceId(parts: readonly string[]): string {
    return parts.map(part => encodeURIComponent(part)).join('|');
}

function fulfilledSessions(requirement: WeeklyCoverageRequirement): number {
    return requirement.completedSessions + requirement.projectedSessions;
}

/** Derive only remaining minimum authored roles. Credit ids are already deduplicated by
 * `buildCoverageState`, so replaying the same completed/projected exposure cannot create
 * an extra occurrence here. */
export function deriveRequiredRoleOccurrences(state: CoverageState): RequiredRoleOccurrence[] {
    const { phase, coverageSetId } = state;
    if (!phase || !coverageSetId) return [];
    return state.requirements
        .filter(requirement => requirement.minimumSessions > fulfilledSessions(requirement))
        .filter(requirement => requirement.key !== 'recovery_or_rest')
        .flatMap(requirement => {
            const startOrdinal = fulfilledSessions(requirement);
            const count = requirement.minimumSessions - startOrdinal;
            const authoredSessionIdentity = authoredSessionIdentityFor(coverageSetId, requirement.key);
            const windowStart = requirement.windowStart ?? state.asOfDate;
            const windowEnd = requirement.windowEnd ?? state.asOfDate;
            return Array.from({ length: count }, (_, index) => {
                const ordinal = startOrdinal + index;
                return {
                    id: canonicalOccurrenceId([
                        coverageSetId, windowStart, windowEnd, phase, requirement.key,
                        authoredSessionIdentity, String(ordinal),
                    ]),
                    coverageSetId,
                    coverageKey: requirement.key,
                    authoredSessionIdentity,
                    phase,
                    windowStart,
                    windowEnd,
                    ordinal,
                    label: requirement.label,
                    eligibleTemplateIds: [],
                    eligibleWorkoutIds: [],
                };
            });
        })
        .sort((left, right) => left.id.localeCompare(right.id));
}

export function attachExactEligibleIdentities(
    occurrences: readonly RequiredRoleOccurrence[],
    templates: readonly SessionTemplate[],
): RequiredRoleOccurrence[] {
    return occurrences.map(occurrence => {
        const eligibleTemplateIds = templates
            .filter(template => coverageKeysForTemplate(template, occurrence.phase).includes(occurrence.coverageKey))
            .map(template => template.id)
            .sort();
        return {
            ...occurrence,
            eligibleTemplateIds,
            eligibleWorkoutIds: [...new Set(
                eligibleTemplateIds.flatMap(id => workoutIdForTemplateId(id) ?? []),
            )].sort(),
        };
    });
}

function emptyReservation(occurrenceId: string): RoleReservation {
    return {
        occurrenceId,
        nominatedDate: null,
        assignedDate: null,
        templateId: null,
        workoutId: null,
        wasMoved: false,
    };
}

/** Exact identity only. A template fulfils an occurrence when `coverage.ts` already grants
 * that authored key for the occurrence's phase -- never through modality, category or
 * title similarity (ADR-0016). */
export function occurrenceForTemplate(
    occurrences: readonly RequiredRoleOccurrence[],
    template: SessionTemplate,
): RequiredRoleOccurrence[] {
    return occurrences.filter(occurrence => occurrence.eligibleTemplateIds.includes(template.id));
}

/**
 * Replays an existing reservation set through the evaluator in real date order and reports
 * whether every assignment is still admissible.
 *
 * This is the fast path of ADR-0018's D-SUPPORT viability check: if the incumbent
 * allocation survives a tentative supporting selection, the maximum achievable count
 * cannot have fallen below it, because added load never makes a rejected candidate
 * admissible. When the incumbent does break, the caller must fall back to the full bounded
 * search -- an equal-cardinality alternative may still exist.
 */
export function allocationSurvives(
    assignments: readonly AllocationAssignment[],
    evaluator: AllocationDateEvaluator,
): boolean {
    const applied: AllocationAssignment[] = [];
    for (const assignment of [...assignments].sort((left, right) => left.date.localeCompare(right.date))) {
        if (!evaluator.evaluate(applied, assignment.date).acceptedTemplateIds.includes(assignment.templateId)) return false;
        applied.push(assignment);
    }
    return true;
}

export interface WeeklyRoleReservationOptions {
    budget?: WeeklyAllocationSearchBudget;
    /** Dates the allocator may not use, e.g. the immutable today/tomorrow seeds. */
    unavailableDates?: ReadonlySet<string>;
    /** Prior nominations, so a re-plan reports `wasMoved` instead of a new occurrence. */
    nominatedDates?: ReadonlyMap<string, string | null>;
}

interface OccurrenceSearchState {
    occurrence: RequiredRoleOccurrence;
    candidates: AllocationAssignment[];
    /** The exact-candidate list was longer than the per-occurrence cap, so a failure for
     * this occurrence is budget exhaustion rather than proven infeasibility (D-BOUND). */
    truncated: boolean;
    blockers: Set<string>;
    sawDateConflict: boolean;
    sawFatigueExclusion: boolean;
    sawSafetyExclusion: boolean;
}

function assignmentSignature(assignments: readonly AllocationAssignment[]): string {
    return [...assignments]
        .map(item => `${item.date}:${item.templateId}`)
        .sort()
        .join(',');
}

function missReasonFor(state: OccurrenceSearchState): WeeklyRoleMissReason {
    if (state.candidates.length === 0) {
        if (state.sawSafetyExclusion) return 'hard_safety_or_recovery';
        if (state.sawFatigueExclusion) return 'projected_fatigue';
        return 'no_exact_candidate';
    }
    if (state.sawDateConflict) return 'no_conflict_free_date';
    if (state.sawSafetyExclusion) return 'hard_safety_or_recovery';
    if (state.sawFatigueExclusion) return 'projected_fatigue';
    return 'no_conflict_free_date';
}

/**
 * ADR-0018 D-RESERVE / D-BOUND: a bounded, deterministic backtracking search over
 * *minimum required role occurrences only*. It is not a utility search over workout
 * sequences and never imports the Phase 5.1 beam-search prototype.
 *
 * Joint feasibility is real: every tentative assignment is re-checked against the actual
 * projected fatigue/history transition produced by the accumulated assignments, so two
 * individually feasible dates that conflict after the first pick cannot both be reserved.
 */
export function resolveWeeklyRoleReservations(
    occurrences: readonly RequiredRoleOccurrence[],
    evaluator: AllocationDateEvaluator,
    options: WeeklyRoleReservationOptions = {},
): WeeklyRoleAllocationResult {
    const budget = options.budget ?? WEEKLY_ALLOCATION_SEARCH_BUDGET;
    const unavailableDates = options.unavailableDates ?? new Set<string>();
    const nominatedDates = options.nominatedDates ?? new Map<string, string | null>();

    const usableDates = evaluator.forecastDates.filter(date => !unavailableDates.has(date));
    const dates = usableDates.slice(0, budget.maxDates);
    const datesTruncated = usableDates.length > budget.maxDates;

    // Canonical occurrence order: earliest deadline, then authored key, then stable id.
    // Sorting is deliberately free -- only a projected-state transition consumes a node.
    const ordered = [...occurrences].sort((left, right) =>
        left.windowEnd.localeCompare(right.windowEnd)
        || left.coverageKey.localeCompare(right.coverageKey)
        || left.ordinal - right.ordinal
        || left.id.localeCompare(right.id));
    const examined = ordered.slice(0, budget.maxOccurrences);
    const unexamined = ordered.slice(budget.maxOccurrences);

    const evaluationCache = new Map<string, ProjectedDateOutcome>();
    const evaluateCached = (assignments: readonly AllocationAssignment[], date: string): ProjectedDateOutcome => {
        const key = `${date}#${assignmentSignature(assignments)}`;
        const cached = evaluationCache.get(key);
        if (cached) return cached;
        const outcome = evaluator.evaluate(assignments, date);
        evaluationCache.set(key, outcome);
        return outcome;
    };

    // Root candidate enumeration. The root is the least-loaded state the search can reach,
    // so a candidate rejected here can never become admissible deeper in; each survivor is
    // still re-proved against the real transition before it is reserved.
    const rootOutcomes = new Map<string, ProjectedDateOutcome>(
        dates.map(date => [date, evaluateCached([], date)] as const),
    );
    const searchStates: OccurrenceSearchState[] = examined.map(occurrence => {
        const all: AllocationAssignment[] = [];
        const blockers = new Set<string>();
        let sawFatigueExclusion = false;
        let sawSafetyExclusion = false;
        for (const date of dates) {
            const outcome = rootOutcomes.get(date)!;
            for (const templateId of occurrence.eligibleTemplateIds) {
                if (outcome.acceptedTemplateIds.includes(templateId)) {
                    all.push({ date, templateId });
                } else if (outcome.fatigueExcludedTemplateIds.includes(templateId)) {
                    sawFatigueExclusion = true;
                    blockers.add(`${date}:${FATIGUE_CEILING_BLOCKER}`);
                } else {
                    for (const reason of outcome.exclusionReasons.get(templateId) ?? []) {
                        blockers.add(`${date}:${reason}`);
                        if (SAFETY_EXCLUSION_REASONS.has(reason)) sawSafetyExclusion = true;
                    }
                }
            }
        }
        all.sort((left, right) => left.date.localeCompare(right.date) || left.templateId.localeCompare(right.templateId));
        return {
            occurrence,
            candidates: all.slice(0, budget.maxCandidatesPerOccurrence),
            truncated: all.length > budget.maxCandidatesPerOccurrence || datesTruncated,
            blockers,
            sawDateConflict: false,
            sawFatigueExclusion,
            sawSafetyExclusion,
        };
    });

    const stateById = new Map(searchStates.map(state => [state.occurrence.id, state]));
    let transitionsUsed = 0;
    let budgetExhausted = false;
    let bestByOccurrence = new Map<string, AllocationAssignment>();

    const search = (
        assignments: AllocationAssignment[],
        placed: Map<string, AllocationAssignment>,
        remaining: readonly OccurrenceSearchState[],
        depth: number,
    ): void => {
        if (placed.size > bestByOccurrence.size) bestByOccurrence = new Map(placed);
        // Every occurrence placed: no branch can beat this, so the search is complete.
        if (bestByOccurrence.size === searchStates.length) return;
        if (remaining.length === 0 || budgetExhausted) return;
        if (depth >= budget.maxOccurrences) return;
        // Prune any branch that cannot *beat* the incumbent. Ties are pruned rather than
        // explored because the traversal order is itself ADR-0018's stable tie-break order
        // (deadline, constrainedness, coverage key, template id, date) and an equal
        // cardinality never replaces the incumbent -- so an equal branch could only
        // reproduce the solution already held.
        if (placed.size + remaining.length <= bestByOccurrence.size) return;

        const usedDates = new Set(assignments.map(item => item.date));
        const freeCount = (state: OccurrenceSearchState) =>
            state.candidates.filter(item => !usedDates.has(item.date)).length;
        // Most constrained first, then the canonical deadline/key/id order above.
        const next = remaining.reduce((bestState, candidateState) =>
            freeCount(candidateState) < freeCount(bestState) ? candidateState : bestState, remaining[0]);
        const rest = remaining.filter(state => state !== next);

        for (const candidate of next.candidates) {
            if (usedDates.has(candidate.date)) {
                next.sawDateConflict = true;
                continue;
            }
            if (transitionsUsed >= budget.maxTransitions) {
                budgetExhausted = true;
                return;
            }
            transitionsUsed += 1;
            const outcome = evaluateCached(assignments, candidate.date);
            if (!outcome.acceptedTemplateIds.includes(candidate.templateId)) {
                if (outcome.fatigueExcludedTemplateIds.includes(candidate.templateId)) {
                    next.sawFatigueExclusion = true;
                    next.blockers.add(`${candidate.date}:${FATIGUE_CEILING_BLOCKER}`);
                } else {
                    for (const reason of outcome.exclusionReasons.get(candidate.templateId) ?? []) {
                        next.blockers.add(`${candidate.date}:${reason}`);
                        if (SAFETY_EXCLUSION_REASONS.has(reason)) next.sawSafetyExclusion = true;
                    }
                }
                continue;
            }
            assignments.push(candidate);
            placed.set(next.occurrence.id, candidate);
            search(assignments, placed, rest, depth + 1);
            placed.delete(next.occurrence.id);
            assignments.pop();
            if (budgetExhausted) return;
        }

        // Leaving this occurrence unplaced can still be the highest-cardinality solution
        // when it has no conflict-free date at all.
        search(assignments, placed, rest, depth + 1);
    };

    if (searchStates.length > 0 && dates.length > 0) search([], new Map(), searchStates, 0);

    const reservationsByDate = new Map<string, { occurrence: RequiredRoleOccurrence; templateId: string }>();
    bestByOccurrence.forEach((assignment, occurrenceId) => {
        const occurrence = stateById.get(occurrenceId)?.occurrence;
        if (occurrence) reservationsByDate.set(assignment.date, { occurrence, templateId: assignment.templateId });
    });

    const examinedOutcomes: WeeklyRoleAllocationOutcome[] = examined.map(occurrence => {
        const state = stateById.get(occurrence.id)!;
        const assignment = bestByOccurrence.get(occurrence.id);
        const nominated = nominatedDates.get(occurrence.id) ?? null;
        const observedBlockers = state.blockers.size > 0 ? { observedBlockers: [...state.blockers].sort() } : {};

        if (assignment) {
            return {
                occurrence,
                reservation: {
                    occurrenceId: occurrence.id,
                    nominatedDate: nominated ?? assignment.date,
                    assignedDate: assignment.date,
                    templateId: assignment.templateId,
                    workoutId: workoutIdForTemplateId(assignment.templateId) ?? null,
                    wasMoved: nominated !== null && nominated !== assignment.date,
                },
                status: 'reserved' as const,
                ...observedBlockers,
            };
        }

        const reservation = { ...emptyReservation(occurrence.id), nominatedDate: nominated };
        if (occurrence.eligibleTemplateIds.length === 0) {
            return { occurrence, reservation, status: 'missed' as const, reason: 'no_exact_candidate' as const, ...observedBlockers };
        }
        // Budget exhaustion is never converted into a safety miss or a false infeasibility.
        if (budgetExhausted || state.truncated) {
            return { occurrence, reservation, status: 'unresolved_search_budget' as const, ...observedBlockers };
        }
        return { occurrence, reservation, status: 'missed' as const, reason: missReasonFor(state), ...observedBlockers };
    });

    const unexaminedOutcomes: WeeklyRoleAllocationOutcome[] = unexamined.map(occurrence => ({
        occurrence,
        reservation: { ...emptyReservation(occurrence.id), nominatedDate: nominatedDates.get(occurrence.id) ?? null },
        status: 'unresolved_search_budget' as const,
    }));

    return {
        outcomes: [...examinedOutcomes, ...unexaminedOutcomes]
            .sort((left, right) => left.occurrence.id.localeCompare(right.occurrence.id)),
        reservationsByDate,
        fulfilledCount: bestByOccurrence.size,
        transitionsUsed,
        budgetExhausted: budgetExhausted || unexamined.length > 0,
    };
}
