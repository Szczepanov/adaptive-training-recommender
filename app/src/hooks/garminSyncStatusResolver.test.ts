import { describe, it, expect } from 'vitest';
import { resolveGarminSyncStatus, type GarminSyncStatusInputs } from './garminSyncStatusResolver';
import type { GarminQueuedWorkout } from '../services/garminWorkoutQueueService';
import type { GarminSyncRequest } from '../services/garminSyncRequestService';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';
import type { DailyRecoverySnapshot } from '../engine/models';

const dummyPayload = {} as CanonicalWorkoutExport;

function baseInputs(overrides: Partial<GarminSyncStatusInputs> = {}): GarminSyncStatusInputs {
    return {
        queueItems: [],
        syncRequest: null,
        snapshot: null,
        triggering: false,
        isGetInFlight: false,
        isStale: false,
        clientError: null,
        ...overrides,
    };
}

function queuedWorkout(overrides: Partial<GarminQueuedWorkout> = {}): GarminQueuedWorkout {
    return {
        userId: 'u1',
        date: '2026-08-27',
        workoutTitle: 'Aerobic Engine 3x15',
        modality: 'cycling',
        status: 'pending',
        queuedAt: '2026-08-27T06:00:00+00:00',
        payload: dummyPayload,
        ...overrides,
    };
}

function syncRequest(overrides: Partial<GarminSyncRequest> = {}): GarminSyncRequest {
    return {
        userId: 'u1',
        status: 'pending',
        requestedAt: '2026-08-27T06:00:00+00:00',
        ...overrides,
    };
}

function snapshot(garminSyncedAt: string): DailyRecoverySnapshot {
    return {
        source: { garminSyncedAt },
    } as unknown as DailyRecoverySnapshot;
}

describe('resolveGarminSyncStatus', () => {
    it('is idle with no queue items, no request, and no snapshot', () => {
        const result = resolveGarminSyncStatus(baseInputs());
        expect(result.status).toBe('idle');
        expect(result.isBusy).toBe(false);
        expect(result.latestSyncedAt).toBeNull();
    });

    it('is pending while a workout POST is queued, and surfaces it as queuedWorkout', () => {
        const pending = queuedWorkout({ status: 'pending' });
        const result = resolveGarminSyncStatus(baseInputs({ queueItems: [pending] }));
        expect(result.status).toBe('pending');
        expect(result.isBusy).toBe(true);
        expect(result.queuedWorkout).toEqual(pending);
    });

    it('is pending while a GET sync request is in flight and not stale', () => {
        const result = resolveGarminSyncStatus(baseInputs({ isGetInFlight: true, isStale: false }));
        expect(result.status).toBe('pending');
        expect(result.isBusy).toBe(true);
        expect(result.pendingCount).toBe(1);
    });

    it('a stale GET request does not mask a genuinely pending POST workout', () => {
        // Regression test: isBusy must not be gated by the (unrelated) GET request's
        // staleness when a workout POST is independently still pending.
        const pending = queuedWorkout({ status: 'pending' });
        const result = resolveGarminSyncStatus(baseInputs({
            queueItems: [pending],
            isGetInFlight: true,
            isStale: true,
        }));
        expect(result.isBusy).toBe(true);
        expect(result.status).toBe('pending');
    });

    it('a stale GET request is no longer treated as busy on its own', () => {
        const result = resolveGarminSyncStatus(baseInputs({ isGetInFlight: true, isStale: true }));
        expect(result.isBusy).toBe(false);
        expect(result.status).toBe('idle');
    });

    it('reports synced with the later of GET and POST timestamps', () => {
        const result = resolveGarminSyncStatus(baseInputs({
            snapshot: snapshot('2026-08-27T07:15:00+00:00'),
            queueItems: [queuedWorkout({ status: 'synced', syncedAt: '2026-08-26T14:36:12+00:00' })],
        }));
        expect(result.status).toBe('synced');
        expect(result.latestGetSyncedAt).toBe('2026-08-27T07:15:00+00:00');
        expect(result.latestPostSyncedAt).toBe('2026-08-26T14:36:12+00:00');
        expect(result.latestSyncedAt).toBe('2026-08-27T07:15:00+00:00');
    });

    it('prefers a completed sync request timestamp over an older snapshot timestamp', () => {
        const result = resolveGarminSyncStatus(baseInputs({
            snapshot: snapshot('2026-08-26T06:00:00+00:00'),
            syncRequest: syncRequest({ status: 'completed', completedAt: '2026-08-27T09:00:00+00:00' }),
        }));
        expect(result.latestGetSyncedAt).toBe('2026-08-27T09:00:00+00:00');
        expect(result.status).toBe('synced');
    });

    it('is failed when the backend-reported sync request is failed and not stale', () => {
        const result = resolveGarminSyncStatus(baseInputs({
            syncRequest: syncRequest({ status: 'failed', error: 'Garmin API 500 error' }),
        }));
        expect(result.status).toBe('failed');
        expect(result.error).toBe('Garmin API 500 error');
    });

    it('ignores a stale failed sync request rather than getting stuck on it', () => {
        const result = resolveGarminSyncStatus(baseInputs({
            syncRequest: syncRequest({ status: 'failed', error: 'Garmin API 500 error' }),
            isStale: true,
        }));
        expect(result.status).not.toBe('failed');
    });

    it('is failed when a workout POST failed', () => {
        const failed = queuedWorkout({ status: 'failed', error: 'Garmin API 500 error' });
        const result = resolveGarminSyncStatus(baseInputs({ queueItems: [failed] }));
        expect(result.status).toBe('failed');
        expect(result.error).toBe('Garmin API 500 error');
        expect(result.queuedWorkout).toEqual(failed);
    });

    it('a client error (e.g. a subscription failure) takes priority and reports failed', () => {
        const result = resolveGarminSyncStatus(baseInputs({
            snapshot: snapshot('2026-08-27T07:15:00+00:00'),
            clientError: 'Could not request sync — try again.',
        }));
        expect(result.status).toBe('failed');
        expect(result.error).toBe('Could not request sync — try again.');
    });

    it('recovers to synced once the client error clears, even with prior synced data', () => {
        // Regression test: nothing in the resolver itself should keep 'failed' pinned
        // once the caller stops passing a clientError -- the hook clears it as soon as
        // a fresh subscription update arrives, and this pure function must honor that
        // on every call rather than remembering the old error.
        const inputs = baseInputs({
            snapshot: snapshot('2026-08-27T07:15:00+00:00'),
            clientError: 'Could not request sync — try again.',
        });
        expect(resolveGarminSyncStatus(inputs).status).toBe('failed');

        const recovered = resolveGarminSyncStatus({ ...inputs, clientError: null });
        expect(recovered.status).toBe('synced');
        expect(recovered.error).toBeNull();
    });
});
