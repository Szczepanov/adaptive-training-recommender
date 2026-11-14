// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { loadLedgerSessionAiCopyText, WorkoutNotReadyError } from './ledgerSessionAiCopyText';

describe('loadLedgerSessionAiCopyText', () => {
  it('rejects with WorkoutNotReadyError when no view matches the execution', async () => {
    const other = { structured: { execution: { executionId: 'other' } } } as unknown as CompletedWorkoutView;
    await expect(loadLedgerSessionAiCopyText('exec-1', async () => [other], '2026-11-14T10:00:00.000Z', undefined))
      .rejects.toBeInstanceOf(WorkoutNotReadyError);
  });

  it('propagates a failing read as a generic error, not not-ready', async () => {
    const fetchViews = vi.fn().mockRejectedValue(new Error('offline'));
    const result = loadLedgerSessionAiCopyText('exec-1', fetchViews, '2026-11-14T10:00:00.000Z', undefined);
    await expect(result).rejects.toThrow('offline');
    await expect(result).rejects.not.toBeInstanceOf(WorkoutNotReadyError);
  });
});
