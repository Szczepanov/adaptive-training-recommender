import { describe, expect, it } from 'vitest';
import { resolveEvergreenPlan } from './evergreenPlanning';
import { resolvePlanningContext } from './planningMode';
import { evaluatePeriodizationPhase } from './periodization';
import type { UserContext, UserPreferences, TrainingIntentProfile } from './models';

/**
 * End-to-end check (ADR-0037 D-DOSE) that a confirmed progression's per-session duration
 * actually reaches `packWeeklyDose` through `resolveEvergreenPlan`'s new
 * `progressionOverrides` parameter -- the lower-level substitution itself is covered by
 * `weeklyDosePacking.test.ts`; this proves the wiring between them is not lost.
 */

const DATE = '2026-09-07';

const evergreenProfile: TrainingIntentProfile = {
    userId: 'u1', planningMode: 'evergreen', priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 3 },
    organizationPreference: 'auto', schemaVersion: 1, createdAt: '', updatedAt: '',
};
const preferences: UserPreferences = {
    userId: 'u1', preferredRecoveryStyle: 'mixed', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 60,
    preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false, preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
    schemaVersion: 1, createdAt: '', updatedAt: '',
};
const context: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: true, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true, restrictedModalities: [], maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
};

function resolve(progressionOverrides?: ReadonlyMap<string, number>) {
    const planningContext = resolvePlanningContext(evergreenProfile, evaluatePeriodizationPhase([], DATE), DATE);
    return resolveEvergreenPlan(
        planningContext,
        evaluatePeriodizationPhase([], DATE).phase,
        [],
        null,
        preferences,
        context,
        DATE,
        [],
        7,
        false,
        [],
        progressionOverrides,
    );
}

describe('resolveEvergreenPlan progressionOverrides wiring', () => {
    it('threads a confirmed progression override into the packed weekly budget', () => {
        const baseline = resolve();
        expect(baseline).not.toBeNull();

        const overridden = resolve(new Map([['aerobic_volume', 200]]));
        expect(overridden).not.toBeNull();

        // The override raises aerobic_volume's per-session credited minutes well above its
        // catalog duration, so the same capacity now either clears a shortfall the baseline
        // had or packs fewer aerobic_volume sessions to reach the same target -- either way
        // the budgets must differ once the override is applied, proving it reached the packer.
        expect(overridden!.budget).not.toEqual(baseline!.budget);
    });

    it('is a no-op when no confirmed progression targets a wired coverage key', () => {
        const withEmptyMap = resolve(new Map());
        const withDefault = resolve();
        expect(withEmptyMap!.budget).toEqual(withDefault!.budget);
    });
});
