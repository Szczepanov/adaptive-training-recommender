import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
    getRecoverySnapshotState: vi.fn(),
    getCheckinsInRangeState: vi.fn(),
    getRecommendationsInRange: vi.fn(),
    getEntriesInRange: vi.fn(),
}));

vi.mock('./recoverySnapshotService', () => ({ recoverySnapshotService: { getRecoverySnapshotState: services.getRecoverySnapshotState } }));
vi.mock('./checkinService', () => ({ checkinService: { getCheckinsInRangeState: services.getCheckinsInRangeState } }));
vi.mock('./recommendationService', () => ({ recommendationService: { getRecommendationsInRange: services.getRecommendationsInRange } }));
vi.mock('./decisionJournalService', () => ({ decisionJournalService: { getEntriesInRange: services.getEntriesInRange } }));

import { ShadowLogService } from './shadowLogService';

const START = '2026-08-14';
const END = '2026-08-16';

describe('ShadowLogService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        services.getRecoverySnapshotState.mockResolvedValue({ status: 'MISSING' });
        services.getCheckinsInRangeState.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getRecommendationsInRange.mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        services.getEntriesInRange.mockResolvedValue({ entries: [], invalidRecords: 0 });
    });

    it('reads the recommendation range end-exclusive one day past the inclusive endDate', async () => {
        await new ShadowLogService().build('u1', START, END);
        expect(services.getRecommendationsInRange).toHaveBeenCalledWith('u1', START, '2026-08-17');
    });

    it('reads the journal range inclusive and the check-in range end-exclusive', async () => {
        await new ShadowLogService().build('u1', START, END);
        expect(services.getEntriesInRange).toHaveBeenCalledWith('u1', START, END);
        expect(services.getCheckinsInRangeState).toHaveBeenCalledWith('u1', START, '2026-08-17');
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
        services.getEntriesInRange.mockResolvedValue({ entries: [{
            userId: 'u1', date: '2026-08-15', externalVerdict: 'proceed', sawEngineVerdictFirst: false,
            createdAt: '', updatedAt: '', schemaVersion: 1,
        }], invalidRecords: 0 });

        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.rows).toHaveLength(3);
        expect(result.rows[1]).toMatchObject({
            date: '2026-08-15', engineVerdict: 'proceed', externalVerdict: 'proceed', agreement: 'agree', adherenceFollowed: true,
        });
        expect(result.rows[0]).toMatchObject({ date: '2026-08-14', engineVerdict: null, externalVerdict: null });
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

    it('includes a valid check-in on the inclusive export end date', async () => {
        services.getCheckinsInRangeState.mockResolvedValue({
            status: 'AVAILABLE',
            data: [{
                userId: 'u1', date: END, readiness: 7, sleepQuality: 7, fatigue: 3, soreness: 2, mentalStress: 3, motivation: 7,
                painOrInjury: false, illnessSymptoms: false, unusuallyLimitedTime: false, alreadyTrainedToday: false,
                availability: { timeAvailableMin: 60, preferredModalityToday: null, indoorOnly: false },
                notes: null, submittedAt: '', dataQuality: { isComplete: true, missingFields: [] }, schemaVersion: 1, createdAt: '', updatedAt: '',
            }],
            revision: null,
        });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.rows[2].subjectiveComplete).toBe(true);
    });

    it('preserves an invalid check-in range state instead of treating it as empty history', async () => {
        services.getCheckinsInRangeState.mockResolvedValue({
            status: 'INVALID', issues: [{ code: 'invalid-date-range', documentPath: 'private' }],
        });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.sourceQuality.subjectiveCheckins).toMatchObject({ status: 'INVALID', issueCount: 1 });
        expect(result.unavailableSources).toContain('subjective check-ins (range invalid)');
    });

    it('preserves an unavailable check-in range state instead of treating it as empty history', async () => {
        services.getCheckinsInRangeState.mockResolvedValue({
            status: 'UNAVAILABLE', operation: 'read subjective check-in history', retryable: true,
        });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.sourceQuality.subjectiveCheckins).toMatchObject({ status: 'UNAVAILABLE', issueCount: 0 });
        expect(result.unavailableSources).toContain('subjective check-ins (range unavailable)');
    });

    it('preserves a missing check-in range state without treating it as a read failure', async () => {
        services.getCheckinsInRangeState.mockResolvedValue({ status: 'MISSING' });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.sourceQuality.subjectiveCheckins).toMatchObject({ status: 'MISSING', issueCount: 0 });
        expect(result.unavailableSources).not.toContain('subjective check-ins (range unavailable)');
    });

    it('reports invalid decision journal rows instead of silently turning them into missing days', async () => {
        services.getEntriesInRange.mockResolvedValue({ entries: [], invalidRecords: 2 });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources).toContain('decision journal (2 invalid record(s) omitted)');
    });

    it('reports a failed recommendation range read', async () => {
        services.getRecommendationsInRange.mockResolvedValue({ status: 'UNAVAILABLE', operation: 'read', retryable: true });
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources).toContain('recommendations and feedback');
    });

    it('reports a failed journal range read rather than silently returning an empty log', async () => {
        services.getEntriesInRange.mockRejectedValue(new Error('offline'));
        const result = await new ShadowLogService().build('u1', START, END);
        expect(result.unavailableSources).toContain('decision journal');
    });
});
