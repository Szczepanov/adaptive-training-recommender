import type { PlanningMode, TrainingIntentProfile, UserEvent } from './models';
import type { PeriodizationResult } from './periodization';
import { resolvePlanDefinitionForEvent } from './planSchedule';

export interface PlanningContext {
    mode: PlanningMode;
    /** A resolved in-memory default is always present, even when no Firestore profile is. */
    profile: TrainingIntentProfile;
    focusEvent: UserEvent | null;
    eventStrategy: 'structured_plan' | 'demand_derived' | null;
}

export const DEFAULT_TRAINING_INTENT_PROFILE: Omit<TrainingIntentProfile, 'userId' | 'createdAt' | 'updatedAt'> = {
    planningMode: 'evergreen', priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 },
    organizationPreference: 'auto', schemaVersion: 1,
};

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
