import { describe, expect, it } from 'vitest';
import { aerobicPackingForFloor, resolveEvergreenPlan, type EvergreenMechanicalInputs } from './evergreenPlanning';
import type { CheckinRecord } from './mechanicalProgression';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { addDaysToLocalDateString } from '../utils/localDate';
import { resolvePlanningContext } from './planningMode';
import { evaluatePeriodizationPhase } from './periodization';
import type { DailySubjectiveCheckin, UserContext, UserPreferences, TrainingIntentProfile } from './models';
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

    it('caps the long anchor and its packed role at the allocator-executable template maximum', () => {
        const highFloor: AerobicVolumeFloor = { floorMin: 135, source: 'athlete_history', sampleCount: 8, medianMin: 180 };
        const weeklyDose = {
            source: 'athlete_history' as const, modality: 'Cycling' as const,
            floorMinutes: 180, targetMinutes: 240, upperMinutes: 300,
            typicalSessionMinutes: 90, longAnchor: { workoutId: 'cycling_zone2_standard_01', durationMinutes: 90 },
            weeklyMinutes: [180, 240, 300, 360], observedWeeks: 4,
        };
        const result = aerobicPackingForFloor(highFloor, [{ date: DATE, availableMinutes: 150 }], weeklyDose, true);
        expect(result.descriptor.longAerobicAnchor?.durationMinutes).toBe(60);
        expect(result.descriptor.roles.find(role => role.id === 'aerobic_volume')?.durationMinutes).toBe(60);
    });
});

describe('resolveEvergreenPlan mechanical progression inputs (#804)', () => {
    const MECHANICAL_DATE = '2026-09-20';
    const sportReadinessProfile: TrainingIntentProfile = { ...evergreenProfile, priorities: ['sport_readiness'] };
    const establishedRuns: CompletedExposure[] = Array.from({ length: 12 }, (_, index) => ({
        occurrenceKey: `run-${index}`,
        date: addDaysToLocalDateString(MECHANICAL_DATE, -27 + index * 2),
        modality: 'Running',
        category: 'Easy Endurance',
        costProfile: { systemic: 0.25, cardiovascular: 0.35, lowerBody: 0.2, upperBody: 0, impactTissue: 0.3, neuromuscular: 0.1 },
        trainingRecordLike: { type: 'Running aerobic endurance', duration_min: 60, training_effect: 2, intensity_tag: 'easy' },
    }));
    const historySnapshot: TrainingHistorySnapshot = {
        throughDateExclusive: MECHANICAL_DATE,
        windowDays: 7,
        completedEvents: [],
        exposures: [],
        sourceStates: {
            activities: { status: 'AVAILABLE', revision: 'a' },
            recommendations: { status: 'AVAILABLE', revision: 'r' },
            manualTraining: { status: 'MISSING' },
        },
        generatedAt: '2026-09-20T05:00:00Z',
        revision: 'mechanical-test',
        athleteStateEvidence: { observedWindowDays: 28, exposures: establishedRuns },
    };
    const exposure = (date: string, workoutId: string): CompletedExposure => ({
        ...establishedRuns[0], occurrenceKey: `${workoutId}-${date}`, date, workoutId,
    });
    const tolerated = (date: string): CheckinRecord => ({
        date,
        checkin: {
            userId: 'u1', date, readiness: 8, sleepQuality: 8, fatigue: 2, soreness: 2, mentalStress: 2, motivation: 8,
            painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
            availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
            notes: null, submittedAt: `${date}T07:00:00.000Z`,
            tissueResponses: { knee: { region: 'knee', morningState: 'normal', nextMorningReaction: 'normal' } },
        } as DailySubjectiveCheckin,
    });

    function eligibleMechanicalWorkouts(mechanical: EvergreenMechanicalInputs): string[] | undefined {
        const planningContext = resolvePlanningContext(sportReadinessProfile, evaluatePeriodizationPhase([], MECHANICAL_DATE), MECHANICAL_DATE);
        const plan = resolveEvergreenPlan(
            planningContext, evaluatePeriodizationPhase([], MECHANICAL_DATE).phase, [], historySnapshot,
            preferences, context, MECHANICAL_DATE, [], 7, false, [], new Map(), null, false, mechanical,
        );
        return plan?.planDefinition.coverageRequirements
            ?.find(requirement => requirement.coverageKey === 'mechanical_exposure')?.eligibleWorkoutIds;
    }

    const walkRuns = [exposure('2026-09-15', 'running_walk_run_01'), exposure('2026-09-17', 'running_walk_run_01')];

    it('advances a tolerated Stage-1 athlete to Stage 2 only with explicit follow-up check-ins', () => {
        const withCheckins = eligibleMechanicalWorkouts({
            exposureHistory: walkRuns, checkinHistory: [tolerated('2026-09-16'), tolerated('2026-09-18')],
        });
        expect(withCheckins).toContain('strength_reactive_power_01');
        expect(withCheckins).not.toContain('field_acceleration_braking_01');

        const withoutCheckins = eligibleMechanicalWorkouts({ exposureHistory: walkRuns });
        expect(withoutCheckins).toContain('running_walk_run_01');
        expect(withoutCheckins).not.toContain('strength_reactive_power_01');
    });

    it('keeps a Stage-2 exposure from 10 days ago instead of re-entering at Stage 1', () => {
        const eligible = eligibleMechanicalWorkouts({ exposureHistory: [exposure('2026-09-10', 'strength_reactive_power_01')] });
        expect(eligible).toContain('strength_reactive_power_01');
    });

    it('advances from Stage 2 to Stage 3 only for an explicit higher target', () => {
        const stageTwo = [exposure('2026-09-15', 'strength_reactive_power_01'), exposure('2026-09-17', 'strength_reactive_power_01')];
        const checkinHistory = [tolerated('2026-09-16'), tolerated('2026-09-18')];

        expect(eligibleMechanicalWorkouts({ exposureHistory: stageTwo, checkinHistory })).not.toContain('field_acceleration_braking_01');
        expect(eligibleMechanicalWorkouts({ exposureHistory: stageTwo, checkinHistory, targetStage: 3 }))
            .toContain('field_acceleration_braking_01');
    });

    it('preserves a recent already-performed Stage 3 without requiring a new higher target', () => {
        const stageThree = [exposure('2026-09-15', 'field_acceleration_braking_01')];
        const checkinHistory = [tolerated('2026-09-16')];

        expect(eligibleMechanicalWorkouts({ exposureHistory: stageThree, checkinHistory }))
            .toContain('field_acceleration_braking_01');
    });
});
