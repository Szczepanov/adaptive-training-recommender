import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
    getRecoverySnapshotState: vi.fn(),
    getCheckinsInRange: vi.fn(),
    getRecommendationsInRange: vi.fn(),
    getEntriesInRange: vi.fn(),
}));

vi.mock('./recoverySnapshotService', () => ({ recoverySnapshotService: { getRecoverySnapshotState: services.getRecoverySnapshotState } }));
vi.mock('./checkinService', () => ({ checkinService: { getCheckinsInRange: services.getCheckinsInRange } }));
vi.mock('./recommendationService', () => ({ recommendationService: { getRecommendationsInRange: services.getRecommendationsInRange } }));
vi.mock('./decisionJournalService', () => ({ decisionJournalService: { getEntriesInRange: services.getEntriesInRange } }));

import { ShadowLogService } from './shadowLogService';

const START = '2026-08-14';
const END = '2026-08-16';

describe('ShadowLogService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        services.getRecoverySnapshotState.mockResolvedValue({ status: 'MISSING' });
        services.getCheckinsInRange.mockResolvedValue([]);
        services.getRecommendationsInRange.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getEntriesInRange.mockResolvedValue([]);
    });

    it('reads the recommendation range end-exclusive one day past the inclusive endDate', async () => {
        await new ShadowLogService().build('u1', START, END);
        expect(services.getRecommendationsInRange).toHaveBeenCalledWith('u1', START, '2026-08-17');
    });

    it('reads the journal and check-in ranges inclusive of both ends', async () => {
        await new ShadowLogService().build('u1', START, END);
        expect(services.getEntriesInRange).toHaveBeenCalledWith('u1', START, END);
        expect(services.getCheckinsInRange).toHaveBeenCalledWith('u1', START, END);
    });

    it('reads one recovery snapshot per day in the inclusive range', async () => {
        await new ShadowLogService().build('u1', START, END);
        expect(services.getRecoverySnapshotState).toHaveBeenCalledTimes(3);
        expect(services.getRecoverySnapshotState).toHaveBeenCalledWith('u1', '2026-08-14');
        expect(services.getRecoverySnapshotState).toHaveBeenCalledWith('u1', '2026-08-15');
        expect(services.getRecoverySnapshotState).toHaveBeenCalledWith('u1', '2026-08-16');
    });

    it('joins a recommendation and a journal entry on the same date into one row', async () => {
        services.getRecommendationsInRange.mockResolvedValue({
            status: 'AVAILABLE',
            data: [{
                userId: 'u1', date: '2026-08-15', templateId: 't', templateTitle: 'Easy Ride', category: 'Easy', modality: 'Cycling',
                mode: 'train', rationale: 'r', schemaVersion: 3, createdAt: '', updatedAt: '',
                adherence: { respondedAt: null, followed: true, actualModality: null, actualDurationMin: 40, skipped: false, notes: null },
            }],
            revision: null,
        });
        services.getEntriesInRange.mockResolvedValue([{
            userId: 'u1', date: '2026-08-15', externalVerdict: 'proceed', sawEngineVerdictFirst: false,
            createdAt: '', updatedAt: '', schemaVersion: 1,
        }]);

        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
            date: '2026-08-15', engineVerdict: 'proceed', externalVerdict: 'proceed', agreement: 'agree', adherenceFollowed: true,
        });
    });

    it('does not report a missing recovery snapshot day as an unavailable source', async () => {
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources.join()).not.toContain('recovery snapshots');
    });

    it('reports an unreadable recovery snapshot day', async () => {
        services.getRecoverySnapshotState.mockResolvedValueOnce({ status: 'MISSING' });
        services.getRecoverySnapshotState.mockResolvedValueOnce({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        services.getRecoverySnapshotState.mockResolvedValueOnce({ status: 'MISSING' });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources).toContain('recovery snapshots (1 day(s) unreadable)');
    });

    it('omits an invalid range-query check-in rather than treating it as valid history', async () => {
        services.getCheckinsInRange.mockResolvedValue([{ userId: 'u1', date: '2026-08-15', readiness: 'not-a-number' }]);
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources).toContain('subjective check-ins (1 invalid record(s) omitted)');
    });

    it('reports a failed recommendation range read', async () => {
        services.getRecommendationsInRange.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources).toContain('recommendations and adherence');
    });

    it('reports a failed journal range read rather than silently returning an empty log', async () => {
        services.getEntriesInRange.mockRejectedValue(new Error('offline'));
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources).toContain('decision journal');
    });
});
