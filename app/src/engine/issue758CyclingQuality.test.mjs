import { describe, expect, it } from 'vitest';

import { buildPersonaFamilies } from '../../scripts/ai-judge/personaSuite.mjs';
import { runScenario } from './simulation/analyze';
import { generateWeekAheadPlanWithIntent } from './planner';
import { aerobicPackingForFloor } from './evergreenPlanning';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from './evergreenStrategy';
import { resolveAerobicVolumeFloor } from './aerobicVolumeFloor';
import { resolveAvailability } from './schedule';
import { resolveTrainingCapacity } from './trainingCapacity';
import { EVERGREEN_PACKING_COVERAGE, packWeeklyDose } from './weeklyDosePacking';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../workouts/event-plan';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { ENRICHED_TEMPLATES_BY_ID } from './templates';
import { evaluateTemplateEligibility } from './eligibility';
import { resolveTimeCapDoseAdjustment } from './optimizer';
import { addDaysToLocalDateString } from '../utils/localDate';
import { resolveWorkoutPrescription } from '../workouts/prescription';

const cases = buildPersonaFamilies().find(family => family.familyId === 'persona_cycling_primary_hybrid')?.cases ?? [];
const caseFor = id => {
    const scenario = cases.find(item => item.scenario.id === id)?.scenario;
    if (!scenario) throw new Error(`Missing issue #758 persona case: ${id}`);
    return scenario;
};
const cyclingQuality = result => result.decisionTraces.filter(trace =>
    trace.selected.modality === 'Cycling'
    && ['Moderate Endurance', 'Hard Endurance'].includes(trace.selected.category));
function packingFor(scenario) {
    const state = inferAthleteTrainingState(scenario.initialHistory, 28);
    const strategy = resolveEvidenceBackedStrategy({ priorities: scenario.trainingIntentProfile.priorities }, state);
    const availability = Array.from({ length: 6 }, (_, index) => {
        const date = addDaysToLocalDateString(scenario.startDate, index);
        return { date, maxTimeMinutes: resolveAvailability(date, null, [], scenario.context).maxTimeMinutes };
    });
    const capacity = resolveTrainingCapacity(scenario.trainingIntentProfile.weeklyCommitment, scenario.preferences, availability);
    const floor = resolveAerobicVolumeFloor(scenario.initialHistory, scenario.startDate);
    const descriptor = aerobicPackingForFloor(floor, capacity.usableWindows).descriptor;
    return { state, strategy, budget: packWeeklyDose(strategy, capacity, descriptor) };
}

