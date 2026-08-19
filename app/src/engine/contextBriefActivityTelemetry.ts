import type { ActivityLapSummary, ActivityZoneBucket, NormalizedGarminActivity } from './models';

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
    road_biking: 'Road cycling',
    cycling: 'Cycling',
    virtual_ride: 'Virtual cycling',
    gravel_cycling: 'Gravel cycling',
    mountain_biking: 'Mountain biking',
    cyclocross: 'Cyclocross',
    indoor_cycling: 'Indoor cycling',
};

function formatActivityType(typeKey: string): string {
    const label = ACTIVITY_TYPE_LABELS[typeKey];
    if (label) return label;
    const words = typeKey.replace(/_/g, ' ');
    return words.length > 0 ? `${words[0].toUpperCase()}${words.slice(1)}` : 'Activity';
}

function hasDetailedTelemetry(activity: NormalizedGarminActivity): boolean {
    return activity.normalizedPower !== undefined
        || activity.intensityFactor !== undefined
        || activity.variabilityIndex !== undefined
        || (activity.powerInZones?.length ?? 0) > 0
        || (activity.hrInZones?.length ?? 0) > 0
        || (activity.laps?.length ?? 0) > 0;
}

function formatDuration(seconds: number): string {
    const roundedSeconds = Math.max(0, Math.round(seconds));
    const hours = Math.floor(roundedSeconds / 3600);
    const minutes = Math.floor((roundedSeconds % 3600) / 60);
    const secs = roundedSeconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatNumber(value: number, places: number): string {
    const factor = 10 ** places;
    return String(Math.round(value * factor) / factor);
}

function renderZones(
    label: string,
    buckets: readonly ActivityZoneBucket[],
    boundaryUnit: 'W' | 'bpm',
): string[] {
    const totalSeconds = buckets.reduce((sum, bucket) => sum + bucket.secondsInZone, 0);
    const lines = [`- ${label}:`];
    for (const bucket of [...buckets].sort((a, b) => a.zoneNumber - b.zoneNumber)) {
        const share = totalSeconds > 0 ? (bucket.secondsInZone / totalSeconds) * 100 : null;
        const shareText = share === null ? '' : ` · ${formatNumber(share, 1)}%`;
        const boundary = bucket.lowBoundary === undefined
            ? ''
            : ` · low boundary ${formatNumber(bucket.lowBoundary, 0)} ${boundaryUnit}`;
        lines.push(`  - Z${bucket.zoneNumber}: ${formatDuration(bucket.secondsInZone)}${shareText}${boundary}`);
    }
    return lines;
}

function renderLaps(laps: readonly ActivityLapSummary[]): string[] {
    const lines = [
        '- Laps:',
        '',
        '  | Lap | Duration | Avg power | Avg HR |',
        '  |---:|---:|---:|---:|',
    ];
    for (const lap of [...laps].sort((a, b) => a.lapIndex - b.lapIndex)) {
        const power = lap.averagePowerWatts === undefined ? '—' : `${formatNumber(lap.averagePowerWatts, 0)} W`;
        const hr = lap.averageHrBpm === undefined ? '—' : `${formatNumber(lap.averageHrBpm, 0)} bpm`;
        lines.push(`  | ${lap.lapIndex} | ${formatDuration(lap.durationSeconds)} | ${power} | ${hr} |`);
    }
    return lines;
}

/**
 * Compact, paste-ready activity detail for an external training analysis. The daily
 * context brief already carries load/recovery context; this section preserves the
 * workout-specific evidence that would otherwise be discarded by the summary table.
 */
export function renderContextBriefActivityTelemetry(
    activities: readonly NormalizedGarminActivity[],
): string {
    const detailed = activities
        .filter(hasDetailedTelemetry)
        .sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId));
    if (detailed.length === 0) return '';

    const lines: string[] = [
        '### Detailed activity telemetry',
        '',
        'Only activities with Garmin detail telemetry are expanded below; absent fields were not reported by Garmin.',
    ];

    for (const activity of detailed) {
        lines.push('', `#### ${activity.date} — ${formatActivityType(activity.type)} — ${activity.intensityTag}`);

        const powerSummary: string[] = [];
        if (activity.normalizedPower !== undefined) {
            powerSummary.push(`normalized power ${formatNumber(activity.normalizedPower, 0)} W`);
        }
        if (activity.intensityFactor !== undefined) {
            powerSummary.push(`IF ${formatNumber(activity.intensityFactor, 2)}`);
        }
        if (activity.variabilityIndex !== undefined) {
            powerSummary.push(`VI ${formatNumber(activity.variabilityIndex, 2)}`);
        }
        if (powerSummary.length > 0) lines.push(`- Power summary: ${powerSummary.join(' · ')}`);

        if (activity.powerInZones?.length) {
            lines.push(...renderZones('Power zones', activity.powerInZones, 'W'));
        }
        if (activity.hrInZones?.length) {
            lines.push(...renderZones('Heart-rate zones', activity.hrInZones, 'bpm'));
        }
        if (activity.laps?.length) {
            lines.push(...renderLaps(activity.laps));
        }
    }

    return lines.join('\n');
}

/** Insert detailed activity telemetry as a subsection of completed training (section 3).
 * The fallback append keeps the handoff useful if the parent brief heading ever changes. */
export function injectActivityTelemetryIntoContextBrief(
    brief: string,
    activities: readonly NormalizedGarminActivity[],
): string {
    const telemetry = renderContextBriefActivityTelemetry(activities);
    if (!telemetry) return brief;

    const nextSectionMarker = '\n## 4. Subjective';
    const markerIndex = brief.indexOf(nextSectionMarker);
    if (markerIndex === -1) return `${brief.trimEnd()}\n\n${telemetry}\n`;

    return `${brief.slice(0, markerIndex)}\n\n${telemetry}${brief.slice(markerIndex)}`;
}
