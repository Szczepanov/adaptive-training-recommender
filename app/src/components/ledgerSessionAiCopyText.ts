import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { buildWorkoutAiCopy, type ResponseLoader } from './completedWorkoutCopy';
import { findCompletedWorkoutForExecution } from './session/postCompletionAiCopy';

/** The completed session has not reached the History read model yet; nothing is copied. */
export class WorkoutNotReadyError extends Error {
  constructor() {
    super('Completed workout is not available yet.');
    this.name = 'WorkoutNotReadyError';
  }
}

/** Resolves the Markdown report for one execution, or rejects with `WorkoutNotReadyError`. */
export async function loadLedgerSessionAiCopyText(
  executionId: string,
  fetchViews: () => Promise<readonly CompletedWorkoutView[]>,
  exportedAt: string,
  loadResponses: ResponseLoader | undefined,
): Promise<string> {
  const view = findCompletedWorkoutForExecution(await fetchViews(), executionId);
  if (!view) throw new WorkoutNotReadyError();
  return buildWorkoutAiCopy(view, exportedAt, loadResponses);
}
