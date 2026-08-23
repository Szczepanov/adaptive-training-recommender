import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GarminSyncNowButton } from './GarminSyncNowButton';
import { isAwaitedSyncTerminal } from '../utils/garminSyncRequestState';
import { isSyncRequestStale, STALE_AFTER_MS } from '../utils/garminSyncStaleness';
import type { GarminSyncRequest } from '../services/garminSyncRequestService';

// This repo has no interactive component-test harness (no @testing-library/react) --
// markup-level smoke test, matching the existing convention for sibling components
// (ManualSessionBuilder.test.tsx, SessionJsonImport.test.tsx). subscribeToRequest is a
// useEffect, which react-dom/server never runs, so this only exercises the button's
// default (no outstanding request) render. State-transition rules are kept in pure
// helpers and tested directly below.
vi.mock('../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(() => vi.fn()),
        requestSync: vi.fn(async () => '2026-08-21T06:00:00.000Z'),
        getRequest: vi.fn(async () => null),
    },
}));

describe('GarminSyncNowButton', () => {
    it('renders an idle "Sync now" trigger by default', () => {
        const html = renderToStaticMarkup(<GarminSyncNowButton userId="u1" />);

        expect(html).toContain('Sync now');
        expect(html).not.toContain('disabled');
    });
});

describe('isAwaitedSyncTerminal', () => {
    const requestedAt = '2026-08-21T06:00:00.000Z';
    const base = (overrides: Partial<GarminSyncRequest> = {}): GarminSyncRequest => ({
        userId: 'u1',
        status: 'pending',
        requestedAt,
        ...overrides,
    });

    it('ignores terminal snapshots for an older shared-document request', () => {
        expect(
            isAwaitedSyncTerminal(
                base({ status: 'completed', requestedAt: '2026-08-21T05:00:00.000Z' }),
                requestedAt
            )
        ).toBe(false);
    });

    it('waits while the matching request is pending or processing', () => {
        expect(isAwaitedSyncTerminal(base({ status: 'pending' }), requestedAt)).toBe(false);
        expect(isAwaitedSyncTerminal(base({ status: 'processing' }), requestedAt)).toBe(false);
    });

    it('resolves only a terminal snapshot for the exact request', () => {
        expect(isAwaitedSyncTerminal(base({ status: 'completed' }), requestedAt)).toBe(true);
        expect(isAwaitedSyncTerminal(base({ status: 'failed' }), requestedAt)).toBe(true);
        expect(isAwaitedSyncTerminal(base({ status: 'completed' }), null)).toBe(false);
    });
});

describe('isSyncRequestStale', () => {
    const baseRequest = (overrides: Partial<GarminSyncRequest> = {}): GarminSyncRequest => ({
        userId: 'u1',
        status: 'pending',
        requestedAt: '2026-08-21T06:00:00.000Z',
        ...overrides,
    });
    const requestedAtMs = Date.parse('2026-08-21T06:00:00.000Z');

    it('is never stale with no outstanding request', () => {
        expect(isSyncRequestStale(null, requestedAtMs + STALE_AFTER_MS * 2)).toBe(false);
    });

    it('is not stale for a completed or failed request, no matter how old', () => {
        expect(isSyncRequestStale(baseRequest({ status: 'completed' }), requestedAtMs + STALE_AFTER_MS * 10)).toBe(false);
        expect(isSyncRequestStale(baseRequest({ status: 'failed' }), requestedAtMs + STALE_AFTER_MS * 10)).toBe(false);
    });

    it('is not stale while pending or processing under the threshold', () => {
        expect(isSyncRequestStale(baseRequest({ status: 'pending' }), requestedAtMs + STALE_AFTER_MS - 1)).toBe(false);
        expect(isSyncRequestStale(baseRequest({ status: 'processing' }), requestedAtMs + STALE_AFTER_MS - 1)).toBe(false);
    });

    it('goes stale once pending or ordinary processing exceeds the threshold', () => {
        expect(isSyncRequestStale(baseRequest({ status: 'pending' }), requestedAtMs + STALE_AFTER_MS + 1)).toBe(true);
        expect(isSyncRequestStale(baseRequest({ status: 'processing' }), requestedAtMs + STALE_AFTER_MS + 1)).toBe(true);
    });

    it('respects a custom threshold', () => {
        const request = baseRequest({ status: 'processing' });
        expect(isSyncRequestStale(request, requestedAtMs + 1000, 500)).toBe(true);
        expect(isSyncRequestStale(request, requestedAtMs + 1000, 5000)).toBe(false);
    });

    it('measures a processing request from claimedAt, not requestedAt', () => {
        // garmin-manual-sync-poll only ticks every 3 minutes, so a request can sit
        // 'pending' for a couple of those minutes before a worker claims it.
        // Measuring staleness from requestedAt once claimed would eat into the same
        // budget twice; claimedAt is when the worker actually started.
        const claimedAtMs = requestedAtMs + 2 * 60 * 1000;
        const request = baseRequest({
            status: 'processing',
            claimedAt: new Date(claimedAtMs).toISOString(),
        });

        // Just past STALE_AFTER_MS since the request was first queued, but well
        // under STALE_AFTER_MS since the worker actually claimed it -- must not be
        // considered stale yet.
        expect(isSyncRequestStale(request, requestedAtMs + STALE_AFTER_MS + 1000)).toBe(false);
        // Past STALE_AFTER_MS since claimedAt -- now genuinely stale.
        expect(isSyncRequestStale(request, claimedAtMs + STALE_AFTER_MS + 1)).toBe(true);
    });

    it('falls back to requestedAt for a processing request with no claimedAt yet', () => {
        const request = baseRequest({ status: 'processing', claimedAt: undefined });
        expect(isSyncRequestStale(request, requestedAtMs + STALE_AFTER_MS + 1)).toBe(true);
    });
});
