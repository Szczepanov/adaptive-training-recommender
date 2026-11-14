// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { copyDeferredText, StaleCopyError } from '../utils/copyDeferredText';
import { copyFailureState, loadLedgerSessionAiCopyText, WorkoutNotReadyError } from './ledgerSessionAiCopyText';

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

describe('copyFailureState', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('maps not-ready, generic and stale failures to distinct button states', () => {
    expect(copyFailureState(new WorkoutNotReadyError())).toBe('not_ready');
    expect(copyFailureState(new Error('offline'))).toBe('error');
    expect(copyFailureState(new StaleCopyError())).toBe('idle');
  });

  it('returns a superseded Home copy to idle while the newer copy wins (#1258 review)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('ClipboardItem', undefined);
    let resolveOlder: (text: string) => void = () => {};
    const older = copyDeferredText(new Promise<string>(resolve => { resolveOlder = resolve; }));
    const newer = copyDeferredText(Promise.resolve('# Session: newer'));
    await newer;
    resolveOlder('# Session: older');
    const olderOutcome = await older.then(() => 'copied' as const, copyFailureState);
    expect(olderOutcome).toBe('idle');
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('# Session: newer');
  });
});
