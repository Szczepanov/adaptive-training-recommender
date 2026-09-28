import { useState } from 'react';
import type { DataState } from '../engine/dataState';
import type { ActivityPrescribedTarget, ActivityResponseTelemetry, ActivitySegmentSummary, NormalizedGarminActivity } from '../engine/models';
import { copyActivityJsonToClipboard } from '../utils/activityJsonExport';
import {
  formatDuration,
  formatLapDistance,
  formatPace,
  formatRunningPower,
  formatTrainingEffectDescriptor,
  hasRunningDynamics,
  hrMeasurementDetail,
} from './activityTelemetryFormat';
import { ZoneBars } from './ZoneBars';
import './ActivityTelemetry.css';

interface ActivityTelemetryProps {
  state: DataState<NormalizedGarminActivity[]> | null;
  onReclassify?: (activityId: string) => void;
}

function humanizeTelemetryToken(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatMmpDuration(durationSeconds: number): string {
  if (durationSeconds < 60) return `${durationSeconds}s`;
  if (durationSeconds % 60 === 0) return `${durationSeconds / 60}m`;
  return formatDuration(durationSeconds);
}

function formatSourceResolution(response: ActivityResponseTelemetry): string[] {
  const entries: string[] = [];
  if (response.sourceResolution.powerSeconds !== undefined) entries.push(`Power source ${response.sourceResolution.powerSeconds} s`);
  if (response.sourceResolution.hrSeconds !== undefined) entries.push(`HR source ${response.sourceResolution.hrSeconds} s`);
  if (response.sourceResolution.cadenceSeconds !== undefined) entries.push(`Cadence source ${response.sourceResolution.cadenceSeconds} s`);
  return entries;
}

function formatPrescribedTarget(target: ActivityPrescribedTarget | undefined): string {
  if (target === undefined) return '—';
  const normalizedKind = target.kind.toLowerCase();

  if (normalizedKind === 'power_zone' && target.value !== undefined) {
    return `Power zone ${Math.round(target.value)}`;
  }

  if (target.text?.trim()) return target.text;

  const unit = normalizedKind === 'power_watts' || normalizedKind === 'power_range_watts'
    ? ' W'
    : normalizedKind.includes('cadence')
      ? ' rpm'
      : '';
  const fallbackLabel = humanizeTelemetryToken(target.kind);

  if (target.low !== undefined || target.high !== undefined) {
    const low = target.low !== undefined ? Math.round(target.low) : '—';
    const high = target.high !== undefined ? Math.round(target.high) : '—';
    const range = `${low}–${high}`;
    return unit ? `${range}${unit}` : `${fallbackLabel}: ${range}`;
  }
  if (target.value !== undefined) {
    const value = Math.round(target.value);
    return unit ? `${value}${unit}` : `${fallbackLabel}: ${value}`;
  }
  return fallbackLabel;
}

function segmentPeakText(segment: ActivitySegmentSummary): string | null {
  const peaks = [
    segment.peak1sPowerWatts !== undefined ? `1s ${Math.round(segment.peak1sPowerWatts)}` : null,
    segment.peak5sPowerWatts !== undefined ? `5s ${Math.round(segment.peak5sPowerWatts)}` : null,
    segment.peak10sPowerWatts !== undefined ? `10s ${Math.round(segment.peak10sPowerWatts)}` : null,
  ].filter((value): value is string => value !== null);
  return peaks.length > 0 ? `Peaks ${peaks.join(' / ')} W` : null;
}

function segmentSplitText(segment: ActivitySegmentSummary): string | null {
  const powerValues = [
    segment.firstThirdPowerWatts,
    segment.middleThirdPowerWatts,
    segment.lastThirdPowerWatts,
  ];
  const hasAllPowerThirds = powerValues.every((value) => value !== undefined);
  const parts: string[] = [];
  if (hasAllPowerThirds) {
    parts.push(`${powerValues.map((value) => Math.round(value as number)).join(' → ')} W`);
  }
  if (segment.lastThirdHrBpm !== undefined) parts.push(`${Math.round(segment.lastThirdHrBpm)} bpm final ⅓`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function steadyHalfSummary(response: ActivityResponseTelemetry): string | null {
  const halves = response.steadyHalves;
  if (halves === undefined) return null;

  const parts: string[] = [];
  if (halves.firstPowerWatts !== undefined && halves.secondPowerWatts !== undefined) {
    parts.push(`Power ${Math.round(halves.firstPowerWatts)} → ${Math.round(halves.secondPowerWatts)} W`);
  }
  if (halves.firstHrBpm !== undefined && halves.secondHrBpm !== undefined) {
    parts.push(`HR ${Math.round(halves.firstHrBpm)} → ${Math.round(halves.secondHrBpm)} bpm`);
  }
  if (halves.firstCadenceRpm !== undefined && halves.secondCadenceRpm !== undefined) {
    parts.push(`Cadence ${Math.round(halves.firstCadenceRpm)} → ${Math.round(halves.secondCadenceRpm)} rpm`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function ActivityTelemetry({ state, onReclassify }: ActivityTelemetryProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (state === null) return <p className="activity-telemetry-state">Loading recent activities…</p>;
  if (state.status === 'INVALID') return <p className="activity-telemetry-state error">Stored activity data is malformed and needs repair.</p>;
  if (state.status === 'UNAVAILABLE') return <p className="activity-telemetry-state error">Activity telemetry is temporarily unavailable. Retry the dashboard refresh.</p>;
  if (state.status === 'MISSING' || state.data.length === 0) return <p className="activity-telemetry-state">No activities were recorded in the last seven days.</p>;

  const handleCopyActivityJson = async (activity: NormalizedGarminActivity) => {
    try {
      await copyActivityJsonToClipboard(activity);
      setCopiedId(activity.activityId);
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === activity.activityId ? null : curr));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy activity JSON', err);
    }
  };

  return (
    <div className="activity-telemetry-list">
      {[...state.data].reverse().map((activity) => {
        const runningDynamics = hasRunningDynamics(activity.runningDynamics) ? activity.runningDynamics : undefined;
        const runningPower = runningDynamics ? formatRunningPower(runningDynamics) : null;
        const hasDetail = (activity.powerInZones?.length ?? 0) > 0
          || (activity.hrInZones?.length ?? 0) > 0
          || (activity.laps?.length ?? 0) > 0
          || (activity.exerciseSets?.length ?? 0) > 0
          || activity.normalizedPower !== undefined
          || runningDynamics !== undefined
          || activity.activityResponse !== undefined;
        const trainingEffectDescriptor = activity.primaryBenefit ?? activity.trainingEffectLabel;
        const hrDetail = hrMeasurementDetail(activity);
        const steadySummary = activity.activityResponse !== undefined ? steadyHalfSummary(activity.activityResponse) : null;
        const trainingResponseMetrics = [
          activity.trainingEffectAerobic != null
            ? `Aerobic TE ${activity.trainingEffectAerobic.toFixed(1)}`
            : null,
          activity.trainingEffectAnaerobic != null
            ? `Anaerobic TE ${activity.trainingEffectAnaerobic.toFixed(1)}`
            : null,
          activity.epoc != null ? `EPOC ${Math.round(activity.epoc)}` : null,
          activity.recoveryTimeHours != null ? `Rec ${activity.recoveryTimeHours}h` : null,
        ].filter((metric): metric is string => metric !== null);

        const telemetryBadges: string[] = [];
        if ((activity.powerInZones?.length ?? 0) > 0 || activity.normalizedPower !== undefined) telemetryBadges.push('⚡ Power');
        if ((activity.hrInZones?.length ?? 0) > 0) telemetryBadges.push('❤️ HR Zones');
        if (runningDynamics !== undefined) telemetryBadges.push('🏃 Dynamics');
        if ((activity.exerciseSets?.length ?? 0) > 0) telemetryBadges.push('🏋️ Sets & Reps');
        if ((activity.laps?.length ?? 0) > 0) telemetryBadges.push('⏱️ Laps');
        if (activity.activityResponse !== undefined) telemetryBadges.push('🎯 Segments & MMP');

        return (
          <article className="activity-telemetry-card" key={activity.activityId}>
            <header>
              <div>
                <h4>{activity.type.replaceAll('_', ' ')}</h4>
                <p>
                  {activity.date} · {activity.durationMin ?? '—'} min · {activity.intensityTag}
                  {trainingEffectDescriptor
                    ? ` · ${formatTrainingEffectDescriptor(trainingEffectDescriptor)}`
                    : ''}
                </p>
                {trainingResponseMetrics.length > 0 && (
                  <p className="activity-te-metrics" style={{ fontSize: '0.8rem', color: 'var(--text-muted, #71717a)', marginTop: '0.2rem' }}>
                    {trainingResponseMetrics.join(' · ')}
                  </p>
                )}
                {telemetryBadges.length > 0 && (
                  <div className="activity-telemetry-badges" aria-label="Detailed telemetry categories">
                    {telemetryBadges.map((badge) => (
                      <span key={badge} className="activity-telemetry-badge">{badge}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="activity-header-right">
                {activity.normalizedPower !== undefined && (
                  <div className="activity-power-summary" aria-label="Power summary">
                    <span><strong>{Math.round(activity.normalizedPower)}</strong> W NP</span>
                    {activity.intensityFactor !== undefined && <span><strong>{activity.intensityFactor.toFixed(2)}</strong> IF</span>}
                    {activity.variabilityIndex !== undefined && <span><strong>{activity.variabilityIndex.toFixed(2)}</strong> VI</span>}
                  </div>
                )}
                <div className="activity-card-actions">
                  <button
                    type="button"
                    className="btn-copy-activity-json"
                    onClick={() => handleCopyActivityJson(activity)}
                    aria-label={`Copy JSON for ${activity.type} from ${activity.date}`}
                    title="Copy structured activity JSON to clipboard for AI agent planning"
                  >
                    {copiedId === activity.activityId ? '✓ Copied JSON' : '📋 Copy JSON'}
                  </button>
                  {onReclassify && (
                    <button
                      type="button"
                      className="btn-reclassify-activity"
                      onClick={() => onReclassify(activity.activityId)}
                      aria-label={`Correct or reclassify ${activity.type} from ${activity.date}`}
                    >
                      ✏️ Correct
                    </button>
                  )}
                </div>
              </div>
            </header>

            {hrDetail !== null && (
              <section className="activity-hr-fidelity" aria-label="Heart-rate measurement quality">
                <h5>Heart-rate measurement</h5>
                <p><strong>{hrDetail.status}</strong></p>
                <p className="activity-hr-fidelity-reason">{hrDetail.reason}</p>
              </section>
            )}
            {!hasDetail && <p className="activity-telemetry-empty">No zone, lap, or running-dynamics telemetry is available for this activity.</p>}
            {runningDynamics !== undefined && (
              <section className="activity-dynamics" aria-label="Running Dynamics & Biomechanical Symmetry">
                <h5>Running Dynamics & Symmetry</h5>
                <div className="activity-dynamics-grid">
                  {runningDynamics.groundContactBalanceLeftPct != null && (
                    <div className="activity-dynamics-metric">
                      <span className="activity-dynamics-label">GCT Balance (L/R)</span>
                      <strong>{runningDynamics.groundContactBalanceLeftPct.toFixed(1)}% L / {(100.0 - runningDynamics.groundContactBalanceLeftPct).toFixed(1)}% R</strong>
                    </div>
                  )}
                  {runningDynamics.groundContactTimeMs != null && (
                    <div className="activity-dynamics-metric">
                      <span className="activity-dynamics-label">Ground Contact Time</span>
                      <strong>{Math.round(runningDynamics.groundContactTimeMs)} ms</strong>
                    </div>
                  )}
                  {runningDynamics.verticalOscillationCm != null && (
                    <div className="activity-dynamics-metric">
                      <span className="activity-dynamics-label">Vertical Oscillation</span>
                      <strong>{runningDynamics.verticalOscillationCm.toFixed(1)} cm</strong>
                    </div>
                  )}
                  {runningDynamics.verticalRatioPct != null && (
                    <div className="activity-dynamics-metric">
                      <span className="activity-dynamics-label">Vertical Ratio</span>
                      <strong>{runningDynamics.verticalRatioPct.toFixed(1)}%</strong>
                    </div>
                  )}
                  {runningDynamics.strideLengthM != null && (
                    <div className="activity-dynamics-metric">
                      <span className="activity-dynamics-label">Stride Length</span>
                      <strong>{runningDynamics.strideLengthM.toFixed(2)} m</strong>
                    </div>
                  )}
                  {runningPower !== null && (
                    <div className="activity-dynamics-metric">
                      <span className="activity-dynamics-label">Running Power</span>
                      <strong>{runningPower}</strong>
                    </div>
                  )}
                </div>
              </section>
            )}
            {activity.powerInZones !== undefined && activity.powerInZones.length > 0 && (
              <ZoneBars title="Power zones" unit="W" zones={activity.powerInZones} />
            )}
            {activity.hrInZones !== undefined && activity.hrInZones.length > 0 && (
              <ZoneBars title="Heart-rate zones" unit="bpm" zones={activity.hrInZones} />
            )}
            {activity.laps !== undefined && activity.laps.length > 0 && (
              <section className="activity-laps" aria-label="Lap summaries">
                <h5>Lap summaries</h5>
                <div className="activity-lap-table-wrap">
                  <table>
                    <thead><tr><th>Lap</th><th>Duration</th><th>Distance</th><th>Pace</th><th>Avg power</th><th>Avg HR</th></tr></thead>
                    <tbody>
                      {activity.laps.map((lap) => (
                        <tr key={lap.lapIndex}>
                          <td>{lap.lapIndex}</td>
                          <td>{formatDuration(lap.durationSeconds)}</td>
                          <td>{lap.distanceMeters !== undefined ? formatLapDistance(lap.distanceMeters) : '—'}</td>
                          <td>{lap.averageSpeedMps !== undefined ? formatPace(lap.averageSpeedMps) : '—'}</td>
                          <td>{lap.averagePowerWatts !== undefined ? `${Math.round(lap.averagePowerWatts)} W` : '—'}</td>
                          <td>{lap.averageHrBpm !== undefined ? `${Math.round(lap.averageHrBpm)} bpm` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {activity.exerciseSets !== undefined && activity.exerciseSets.length > 0 && (
              <section className="activity-exercise-sets" aria-label="Exercise sets">
                <h5>Strength sets &amp; reps</h5>
                <div className="activity-lap-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Set</th>
                        <th>Exercise</th>
                        <th>Reps</th>
                        <th>Weight</th>
                        <th>Work / Rest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.exerciseSets.map((set, idx) => (
                        <tr key={idx}>
                          <td>{set.setOrder + 1}{set.setType && set.setType !== 'active' ? ` (${set.setType})` : ''}</td>
                          <td>{(set.exerciseName || set.exerciseCategory || 'Exercise').replaceAll('_', ' ')}</td>
                          <td>{set.repetitionCount != null ? set.repetitionCount : '—'}</td>
                          <td>{set.weightKg != null ? `${set.weightKg} kg` : '—'}</td>
                          <td>
                            {set.durationSeconds != null ? `${Math.round(set.durationSeconds)}s` : '—'}
                            {set.restDurationSeconds != null ? ` / ${Math.round(set.restDurationSeconds)}s rest` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {activity.activityResponse !== undefined && (
              <details className="activity-response-telemetry">
                <summary>
                  Multi-resolution session analysis
                  <span className="activity-response-summary">
                    {activity.activityResponse.segmentCountTotal} segments · {activity.activityResponse.powerDurationPeaks.length} MMP windows
                  </span>
                </summary>
                <div className="activity-response-body">
                  <p className="activity-response-provenance">
                    Observational telemetry · {activity.activityResponse.derivationVersion}
                    {formatSourceResolution(activity.activityResponse).length > 0
                      ? ` · ${formatSourceResolution(activity.activityResponse).join(' · ')}`
                      : ' · source cadence unavailable'}
                  </p>
                  {activity.activityResponse.segmentsTruncated && (
                    <p className="activity-response-truncation">
                      Showing {activity.activityResponse.segments.length} of {activity.activityResponse.segmentCountTotal} semantic segments.
                    </p>
                  )}
                  {activity.activityResponse.powerDurationPeaks.length > 0 && (
                    <section className="activity-response-subsection" aria-label="Mean maximal power peaks">
                      <h5>Mean maximal power</h5>
                      <ul className="activity-mmp-grid">
                        {activity.activityResponse.powerDurationPeaks.map((peak) => (
                          <li key={peak.durationSeconds} className="activity-mmp-peak">
                            <span>{formatMmpDuration(peak.durationSeconds)}</span>
                            <strong>{Math.round(peak.powerWatts)} W</strong>
                            <span>{peak.confidence} confidence</span>
                            {(peak.activityHalf !== undefined || peak.elapsedBeforeSeconds !== undefined) && (
                              <span>
                                {peak.activityHalf !== undefined ? `${peak.activityHalf} half` : 'timing available'}
                                {peak.elapsedBeforeSeconds !== undefined ? ` · after ${formatDuration(peak.elapsedBeforeSeconds)}` : ''}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {steadySummary !== null && (
                    <section className="activity-response-subsection" aria-label="Steady first and second half comparison">
                      <h5>Steady halves</h5>
                      <p className="activity-steady-halves">{steadySummary}</p>
                    </section>
                  )}
                  {activity.activityResponse.segments.length > 0 && (
                    <section className="activity-response-subsection" aria-label="Semantic segment telemetry">
                      <h5>Semantic segments</h5>
                      <p className="activity-table-scroll-hint">Swipe horizontally to inspect all segment evidence.</p>
                      <div className="activity-lap-table-wrap">
                        <table className="activity-response-table" aria-label="Semantic segment telemetry">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Type</th>
                              <th>Identity</th>
                              <th>Start</th>
                              <th>Duration</th>
                              <th>Prescribed</th>
                              <th>Performed power</th>
                              <th>Heart rate</th>
                              <th>Cadence</th>
                              <th>Within-segment</th>
                              <th>Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activity.activityResponse.segments.map((segment) => {
                              const peakText = segmentPeakText(segment);
                              const splitText = segmentSplitText(segment);
                              return (
                                <tr key={segment.segmentIndex}>
                                  <td>{segment.segmentIndex}</td>
                                  <td>{humanizeTelemetryToken(segment.segmentType)}</td>
                                  <td>{humanizeTelemetryToken(segment.identitySource)}</td>
                                  <td>{segment.startOffsetSeconds !== undefined ? formatDuration(segment.startOffsetSeconds) : '—'}</td>
                                  <td>{formatDuration(segment.durationSeconds)}</td>
                                  <td>{formatPrescribedTarget(segment.prescribedTarget)}</td>
                                  <td>
                                    <span className="activity-response-cell-lines">
                                      <span>{segment.averagePowerWatts !== undefined ? `${Math.round(segment.averagePowerWatts)} W avg` : '—'}</span>
                                      {peakText !== null && <span>{peakText}</span>}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="activity-response-cell-lines">
                                      <span>{segment.averageHrBpm !== undefined ? `${Math.round(segment.averageHrBpm)} bpm avg` : '—'}</span>
                                      {segment.endHrBpm !== undefined && <span>{Math.round(segment.endHrBpm)} bpm end</span>}
                                      {segment.maxHrBpm !== undefined && <span>{Math.round(segment.maxHrBpm)} bpm max</span>}
                                    </span>
                                  </td>
                                  <td>
                                    <span className="activity-response-cell-lines">
                                      <span>{segment.averageCadenceRpm !== undefined ? `${Math.round(segment.averageCadenceRpm)} rpm avg` : '—'}</span>
                                      {segment.maxCadenceRpm !== undefined && <span>{Math.round(segment.maxCadenceRpm)} rpm max</span>}
                                    </span>
                                  </td>
                                  <td>{splitText ?? '—'}</td>
                                  <td>{segment.evidenceConfidence} confidence</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </div>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}
