import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionExecution } from '../sessions/models';

const mocks = vi.hoisted(() => ({
    response: vi.fn(),
    occurrence: vi.fn(),
    reconcile: vi.fn(),
}));

vi.mock('./sessionResponseService', () => ({
    sessionResponseService: { recordOrUpdateResponse: mocks.response },
}));
vi.mock('./sessionOccurrenceService', () => ({
    sessionOccurrenceService: { transitionOccurrenceState: mocks.occurrence },
}));
vi.mock('../training-occurrence', () => ({
    reconcileStructuredCompletion: mocks.reconcile,
}));

import { convergeCompletedExecution } from './sessionCompletionConvergence';

const execution: SessionExecution = {
    userId: 'u1',
    executionId: 'exec-1',
    occurrenceId: 'occ-1',
    sessionSource: { kind: 'unplanned_fixture', fixtureId: 'fixture-1' },
    prescriptionHash: 'rx-1',
    date: '2026-10-05',
    startedAt: '2026-10-05T10:00:00.000Z',
    completedAt: '2026-10-05T11:00:00.000Z',
    updatedAt: '2026-10-05T11:00:00.000Z',
    state: 'completed',
    completionEvidence: {
        submittedAt: '2026-10-05T11:00:00.000Z',
        sessionRpe: 8,
        completedFraction: 0.9,
        unexpectedFatigue: true,
        note: 'canonical note',
    },
    schemaVersion: 1,
};

describe('convergeCompletedExecution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.response.mockResolvedValue(undefined);
        mocks.occurrence.mockResolvedValue(undefined);
        mocks.reconcile.mockResolvedValue(undefined);
    });

    it('derives retryable response projection only from durable completion evidence', async () => {
        await convergeCompletedExecution('u1', execution, 'Strength');
        expect(mocks.response).toHaveBeenCalledWith(
            'u1',
            { kind: 'execution', id: 'exec-1', date: '2026-10-05' },
            'immediate',
            '2026-10-05',
            '2026-10-05',
            {
                sessionRpe: 8,
                completedFraction: 0.9,
                unexpectedFatigue: true,
                note: 'canonical note',
            },
            'occ-1',
            '2026-10-05T11:00:00.000Z',
            { preserveExisting: true },
        );
        expect(mocks.occurrence).toHaveBeenCalledWith('u1', 'occ-1', 'completed', execution.completedAt);
        expect(mocks.reconcile).toHaveBeenCalledWith('u1', execution, 'Strength');
    });

    it('does not turn a downstream outage into a failed canonical completion', async () => {
        mocks.response.mockRejectedValueOnce(new Error('response unavailable'));
        mocks.occurrence.mockRejectedValueOnce(new Error('occurrence unavailable'));
        mocks.reconcile.mockRejectedValueOnce(new Error('reconcile unavailable'));
        await expect(convergeCompletedExecution('u1', execution)).resolves.toBeUndefined();
    });

    it('does nothing for a non-completed execution', async () => {
        await convergeCompletedExecution('u1', { ...execution, state: 'abandoned', completedAt: undefined });
        expect(mocks.response).not.toHaveBeenCalled();
        expect(mocks.occurrence).not.toHaveBeenCalled();
        expect(mocks.reconcile).not.toHaveBeenCalled();
    });
    it.each(['response', 'occurrence', 'reconcile'] as const)('retries %s projection after a post-terminal outage', async name => {
        mocks[name].mockRejectedValueOnce(new Error('temporary outage'));
        await convergeCompletedExecution('u1', execution);
        await convergeCompletedExecution('u1', execution);
        expect(mocks[name]).toHaveBeenCalledTimes(2);
        expect(mocks.response.mock.calls[1][5]).toEqual({ sessionRpe: 8, completedFraction: 0.9, unexpectedFatigue: true, note: 'canonical note' });
    });

});
