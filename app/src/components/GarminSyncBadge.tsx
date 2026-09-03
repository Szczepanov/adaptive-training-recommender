import React, { useCallback } from 'react';
import { useGarminSyncStatus } from '../hooks/useGarminSyncStatus';
import { useGarminConnectionState } from '../hooks/useGarminConnectionState';
import './GarminSyncBadge.css';

export interface GarminSyncBadgeProps {
    userId: string | null | undefined;
    date?: string;
    onSynced?: () => void;
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

function formatDetailedTimestamp(isoString: string | null | undefined): string {
    if (!isoString) return 'None';
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;
        return d.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return isoString;
    }
}

export const GarminSyncBadge: React.FC<GarminSyncBadgeProps> = ({ userId, date, onSynced }) => {
    const garminConnectionState = useGarminConnectionState(userId);
    const {
        status,
        queuedWorkout,
        pendingCount,
        isBusy,
        error,
        latestSyncedAt,
        latestGetSyncedAt,
        latestPostSyncedAt,
        triggerSync,
    } = useGarminSyncStatus(
        garminConnectionState === 'connected' ? userId : null,
        date,
        onSynced,
    );

    const handleClick = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (isBusy) return;
        await triggerSync();
    }, [isBusy, triggerSync]);

    // Do not install queue/recovery listeners or show a sync action until connection status
    // is positively known. Unknown is intentionally distinct from disconnected (ADR-0029).
    if (garminConnectionState === 'checking' || garminConnectionState === 'disconnected') {
        return null;
    }
    if (garminConnectionState === 'unknown') {
        return (
            <button
                type="button"
                className="garmin-sync-badge status-failed"
                title="Garmin connection status could not be verified. Refresh to retry."
                aria-label="Garmin connection status could not be verified. Refresh to retry."
                disabled
            >
                <span className="garmin-sync-icon" aria-hidden="true">⚠️</span>
                <span className="garmin-sync-label">Garmin: Status unavailable</span>
            </button>
        );
    }

    let badgeClass = 'garmin-sync-badge';
    let icon: string;
    let label: string;
    let tooltip: string;
    let disabled: boolean;

    if (status === 'pending' || isBusy) {
        badgeClass += ' status-pending';
        icon = '🔄';
        label = pendingCount > 1 ? `Garmin: Syncing (${pendingCount})...` : 'Garmin: Syncing...';
        tooltip = queuedWorkout
            ? `Pushing "${queuedWorkout.workoutTitle || 'Workout'}" (${queuedWorkout.date || 'Session'}) to Garmin Connect...`
            : 'Syncing with Garmin Connect...';
        disabled = true;
    } else if (status === 'failed') {
        badgeClass += ' status-failed';
        icon = '⚠️';
        label = 'Garmin: Error (Retry)';
        tooltip = `Garmin sync error: ${error || 'Unknown error'}. Click to retry.`;
        disabled = false;
    } else if (status === 'synced' && latestSyncedAt) {
        badgeClass += ' status-synced';
        icon = '✓';
        const timeFormatted = formatSyncTimestamp(latestSyncedAt);
        label = timeFormatted ? `Garmin: Synced (${timeFormatted})` : 'Garmin: Synced';
        const getDetails = formatDetailedTimestamp(latestGetSyncedAt);
        const postDetails = formatDetailedTimestamp(latestPostSyncedAt);
        tooltip = `Garmin synced.\n• Health & recovery: ${getDetails}\n• Workout export: ${postDetails}\nClick to force sync now.`;
        disabled = false;
    } else {
        badgeClass += ' status-idle';
        icon = '🔄';
        label = 'Garmin: Sync now';
        tooltip = 'Click to sync health & recovery data with Garmin Connect.';
        disabled = false;
    }

    return (
        <button
            type="button"
            className={badgeClass}
            title={tooltip}
            aria-label={tooltip}
            disabled={disabled}
            onClick={handleClick}
            aria-busy={status === 'pending' || isBusy}
        >
            <span className="garmin-sync-icon" aria-hidden="true">{icon}</span>
            <span className="garmin-sync-label">{label}</span>
        </button>
    );
};
