import { describe, expect, it } from 'vitest';
import { aerobicPackingForFloor, resolveEvergreenPlan } from './evergreenPlanning';
import { resolvePlanningContext } from './planningMode';
import { evaluatePeriodizationPhase } from './periodization';
import type { UserContext, UserPreferences, TrainingIntentProfile } from './models';
import { CATALOG_AEROBIC_VOLUME_FLOOR, type AerobicVolumeFloor } from './aerobicVolumeFloor';

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

describe('resolveEvergreenPlan athlete-relative aerobic floor (#757)', () => {
    const ESTABLISHED_FLOOR: AerobicVolumeFloor = { floorMin: 45, source: 'athlete_history', sampleCount: 8, medianMin: 60 };

    function resolveWith(maxTimeMinutes: number, floor: AerobicVolumeFloor | null) {
        const cappedContext: UserContext = { ...context, constraints: { ...context.constraints, maxTimeMinutes } };
        const cappedPreferences: UserPreferences = { ...preferences, defaultWeekdayTimeMin: maxTimeMinutes, defaultWeekendTimeMin: maxTimeMinutes };
        const planningContext = resolvePlanningContext(evergreenProfile, evaluatePeriodizationPhase([], DATE), DATE);
        return resolveEvergreenPlan(
            planningContext, evaluatePeriodizationPhase([], DATE).phase, [], null, cappedPreferences, cappedContext,
            DATE, [], 7, false, [], new Map(), floor,
        );
    }

    it('is a no-op for a catalog-minimum floor (new users and thin evidence)', () => {
        expect(resolveWith(35, CATALOG_AEROBIC_VOLUME_FLOOR)!.budget).toEqual(resolveWith(35, null)!.budget);
    });

    it('keeps the aerobic role planned and reports an explicit shortfall when no window reaches the floor', () => {
        const catalog = resolveWith(35, null);
        const established = resolveWith(35, ESTABLISHED_FLOOR);
        const aerobicRoles = (plan: typeof catalog) => plan!.budget.requiredRoles.filter(role => role.coverageRoleId === 'aerobic_volume');
        // The aerobic role must not silently disappear under an unreachable floor.
        expect(aerobicRoles(established)).toEqual(aerobicRoles(catalog));
        expect(aerobicRoles(established).length).toBeGreaterThan(0);
        expect(established!.budget.shortfalls).toContainEqual(expect.objectContaining({
            code: 'minimum_dose_shortfall',
            adaptation: 'aerobic_endurance',
            message: expect.stringContaining('45-min aerobic-volume session floor'),
        }));
        expect(catalog!.budget.shortfalls.some(warning => warning.message.includes('session floor'))).toBe(false);
    });

    it('budgets the aerobic role at the floor when a window can hold it', () => {
        const roomy = aerobicPackingForFloor(ESTABLISHED_FLOOR, [{ date: DATE, availableMinutes: 35 }, { date: '2026-09-12', availableMinutes: 90 }]);
        expect(roomy.shortfall).toBeNull();
        expect(roomy.descriptor.roles.find(role => role.id === 'aerobic_volume')!.durationMinutes).toBe(45);
        expect(aerobicPackingForFloor(CATALOG_AEROBIC_VOLUME_FLOOR, []).descriptor.roles.find(role => role.id === 'aerobic_volume')!.durationMinutes).toBe(30);
    });
});
