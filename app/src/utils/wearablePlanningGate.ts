import type { GarminConnectionState } from '../services/garminConnectionService';

export type WearablePlanningMode =
    | 'wearable'
    | 'subjective_only'
    | 'sync_required'
    | 'unavailable';

/**
 * Separates absent telemetry from an absent provider. This is the shared composition
 * boundary for daily and 7-day planning; engine adapters alone do not authorize fallback.
 */
export function resolveWearablePlanningMode(
    hasRecoverySnapshot: boolean,
    garminConnectionState: GarminConnectionState,
): WearablePlanningMode {
    if (hasRecoverySnapshot) return 'wearable';
    if (garminConnectionState === 'disconnected') return 'subjective_only';
    if (garminConnectionState === 'connected') return 'sync_required';
    return 'unavailable';
}
