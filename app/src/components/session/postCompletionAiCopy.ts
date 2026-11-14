import type { CompletedWorkoutView } from '../../training-occurrence/completedWorkoutView';

/** The completed-workout view whose structured execution is `executionId`, if the read model has it yet. */
export function findCompletedWorkoutForExecution(
  views: readonly CompletedWorkoutView[],
  executionId: string,
): CompletedWorkoutView | undefined {
  return views.find(view => view.structured?.execution?.executionId === executionId);
}
