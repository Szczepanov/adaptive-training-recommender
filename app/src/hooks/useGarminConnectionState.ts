import { useEffect, useState } from 'react';
import {
    garminConnectionService,
    type GarminConnectionState,
} from '../services/garminConnectionService';

export type GarminConnectionViewState = GarminConnectionState | 'checking';

export interface TrackedConnectionState {
    userId: string | null | undefined;
    enabled: boolean;
    value: GarminConnectionViewState;
}

export function initialTrackedConnectionState(
    userId: string | null | undefined,
    enabled: boolean,
): TrackedConnectionState {
    return { userId, enabled, value: userId && enabled ? 'checking' : 'disconnected' };
}

/** On the render where `userId`/`enabled` change, the subscription effect hasn't run
 * yet, so `state` can still hold the previous user's (possibly `connected`) value.
 * Resolve to `checking`/`disconnected` until the tracked inputs match this render's
 * inputs, so consumers (useAutoGarminSync, GarminSyncBadge) never briefly see a prior
 * user's connection status attributed to the new user. */
export function resolveGarminConnectionViewState(
    state: TrackedConnectionState,
    userId: string | null | undefined,
    enabled: boolean,
): GarminConnectionViewState {
    if (state.userId !== userId || state.enabled !== enabled) {
        return userId && enabled ? 'checking' : 'disconnected';
    }
    return state.value;
}

/** Keeps UI and sync hooks on the shared ADR-0029 tri-state connection contract. */
export function useGarminConnectionState(
    userId: string | null | undefined,
    enabled = true,
): GarminConnectionViewState {
    const [state, setState] = useState<TrackedConnectionState>(() =>
        initialTrackedConnectionState(userId, enabled),
    );

    useEffect(() => {
        if (!userId || !enabled) {
            setState({ userId, enabled, value: 'disconnected' });
            return;
        }

        setState({ userId, enabled, value: 'checking' });
        return garminConnectionService.subscribeToGarminConnection(userId, (result) => {
            setState({ userId, enabled, value: result.state });
        });
    }, [userId, enabled]);

    return resolveGarminConnectionViewState(state, userId, enabled);
}
