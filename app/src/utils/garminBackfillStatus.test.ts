import { describe, expect, it } from 'vitest';
import { getGarminBackfillStatus, isGarminBackfillRequest } from './garminBackfillStatus';
import { STALE_AFTER_MS } from './garminSyncStaleness';
import type { GarminSyncRequest } from '../services/garminSyncRequestService';

const requestedAtMs = Date.parse('2026-08-21T06:00:00.000Z');
const request = (overrides: Partial<GarminSyncRequest> = {}): GarminSyncRequest => ({
    userId: 'u1',
    status: 'pending',
    requestedAt: new Date(requestedAtMs).toISOString(),
    ...overrides,
});

describe('isGarminBackfillRequest', () => {
    it('is false for no request', () => {
        expect(isGarminBackfillRequest(null)).toBe(false);
    });

    it('is false for a plain "Sync Now" request', () => {
        expect(isGarminBackfillRequest(request({ requestType: 'sync' }))).toBe(false);
    });

    it('is false for a request with no requestType at all (legacy docs)', () => {
        expect(isGarminBackfillRequest(request({ requestType: undefined }))).toBe(false);
    });

    it('is true for both backfill request types', () => {
        expect(isGarminBackfillRequest(request({ requestType: 'backfill' }))).toBe(true);
        expect(isGarminBackfillRequest(request({ requestType: 'initial_backfill' }))).toBe(true);
    });
});

describe('getGarminBackfillStatus', () => {
    it('is "none" when there is no request', () => {
        expect(getGarminBackfillStatus(null, requestedAtMs)).toBe('none');
    });

    it('is "none" for a plain "Sync Now" request, however it is failing or aging', () => {
        expect(
            getGarminBackfillStatus(
                request({ requestType: 'sync', status: 'failed' }),
                requestedAtMs + STALE_AFTER_MS * 10
            )
        ).toBe('none');
    });

    it('is "in_progress" for a pending or claimed backfill under the staleness threshold', () => {
        expect(getGarminBackfillStatus(request({ requestType: 'backfill', status: 'pending' }), requestedAtMs)).toBe(
            'in_progress'
        );
        expect(
            getGarminBackfillStatus(request({ requestType: 'initial_backfill', status: 'processing' }), requestedAtMs)
        ).toBe('in_progress');
    });

    it('is "failed" once the backend records a failure, regardless of age', () => {
        expect(
            getGarminBackfillStatus(request({ requestType: 'backfill', status: 'failed' }), requestedAtMs)
        ).toBe('failed');
    });

    it('is "stale" once a claimed backfill outruns its staleness threshold', () => {
        expect(
            getGarminBackfillStatus(
                request({ requestType: 'backfill', status: 'processing' }),
                requestedAtMs + STALE_AFTER_MS * 10
            )
        ).toBe('stale');
    });

    it('is "none" once a backfill has completed', () => {
        expect(
            getGarminBackfillStatus(request({ requestType: 'backfill', status: 'completed' }), requestedAtMs)
        ).toBe('none');
    });
});