describe('issue #758 evergreen cycling quality', () => {
    it('keeps the quality role optional with the existing exact workout identities', () => {
        const role = EVERGREEN_GENERAL_COVERAGE_SET.coverage.find(item => item.key === 'sustained_quality');
        const packingRole = EVERGREEN_PACKING_COVERAGE.roles.find(item => item.id === 'sustained_quality');
        expect(role?.requirement).toBe('optional');
        expect(EVERGREEN_GENERAL_COVERAGE_SET.requiredKeys).not.toContain('sustained_quality');
        expect(role?.workoutIds).toEqual([
            'cycling_controlled_threshold_4x8_01',
            'cycling_tempo_surges_01',
            'running_tempo_01',
        ]);
        expect(packingRole?.exactWorkoutIds).toEqual(role?.workoutIds);
        expect(WORKOUTS_BY_ID.get('cycling_tempo_surges_01')?.duration.minimumMin).toBe(30);
        expect(WORKOUTS_BY_ID.get('cycling_tempo_surges_01')?.variants.some(
            variant => variant.id === 'return_to_training' && variant.targetDurationMin === 30,
        )).toBe(true);
    });

    it('packs optional cycling quality and explains when required reservations consume the feasible forecast dates', async () => {
        const scenario = caseFor('persona_cycling_hybrid_baseline');
        expect(scenario.initialHistory).toHaveLength(12);
        expect(scenario.initialHistory.reduce((sum, item) => sum + item.trainingRecordLike.duration_min, 0)).toBeGreaterThanOrEqual(720);
        const { state, strategy, budget } = packingFor(scenario);
        expect(state.trainingAgeProxy).toBe('established');
        expect(strategy.requirements.some(requirement => requirement.adaptation === 'high_intensity')).toBe(true);
        expect(strategy.hardSessionCap).toBe(2);
        expect(budget.optionalRoles.some(role => role.coverageRoleId === 'sustained_quality'
            && role.exactWorkoutIds.includes('cycling_tempo_surges_01'))).toBe(true);
        const plans = [];
        const result = await runScenario(scenario, async (...args) => {
            const plan = await generateWeekAheadPlanWithIntent(...args);
            plans.push(plan);
            return plan;
        });
        expect(result.decisionTraces).toHaveLength(14);
        expect(cyclingQuality(result)).toHaveLength(0);
        expect(plans[0].allocationReport.optionalMisses).toContainEqual(expect.objectContaining({
            coverageKey: 'sustained_quality', reason: 'capacity_exhausted_by_required_roles',
            observedBlockedDates: expect.arrayContaining([expect.any(String)]),
        }));
        const blockedDates = plans[0].allocationReport.optionalMisses[0].observedBlockedDates;
        expect(blockedDates.every(date => plans[0].allocationReport.outcomes.some(outcome =>
            outcome.status === 'fulfilled' && outcome.reservation.assignedDate === date,
        ))).toBe(true);
    });

    it('limits seven-day capacity evidence to the active evergreen quality block', async () => {
        const scenario = { ...caseFor('persona_cycling_hybrid_baseline'), weeks: 1 };
        let plan;
        await runScenario(scenario, async (...args) => {
            args[8] = { ...args[8], days: 7 };
            plan = await generateWeekAheadPlanWithIntent(...args);
            return plan;
        });
        const blockEndDate = addDaysToLocalDateString(scenario.startDate, 6);
        expect(plan.days.at(-1).date).toBe(addDaysToLocalDateString(blockEndDate, 1));
        expect(plan.allocationReport.optionalMisses).toContainEqual(expect.objectContaining({
            coverageKey: 'sustained_quality', reason: 'capacity_exhausted_by_required_roles',
            observedBlockedDates: expect.arrayContaining([expect.any(String)]),
        }));
        expect(plan.allocationReport.optionalMisses[0].observedBlockedDates.every(date =>
            date >= scenario.startDate && date <= blockEndDate,
        )).toBe(true);
    });

    it('uses an otherwise-free training day for quality without exceeding maxSessions or moving required roles', async () => {
        const base = caseFor('persona_cycling_hybrid_baseline');
        const scenario = {
            ...base,
            weeks: 1,
            trainingIntentProfile: {
                ...base.trainingIntentProfile,
                weeklyCommitment: { minSessions: 4, targetSessions: 5, maxSessions: 6 },
            },
        };
        const plans = [];
        const result = await runScenario(scenario, async (...args) => {
            args[8] = { ...args[8], days: 7 };
            const plan = await generateWeekAheadPlanWithIntent(...args);
            plans.push(plan);
            return plan;
        });
        const selectedQuality = cyclingQuality(result);
        expect(selectedQuality).toHaveLength(1);
        const requiredReservationDates = new Set(plans[0].allocationReport.outcomes
            .filter(outcome => outcome.status === 'fulfilled')
            .map(outcome => outcome.reservation.assignedDate));
        expect(selectedQuality.every(trace => !requiredReservationDates.has(trace.date))).toBe(true);
        expect(plans[0].allocationReport.optionalMisses ?? []).toHaveLength(0);
        const qualityBlockEnd = addDaysToLocalDateString(scenario.startDate, 6);
        const exerciseDates = new Set(result.decisionTraces.filter(trace =>
            trace.date >= scenario.startDate
            && trace.date <= qualityBlockEnd
            && !['Rest', 'Mobility/Recovery'].includes(trace.selected.category),
        ).map(trace => trace.date));
        expect(exerciseDates.size).toBeLessThanOrEqual(scenario.trainingIntentProfile.weeklyCommitment.maxSessions);
    });

    it('does not place optional cycling quality on a stimulus-only fixed-activity date', async () => {
        const base = caseFor('persona_cycling_hybrid_baseline');
        const controlScenario = {
            ...base,
            weeks: 1,
            trainingIntentProfile: {
                ...base.trainingIntentProfile,
                weeklyCommitment: { minSessions: 4, targetSessions: 5, maxSessions: 6 },
            },
        };
        const run = scenario => runScenario(scenario, async (...args) => {
            args[8] = { ...args[8], days: 7 };
            return generateWeekAheadPlanWithIntent(...args);
        });
        const control = await run(controlScenario);
        const controlQuality = cyclingQuality(control);
        expect(controlQuality).toHaveLength(1);
        const fixedDate = controlQuality[0].date;
        const scenario = {
            ...controlScenario,
            fixedActivities: ['stimulus-only-booking', 'second-stimulus-only-booking'].map(id => ({
                id,
                userId: 'test-athlete',
                title: 'Booked training session',
                date: fixedDate,
                durationMin: 30,
                expectedStimulus: { aerobicEndurance: 0.4 },
                fixed: true,
                isCompleted: false,
                environment: 'indoor',
                equipment: ['indoor_bike'],
                createdAt: '2026-08-31T00:00:00.000Z',
                updatedAt: '2026-08-31T00:00:00.000Z',
            })),
        };
        const result = await run(scenario);
        const selectedQuality = cyclingQuality(result);
        expect(selectedQuality).toHaveLength(1);
        expect(selectedQuality.every(trace => trace.date !== fixedDate)).toBe(true);
        const qualityBlockEnd = addDaysToLocalDateString(scenario.startDate, 6);
        const recommendedExerciseSessions = result.decisionTraces.filter(trace =>
            trace.date >= scenario.startDate
            && trace.date <= qualityBlockEnd
            && !['Rest', 'Mobility/Recovery'].includes(trace.selected.category),
        ).length;
        expect(recommendedExerciseSessions + scenario.fixedActivities.length)
            .toBeLessThanOrEqual(scenario.trainingIntentProfile.weeklyCommitment.maxSessions);
    });

    it('admits the authored cycling tempo variant within a 35-minute cap without falsely reporting capacity exhaustion', async () => {
        const scenario = caseFor('persona_cycling_hybrid_low_time');
        const tempo = ENRICHED_TEMPLATES_BY_ID.get('end_mod_02');
        expect(tempo?.durationMin).toBe(40);
        expect(tempo?.easierDose).toMatchObject({ durationMin: 30, durationMax: 30 });
        expect(evaluateTemplateEligibility(tempo, scenario.context, 35, scenario.startDate).eligible).toBe(true);
        const capAdjustment = resolveTimeCapDoseAdjustment(tempo, 35, false);
        const cappedPrescription = capAdjustment?.activeDose;
        expect(cappedPrescription?.durationMin).toBeGreaterThanOrEqual(30);
        expect(cappedPrescription?.durationMax).toBeLessThanOrEqual(35);
        const catalogPrescription = resolveWorkoutPrescription({
            template: tempo,
            rationale: 'issue #758 cap-fit regression',
            mode: 'train',
            activeDose: cappedPrescription,
            adjustment: capAdjustment?.adjustment,
        }, 'issue-758', scenario.startDate);
        expect(catalogPrescription?.targetDurationMin).toBeGreaterThanOrEqual(30);
        expect(catalogPrescription?.targetDurationMin).toBeLessThanOrEqual(35);
        expect(catalogPrescription?.variantId).toBe('reduced');
        const plans = [];
        const result = await runScenario(scenario, async (...args) => {
            const plan = await generateWeekAheadPlanWithIntent(...args);
            plans.push(plan);
            return plan;
        });
        const selected = cyclingQuality(result);
        expect(selected.length).toBeGreaterThanOrEqual(1);
        expect(selected.every(trace => trace.selected.durationMin >= 30)).toBe(true);
        expect(selected.every(trace => trace.selected.durationMin <= 35)).toBe(true);
        expect(selected.every(trace => trace.selected.durationMax <= 35)).toBe(true);
        expect(plans.flatMap(plan => plan.allocationReport.optionalMisses ?? []).some(
            miss => miss.reason === 'capacity_exhausted_by_required_roles',
        )).toBe(false);
    });

    it('withholds cycling quality throughout adverse recovery', async () => {
        const plans = [];
        const result = await runScenario(caseFor('persona_cycling_hybrid_adverse_recovery'), async (...args) => {
            const plan = await generateWeekAheadPlanWithIntent(...args);
            plans.push(plan);
            return plan;
        });
        expect(cyclingQuality(result)).toHaveLength(0);
        expect(plans.flatMap(plan => plan.allocationReport.optionalMisses ?? [])).toHaveLength(0);
    });

    it('withholds cycling quality throughout the local tissue conflict', async () => {
        const result = await runScenario(caseFor('persona_cycling_hybrid_local_tissue_conflict'));
        expect(cyclingQuality(result)).toHaveLength(0);
    });
});
