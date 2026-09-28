import type { ActivityLapSummary, ActivityZoneBucket, NormalizedGarminActivity } from './models';
import { findSectionHeading, SECTION_TITLE } from './contextBrief';
import { hrEvidence } from './contextBriefResponseFeatures';
import { normalizeModality } from './performedTrainingFacts';
import {
    deriveKeySessionSummaries,
    hasAvailableFeature,
    renderKeySessionSummaries,
    type ResponseContext,
} from './contextBriefResponseSummary';

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
    road_biking: 'Road cycling',
    cycling: 'Cycling',
    virtual_ride: 'Virtual cycling',
    gravel_cycling: 'Gravel cycling',
    mountain_biking: 'Mountain biking',
    cyclocross: 'Cyclocross',
    indoor_cycling: 'Indoor cycling',
    running: 'Running',
    trail_running: 'Trail running',
    treadmill_running: 'Treadmill running',
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
        || (activity.laps?.length ?? 0) > 0
        || activity.runningDynamics !== undefined
        || activity.activityResponse !== undefined;
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

function powerDurationLabel(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds % 60 === 0) return `${seconds / 60}m`;
    return formatDuration(seconds);
}

function renderActivityResponse(activity: NormalizedGarminActivity, maxSegments?: number): string[] {
    const response = activity.activityResponse;
    if (!response) return [];
    const intervalHr = hrEvidence(activity, 'INTERVAL_RESPONSE');
    const aerobicHr = hrEvidence(activity, 'AEROBIC_DECOUPLING');
    const lines: string[] = ['- Multi-resolution response telemetry:'];
    const resolution = response.sourceResolution;
    const parts = [
        resolution.powerSeconds === undefined ? null : `power ~${formatNumber(resolution.powerSeconds, 2)} s`,
        resolution.hrSeconds === undefined ? null : `HR ~${formatNumber(resolution.hrSeconds, 2)} s`,
        resolution.cadenceSeconds === undefined ? null : `cadence ~${formatNumber(resolution.cadenceSeconds, 2)} s`,
    ].filter((part): part is string => part !== null);
    lines.push(`  - Source resolution: ${parts.length > 0 ? parts.join(' · ') : 'not estimable'} · derivation ${response.derivationVersion}`);
    if (intervalHr.note) lines.push(`  - Segment HR provenance: ${intervalHr.note}`);
    if (aerobicHr.note && aerobicHr.note !== intervalHr.note) {
        lines.push(`  - Steady-half HR provenance: ${aerobicHr.note}`);
    }

    if (response.powerDurationPeaks.length > 0) {
        lines.push(`  - Power-duration peaks: ${response.powerDurationPeaks
            .map(peak => `${powerDurationLabel(peak.durationSeconds)} ${formatNumber(peak.powerWatts, 0)} W (${peak.confidence}${peak.activityHalf ? `, ${peak.activityHalf} half` : ''})`)
            .join(' · ')}`);
    }
    if (response.steadyHalves) {
        const half = response.steadyHalves;
        const halfParts = [
            half.firstPowerWatts === undefined || half.secondPowerWatts === undefined
                ? null : `power ${formatNumber(half.firstPowerWatts, 0)}→${formatNumber(half.secondPowerWatts, 0)} W`,
            aerobicHr.withheld || half.firstHrBpm === undefined || half.secondHrBpm === undefined
                ? null : `HR ${formatNumber(half.firstHrBpm, 0)}→${formatNumber(half.secondHrBpm, 0)} bpm`,
            half.firstCadenceRpm === undefined || half.secondCadenceRpm === undefined
                ? null : `cadence ${formatNumber(half.firstCadenceRpm, 0)}→${formatNumber(half.secondCadenceRpm, 0)} rpm`,
        ].filter((part): part is string => part !== null);
        if (halfParts.length > 0) lines.push(`  - Deterministic halves: ${halfParts.join(' · ')}`);
    }
    const visibleSegments = maxSegments === undefined ? response.segments : response.segments.slice(0, maxSegments);
    if (visibleSegments.length > 0) {
        const viewLimit = visibleSegments.length < response.segments.length
            ? `; this view shows first ${visibleSegments.length} persisted segments`
            : '';
        lines.push(
            `  - Segments: ${response.segmentCountTotal}${response.segmentsTruncated ? ` total; persisted first ${response.segments.length}` : ''}${viewLimit}`,
            '',
            '  | # | Type | Identity | Duration | Target | Avg/peaks power | HR avg/end/max | Cadence avg/max | Power thirds | Confidence |',
            '  |---:|---|---|---:|---|---|---|---|---|---|',
        );
        for (const segment of visibleSegments) {
            const target = segment.prescribedTarget
                ? segment.prescribedTarget.kind === 'power_watts' && segment.prescribedTarget.value !== undefined
                    ? `${formatNumber(segment.prescribedTarget.value, 0)} W`
                    : segment.prescribedTarget.kind === 'power_range_watts'
                        ? `${segment.prescribedTarget.low === undefined ? '—' : formatNumber(segment.prescribedTarget.low, 0)}–${segment.prescribedTarget.high === undefined ? '—' : formatNumber(segment.prescribedTarget.high, 0)} W`
                        : segment.prescribedTarget.value === undefined
                            ? segment.prescribedTarget.kind
                            : `${segment.prescribedTarget.kind} ${formatNumber(segment.prescribedTarget.value, 0)}`
                : '—';
            const power = [
                segment.averagePowerWatts === undefined ? null : `avg ${formatNumber(segment.averagePowerWatts, 0)}`,
                segment.peak1sPowerWatts === undefined ? null : `1s ${formatNumber(segment.peak1sPowerWatts, 0)}`,
                segment.peak5sPowerWatts === undefined ? null : `5s ${formatNumber(segment.peak5sPowerWatts, 0)}`,
                segment.peak10sPowerWatts === undefined ? null : `10s ${formatNumber(segment.peak10sPowerWatts, 0)}`,
            ].filter((part): part is string => part !== null).join('/');
            const hr = intervalHr.withheld
                ? 'withheld'
                : [segment.averageHrBpm, segment.endHrBpm, segment.maxHrBpm]
                    .map(value => value === undefined ? '—' : formatNumber(value, 0)).join('/');
            const cadence = [segment.averageCadenceRpm, segment.maxCadenceRpm]
                .map(value => value === undefined ? '—' : formatNumber(value, 0)).join('/');
            const thirds = [segment.firstThirdPowerWatts, segment.middleThirdPowerWatts, segment.lastThirdPowerWatts]
                .map(value => value === undefined ? '—' : formatNumber(value, 0)).join('/');
            lines.push(`  | ${segment.segmentIndex} | ${segment.segmentType} | ${segment.identitySource} | ${formatDuration(segment.durationSeconds)} | ${target} | ${power || '—'} W | ${hr}${hr === 'withheld' ? '' : ' bpm'} | ${cadence} rpm | ${thirds} W | ${segment.evidenceConfidence} |`);
        }
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

const MORNING_QUALITY_DOMAINS = new Set(['tempo', 'threshold', 'vo2', 'anaerobic', 'mixed', 'race']);
const MORNING_MAX_LAPS = 20;
const MORNING_MAX_RESPONSE_SEGMENTS = 20;

function isFiniteNumber(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function pacePerKm(speedMps: number | undefined): string {
    if (!isFiniteNumber(speedMps) || speedMps <= 0) return '—';
    const seconds = Math.round(1000 / speedMps);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}/km`;
}

function renderRunningDynamics(activity: NormalizedGarminActivity): string[] {
    const dynamics = activity.runningDynamics;
    if (!dynamics) return [];
    const parts = [
        isFiniteNumber(dynamics.avgRunningPowerWatts) ? `avg running power ${formatNumber(dynamics.avgRunningPowerWatts, 0)} W` : null,
        isFiniteNumber(dynamics.maxRunningPowerWatts) ? `max running power ${formatNumber(dynamics.maxRunningPowerWatts, 0)} W` : null,
        isFiniteNumber(dynamics.strideLengthM) ? `stride ${formatNumber(dynamics.strideLengthM, 2)} m` : null,
        isFiniteNumber(dynamics.groundContactTimeMs) ? `GCT ${formatNumber(dynamics.groundContactTimeMs, 0)} ms` : null,
        isFiniteNumber(dynamics.groundContactBalanceLeftPct)
            ? `GCT balance ${formatNumber(dynamics.groundContactBalanceLeftPct, 1)}/${formatNumber(100 - dynamics.groundContactBalanceLeftPct, 1)} L/R`
            : null,
        isFiniteNumber(dynamics.verticalOscillationCm) ? `vertical oscillation ${formatNumber(dynamics.verticalOscillationCm, 1)} cm` : null,
        isFiniteNumber(dynamics.verticalRatioPct) ? `vertical ratio ${formatNumber(dynamics.verticalRatioPct, 1)}%` : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? [`- Running dynamics: ${parts.join(' · ')}`] : [];
}

function renderMorningLaps(activity: NormalizedGarminActivity): string[] {
    const laps = [...(activity.laps ?? [])].sort((a, b) => a.lapIndex - b.lapIndex);
    if (laps.length === 0) return [];
    const visible = laps.slice(0, MORNING_MAX_LAPS);
    const running = normalizeModality(activity.type) === 'Running';
    const lines = running
        ? [
            '- Interval/lap detail:',
            '',
            '  | Lap | Duration | Distance | Pace | Avg power | Avg HR |',
            '  |---:|---:|---:|---:|---:|---:|',
        ]
        : [
            '- Interval/lap detail:',
            '',
            '  | Lap | Duration | Avg power | Avg HR |',
            '  |---:|---:|---:|---:|',
        ];

    for (const lap of visible) {
        const power = lap.averagePowerWatts === undefined ? '—' : `${formatNumber(lap.averagePowerWatts, 0)} W`;
        const hr = lap.averageHrBpm === undefined ? '—' : `${formatNumber(lap.averageHrBpm, 0)} bpm`;
        if (running) {
            const distance = lap.distanceMeters === undefined ? '—' : `${formatNumber(lap.distanceMeters / 1000, 2)} km`;
            lines.push(
                `  | ${lap.lapIndex} | ${formatDuration(lap.durationSeconds)} | ${distance} | ${pacePerKm(lap.averageSpeedMps)} | ${power} | ${hr} |`,
            );
        } else {
            lines.push(`  | ${lap.lapIndex} | ${formatDuration(lap.durationSeconds)} | ${power} | ${hr} |`);
        }
    }
    if (visible.length < laps.length) {
        lines.push(`  - … ${laps.length - visible.length} additional lap(s) omitted from the morning brief; use diagnostic export for all laps.`);
    }
    return lines;
}

/**
 * The morning handoff is intentionally compact except for yesterday's quality endurance
 * session. Tempo is quality even when #809 labels its stimulus intensity only "moderate";
 * hard-tagged cycling/running is also expanded for legacy records whose stimulusDomain is
 * absent. This selection is display-only and has no recommendation authority.
 */
export function renderMorningQualityActivityTelemetry(activity: NormalizedGarminActivity): string[] {
    const modality = normalizeModality(activity.type);
    if (modality !== 'Cycling' && modality !== 'Running') return [];
    const domain = activity.stimulusDomain ?? 'unknown';
    const canonicalQuality = MORNING_QUALITY_DOMAINS.has(domain);
    const legacyHard = domain === 'unknown' && activity.intensityTag === 'hard';
    if (!canonicalQuality && !legacyHard) return [];

    const detail: string[] = [];
    const sessionParts = [
        isFiniteNumber(activity.variabilityIndex) ? `VI ${formatNumber(activity.variabilityIndex, 2)}` : null,
        isFiniteNumber(activity.maxHr) ? `max HR ${formatNumber(activity.maxHr, 0)} bpm` : null,
        isFiniteNumber(activity.trainingEffectAnaerobic) ? `anaerobic TE ${formatNumber(activity.trainingEffectAnaerobic, 1)}` : null,
        activity.primaryBenefit ? `primary benefit ${activity.primaryBenefit}` : null,
    ].filter((part): part is string => part !== null);
    if (sessionParts.length > 0) detail.push(`- Session detail: ${sessionParts.join(' · ')}`);

    if (activity.powerInZones?.length) detail.push(...renderZones('Power zones', activity.powerInZones, 'W'));
    if (activity.hrInZones?.length) detail.push(...renderZones('Heart-rate zones', activity.hrInZones, 'bpm'));
    detail.push(...renderRunningDynamics(activity));

    if (activity.activityResponse) {
        detail.push(...renderActivityResponse(activity, MORNING_MAX_RESPONSE_SEGMENTS));
    }

    // For running, laps are the only interval-resolution evidence currently persisted.
    // For cycling, prefer semantic/native response evidence; legacy quality rides fall back
    // to bounded laps when the activityResponse sidecar is absent.
    if (modality === 'Running' || !activity.activityResponse) {
        detail.push(...renderMorningLaps(activity));
    }

    if (detail.length === 0) return [];
    return [
        '  - Quality-session detail (display-only):',
        ...detail.map(line => line.length === 0 ? '' : `    ${line}`),
    ];
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
        if (activity.activityResponse) {
            lines.push(...renderActivityResponse(activity));
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
    summarizedIds: ReadonlySet<string> = new Set(),
): string {
    const detailed = activities
        .filter(activity => hasDetailedTelemetry(activity) && !summarizedIds.has(activity.activityId))
        .sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId));
    if (detailed.length === 0) return '';

    const lines: string[] = [
        '### Key-session telemetry (compact)',
        '',
        summarizedIds.size > 0
            ? 'One line per activity with Garmin detail telemetry that has no semantic summary below. Per-lap and per-zone tables are in the diagnostic export.'
            : 'One line per activity with Garmin detail telemetry. Per-lap and per-zone tables are in the diagnostic export.',
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
        if (activity.activityResponse?.powerDurationPeaks.length) {
            const preferred = [5, 60, 300]
                .map(duration => activity.activityResponse?.powerDurationPeaks.find(peak => peak.durationSeconds === duration))
                .filter((peak): peak is NonNullable<typeof peak> => peak !== undefined);
            if (preferred.length > 0) {
                parts.push(`MMP ${preferred.map(peak => `${powerDurationLabel(peak.durationSeconds)} ${formatNumber(peak.powerWatts, 0)} W`).join(' / ')}`);
            }
        }
        if (activity.activityResponse) {
            const response = activity.activityResponse;
            const semantic = response.segments.filter(segment =>
                segment.identitySource === 'reconciled_workout_step' || segment.identitySource === 'fit_workout_step').length;
            if (semantic > 0) parts.push(`${semantic} semantic segments (${response.derivationVersion})`);
        }
        lines.push(`- ${activity.date} — ${formatActivityType(activity.type)} — ${activity.intensityTag}: ${parts.length > 0 ? parts.join(' · ') : 'no usable power, zone or lap detail reported'}`);
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
    response?: ResponseContext,
): string {
    // Issue #814: key sessions get a semantic summary. In the compact (planning) export it
    // replaces that session's digest line only when at least one feature produced a value;
    // diagnostic keeps every raw table and adds the summaries after them.
    const summaries = response ? deriveKeySessionSummaries(activities, response) : [];
    const summaryText = response ? renderKeySessionSummaries(summaries, response) : '';
    const summarizedIds = new Set(summaries.filter(hasAvailableFeature).map(summary => summary.activity.activityId));
    const raw = compact ? renderCompactActivityTelemetry(activities, summarizedIds) : renderContextBriefActivityTelemetry(activities);
    const telemetry = [raw, summaryText].filter(Boolean).join('\n\n');
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
