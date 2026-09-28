import type { ActivityLapSummary, ActivityPrescribedTarget, ActivityStimulusDomain, ActivityZoneBucket, NormalizedGarminActivity } from './models';
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

function humanizeTelemetryToken(value: string): string {
    return value.replaceAll('_', ' ');
}

function escapeMarkdownTableCell(value: string): string {
    return value.replaceAll('|', '\\|').replace(/\r?\n/g, ' ').trim();
}

function formatPrescribedTarget(target: ActivityPrescribedTarget | undefined): string {
    if (target === undefined) return '—';
    const normalizedKind = target.kind.toLowerCase();
    if (normalizedKind === 'power_zone' && target.value !== undefined) {
        return `Power zone ${Math.round(target.value)}`;
    }
    if (target.text?.trim()) return escapeMarkdownTableCell(target.text);

    const unit = normalizedKind === 'power_watts' || normalizedKind === 'power_range_watts'
        ? ' W'
        : normalizedKind.includes('cadence')
            ? ' rpm'
            : '';
    const label = humanizeTelemetryToken(target.kind);
    if (target.low !== undefined || target.high !== undefined) {
        const low = target.low === undefined ? '—' : formatNumber(target.low, 0);
        const high = target.high === undefined ? '—' : formatNumber(target.high, 0);
        return unit ? `${low}–${high}${unit}` : `${label}: ${low}–${high}`;
    }
    if (target.value !== undefined) {
        const value = formatNumber(target.value, 0);
        return unit ? `${value}${unit}` : `${label}: ${value}`;
    }
    return label;
}

type ActivityResponseRenderDetail = 'morning' | 'bounded' | 'diagnostic';

