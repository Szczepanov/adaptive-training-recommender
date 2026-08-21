import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GarminSyncNowButton } from './GarminSyncNowButton';
import { isSyncRequestStale, STALE_AFTER_MS } from '../utils/garminSyncStaleness';
import type { GarminSyncRequest } from '../services/garminSyncRequestService';

// This repo has no interactive component-test harness (no @testing-library/react) --
// markup-level smoke test, matching the existing convention for sibling components
// (ManualSessionBuilder.test.tsx, SessionJsonImport.test.tsx). subscribeToRequest is a
// useEffect, which react-dom/server never runs, so this only exercises the button's
// default (no outstanding request) render; garminSyncRequestService.test.ts and
// test_sync_service.py cover the request/poll behavior itself. The stale-request
// detection is the one piece of state-transition logic worth its own interactive test
// (per review), so it's factored into the pure isSyncRequestStale() below instead of
// buried in the component, and tested directly here without rendering anything.
vi.mock('../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(() => vi.fn()),
        requestSync: vi.fn(async () => {}),
    },
}));

describe('GarminSyncNowButton', () => {
    it('renders an idle "Sync now" trigger by default', () => {
        const html = renderToStaticMarkup(<GarminSyncNowButton userId="u1" />);

        expect(html).toContain('Sync now');
        expect(html).not.toContain('disabled');
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

    it('goes stale once pending or processing exceeds the threshold', () => {
        expect(isSyncRequestStale(baseRequest({ status: 'pending' }), requestedAtMs + STALE_AFTER_MS + 1)).toBe(true);
        expect(isSyncRequestStale(baseRequest({ status: 'processing' }), requestedAtMs + STALE_AFTER_MS + 1)).toBe(true);
    });

    it('respects a custom threshold', () => {
        const request = baseRequest({ status: 'processing' });
        expect(isSyncRequestStale(request, requestedAtMs + 1000, 500)).toBe(true);
        expect(isSyncRequestStale(request, requestedAtMs + 1000, 5000)).toBe(false);
    });
});
