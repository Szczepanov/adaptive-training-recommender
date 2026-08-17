import React from 'react';
import { useGarminSyncStatus } from '../hooks/useGarminSyncStatus';
import './GarminSyncBadge.css';

export interface GarminSyncBadgeProps {
    userId: string | null | undefined;
    date?: string;
}

function formatSyncTimestamp(isoString: string | null | undefined): string {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return isoString;
    }
}

export const GarminSyncBadge: React.FC<GarminSyncBadgeProps> = ({ userId }) => {
    const { status, queuedWorkout, pendingCount, error } = useGarminSyncStatus(userId);

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
        label = pendingCount > 1 ? `Garmin: Syncing (${pendingCount})...` : 'Garmin: Syncing...';
        tooltip = `Pushing "${queuedWorkout?.workoutTitle || 'Workout'}" (${queuedWorkout?.date || 'Session'}) to Garmin Connect...`;
    } else if (status === 'synced') {
        badgeClass += ' status-synced';
        icon = '✓';
        const timeFormatted = formatSyncTimestamp(queuedWorkout?.syncedAt);
        label = timeFormatted ? `Garmin: Synced (${timeFormatted})` : 'Garmin: Synced';
        const syncDetails = timeFormatted ? ` at ${timeFormatted}` : '';
        tooltip = `"${queuedWorkout?.workoutTitle || 'Workout'}" (${queuedWorkout?.date}) synced to Garmin Connect${syncDetails}.`;
    } else if (status === 'failed') {
        badgeClass += ' status-failed';
        icon = '⚠️';
        label = 'Garmin: Error';
        tooltip = `Failed to sync "${queuedWorkout?.workoutTitle || 'Workout'}" (${queuedWorkout?.date}): ${queuedWorkout?.error || error || 'Unknown error'}`;
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

