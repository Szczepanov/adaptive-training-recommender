import { useEffect, useState } from 'react';
import {
    garminConnectionService,
    type GarminConnectionState,
} from '../services/garminConnectionService';

export type GarminConnectionViewState = GarminConnectionState | 'checking';

/** Keeps UI and sync hooks on the shared ADR-0029 tri-state connection contract. */
export function useGarminConnectionState(
    userId: string | null | undefined,
    enabled = true,
): GarminConnectionViewState {
    const [state, setState] = useState<GarminConnectionViewState>(
        userId && enabled ? 'checking' : 'disconnected',
    );

    useEffect(() => {
        if (!userId || !enabled) {
            setState('disconnected');
            return;
        }

        setState('checking');
        return garminConnectionService.subscribeToGarminConnection(userId, (result) => {
            setState(result.state);
        });
    }, [userId, enabled]);

    return state;
}
