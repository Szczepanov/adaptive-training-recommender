import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { StaleCopyError } from '../utils/copyDeferredText';
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

/**
 * Button state after a failed copy. A copy superseded by a newer request returns to `idle`:
 * the newer request owns the clipboard and its own feedback, and the button must not stay
 * disabled (`busy`) waiting for a result that will never arrive.
 */
export function copyFailureState(err: unknown): 'idle' | 'not_ready' | 'error' {
  if (err instanceof StaleCopyError) return 'idle';
  return err instanceof WorkoutNotReadyError ? 'not_ready' : 'error';
}
