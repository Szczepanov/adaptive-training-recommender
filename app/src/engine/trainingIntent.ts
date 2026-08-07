import type { DailyReadiness, FatigueState, MicrocycleState, UserEvent, WeeklyObjective } from './models';
import { computeInternalResponseStrain, buildFatigueStateFromHistory } from './fatigue';
import { buildMicrocycleState, getUnresolvedObjectives } from './microcycle';
import type { CompletedExposure, TrainingHistoryProvider } from './trainingHistory';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';
import { evaluatePeriodizationPhase, type PeriodizationResult } from './periodization';
import { addDaysToLocalDateString } from '../utils/localDate';

export type PlannedRecoveryReason = 
  | 'scheduled_recovery'   // Prescribed microcycle rest day
  | 'load_target_reached' // Weekly strain cap met
  | 'key_session_shield'; // Protecting tomorrow's key anchor

export type ExecutionModifier = 
  | 'readiness_reduction' 
  | 'safety_constraint';

export interface TrainingIntent {
    periodization: PeriodizationResult;
    unresolvedObjectives: WeeklyObjective[];
    plannedDose: number;
    fatigue: FatigueState;
    /** Retained for the pure planner core after a single asynchronous read. */
    history: CompletedExposure[];
    /** Null only for legacy fixture providers that implement reconstruct() alone. */
    historySnapshot: TrainingHistorySnapshot | null;
    microcycle: MicrocycleState;
    sessionRole?: 'anchor' | 'supporting' | 'recovery';
    recoveryIntent?: {
        reason: PlannedRecoveryReason;
        priority: number;
    } | null;
    executionModifier?: ExecutionModifier | null;
}

/** Fetch the bounded history once and reuse that immutable revision across every
 * decision horizon in a dashboard refresh. Legacy fixture providers can omit it. */
export async function prepareTrainingHistorySnapshot(
    userId: string,
    throughDateExclusive: string,
    windowDays: number = 7,
    historyProvider?: TrainingHistoryProvider,
): Promise<TrainingHistorySnapshot | null> {
    const provider = historyProvider ?? (await import('./firestoreTrainingHistory')).firestoreTrainingHistoryProvider;
    return provider.getSnapshot
        ? provider.getSnapshot(userId, throughDateExclusive, windowDays)
        : null;
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
    preparedHistorySnapshot?: TrainingHistorySnapshot | null,
): Promise<TrainingIntent> {
    const periodization = evaluatePeriodizationPhase(events, date);
    // The production provider is dynamically loaded only when necessary. This keeps
    // Firebase configuration entirely outside deterministic engine-test imports.
    const historySnapshot = preparedHistorySnapshot
        ?? await prepareTrainingHistorySnapshot(userId, date, windowDays, historyProvider);
    const provider = historyProvider ?? (await import('./firestoreTrainingHistory')).firestoreTrainingHistoryProvider;
    const history = historySnapshot?.exposures ?? await provider.reconstruct(userId, date, windowDays);
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
    return { periodization, unresolvedObjectives, plannedDose, fatigue, history, historySnapshot, microcycle };
}
