import type { GarminConnectionState } from '../services/garminConnectionService';

export type WearablePlanningMode =
    | 'wearable'
    | 'subjective_only'
    | 'sync_required'
    | 'unavailable';

/**
 * Separates absent telemetry from an absent provider. This is the shared composition
 * boundary for daily and 7-day planning; engine adapters alone do not authorize fallback.
 *
 * `unavailable` deliberately preserves uncertainty: it means the provider connection
 * state could not be verified, not that Garmin is disconnected. Callers may degrade to
 * subjective-only computation while that uncertainty is visible, but they must not infer
 * or persist a disconnect from this mode. A confirmed connection without recovery data is
 * the only state that requires a sync; any available recovery snapshot remains usable even
 * when provider-status verification is unavailable.
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
