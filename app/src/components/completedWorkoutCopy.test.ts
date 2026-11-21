import { describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../responses/models';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';

const { formatMarkdown } = vi.hoisted(() => ({ formatMarkdown: vi.fn(() => 'REPORT') }));
vi.mock('../training-occurrence/completedWorkoutMarkdown', () => ({ formatCompletedWorkoutMarkdown: formatMarkdown }));

import { buildWorkoutAiCopy, loadWorkoutResponses, structuredExecutionIdsOf } from './completedWorkoutCopy';

const EXPORTED_AT = '2026-11-14T10:00:00.000Z';
const withExecution = {
    performedOccurrenceId: 'pto-1', sourceKeys: ['structured_execution:exec-1'], structured: { execution: { executionId: 'exec-1' } },
} as unknown as CompletedWorkoutView;
const withoutExecution = { performedOccurrenceId: 'pto-2', sourceKeys: ['provider_activity:garmin:9'] } as unknown as CompletedWorkoutView;
const responses = [{ responseId: 'r1' }] as unknown as SessionResponse[];

describe('buildWorkoutAiCopy', () => {
    it('passes the response read to the markdown', async () => {
        const load = vi.fn().mockResolvedValue({ responses, invalidRecords: 0 });
        await expect(buildWorkoutAiCopy(withExecution, EXPORTED_AT, load)).resolves.toBe('REPORT');
        expect(load).toHaveBeenCalledWith('exec-1');
        expect(formatMarkdown).toHaveBeenCalledWith(withExecution, EXPORTED_AT, { status: 'read', responses, invalidRecords: 0 });
    });

    it('maps a rejected response read to a failed read', async () => {
        const load = vi.fn().mockRejectedValue(new Error('offline'));
        await buildWorkoutAiCopy(withExecution, EXPORTED_AT, load);
        expect(formatMarkdown).toHaveBeenLastCalledWith(withExecution, EXPORTED_AT, { status: 'failed' });
    });

    it('skips the response read when the view has no execution', async () => {
        const load = vi.fn();
        await buildWorkoutAiCopy(withoutExecution, EXPORTED_AT, load);
        expect(load).not.toHaveBeenCalled();
        expect(formatMarkdown).toHaveBeenLastCalledWith(withoutExecution, EXPORTED_AT, undefined);
    });

    it('passes userId as an identity set even when responses are absent or failed', async () => {
        await buildWorkoutAiCopy(withoutExecution, EXPORTED_AT, undefined, 'user-secret-42');
        expect(formatMarkdown).toHaveBeenLastCalledWith(withoutExecution, EXPORTED_AT, undefined, new Set(['user-secret-42']));

        const failingLoad = vi.fn().mockRejectedValue(new Error('offline'));
        await buildWorkoutAiCopy(withExecution, EXPORTED_AT, failingLoad, 'user-secret-42');
        expect(formatMarkdown).toHaveBeenLastCalledWith(withExecution, EXPORTED_AT, { status: 'failed' }, new Set(['user-secret-42']));
    });
});

describe('loadWorkoutResponses', () => {
    it('returns undefined without a loader', async () => {
        await expect(loadWorkoutResponses(withExecution, undefined)).resolves.toBeUndefined();
    });

    it('joins every structured execution the occurrence links to, deduplicated, and sums unreadable records', async () => {
        const view = {
            ...withExecution,
            sourceKeys: ['structured_execution:exec-1', 'structured_execution:exec-2', 'provider_activity:garmin:9'],
        } as unknown as CompletedWorkoutView;
        const shared = { responseId: 'shared' } as unknown as SessionResponse;
        const load = vi.fn(async (id: string) => (id === 'exec-1'
            ? { responses: [shared, { responseId: 'a' } as unknown as SessionResponse], invalidRecords: 1 }
            : { responses: [shared], invalidRecords: 0 }));
        const read = await loadWorkoutResponses(view, load);
        expect(load.mock.calls.map(call => call[0])).toEqual(['exec-1', 'exec-2']);
        expect(read).toEqual({ status: 'read', responses: [shared, { responseId: 'a' }], invalidRecords: 1 });
    });

    it('treats one failed execution read as a failed read', async () => {
        const view = { ...withExecution, sourceKeys: ['structured_execution:exec-1', 'structured_execution:exec-2'] } as unknown as CompletedWorkoutView;
        const load = vi.fn(async (id: string) => {
            if (id === 'exec-2') throw new Error('offline');
            return { responses, invalidRecords: 0 };
        });
        await expect(loadWorkoutResponses(view, load)).resolves.toEqual({ status: 'failed' });
    });
});

describe('structuredExecutionIdsOf', () => {
    it('reads execution ids from source refs and the hydrated execution, never the planning occurrence id', () => {
        const view = {
            sourceKeys: ['provider_activity:garmin:1', 'structured_execution:exec-2'],
            structured: { execution: { executionId: 'exec-1' } },
        } as unknown as CompletedWorkoutView;
        expect(structuredExecutionIdsOf(view)).toEqual(['exec-2', 'exec-1']);
    });
});
