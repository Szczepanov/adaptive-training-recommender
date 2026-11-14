import { describe, expect, it } from 'vitest';
import type { CompletedWorkoutView } from '../../training-occurrence/completedWorkoutView';
import { findCompletedWorkoutForExecution } from './postCompletionAiCopy';

function viewWith(executionId: string | undefined): CompletedWorkoutView {
  return { structured: executionId ? { execution: { executionId } } : undefined } as unknown as CompletedWorkoutView;
}

describe('findCompletedWorkoutForExecution', () => {
  it('finds the view by executionId', () => {
    const target = viewWith('exec-2');
    expect(findCompletedWorkoutForExecution([viewWith('exec-1'), viewWith(undefined), target], 'exec-2')).toBe(target);
  });

  it('returns undefined when absent', () => {
    expect(findCompletedWorkoutForExecution([viewWith('exec-1'), viewWith(undefined)], 'exec-9')).toBeUndefined();
  });
});
