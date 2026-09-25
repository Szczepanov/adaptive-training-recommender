import type { ActivityLapSummary, ActivityZoneBucket, NormalizedGarminActivity } from './models';
import { findSectionHeading, SECTION_TITLE } from './contextBrief';

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

/** Share of time in the zone with the most seconds, as "Z<n> <pct>%". */
function dominantZone(buckets: readonly ActivityZoneBucket[]): string | null {
    const total = buckets.reduce((sum, bucket) => sum + bucket.secondsInZone, 0);
    if (total <= 0) return null;
    const top = [...buckets].sort((a, b) => b.secondsInZone - a.secondsInZone || a.zoneNumber - b.zoneNumber)[0];
    return `Z${top.zoneNumber} ${formatNumber((top.secondsInZone / total) * 100, 0)}%`;
}

/** Constant-size lap digest: count, total time and the highest-power (else highest-HR) lap.
 * Deliberately never lists laps, so a 100-lap activity costs the same as a 3-lap one. */
function lapDigest(laps: readonly ActivityLapSummary[]): string {
    const totalSeconds = laps.reduce((sum, lap) => sum + lap.durationSeconds, 0);
    const byPower = laps.filter(lap => lap.averagePowerWatts !== undefined);
    const byHr = laps.filter(lap => lap.averageHrBpm !== undefined);
    const pickMax = (items: readonly ActivityLapSummary[], read: (lap: ActivityLapSummary) => number) =>
        items.reduce((best, lap) => (read(lap) > read(best) || (read(lap) === read(best) && lap.lapIndex < best.lapIndex) ? lap : best));
    let peak = '';
    if (byPower.length > 0) {
        const lap = pickMax(byPower, item => item.averagePowerWatts as number);
        peak = ` · strongest lap ${formatNumber(lap.averagePowerWatts as number, 0)} W for ${formatDuration(lap.durationSeconds)}`;
    } else if (byHr.length > 0) {
        const lap = pickMax(byHr, item => item.averageHrBpm as number);
        peak = ` · highest-HR lap ${formatNumber(lap.averageHrBpm as number, 0)} bpm for ${formatDuration(lap.durationSeconds)}`;
    }
    return `${laps.length} laps (${formatDuration(totalSeconds)})${peak}`;
}

/**
 * Issue #811 planning-mode digest: one bounded line per detailed activity (power summary,
 * dominant zones, a constant-size lap digest) instead of full zone and lap tables. Output
 * grows with the number of detailed activities in the window, never with lap count.
 */
export function renderCompactActivityTelemetry(
    activities: readonly NormalizedGarminActivity[],
): string {
    const detailed = activities
        .filter(hasDetailedTelemetry)
        .sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId));
    if (detailed.length === 0) return '';

    const lines: string[] = [
        '### Key-session telemetry (compact)',
        '',
        'One line per activity with Garmin detail telemetry. Per-lap and per-zone tables are in the diagnostic export.',
    ];
    for (const activity of detailed) {
        const parts: string[] = [];
        if (activity.normalizedPower !== undefined) parts.push(`NP ${formatNumber(activity.normalizedPower, 0)} W`);
        if (activity.intensityFactor !== undefined) parts.push(`IF ${formatNumber(activity.intensityFactor, 2)}`);
        if (activity.variabilityIndex !== undefined) parts.push(`VI ${formatNumber(activity.variabilityIndex, 2)}`);
        const powerZone = activity.powerInZones?.length ? dominantZone(activity.powerInZones) : null;
        if (powerZone) parts.push(`most time in power ${powerZone}`);
        const hrZone = activity.hrInZones?.length ? dominantZone(activity.hrInZones) : null;
        if (hrZone) parts.push(`most time in HR ${hrZone}`);
        if (activity.laps?.length) parts.push(lapDigest(activity.laps));
        lines.push(`- ${activity.date} — ${formatActivityType(activity.type)} — ${activity.intensityTag}: ${parts.join(' · ')}`);
    }
    return lines.join('\n');
}

/** Insert activity telemetry as a subsection at the end of the completed-training section,
 * located by title so it works in either section order. `compact` selects the bounded
 * planning digest over the full diagnostic tables. The fallback append keeps the handoff
 * useful if the parent brief heading ever changes. */
export function injectActivityTelemetryIntoContextBrief(
    brief: string,
    activities: readonly NormalizedGarminActivity[],
    compact = false,
): string {
    const telemetry = compact ? renderCompactActivityTelemetry(activities) : renderContextBriefActivityTelemetry(activities);
    if (!telemetry) return brief;

    const trainingIndex = findSectionHeading(brief, SECTION_TITLE.training);
    if (trainingIndex === -1) return `${brief.trimEnd()}\n\n${telemetry}\n`;
    const following = [/\n## \d+\. /g, /\n## Requested output/g]
        .map(pattern => {
            pattern.lastIndex = trainingIndex + 1;
            const match = pattern.exec(brief);
            return match ? match.index : -1;
        })
        .filter(index => index !== -1);
    const markerIndex = following.length > 0 ? Math.min(...following) : -1;
    if (markerIndex === -1) return `${brief.trimEnd()}\n\n${telemetry}\n`;

    return `${brief.slice(0, markerIndex)}\n\n${telemetry}\n${brief.slice(markerIndex)}`;
}
