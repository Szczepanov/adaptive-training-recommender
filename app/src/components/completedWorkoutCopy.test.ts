import { describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '../responses/models';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';

const { formatMarkdown } = vi.hoisted(() => ({ formatMarkdown: vi.fn(() => 'REPORT') }));
vi.mock('../training-occurrence/completedWorkoutMarkdown', () => ({ formatCompletedWorkoutMarkdown: formatMarkdown }));

import { buildWorkoutAiCopy, loadWorkoutResponses } from './completedWorkoutCopy';

const EXPORTED_AT = '2026-11-14T10:00:00.000Z';
const withExecution = { performedOccurrenceId: 'pto-1', structured: { execution: { executionId: 'exec-1' } } } as unknown as CompletedWorkoutView;
const withoutExecution = { performedOccurrenceId: 'pto-2' } as unknown as CompletedWorkoutView;
const responses = [{ responseId: 'r1' }] as unknown as SessionResponse[];

describe('buildWorkoutAiCopy', () => {
    it('passes responses to the markdown', async () => {
        const load = vi.fn().mockResolvedValue(responses);
        await expect(buildWorkoutAiCopy(withExecution, EXPORTED_AT, load)).resolves.toBe('REPORT');
        expect(load).toHaveBeenCalledWith('exec-1');
        expect(formatMarkdown).toHaveBeenCalledWith(withExecution, EXPORTED_AT, responses);
    });

    it('maps a rejected response read to responses: unavailable', async () => {
        const load = vi.fn().mockRejectedValue(new Error('offline'));
        await buildWorkoutAiCopy(withExecution, EXPORTED_AT, load);
        expect(formatMarkdown).toHaveBeenLastCalledWith(withExecution, EXPORTED_AT, 'unavailable');
    });

    it('skips the response read when the view has no execution', async () => {
        const load = vi.fn();
        await buildWorkoutAiCopy(withoutExecution, EXPORTED_AT, load);
        expect(load).not.toHaveBeenCalled();
        expect(formatMarkdown).toHaveBeenLastCalledWith(withoutExecution, EXPORTED_AT, undefined);
    });
});

describe('loadWorkoutResponses', () => {
    it('returns undefined without a loader', async () => {
        await expect(loadWorkoutResponses(withExecution, undefined)).resolves.toBeUndefined();
    });
});
