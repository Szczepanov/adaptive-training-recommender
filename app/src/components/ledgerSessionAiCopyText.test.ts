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

  it('threads userId to redact it from the Markdown report even without responses', async () => {
    const view = {
      performedOccurrenceId: 'pto-1',
      sourceKeys: ['structured_execution:exec-1'],
      localDate: '2026-11-14',
      sourceBadge: { hasStructured: true, hasProvider: false, providers: [] },
      reconciliation: { state: 'single_source' },
      structured: {
        title: 'Run for user-secret-99',
        comparison: {
          definitionId: 'w-1', revision: 1, title: 'Run for user-secret-99',
          totalPlannedSteps: 0, completedStepsCount: 0, missingRequiredStepsCount: 0, stepComparisons: [],
          summary: { totalReps: 0, totalTonnageKg: 0, totalDurationSeconds: 0, totalDistanceMeters: 0 },
        },
        steps: [],
        performedRest: 'not_recorded',
        entryInvalidRecords: 0,
        execution: { executionId: 'exec-1', state: 'completed', startedAt: '2026-11-14T07:00:00.000Z', note: 'Owner user-secret-99' },
      },
      garminExerciseSetsAreDiagnosticOnly: true,
      sourceReads: {
        structured: { status: 'available' },
        provider: 'not_linked',
        outbox: { status: 'read', queued: 0, failed: 0 },
        reconciliationSweep: 'completed',
        ambiguousCounterpart: false,
      },
    } as unknown as CompletedWorkoutView;
    const md = await loadLedgerSessionAiCopyText('exec-1', async () => [view], '2026-11-14T10:00:00.000Z', undefined, 'user-secret-99');
    expect(md).not.toContain('user-secret-99');
    expect(md).toContain('# Session: Run for &#91;redacted&#93;');
    expect(md).toContain('note: Owner &#91;redacted&#93;');
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
