import type { PlanningMode, TrainingIntentProfile, TrainingPriority, UserEvent, UserGoal } from './models';
import type { PeriodizationResult } from './periodization';
import { resolvePlanDefinitionForEvent } from './planSchedule';
import { DEFAULT_TRAINING_INTENT_PROFILE } from './evergreenStrategy';

export interface PlanningContext {
    mode: PlanningMode;
    /** A resolved in-memory default is always present, even when no Firestore profile is. */
    profile: TrainingIntentProfile;
    focusEvent: UserEvent | null;
    eventStrategy: 'structured_plan' | 'demand_derived' | null;
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
): PlanningContext {
    void date;
    const resolvedProfile = fallbackProfile(profile);
    const hasEligibleEvent = periodization.focusEvent !== null;
    // Legacy profiles did not exist: retain event-directed behavior whenever the old
    // event pipeline has a governing event, otherwise use the evergreen default.
    const eventDirected = hasEligibleEvent && (profile === null || profile.planningMode === 'event_directed');
    if (!eventDirected) return { mode: 'evergreen', profile: resolvedProfile, focusEvent: null, eventStrategy: null };

    const focusEvent = periodization.focusEvent!;
    return {
        mode: 'event_directed',
        profile: resolvedProfile,
        focusEvent,
        eventStrategy: resolvePlanDefinitionForEvent(focusEvent) ? 'structured_plan' : 'demand_derived',
    };
}
