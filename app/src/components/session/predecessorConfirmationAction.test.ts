import { describe, expect, it, vi } from 'vitest';
import { recordPredecessorConfirmation } from './predecessorConfirmationAction';
import type { SessionResponseService } from '../../services/sessionResponseService';

vi.mock('../../services/sessionResponseService', () => ({ sessionResponseService: { recordOrUpdateResponse: vi.fn() } }));

describe('recordPredecessorConfirmation (#896)', () => {
    it.each([false, true])('writes the explicit answer (%s) as the predecessor immediate response', async unexpectedFatigue => {
        const recordOrUpdateResponse = vi.fn().mockResolvedValue(undefined);
        const service = { recordOrUpdateResponse } as unknown as SessionResponseService;

        await recordPredecessorConfirmation(
            'u1',
            { sourceSession: { kind: 'execution', id: 'exec-am', date: '2026-10-17' }, occurrenceId: 'occ-am' },
            unexpectedFatigue,
            service,
        );

        expect(recordOrUpdateResponse).toHaveBeenCalledWith(
            'u1',
            { kind: 'execution', id: 'exec-am', date: '2026-10-17' },
            'immediate',
            '2026-10-17',
            '2026-10-17',
            { unexpectedFatigue },
            'occ-am',
        );
    });
});
