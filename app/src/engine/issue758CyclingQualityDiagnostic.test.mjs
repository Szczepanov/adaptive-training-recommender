import { describe, expect, it } from 'vitest';

import { buildPersonaFamilies } from '../../scripts/ai-judge/personaSuite.mjs';
import { runScenario } from './simulation/analyze';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from './evergreenStrategy';
import { generateWeekAheadPlanWithIntent } from './planner';
import { resolveAvailability } from './schedule';
import { resolveTrainingCapacity } from './trainingCapacity';
import { EVERGREEN_PACKING_COVERAGE, packWeeklyDose } from './weeklyDosePacking';
import { WORKOUTS_BY_ID } from '../workouts/catalog';
import { addDaysToLocalDateString } from '../utils/localDate';

const CASE_IDS = ['persona_cycling_hybrid_baseline', 'persona_cycling_hybrid_low_time'];
const family = buildPersonaFamilies().find(item => item.familyId === 'persona_cycling_primary_hybrid');
const qualityRole = {
    ...EVERGREEN_PACKING_COVERAGE.roles.find(role => role.id === 'sustained_quality'),
    exactWorkoutIds: ['cycling_controlled_threshold_4x8_01', 'running_tempo_01'],
};
const frozenPackingCoverage = {
    ...EVERGREEN_PACKING_COVERAGE,
    roles: EVERGREEN_PACKING_COVERAGE.roles.map(role => role.id === 'sustained_quality' ? qualityRole : role),
};

/** Diagnose source-of-truth gates before the forecast ranks daily templates. */
function describeCandidate(window, workoutId, strategy, packedRole) {
    const workout = WORKOUTS_BY_ID.get(workoutId);
    const reasons = [];
    if (!qualityRole.exactWorkoutIds.includes(workoutId)) reasons.push('not_in_evergreen_quality_descriptor');
    if (!strategy.requirements.some(item => item.adaptation === 'high_intensity')) reasons.push('conditional_quality_prior_withheld');
    if (!packedRole) reasons.push('sustained_quality_not_packed');
    if (!workout || workout.duration.minimumMin > window.availableMinutes) reasons.push('workout_minimum_exceeds_window');
    return { workoutId, minimumMinutes: workout?.duration.minimumMin ?? null, reasons };
}

