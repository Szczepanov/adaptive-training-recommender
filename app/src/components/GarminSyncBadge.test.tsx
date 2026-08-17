import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GarminSyncBadge } from './GarminSyncBadge';
import * as syncHook from '../hooks/useGarminSyncStatus';
import type { CanonicalWorkoutExport } from '../utils/workoutJsonExport';

const dummyPayload = {} as CanonicalWorkoutExport;

describe('GarminSyncBadge', () => {
    it('renders nothing when status is idle', () => {
        vi.spyOn(syncHook, 'useGarminSyncStatus').mockReturnValue({
            status: 'idle',
            queuedWorkout: null,
            isPending: false,
            pendingCount: 0,
            error: null,
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-17" />
        );
        expect(html).toBe('');
    });

    it('renders pending status with spinner and title', () => {
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
            pendingCount: 0,
            error: null,
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-17" />
        );
        expect(html).toContain('status-pending');
        expect(html).toContain('Garmin: Syncing...');
        expect(html).toContain('Aerobic Engine 3x15');
    });

    it('renders synced status with checkmark', () => {
        vi.spyOn(syncHook, 'useGarminSyncStatus').mockReturnValue({
            status: 'synced',
            queuedWorkout: {
                userId: 'u1',
                date: '2026-08-17',
                workoutTitle: 'Aerobic Engine 3x15',
                modality: 'cycling',
                status: 'synced',
                queuedAt: '2026-08-17T09:00:00Z',
                syncedAt: '2026-08-17',
                payload: dummyPayload,
            },
            isPending: false,
            pendingCount: 0,
            error: null,
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-17" />
        );
        expect(html).toContain('status-synced');
        expect(html).toContain('Garmin: Synced');
    });

    it('renders failed status with error tooltip', () => {
        vi.spyOn(syncHook, 'useGarminSyncStatus').mockReturnValue({
            status: 'failed',
            queuedWorkout: {
                userId: 'u1',
                date: '2026-08-17',
                workoutTitle: 'Aerobic Engine 3x15',
                modality: 'cycling',
                status: 'failed',
                queuedAt: '2026-08-17T09:00:00Z',
                error: 'Garmin API 500 error',
                payload: dummyPayload,
            },
            isPending: false,
            pendingCount: 0,
            error: 'Garmin API 500 error',
        });

        const html = renderToStaticMarkup(
            <GarminSyncBadge userId="u1" date="2026-08-17" />
        );
        expect(html).toContain('status-failed');
        expect(html).toContain('Garmin: Error');
        expect(html).toContain('Garmin API 500 error');
    });
});
