import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    useGarminBackfillStatus,
    type UseGarminBackfillStatusResult,
} from '../../hooks/useGarminBackfillStatus';
import type { GarminSyncRequest } from '../../services/garminSyncRequestService';
import { GarminBackfillStatus } from './GarminBackfillStatus';

vi.mock('../../hooks/useGarminBackfillStatus', () => ({
    useGarminBackfillStatus: vi.fn(),
}));

const retryBackfill = vi.fn(async () => undefined);

function hookResult(
    overrides: Partial<UseGarminBackfillStatusResult> = {}
): UseGarminBackfillStatusResult {
    return {
        request: null,
        status: 'none',
        retrying: false,
        localError: null,
        retryBackfill,
        ...overrides,
    };
}

function failedRequest(error: string): GarminSyncRequest {
    return {
        userId: 'u1',
        status: 'failed',
        requestType: 'backfill',
        days: 56,
        requestedAt: '2026-09-18T10:00:00.000Z',
        completedAt: '2026-09-18T10:10:00.000Z',
        error,
    };
}

describe('GarminBackfillStatus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useGarminBackfillStatus).mockReturnValue(hookResult());
    });

    it('renders nothing when there is no actionable backfill request', () => {
        const html = renderToStaticMarkup(<GarminBackfillStatus userId="u1" />);
        expect(html).toBe('');
    });

    it('announces a request-backed backfill while it is in progress', () => {
        vi.mocked(useGarminBackfillStatus).mockReturnValue(hookResult({ status: 'in_progress' }));

        const html = renderToStaticMarkup(<GarminBackfillStatus userId="u1" />);

        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('Loading historical data');
    });

    it('offers a retry once an in-flight backfill is stale', () => {
        vi.mocked(useGarminBackfillStatus).mockReturnValue(hookResult({ status: 'stale' }));

        const html = renderToStaticMarkup(<GarminBackfillStatus userId="u1" />);

        expect(html).toContain('role="alert"');
        expect(html).toContain('It is taking longer than expected.');
        expect(html).toContain('Retry loading history');
    });

    it('does not expose raw backend failure details in athlete-facing copy', () => {
        const providerError = 'GarminConnectAuthenticationError: tokenObject=internal/path';
        vi.mocked(useGarminBackfillStatus).mockReturnValue(
            hookResult({
                status: 'failed',
                request: failedRequest(providerError),
            })
        );

        const html = renderToStaticMarkup(<GarminBackfillStatus userId="u1" />);

        expect(html).toContain('Historical Garmin data didn&#x27;t finish loading.');
        expect(html).toContain('Try loading history again.');
        expect(html).not.toContain(providerError);
        expect(html).not.toContain('tokenObject');
    });

    it('shows a client-side retry error without exposing backend details', () => {
        vi.mocked(useGarminBackfillStatus).mockReturnValue(
            hookResult({
                status: 'failed',
                localError: 'Could not request a retry — try again.',
            })
        );

        const html = renderToStaticMarkup(<GarminBackfillStatus userId="u1" />);

        expect(html).toContain('Could not request a retry — try again.');
    });

    it('disables and marks the retry action busy while the request is being queued', () => {
        vi.mocked(useGarminBackfillStatus).mockReturnValue(
            hookResult({
                status: 'failed',
                retrying: true,
            })
        );

        const html = renderToStaticMarkup(<GarminBackfillStatus userId="u1" />);

        expect(html).toContain('disabled=""');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('Requesting…');
    });
});