describe('issue #758 cycling quality diagnostic', () => {
    for (const caseId of CASE_IDS) {
        it(`runs the current planner against reconstructed pre-change ${caseId} history and quality descriptor`, async () => {
            const currentScenario = family?.cases.find(item => item.scenario.id === caseId)?.scenario;
            const scenario = currentScenario && {
                ...currentScenario,
                initialHistory: currentScenario.initialHistory.map(item => item.modality === 'Cycling'
                    ? { ...item, trainingRecordLike: { ...item.trainingRecordLike, duration_min: 60 } }
                    : item),
            };
            expect(scenario).toBeDefined();
            expect(scenario.initialHistory).toHaveLength(12);
            expect(scenario.initialHistory.reduce((sum, item) => sum + item.trainingRecordLike.duration_min, 0)).toBe(680);
            expect(qualityRole).toBeDefined();

            const weeks = [];
            const planGenerator = async (...args) => {
                const [userId, , context, preferences, , startDate, , , options, provider] = args;
                const historySnapshot = await provider.getSnapshot(userId, startDate, 28);
                const state = inferAthleteTrainingState(historySnapshot.exposures, historySnapshot.windowDays);
                const strategy = resolveEvidenceBackedStrategy({ priorities: scenario.trainingIntentProfile.priorities }, state);
                const packingDays = options.days ?? 7;
                const availability = Array.from({ length: packingDays }, (_, index) => {
                    const date = addDaysToLocalDateString(startDate, index);
                    return { date, maxTimeMinutes: resolveAvailability(date, null, [], context).maxTimeMinutes };
                });
                const capacity = resolveTrainingCapacity(scenario.trainingIntentProfile.weeklyCommitment, preferences, availability);
                const packed = packWeeklyDose(strategy, capacity, frozenPackingCoverage);
                const packedQuality = packed.optionalRoles.filter(role => role.coverageRoleId === 'sustained_quality');
                weeks.push({
                    startDate,
                    packingDays,
                    state: { trainingAgeProxy: state.trainingAgeProxy, dataQuality: state.inference.dataQuality, recentExposure: state.recentExposure },
                    strategy: { highIntensity: strategy.requirements.find(item => item.adaptation === 'high_intensity')?.priority ?? null, hardSessionCap: strategy.hardSessionCap ?? null, warnings: strategy.warnings.map(item => item.code) },
                    capacity: { minSessions: capacity.minSessions, targetSessions: capacity.targetSessions, maxSessions: capacity.maxSessions },
                    descriptor: { durationMinutes: qualityRole.durationMinutes, exactWorkoutIds: qualityRole.exactWorkoutIds },
                    packedQuality: packedQuality.map(role => ({ date: role.date, workoutIds: role.exactWorkoutIds })),
                    days: capacity.usableWindows.map(window => ({
                        date: window.date,
                        minutes: window.availableMinutes,
                        candidates: [...qualityRole.exactWorkoutIds, 'cycling_tempo_surges_01'].map(id =>
                            describeCandidate(window, id, strategy, packedQuality.some(role => role.date === window.date))),
                    })),
                });
                return generateWeekAheadPlanWithIntent(...args);
            };
            const simulated = await runScenario(scenario, planGenerator);
            expect(weeks).toHaveLength(2);
            expect(weeks.map(week => week.packingDays)).toEqual([6, 6]);
            expect(weeks.map(week => week.days.length)).toEqual([6, 6]);
            expect(weeks.map(week => week.state.dataQuality)).toEqual(['high', 'high']);
            expect(weeks.map(week => week.state.trainingAgeProxy)).toEqual(['developing', 'developing']);
            expect(weeks.map(week => week.strategy.highIntensity)).toEqual([null, null]);
            expect(weeks.map(week => week.strategy.hardSessionCap)).toEqual([null, null]);
            expect(weeks.map(week => week.packedQuality)).toEqual([[], []]);
            const selectedQuality = simulated.decisionTraces.filter(trace => trace.selected.modality === 'Cycling'
                && ['Moderate Endurance', 'Hard Endurance'].includes(trace.selected.category));
            expect(simulated.decisionTraces).toHaveLength(14);
            expect(selectedQuality).toHaveLength(0);
            expect(simulated.allocationReports).toHaveLength(2);
            expect(simulated.allocationReports.flatMap(entry => entry.report.outcomes
                .filter(outcome => outcome.occurrence.coverageKey === 'sustained_quality'))).toHaveLength(0);
            const reasonCode = {
                not_in_evergreen_quality_descriptor: 'D', conditional_quality_prior_withheld: 'P',
                sustained_quality_not_packed: 'N', workout_minimum_exceeds_window: 'T',
            };
            console.log(JSON.stringify({ caseId, candidateOrder: [...qualityRole.exactWorkoutIds, 'cycling_tempo_surges_01'],
                reasonCode, weeks: weeks.map(week => ({ startDate: week.startDate, packingDays: week.packingDays, state: week.state,
                    strategy: week.strategy, packedQuality: week.packedQuality,
                    days: week.days.map(day => [day.date, day.minutes, ...day.candidates.map(candidate =>
                        candidate.reasons.map(reason => reasonCode[reason]).join(''))]) })),
                selectedQuality: selectedQuality.map(trace => ({ date: trace.date, id: trace.selected.templateId })),
                outsidePackingHorizon: simulated.decisionTraces.filter(trace => !weeks.some(week => week.days
                    .some(day => day.date === trace.date))).map(trace => ({ date: trace.date, id: trace.selected.templateId })),
                actualQualityAllocations: simulated.allocationReports.map(entry => ({ week: entry.weekIndex,
                    outcomes: entry.report.outcomes.filter(outcome => outcome.occurrence.coverageKey === 'sustained_quality') })) }));
        });
    }
});
