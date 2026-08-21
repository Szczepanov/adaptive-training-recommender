import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GarminSyncNowButton } from './GarminSyncNowButton';

// This repo has no interactive component-test harness (no @testing-library/react) --
// markup-level smoke test, matching the existing convention for sibling components
// (ManualSessionBuilder.test.tsx, SessionJsonImport.test.tsx). subscribeToRequest is a
// useEffect, which react-dom/server never runs, so this only exercises the button's
// default (no outstanding request) render; garminSyncRequestService.test.ts and
// test_sync_service.py cover the request/poll behavior itself.
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
