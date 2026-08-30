import { addDaysToLocalDateString } from '../utils/localDate';
import type { FixedActivity, MicrocycleState, UserContext, UserPreferences } from './models';
import type { PlanningContext } from './planningMode';
import type { CompletedExposure } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import type { PhaseWeights } from './periodization';
import { resolveAvailability } from './schedule';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from './evergreenStrategy';
import { resolveTrainingCapacity } from './trainingCapacity';
import { EVERGREEN_PACKING_COVERAGE, packWeeklyDose, type WeeklyBudget } from './weeklyDosePacking';
import { buildEvergreenPlanDefinition, type PlanDefinition } from './planSchedule';
import { buildMicrocycleState } from './microcycle';

export interface ResolvedEvergreenPlan {
    planDefinition: PlanDefinition;
    microcycle: MicrocycleState;
    budget: WeeklyBudget;
}

/** The sole bridge from durable evergreen inputs to an executable rolling plan. It is
 * intentionally unavailable without preferences because duration is preference-owned,
 * not inferred from the profile. */
export function resolveEvergreenPlan(
    planningContext: PlanningContext,
    phase: PhaseWeights,
    history: readonly CompletedExposure[],
    historySnapshot: TrainingHistorySnapshot | null,
    preferences: UserPreferences | null,
    context: UserContext,
    date: string,
    fixedActivities: readonly FixedActivity[],
    days: number = 7,
): ResolvedEvergreenPlan | null {
    if (planningContext.mode !== 'evergreen' || !preferences) return null;
    const availability = Array.from({ length: Math.max(1, days) }, (_, index) => {
        const windowDate = addDaysToLocalDateString(date, index);
        return {
            date: windowDate,
            maxTimeMinutes: resolveAvailability(windowDate, null, [...fixedActivities], context).maxTimeMinutes,
        };
    });
    const capacity = resolveTrainingCapacity(planningContext.profile.weeklyCommitment, preferences, availability);
    const stateEvidence = historySnapshot?.athleteStateEvidence;
    const strategy = resolveEvidenceBackedStrategy(
        { priorities: planningContext.profile.priorities },
        inferAthleteTrainingState(
            stateEvidence?.exposures ?? history,
            stateEvidence?.observedWindowDays ?? historySnapshot?.windowDays ?? 0,
        ),
    );
    const budget = packWeeklyDose(strategy, capacity, EVERGREEN_PACKING_COVERAGE);
    const result = buildEvergreenPlanDefinition(strategy, capacity, budget, date);
    if (result.status !== 'AVAILABLE') return null;
    return {
        planDefinition: result.data,
        microcycle: buildMicrocycleState(phase, addDaysToLocalDateString(date, -7), [...history], null, result.data, date),
        budget,
    };
}
