import { describe, expect, it } from 'vitest';
import type { MicrocycleState, UserEvent, WeeklyObjective, WorkoutStimulusProfile } from './models';
import { buildSeptemberCyclingEventPlan } from './planSchedule';
import { resolvePlannedDoseForDate } from './trainingIntent';
import { deriveObjectiveCredit, readStimulusProfile } from './stimulus';
import {
    creditObjectivesFromStimulus,
    getUnresolvedObjectives,
    LEGACY_KEYWORD_COMPATIBILITY_CREDIT,
    stimulusCoverage,
    STIMULUS_CREDIT_COVERAGE_THRESHOLD,
    updateMicrocycleProgress,
} from './microcycle';
import { applyProjectedObjectiveCredits } from './planner';

const septemberCyclingEvent: UserEvent = {
    id: 'sep-event-review',
    title: 'September Cycling Event',
    date: '2026-09-20',
    priority: 'A',
    lifecycle: 'scheduled',
    category: 'cycling_event',
    demandProfile: {
        aerobicEndurance: 0.8,
        thresholdPower: 0.8,
        vo2MaxPower: 0.7,
        repeatedSurges: 0.7,
        sprintPower: 0.3,
        fatigueResistance: 0.8,
        neuromuscular: 0.3,
    },
};

const zeroStimulus: WorkoutStimulusProfile = {
    aerobicEndurance: 0,
    thresholdPower: 0,
    vo2MaxPower: 0,
    repeatedSurges: 0,
    sprintPower: 0,
    fatigueResistance: 0,
    maxStrength: 0,
    hypertrophy: 0,
};

function objective(overrides: Partial<WeeklyObjective> = {}): WeeklyObjective {
    return {
        id: 'obj-z2',
        key: 'zone2_aerobic',
        title: 'Aerobic Base',
        requiredCredit: 1,
        targetExposures: 1,
        completedExposures: 0,
        targetStimulus: { aerobicEndurance: 0.8 },
        ...overrides,
    };
}