function renderActivityResponse(
    activity: NormalizedGarminActivity,
    maxSegments?: number,
    detail: ActivityResponseRenderDetail = 'bounded',
): string[] {
    const response = activity.activityResponse;
    if (!response) return [];
    const intervalHr = hrEvidence(activity, 'INTERVAL_RESPONSE');
    const aerobicHr = hrEvidence(activity, 'AEROBIC_DECOUPLING');
    const morning = detail === 'morning';
    const lines: string[] = [morning ? '- Response telemetry:' : '- Multi-resolution response telemetry:'];
    if (!morning) {
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
    } else if (activity.hrMeasurement) {
        const measurement = activity.hrMeasurement;
        const unverified = measurement.provenanceConfidence !== 'confirmed'
            || measurement.summaryCompatibility !== 'verified_same_effective_trace'
            || measurement.measurementConfidence === 'low'
            || measurement.measurementConfidence === 'unreliable'
            || measurement.measurementConfidence === 'unknown'
            || measurement.artifactFlags.some(flag => flag.includes('UNVERIFIED'));
        if (unverified) lines.push('  - HR Confidence: Unverified (Observational only)');
    }

    if (response.powerDurationPeaks.length > 0) {
        lines.push(`  - Power-duration peaks: ${response.powerDurationPeaks
            .map(peak => {
                const timing = detail === 'diagnostic' && peak.elapsedBeforeSeconds !== undefined
                    ? `, after ${formatDuration(peak.elapsedBeforeSeconds)} elapsed`
                    : '';
                return `${powerDurationLabel(peak.durationSeconds)} ${formatNumber(peak.powerWatts, 0)} W (${peak.confidence}${peak.activityHalf ? `, ${peak.activityHalf} half` : ''}${timing})`;
            })
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
    const orderedSegments = [...response.segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
    const visibleSegments = maxSegments === undefined ? orderedSegments : orderedSegments.slice(0, maxSegments);
    if (visibleSegments.length > 0) {
        const viewLimit = visibleSegments.length < response.segments.length
            ? `; this view shows first ${visibleSegments.length} persisted segments`
            : '';
        lines.push(`  - Segments: ${response.segmentCountTotal}${response.segmentsTruncated ? ` total; persisted first ${response.segments.length}` : ''}${viewLimit}`, '');
        if (detail === 'diagnostic') {
            lines.push(
                '  | # | Type | Identity | Start | Duration | Target | Avg/peaks power | HR avg/end/max | Cadence avg/max | Power thirds | Final-third HR | Confidence |',
                '  |---:|---|---|---:|---:|---|---|---|---|---|---|---|',
            );
        } else {
            lines.push(
                '  | # | Type | Identity | Duration | Target | Avg/peaks power | HR avg/end/max | Cadence avg/max | Power thirds | Confidence |',
                '  |---:|---|---|---:|---|---|---|---|---|---|',
            );
        }
        for (const segment of visibleSegments) {
            const target = formatPrescribedTarget(segment.prescribedTarget);
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
            if (detail === 'diagnostic') {
                const start = segment.startOffsetSeconds === undefined ? '—' : formatDuration(segment.startOffsetSeconds);
                const finalThirdHr = intervalHr.withheld
                    ? 'withheld'
                    : segment.lastThirdHrBpm === undefined ? '—' : `${formatNumber(segment.lastThirdHrBpm, 0)} bpm`;
                lines.push(`  | ${segment.segmentIndex} | ${segment.segmentType} | ${segment.identitySource} | ${start} | ${formatDuration(segment.durationSeconds)} | ${target} | ${power || '—'} W | ${hr}${hr === 'withheld' ? '' : ' bpm'} | ${cadence} rpm | ${thirds} W | ${finalThirdHr} | ${segment.evidenceConfidence} |`);
            } else {
                lines.push(`  | ${segment.segmentIndex} | ${segment.segmentType} | ${segment.identitySource} | ${formatDuration(segment.durationSeconds)} | ${target} | ${power || '—'} W | ${hr}${hr === 'withheld' ? '' : ' bpm'} | ${cadence} rpm | ${thirds} W | ${segment.evidenceConfidence} |`);
            }
        }
    }
    return lines;
}

function renderDiagnosticLaps(activity: NormalizedGarminActivity): string[] {
    const laps = [...(activity.laps ?? [])].sort((a, b) => a.lapIndex - b.lapIndex);
    if (laps.length === 0) return [];
    const running = normalizeModality(activity.type) === 'Running';
    const lines = running
        ? [
            '- Laps:',
            '',
            '  | Lap | Duration | Distance | Pace | Avg power | Avg HR |',
            '  |---:|---:|---:|---:|---:|---:|',
        ]
        : [
            '- Laps:',
            '',
            '  | Lap | Duration | Avg power | Avg HR |',
            '  |---:|---:|---:|---:|',
        ];
    for (const lap of laps) {
        const power = lap.averagePowerWatts === undefined ? '—' : `${formatNumber(lap.averagePowerWatts, 0)} W`;
        const hr = lap.averageHrBpm === undefined ? '—' : `${formatNumber(lap.averageHrBpm, 0)} bpm`;
        if (running) {
            const distance = lap.distanceMeters === undefined ? '—' : `${formatNumber(lap.distanceMeters / 1000, 2)} km`;
            lines.push(`  | ${lap.lapIndex} | ${formatDuration(lap.durationSeconds)} | ${distance} | ${pacePerKm(lap.averageSpeedMps)} | ${power} | ${hr} |`);
        } else {
            lines.push(`  | ${lap.lapIndex} | ${formatDuration(lap.durationSeconds)} | ${power} | ${hr} |`);
        }
    }
    return lines;
}

const QUALITY_SESSION_DOMAINS: ReadonlySet<ActivityStimulusDomain> = new Set(['tempo', 'threshold', 'vo2', 'anaerobic', 'mixed', 'race']);
const QUALITY_DETAIL_MAX_LAPS = 20;
const QUALITY_DETAIL_MAX_RESPONSE_SEGMENTS = 20;

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

function renderBoundedQualityLaps(activity: NormalizedGarminActivity, viewLabel: string): string[] {
    const laps = [...(activity.laps ?? [])].sort((a, b) => a.lapIndex - b.lapIndex);
    if (laps.length === 0) return [];
    const visible = laps.slice(0, QUALITY_DETAIL_MAX_LAPS);
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
        lines.push(`  - … ${laps.length - visible.length} additional lap(s) omitted from the ${viewLabel}; use diagnostic export for all laps.`);
    }
    return lines;
}

function isQualityCyclingOrRunning(activity: NormalizedGarminActivity): boolean {
    const modality = normalizeModality(activity.type);
    if (modality !== 'Cycling' && modality !== 'Running') return false;
    const domain = activity.stimulusDomain;
    const canonicalQuality = domain !== undefined && QUALITY_SESSION_DOMAINS.has(domain);
    const legacyHard = domain === undefined && activity.intensityTag === 'hard';
    return canonicalQuality || legacyHard;
}

function renderSessionDetail(activity: NormalizedGarminActivity, includeVariabilityIndex: boolean): string[] {
    const parts = [
        includeVariabilityIndex && isFiniteNumber(activity.variabilityIndex) ? `VI ${formatNumber(activity.variabilityIndex, 2)}` : null,
        isFiniteNumber(activity.maxHr) ? `max HR ${formatNumber(activity.maxHr, 0)} bpm` : null,
        isFiniteNumber(activity.trainingEffectAnaerobic) ? `anaerobic TE ${formatNumber(activity.trainingEffectAnaerobic, 1)}` : null,
        activity.primaryBenefit ? `primary benefit ${activity.primaryBenefit}` : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? [`- Session detail: ${parts.join(' · ')}`] : [];
}

function renderBoundedQualityActivityDetail(
    activity: NormalizedGarminActivity,
    viewLabel: string,
    view: 'morning' | 'planning' = 'planning',
): string[] {
    if (!isQualityCyclingOrRunning(activity)) return [];
    const modality = normalizeModality(activity.type);
    const detail: string[] = [
        ...renderSessionDetail(activity, true),
    ];

    const hasIntervalRows = (activity.activityResponse?.segments.length ?? 0) > 0 || (activity.laps?.length ?? 0) > 0;
    const includeZoneTables = view !== 'morning' || !hasIntervalRows;
    if (includeZoneTables && activity.powerInZones?.length) detail.push(...renderZones('Power zones', activity.powerInZones, 'W'));
    if (includeZoneTables && activity.hrInZones?.length) detail.push(...renderZones('Heart-rate zones', activity.hrInZones, 'bpm'));
    detail.push(...renderRunningDynamics(activity));

    if (activity.activityResponse) {
        detail.push(...renderActivityResponse(
            activity,
            QUALITY_DETAIL_MAX_RESPONSE_SEGMENTS,
            view === 'morning' ? 'morning' : 'bounded',
        ));
    }

    // For running, laps are the interval-resolution evidence currently persisted by this
    // exporter. For cycling, prefer semantic/native response evidence; legacy quality rides
    // fall back to bounded laps when the activityResponse sidecar is absent.
    if (modality === 'Running' || !activity.activityResponse) {
        detail.push(...renderBoundedQualityLaps(activity, viewLabel));
    }
    return detail;
}

/**
 * The morning handoff is intentionally compact except for yesterday's quality endurance
 * session. Tempo is quality even when #809 labels its stimulus intensity only "moderate";
 * hard-tagged cycling/running is also expanded for legacy records whose stimulusDomain is
 * absent. This selection is display-only and has no recommendation authority.
 */
export function renderMorningQualityActivityTelemetry(activity: NormalizedGarminActivity): string[] {
    const detail = renderBoundedQualityActivityDetail(activity, 'morning brief', 'morning');
    if (detail.length === 0) return [];
    return [
        '  - Quality-session detail (display-only):',
        ...detail.map(line => line.length === 0 ? '' : `    ${line}`),
    ];
}

/**
 * Block planning keeps the #811 information budget for ordinary sessions, but quality
 * cycling/running needs the same bounded execution evidence used to close the morning loop.
 * The 20-row caps preserve bounded growth; diagnostic remains the uncapped persisted view.
 */
export function renderPlanningQualityActivityTelemetry(
    activities: readonly NormalizedGarminActivity[],
): string {
    const rendered = [...activities]
        .sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId))
        .map(activity => ({ activity, detail: renderBoundedQualityActivityDetail(activity, 'block-planning export') }))
        .filter(item => item.detail.length > 0);
    if (rendered.length === 0) return '';

    const lines = [
        '### Quality-session execution detail (bounded)',
        '',
        `Quality cycling/running sessions are expanded with the same execution evidence as the morning handoff, capped at ${QUALITY_DETAIL_MAX_RESPONSE_SEGMENTS} semantic segments or ${QUALITY_DETAIL_MAX_LAPS} running/legacy laps per activity. Ordinary endurance/recovery sessions remain compact; use diagnostic export for every persisted row.`,
    ];
    for (const { activity, detail } of rendered) {
        const domain = activity.stimulusDomain && activity.stimulusDomain !== 'unknown'
            ? ` · ${activity.stimulusDomain}`
            : '';
        const cost = activity.sessionCost && activity.sessionCost !== 'unknown'
            ? ` · cost ${activity.sessionCost.replace('_', ' ')}`
            : '';
        lines.push(
            '',
            `#### ${activity.date} — ${formatActivityType(activity.type)} — ${activity.intensityTag}${domain}${cost}`,
            ...detail,
        );
    }
    return lines.join('\n');
}

