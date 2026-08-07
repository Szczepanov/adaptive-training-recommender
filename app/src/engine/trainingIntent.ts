import type { DailyReadiness, FatigueState, UserEvent, WeeklyObjective } from './models';
import { computeInternalResponseStrain, buildFatigueStateFromHistory } from './fatigue';
import { buildMicrocycleState, getUnresolvedObjectives } from './microcycle';
import { reconstructRecentHistory } from './microcycleHistory';
import { evaluatePeriodizationPhase, type PeriodizationResult } from './periodization';
import { addDaysToLocalDateString } from '../utils/localDate';

export interface TrainingIntent {
    periodization: PeriodizationResult;
    unresolvedObjectives: WeeklyObjective[];
    plannedDose: number;
    fatigue: FatigueState;
}

/** Builds the shared plan-side state for today and future projections. Firestore is
 * intentionally read-only here: the durable inputs are adherence records; objectives,
 * dose and fatigue are freshly derived on every evaluation. */
export async function resolveTrainingIntent(
    userId: string,
    events: UserEvent[],
    date: string,
    readiness: DailyReadiness,
    windowDays: number = 7
): Promise<TrainingIntent> {
    const periodization = evaluatePeriodizationPhase(events, date);
    const history = await reconstructRecentHistory(userId, date, windowDays);
    const microcycle = buildMicrocycleState(
        periodization.phase,
        addDaysToLocalDateString(date, -windowDays),
        history
    );
    const unresolvedObjectives = getUnresolvedObjectives(microcycle);
    const fatigue = buildFatigueStateFromHistory(history, computeInternalResponseStrain(readiness), date);
    const urgency = microcycle.objectives.length === 0 ? 0 : unresolvedObjectives.length / microcycle.objectives.length;
    // Phase volume is normalized from its 0.4..1.1 policy range and then softened
    // when the current rolling objectives have already been satisfied.
    const plannedDose = Math.max(0, Math.min(1, (periodization.phase.volumeScale / 1.1) * (0.7 + (0.3 * urgency))));
    return { periodization, unresolvedObjectives, plannedDose, fatigue };
}
