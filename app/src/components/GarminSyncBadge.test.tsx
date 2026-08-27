import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GarminSyncBadge } from './GarminSyncBadge';
import * as syncHook from '../hooks/useGarminSyncStatus';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';

const dummyPayload = {} as CanonicalWorkoutExport;

describe('GarminSyncBadge', () => {
    it('renders idle "Garmin: Sync now" button when status is idle', () => {
        vi.spyOn(syncHook, 'useGarminSyncStatus').mockReturnValue({
            status: 'idle',
            queuedWorkout: null,
            isPending: false,
            isBusy: false,
            isStale: false,
            pendingCount: 0,
            error: null,
            latestSyncedAt: null,
            latestGetSyncedAt: null,
            latestPostSyncedAt: null,
            triggerSync: vi.fn(),
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-17" />
        );
        expect(html).toContain('status-idle');
        expect(html).toContain('Garmin: Sync now');
        expect(html).not.toContain('disabled');
    });

    it('renders pending status with spinner, disabled button and title', () => {
        vi.spyOn(syncHook, 'useGarminSyncStatus').mockReturnValue({
            status: 'pending',
            queuedWorkout: {
                userId: 'u1',
                date: '2026-08-17',
                workoutTitle: 'Aerobic Engine 3x15',
                modality: 'cycling',
                status: 'pending',
                queuedAt: '2026-08-17T09:00:00Z',
                payload: dummyPayload,
            },
            isPending: true,
            isBusy: true,
            isStale: false,
            pendingCount: 1,
            error: null,
            latestSyncedAt: null,
            latestGetSyncedAt: null,
            latestPostSyncedAt: null,
            triggerSync: vi.fn(),
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-17" />
        );
        expect(html).toContain('status-pending');
        expect(html).toContain('Garmin: Syncing...');
        expect(html).toContain('disabled');
        expect(html).toContain('Aerobic Engine 3x15');
    });

    it('renders synced status with latest unified timestamp across GET and POST', () => {
        vi.spyOn(syncHook, 'useGarminSyncStatus').mockReturnValue({
            status: 'synced',
            queuedWorkout: null,
            isPending: false,
            isBusy: false,
            isStale: false,
            pendingCount: 0,
            error: null,
            latestSyncedAt: '2026-08-27T07:15:00.000Z',
            latestGetSyncedAt: '2026-08-27T07:15:00.000Z',
            latestPostSyncedAt: '2026-08-26T14:36:12.000Z',
            triggerSync: vi.fn(),
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-27" />
        );
        expect(html).toContain('status-synced');
        expect(html).toContain('Garmin: Synced');
        expect(html).not.toContain('disabled');
        expect(html).toContain('Health &amp; recovery:');
    });

    it('renders failed status with error tooltip and retry label', () => {
        vi.spyOn(syncHook, 'useGarminSyncStatus').mockReturnValue({
            status: 'failed',
            queuedWorkout: null,
            isPending: false,
            isBusy: false,
            isStale: false,
            pendingCount: 0,
            error: 'Garmin API 500 error',
            latestSyncedAt: null,
            latestGetSyncedAt: null,
            latestPostSyncedAt: null,
            triggerSync: vi.fn(),
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-17" />
        );
        expect(html).toContain('status-failed');
        expect(html).toContain('Garmin: Error (Retry)');
        expect(html).toContain('Garmin API 500 error');
        expect(html).not.toContain('disabled');
    });
});