/**
 * Full persisted activity detail for diagnostic analysis. Raw native samples remain outside
 * this boundary; this renderer exposes only the bounded normalized fields already hydrated
 * on the activity document.
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
        lines.push(...renderSessionDetail(activity, false));

        if (activity.powerInZones?.length) {
            lines.push(...renderZones('Power zones', activity.powerInZones, 'W'));
        }
        if (activity.hrInZones?.length) {
            lines.push(...renderZones('Heart-rate zones', activity.hrInZones, 'bpm'));
        }
        lines.push(...renderRunningDynamics(activity));
        if (activity.laps?.length) {
            lines.push(...renderDiagnosticLaps(activity));
        }
        if (activity.activityResponse) {
            lines.push(...renderActivityResponse(activity, undefined, 'diagnostic'));
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
            ? 'One line per activity with Garmin detail telemetry that has no semantic summary below. The uncapped persisted lap/response view is in the diagnostic export; bounded quality-session zones and execution detail may appear later in this planning section.'
            : 'One line per activity with Garmin detail telemetry. The uncapped persisted lap/response view is in the diagnostic export; bounded quality-session zones and execution detail may appear later in this planning section.',
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
 * planning representation: one-line ordinary-session digests plus bounded quality-session
 * execution detail. Diagnostic keeps the full persisted tables. The fallback append keeps
 * the handoff useful if the parent brief heading ever changes. */
export function injectActivityTelemetryIntoContextBrief(
    brief: string,
    activities: readonly NormalizedGarminActivity[],
    compact = false,
    response?: ResponseContext,
): string {
    // Issue #814: key sessions get a semantic summary. In the compact (planning) export it
    // replaces that session's one-line digest when at least one feature produced a value;
    // the bounded quality-session execution view may still follow as supporting evidence.
    // Diagnostic keeps every persisted table and adds the summaries after them.
    const summaries = response ? deriveKeySessionSummaries(activities, response) : [];
    const summaryText = response ? renderKeySessionSummaries(summaries, response) : '';
    const summarizedIds = new Set(summaries.filter(hasAvailableFeature).map(summary => summary.activity.activityId));
    const raw = compact ? renderCompactActivityTelemetry(activities, summarizedIds) : renderContextBriefActivityTelemetry(activities);
    const qualityDetail = compact ? renderPlanningQualityActivityTelemetry(activities) : '';
    const telemetry = [raw, summaryText, qualityDetail].filter(Boolean).join('\n\n');
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
