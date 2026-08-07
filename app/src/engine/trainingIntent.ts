import type { DailyReadiness, FatigueState, MicrocycleState, UserEvent, WeeklyObjective } from './models';
import { computeInternalResponseStrain, buildFatigueStateFromHistory } from './fatigue';
import { buildMicrocycleState, getUnresolvedObjectives } from './microcycle';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import { evaluatePeriodizationPhase, type PeriodizationResult } from './periodization';
import { addDaysToLocalDateString } from '../utils/localDate';

export interface TrainingIntent {
    periodization: PeriodizationResult;
    unresolvedObjectives: WeeklyObjective[];
    plannedDose: number;
    fatigue: FatigueState;
    /** Retained for the pure planner core after a single asynchronous read. */
    history: CompletedExposure[];
    microcycle: MicrocycleState;
}

/** Builds the shared plan-side state for today and future projections. Firestore is
 * intentionally read-only here: the durable inputs are adherence records; objectives,
 * dose and fatigue are freshly derived on every evaluation. */
export async function resolveTrainingIntent(
    userId: string,
    events: UserEvent[],
    date: string,
    readiness: DailyReadiness,
    windowDays: number = 7,
    historyProvider?: TrainingHistoryProvider,
): Promise<TrainingIntent> {
    const periodization = evaluatePeriodizationPhase(events, date);
    // The production provider is dynamically loaded only when necessary. This keeps
    // Firebase configuration entirely outside deterministic engine-test imports.
    const provider = historyProvider ?? (await import('./firestoreTrainingHistory')).firestoreTrainingHistoryProvider;
    const history = await provider.reconstruct(userId, date, windowDays);
    const microcycle = buildMicrocycleState(
        periodization.phase,
        addDaysToLocalDateString(date, -windowDays),
        history,
        periodization.focusEvent,
    );
    const unresolvedObjectives = getUnresolvedObjectives(microcycle);
    const fatigue = buildFatigueStateFromHistory(history, computeInternalResponseStrain(readiness), date);
    const urgency = microcycle.objectives.length === 0 ? 0 : unresolvedObjectives.length / microcycle.objectives.length;
    // Phase volume is normalized from its 0.4..1.1 policy range and then softened
    // when the current rolling objectives have already been satisfied.
    const plannedDose = Math.max(0, Math.min(1, (periodization.phase.volumeScale / 1.1) * (0.7 + (0.3 * urgency))));
    return { periodization, unresolvedObjectives, plannedDose, fatigue, history, microcycle };
}
