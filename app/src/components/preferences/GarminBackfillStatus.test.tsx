import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GarminBackfillStatus } from './GarminBackfillStatus';

// This repo has no interactive component-test harness (no @testing-library/react) --
// markup-level smoke test, matching the existing convention (GarminSyncNowButton.test.tsx).
// subscribeToRequest is a useEffect, which react-dom/server never runs, so this only
// exercises the default (no outstanding request) render. Status-derivation rules are
// kept in getGarminBackfillStatus and tested directly in garminBackfillStatus.test.ts.
vi.mock('../../services/garminSyncRequestService', () => ({
    garminSyncRequestService: {
        subscribeToRequest: vi.fn(() => vi.fn()),
        requestBackfill: vi.fn(async () => '2026-08-23T06:00:00.000Z'),
    },
}));

describe('GarminBackfillStatus', () => {
    it('renders nothing by default (no outstanding backfill request)', () => {
        const html = renderToStaticMarkup(<GarminBackfillStatus userId="u1" />);
        expect(html).toBe('');
    });
});
