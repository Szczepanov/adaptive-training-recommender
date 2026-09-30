import type { AuthoredPlanBlock, ExternalPlanSession, PlanningMode, TrainingIntentProfile, TrainingPriority, UserEvent, UserGoal } from './models';
import type { PeriodizationResult } from './periodization';
import { resolveActivePlanDefinitionForEvent } from './planSchedule';
import { DEFAULT_TRAINING_INTENT_PROFILE } from './evergreenStrategy';

export interface PlanningContext {
    mode: PlanningMode;
    /** A resolved in-memory default is always present, even when no Firestore profile is. */
    profile: TrainingIntentProfile;
    focusEvent: UserEvent | null;
    /** Date-local event programming authority. A cycling event can remain the focus
     * context while its authored plan is not yet active; in that case evergreen owns the
     * executable week until a structured block starts. */
    eventStrategy: 'structured_plan' | 'demand_derived' | 'evergreen_fallback' | null;
    /** The imported session placed on this date, present only in `externally_planned`
     * mode. Callers adjudicate it instead of ranking candidates (ADR-0019 D-EXT). */
    externalSession: ExternalPlanSession | null;
    /** True when the athlete selected `externally_planned` but no session is placed today,
     * so the engine's own pick is standing in. Never silent: the caller labels it. */
    externalFallback: boolean;
}

/** True when the current date is executed by the Evergreen dose/packing authority.
 * A far-out event can remain contextual without owning executable programming. */
export function usesEvergreenProgramming(planningContext: PlanningContext): boolean {
    return planningContext.mode === 'evergreen'
        || (planningContext.mode === 'event_directed'
            && planningContext.eventStrategy === 'evergreen_fallback');
}

export { DEFAULT_TRAINING_INTENT_PROFILE } from './evergreenStrategy';

type GoalForPrioritySuggestion = UserGoal & { id?: string };

const GOAL_DOMAIN_PRIORITY: Partial<Record<UserGoal['domain'], TrainingPriority>> = {
    strength: 'strength_muscle',
    endurance: 'endurance',
    general_fitness: 'health',
    weight_loss: 'health',
};

/** Produces form-seeding suggestions only. Profile-less engine evaluation continues to
 * use DEFAULT_TRAINING_INTENT_PROFILE until the athlete confirms a saved profile. */
export function suggestTrainingPriorities(goals: readonly GoalForPrioritySuggestion[]): TrainingPriority[] {
    const ordered = goals
        .filter(goal => goal.status === 'active' && !goal.targetDate)
        .map(goal => ({ goal, priority: GOAL_DOMAIN_PRIORITY[goal.domain] }))
        .filter((item): item is { goal: GoalForPrioritySuggestion; priority: TrainingPriority } => item.priority !== undefined)
        .sort((left, right) => right.goal.priority - left.goal.priority
            || (left.goal.createdAt ?? '').localeCompare(right.goal.createdAt ?? '')
            || (left.goal.id ?? left.goal.title).localeCompare(right.goal.id ?? right.goal.title));
    const suggestions = Array.from(new Set(ordered.map(item => item.priority)));
    return suggestions.length > 0 ? suggestions : ['balanced_performance'];
}

function fallbackProfile(profile: TrainingIntentProfile | null): TrainingIntentProfile {
    if (profile) return profile;
    return {
        userId: '', ...DEFAULT_TRAINING_INTENT_PROFILE,
        createdAt: '', updatedAt: '',
    };
}

/** Resolves planning authority once per date. `TrainingIntentProfile` is persisted athlete
 * input; this result is the per-decision engine context and deliberately owns the event
 * fallback rules so callers do not infer mode from `focusEvent === null`. */
export function resolvePlanningContext(
    profile: TrainingIntentProfile | null,
    periodization: PeriodizationResult,
    date: string,
    /** The imported session already placed on `date`, if any. Resolved by the caller
     * through `externalPlacement.ts`; this function performs no placement itself. */
    externalSession: ExternalPlanSession | null = null,
    /** Explicit travel blocks can legitimately make a structured event plan active before
     * its derived build window, so authority resolution must see the same authored blocks
     * as trainingIntent. */
    authoredPlanBlocks: readonly AuthoredPlanBlock[] = [],
): PlanningContext {
    const resolvedProfile = fallbackProfile(profile);

    // D-EXT: externally-planned is effective only when the athlete chose it AND a session
    // is actually placed today. Choosing the mode does not by itself suspend the engine --
    // an unplanned day falls back to the athlete's underlying behaviour, labelled.
    if (profile?.planningMode === 'externally_planned') {
        if (externalSession) {
            return {
                mode: 'externally_planned', profile: resolvedProfile,
                focusEvent: periodization.focusEvent, eventStrategy: null,
                externalSession, externalFallback: false,
            };
        }
        return {
            mode: 'evergreen', profile: resolvedProfile, focusEvent: null, eventStrategy: null,
            externalSession: null, externalFallback: true,
        };
    }

    const hasEligibleEvent = periodization.focusEvent !== null;
    // Legacy profiles did not exist: retain event-directed behavior whenever the old
    // event pipeline has a governing event, otherwise use the evergreen default.
    const eventDirected = hasEligibleEvent && (profile === null || profile.planningMode === 'event_directed');
    if (!eventDirected) return { mode: 'evergreen', profile: resolvedProfile, focusEvent: null, eventStrategy: null, externalSession: null, externalFallback: false };

    const focusEvent = periodization.focusEvent!;
    const eventStrategy = focusEvent.category === 'cycling_event'
        ? (resolveActivePlanDefinitionForEvent(focusEvent, date, authoredPlanBlocks)
            ? 'structured_plan'
            : 'evergreen_fallback')
        : 'demand_derived';
    return {
        mode: 'event_directed',
        profile: resolvedProfile,
        focusEvent,
        eventStrategy,
        externalSession: null,
        externalFallback: false,
    };
}
