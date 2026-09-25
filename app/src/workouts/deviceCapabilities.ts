import type { TrainingSettings } from '../engine/models.ts';
import type { AthletePerformanceProfile, DeviceCapabilities } from './models.ts';

/**
 * Tri-state declared device capabilities, resolved per sensor: explicit training settings
 * win, then the performance profile the Preferences UI writes (issue #816 shares this with
 * the context brief so prescription and export never disagree). `undefined` = unknown.
 */
export function resolveDeviceCapabilities(
    trainingSettings: TrainingSettings | null | undefined,
    profile: AthletePerformanceProfile | null | undefined,
): DeviceCapabilities {
    const settings = trainingSettings?.capabilities;
    const declared = profile?.capabilities;
    return {
        powerMeter: settings?.powerMeter ?? declared?.powerMeter,
        heartRateMonitor: settings?.heartRateMonitor ?? declared?.heartRateMonitor,
        cadenceData: settings?.cadenceData ?? declared?.cadenceData,
    };
}
