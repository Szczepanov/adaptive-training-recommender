import type { NormalizedGarminActivity, TrainingSettings } from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

/**
 * Issue #816: the brief exports two separate sensor facts that must not be conflated.
 *
 * 1. **Configured capability** (`TrainingSettings.capabilities`) — what the athlete has
 *    explicitly declared. It is the only authority on guaranteed future availability, and
 *    an explicit `false` is a hard fact that historical telemetry never overrides.
 * 2. **Observed recent telemetry** — a read-only summary of which channels recent canonical
 *    activities actually contain. Observation is evidence, not ownership: it never writes
 *    back to settings and never promotes an unknown/false configuration to "available".
 *
 * Presentation-only: nothing here feeds a recommendation, so these horizons carry no
 * decision authority (ADR-0033 does not apply) and POLICY_VERSION is unaffected.
 */

/** Observations older than this many days before the planning date are reported as stale. */
export const SENSOR_OBSERVATION_STALE_DAYS = 14;
/** Only activities within this many days of the planning date are counted as "recent". */
export const SENSOR_OBSERVATION_HORIZON_DAYS = 28;

const CYCLING_TYPES = new Set([
    'cycling', 'road_biking', 'virtual_ride', 'gravel_cycling', 'mountain_biking',
    'cyclocross', 'indoor_cycling',
]);

type Configured = boolean | undefined;

export interface SensorChannelObservation {
    count: number;
    latest: string | null;
}

export interface SensorEvidenceSummary {
    horizonStart: string;
    activitiesInHorizon: number;
    cyclingPower: SensorChannelObservation;
    runningPower: SensorChannelObservation;
    heartRate: SensorChannelObservation;
    externalHrSensor: SensorChannelObservation;
}

function hasCyclingPower(activity: NormalizedGarminActivity): boolean {
    if (!CYCLING_TYPES.has(activity.type)) return false;
    return activity.normalizedPower !== undefined
        || (activity.powerInZones?.length ?? 0) > 0
        || (activity.laps ?? []).some(lap => lap.averagePowerWatts !== undefined);
}

function hasRunningPower(activity: NormalizedGarminActivity): boolean {
    const dynamics = activity.runningDynamics;
    return typeof dynamics?.avgRunningPowerWatts === 'number';
}

function hasHeartRate(activity: NormalizedGarminActivity): boolean {
    return typeof activity.averageHr === 'number'
        || (activity.hrInZones?.length ?? 0) > 0
        || (activity.laps ?? []).some(lap => lap.averageHrBpm !== undefined);
}

function observe(
    activities: readonly NormalizedGarminActivity[],
    predicate: (activity: NormalizedGarminActivity) => boolean,
): SensorChannelObservation {
    const matching = activities.filter(predicate);
    const latest = matching.reduce<string | null>((max, item) => (max === null || item.date > max ? item.date : max), null);
    return { count: matching.length, latest };
}

/** Pure summary of observed telemetry from canonical activity fields only (no raw payloads). */
export function summarizeSensorEvidence(
    activities: readonly NormalizedGarminActivity[],
    asOfDate: string,
): SensorEvidenceSummary {
    const horizonStart = addDaysToLocalDateString(asOfDate, -(SENSOR_OBSERVATION_HORIZON_DAYS - 1));
    const recent = activities.filter(item => item.date >= horizonStart && item.date <= asOfDate);
    return {
        horizonStart,
        activitiesInHorizon: recent.length,
        cyclingPower: observe(recent, hasCyclingPower),
        runningPower: observe(recent, hasRunningPower),
        heartRate: observe(recent, hasHeartRate),
        externalHrSensor: observe(recent, item => item.hrMeasurement?.externalHrSensorPresent === true),
    };
}

function configuredText(value: Configured, settingsReadable: boolean): string {
    if (!settingsReadable) return 'configuration unavailable (training settings not readable)';
    if (value === true) return 'configured available';
    if (value === false) return 'configured unavailable (authoritative)';
    return 'configuration unknown';
}

function observedText(label: string, obs: SensorChannelObservation, asOfDate: string, activityCount: number): string {
    if (activityCount === 0) return `${label} not observed — no activities in the recent evidence window, so telemetry provenance is unavailable`;
    if (obs.count === 0 || obs.latest === null) return `${label} not observed in recent evidence`;
    const noun = obs.count === 1 ? 'activity' : 'activities';
    const staleCutoff = addDaysToLocalDateString(asOfDate, -SENSOR_OBSERVATION_STALE_DAYS);
    const stale = obs.latest < staleCutoff ? `; STALE — nothing in the last ${SENSOR_OBSERVATION_STALE_DAYS} days` : '';
    return `recent ${label} observed on ${obs.count} ${noun}; latest ${obs.latest}${stale}`;
}

function overrideNote(value: Configured, settingsReadable: boolean, observed: boolean): string {
    if (settingsReadable && value === false && observed) {
        return ' — historical data does not override the configured unavailability';
    }
    return '';
}

/** Renders the "Configured sensors vs observed recent telemetry" block for section 0. */
export function renderSensorEvidence(
    trainingSettings: TrainingSettings | null,
    activities: readonly NormalizedGarminActivity[],
    asOfDate: string,
): string[] {
    const readable = trainingSettings !== null;
    const caps = trainingSettings?.capabilities;
    const summary = summarizeSensorEvidence(activities, asOfDate);
    const n = summary.activitiesInHorizon;
    const powerObserved = summary.cyclingPower.count + summary.runningPower.count > 0;
    const powerParts = [observedText('cycling power', summary.cyclingPower, asOfDate, n)];
    if (summary.runningPower.count > 0) powerParts.push(observedText('running power', summary.runningPower, asOfDate, n));
    const hrExternal = summary.externalHrSensor.count > 0
        ? ` (external HR sensor confirmed on ${summary.externalHrSensor.count})`
        : '';

    return [
        `- Sensors — configured vs observed (observed = canonical activities ${summary.horizonStart}..${asOfDate}, ${n} in window; observation is evidence, not ownership):`,
        `  - Power meter: ${configuredText(caps?.powerMeter, readable)}; ${powerParts.join('; ')}${overrideNote(caps?.powerMeter, readable, powerObserved)}.`,
        `  - Heart-rate monitor: ${configuredText(caps?.heartRateMonitor, readable)}; ${observedText('HR', summary.heartRate, asOfDate, n)}${hrExternal}${overrideNote(caps?.heartRateMonitor, readable, summary.externalHrSensor.count > 0)}.`,
        `  - Cadence: ${configuredText(caps?.cadenceData, readable)}; not observable — cadence is not carried by canonical activity fields in this export.`,
        '  - Prescription rule: only configured-available sensors are guaranteed for future sessions. Do not assume permanent availability from observation alone; when configuration is unknown or unavailable, give sensor-dependent sessions an executable RPE/feel (or HR, if HR is configured available) fallback.',
    ];
}