describe('Phase 4 review fixes', () => {
    it('uses exact authored travel/taper dose scales in explicit-plan mode', () => {
        const planState = buildSeptemberCyclingEventPlan(septemberCyclingEvent);
        expect(planState.status).toBe('AVAILABLE');
        if (planState.status !== 'AVAILABLE') throw new Error('Expected September plan');

        const genericPhase = { volumeScale: 1.1, intensityScale: 1.1 };
        const objectives = [objective()];
        const unresolved = [...objectives];

        expect(resolvePlannedDoseForDate(genericPhase, objectives, unresolved, planState.data, '2026-08-26'))
            .toEqual({ volume: 0.6, intensity: 0.8 });
        expect(resolvePlannedDoseForDate(genericPhase, objectives, unresolved, planState.data, '2026-09-10'))
            .toEqual({ volume: 0.5, intensity: 1.0 });
    });

    it('makes endurance objective credit sensitive to delivered duration', () => {
        const stimulus = { ...zeroStimulus, aerobicEndurance: 0.8 };
        const abbreviated = deriveObjectiveCredit(
            objective(),
            stimulus,
            { plannedDurationMin: 75, completedDurationMin: 15 },
            { modality: 'Cycling' },
        );
        const complete = deriveObjectiveCredit(
            objective(),
            stimulus,
            { plannedDurationMin: 75, completedDurationMin: 75 },
            { modality: 'Cycling' },
        );

        expect(abbreviated.earnedCredit).toBe(0.16);
        expect(complete.earnedCredit).toBe(0.8);
        expect(abbreviated.earnedCredit).toBeLessThan(complete.earnedCredit);
    });

    it('does not use elapsed duration as a proxy for strength-maintenance quality', () => {
        const strength = objective({
            id: 'obj-strength',
            key: 'strength_maintenance',
            targetStimulus: { maxStrength: 0.7 },
        });
        const stimulus = { ...zeroStimulus, maxStrength: 0.8 };
        expect(deriveObjectiveCredit(strength, stimulus, { plannedDurationMin: 60, completedDurationMin: 15 }).earnedCredit)
            .toBe(0.8);
    });

    it.each([
        [{ aerobicEndurance: 'bad' }, 'aerobicEndurance'],
        [{ aerobicEndurance: Number.NaN }, 'aerobicEndurance'],
        [{ aerobicEndurance: 1.1 }, 'aerobicEndurance'],
        [{ aerobicCapacity: -0.1 }, 'aerobicCapacity'],
    ])('rejects malformed persisted stimulus %#', (raw, field) => {
        const state = readStimulusProfile(raw);
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('Expected invalid stimulus');
        expect(state.issues).toContainEqual(expect.objectContaining({ code: 'stimulus_profile_invalid_axis', field }));
    });

    it('defines partial-canonical precedence per axis while allowing valid legacy backfill', () => {
        const state = readStimulusProfile({ aerobicEndurance: 0.9, thresholdDevelopment: 0.6 });
        expect(state.status).toBe('AVAILABLE');
        if (state.status !== 'AVAILABLE') throw new Error('Expected valid partial profile');
        expect(state.data.aerobicEndurance).toBe(0.9);
        expect(state.data.thresholdPower).toBe(0.6);
    });

    it('keeps structured and keyword fallback credit order-independent', () => {
        const base: MicrocycleState = {
            windowStartDate: '2026-08-03',
            objectives: [objective()],
        };
        const structuredStimulus = { ...zeroStimulus, aerobicEndurance: 0.4 };
        const legacyActivity = {
            type: 'Cycling endurance',
            duration_min: 45,
            training_effect: 0,
            intensity_tag: '',
        };

        const structuredThenLegacy = updateMicrocycleProgress(
            creditObjectivesFromStimulus(base, structuredStimulus, 'Cycling'),
            legacyActivity,
        );
        const legacyThenStructured = creditObjectivesFromStimulus(
            updateMicrocycleProgress(base, legacyActivity),
            structuredStimulus,
            'Cycling',
        );

        expect(LEGACY_KEYWORD_COMPATIBILITY_CREDIT).toBe(0.5);
        expect(structuredThenLegacy.objectives[0].completedCredit).toBe(0.9);
        expect(legacyThenStructured.objectives[0].completedCredit).toBe(0.9);
        expect(getUnresolvedObjectives(structuredThenLegacy).map(item => item.id)).toEqual(['obj-z2']);
        expect(getUnresolvedObjectives(legacyThenStructured).map(item => item.id)).toEqual(['obj-z2']);
    });

    it('stores forecast credit in projectedCredit without mutating completedCredit', () => {
        const base: MicrocycleState = {
            windowStartDate: '2026-08-03',
            objectives: [objective({ completedCredit: 0.2 })],
        };
        const result = applyProjectedObjectiveCredits(base, [{ objectiveId: 'obj-z2', earnedCredit: 0.6 }]);

        expect(result.allocations).toEqual([{ objectiveId: 'obj-z2', earnedCredit: 0.6 }]);
        expect(result.microcycle.objectives[0].completedCredit).toBe(0.2);
        expect(result.microcycle.objectives[0].projectedCredit).toBeCloseTo(0.6, 10);
        expect(getUnresolvedObjectives(result.microcycle)).toHaveLength(1);
        expect(getUnresolvedObjectives(result.microcycle, true)).toHaveLength(1);

        const filled = applyProjectedObjectiveCredits(result.microcycle, [{ objectiveId: 'obj-z2', earnedCredit: 0.5 }]);
        expect(filled.allocations).toEqual([{ objectiveId: 'obj-z2', earnedCredit: 0.2 }]);
        expect(filled.microcycle.objectives[0].completedCredit).toBe(0.2);
        expect(filled.microcycle.objectives[0].projectedCredit).toBeCloseTo(0.8, 10);
        expect(getUnresolvedObjectives(filled.microcycle)).toHaveLength(1);
        expect(getUnresolvedObjectives(filled.microcycle, true)).toHaveLength(0);
    });

    it('documents the intentional V1->V2 semantic delta for sub-threshold qualifying stimulus', () => {
        const stimulus = { ...zeroStimulus, aerobicEndurance: 0.4 };
        const v1WouldCredit = stimulusCoverage(stimulus, objective().targetStimulus) >= STIMULUS_CREDIT_COVERAGE_THRESHOLD;
        const v2 = deriveObjectiveCredit(objective(), stimulus, {}, { modality: 'Cycling' });

        expect(v1WouldCredit).toBe(false);
        expect(v2.qualifies).toBe(true);
        expect(v2.earnedCredit).toBe(0.4);
    });
});
