import { describe, expect, it } from 'vitest';
import { captureReplaySnapshot, collapseTrainingHistoryReplay, createTrainingHistoryReplayRecorder, MAX_TRAINING_HISTORY_REPLAY_WINDOW_DAYS } from './historyReplayCapture';
import type { TrainingHistorySnapshot } from './trainingHistorySnapshot';

const date = '2026-08-01';
const snapshot: TrainingHistorySnapshot = {
    throughDateExclusive: date, windowDays: 7, exposures: [], completedEvents: [], revision: 'history-r1',
    generatedAt: `${date}T08:00:00.000Z`,
    sourceStates: { activities: { status: 'AVAILABLE', revision: 'a' }, recommendations: { status: 'AVAILABLE', revision: 'r' }, manualTraining: { status: 'MISSING' } },
};

describe('bounded history replay capture', () => {
    it('omits free-text feedback without mutating the live event', () => {
        const source = { ...snapshot, completedEvents: [{ date: '2026-07-31', athleteFeedback: { followed: true, notes: 'private note' } }] } as TrainingHistorySnapshot;
        expect(captureReplaySnapshot(source).completedEvents[0].athleteFeedback.notes).toBeNull();
        expect(source.completedEvents[0].athleteFeedback.notes).toBe('private note');
    });

    it('copies exact responses without mutating the provider or leaking later edits', async () => {
        const sourceSnapshot = structuredClone(snapshot);
        const recorder = createTrainingHistoryReplayRecorder({ reconstruct: async () => [], getSnapshot: async () => sourceSnapshot }, {
            userId: 'u1', throughDateExclusive: date,
        });
        expect(await recorder.provider.getSnapshot!('u1', date, 7)).toBe(sourceSnapshot);
        sourceSnapshot.revision = 'later';
        const capture = recorder.finish()!;
        expect(capture.requests[0]).toMatchObject({ kind: 'snapshot', snapshot: { revision: 'history-r1' } });
        expect(collapseTrainingHistoryReplay(snapshot, capture).exposures).toEqual([]);
    });

    it.each([['other', date, 7], ['u1', '2026-08-02', 7], ['u1', date, MAX_TRAINING_HISTORY_REPLAY_WINDOW_DAYS + 1]] as const)(
        'delegates unsupported requests but invalidates replay (%s, %s, %s)', async (userId, requestedDate, days) => {
            const recorder = createTrainingHistoryReplayRecorder({ reconstruct: async () => [] }, { userId: 'u1', throughDateExclusive: date });
            expect(await recorder.provider.reconstruct(userId, requestedDate, days)).toEqual([]);
            expect(recorder.finish()).toBeNull();
        });

    it('keeps the live response usable when capture serialization fails', async () => {
        const circular = { ...snapshot };
        Object.assign(circular, { circular });
        const recorder = createTrainingHistoryReplayRecorder({ reconstruct: async () => [], getSnapshot: async () => circular }, {
            userId: 'u1', throughDateExclusive: date,
        });
        expect(await recorder.provider.getSnapshot!('u1', date, 7)).toBe(circular);
        expect(recorder.finish()).toBeNull();
    });
});
