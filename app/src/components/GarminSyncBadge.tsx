import React from 'react';
import { useGarminSyncStatus } from '../hooks/useGarminSyncStatus';
import './GarminSyncBadge.css';

export interface GarminSyncBadgeProps {
    userId: string | null | undefined;
    date: string;
}

export const GarminSyncBadge: React.FC<GarminSyncBadgeProps> = ({ userId, date }) => {
    const { status, queuedWorkout, error } = useGarminSyncStatus(userId, date);

    if (status === 'idle') {
        return null;
    }

    let badgeClass = 'garmin-sync-badge';
    let icon = '🔄';
    let label = 'Garmin: Syncing...';
    let tooltip = 'Workout is queued for export to Garmin Connect.';

    if (status === 'pending') {
        badgeClass += ' status-pending';
        icon = '🔄';
        label = 'Garmin: Syncing...';
        tooltip = `Pushing "${queuedWorkout?.workoutTitle || 'Workout'}" to Garmin Connect...`;
    } else if (status === 'synced') {
        badgeClass += ' status-synced';
        icon = '✓';
        label = 'Garmin: Synced';
        const syncTime = queuedWorkout?.syncedAt ? ` at ${queuedWorkout.syncedAt}` : '';
        tooltip = `"${queuedWorkout?.workoutTitle || 'Workout'}" synced to Garmin Connect${syncTime}.`;
    } else if (status === 'failed') {
        badgeClass += ' status-failed';
        icon = '⚠️';
        label = 'Garmin: Error';
        tooltip = `Failed to sync workout: ${queuedWorkout?.error || error || 'Unknown error'}`;
    }

    return (
        <div
            className={badgeClass}
            title={tooltip}
            aria-label={tooltip}
            role="status"
        >
            <span className="garmin-sync-icon" aria-hidden="true">{icon}</span>
            <span className="garmin-sync-label">{label}</span>
        </div>
    );
};
