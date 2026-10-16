import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityDetailsFetchButton } from './ActivityDetailsFetchButton';
import { useGarminSyncTrigger } from '../hooks/useGarminSyncTrigger';

vi.mock('../hooks/useGarminSyncTrigger', () => ({ useGarminSyncTrigger: vi.fn() }));
const triggerSync = vi.fn();
const render = (hasLaps = false) => renderToStaticMarkup(
    <ActivityDetailsFetchButton userId="athlete" activityId="elliptical-1" hasLaps={hasLaps} />
);
beforeEach(() => {
    vi.mocked(useGarminSyncTrigger).mockReturnValue({
        request: null, triggering: false, localError: null, isInFlight: false,
        isStale: false, triggerSync,
    });
});
describe('ActivityDetailsFetchButton', () => {
    it('offers fetch without laps and refresh with existing laps', () => {
        expect(render()).toContain('Fetch activity details');
        expect(render(true)).toContain('Refresh activity details');
        expect(useGarminSyncTrigger).toHaveBeenCalledWith('athlete', undefined, 'elliptical-1');
    });
    it('disables for another live request without showing its outcome', () => {
        vi.mocked(useGarminSyncTrigger).mockReturnValue({
            request: { userId: 'athlete', requestedAt: 'now', status: 'processing', requestType: 'sync' },
            triggering: false, localError: null, isInFlight: true, isStale: false, triggerSync,
        });
        expect(render()).toContain('disabled');
        expect(render()).not.toContain('role="status"');
    });
    it('allows retry of a delayed selected request', () => {
        vi.mocked(useGarminSyncTrigger).mockReturnValue({
            request: { userId: 'athlete', requestedAt: 'old', status: 'pending',
                requestType: 'activity_details', activityId: 'elliptical-1' },
            triggering: false, localError: null, isInFlight: true, isStale: true, triggerSync,
        });
        expect(render()).not.toContain('disabled');
        expect(render()).toContain('Request delayed. You can retry.');
    });
    it.each([
        ['pending', 'Queued for the next Garmin sync check'],
        ['processing', 'Fetching activity details'],
        ['completed', 'No laps returned by Garmin'],
        ['failed', 'Details unavailable'],
    ] as const)('reports the selected activity %s outcome', (status, expected) => {
        vi.mocked(useGarminSyncTrigger).mockReturnValue({
            request: { userId: 'athlete', requestedAt: 'now', status,
                requestType: 'activity_details', activityId: 'elliptical-1' },
            triggering: false, localError: null, isInFlight: status === 'pending' || status === 'processing',
            isStale: false, triggerSync,
        });
        expect(render()).toContain(expected);
    });
});
