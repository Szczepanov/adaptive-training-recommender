import { useState } from 'react';
import type { DataState } from '../engine/dataState';
import type { ActivityZoneBucket, NormalizedGarminActivity, RunningDynamics } from '../engine/models';
import { copyActivityJsonToClipboard } from '../utils/activityJsonExport';
import './ActivityTelemetry.css';

interface ActivityTelemetryProps {
  state: DataState<NormalizedGarminActivity[]> | null;
  onReclassify?: (activityId: string) => void;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return remainder > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes}:00`;
}

function hasRunningDynamics(dynamics: RunningDynamics | undefined): dynamics is RunningDynamics {
  return dynamics !== undefined && Object.values(dynamics).some((value) => value != null);
}

function formatRunningPower(dynamics: RunningDynamics): string | null {
  const parts: string[] = [];
  if (dynamics.avgRunningPowerWatts != null) parts.push(`${Math.round(dynamics.avgRunningPowerWatts)} W avg`);
  if (dynamics.maxRunningPowerWatts != null) parts.push(`${Math.round(dynamics.maxRunningPowerWatts)} W max`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatTrainingEffectDescriptor(value: string): string {
  return value.replaceAll('_', ' ');
}

function humanizeHrReason(value: string): string {
  const known: Record<string, string> = {
    ISOLATED_SPIKE: 'isolated spikes',
    REPEATED_DROPOUT: 'repeated dropouts',
    LONG_GAP: 'long gaps',
    CADENCE_LOCK_SUSPECTED: 'possible cadence lock',
    PROVENANCE_AMBIGUOUS: 'ambiguous source provenance',
    SUMMARY_TRACE_DISCORDANCE: 'summary/trace mismatch',
  };
  return known[value] ?? value.replaceAll('_', ' ').toLowerCase();
}

function hrMeasurementDetail(activity: NormalizedGarminActivity): { status: string; reason: string } | null {
  const hasHrSummary = activity.averageHr !== null
    || (activity.hrInZones?.length ?? 0) > 0
    || activity.activityTrainingLoad !== null
    || activity.trainingEffectAerobic !== null
    || activity.trainingEffectAnaerobic !== null;
  const measurement = activity.hrMeasurement;
  if (!measurement) {
    return hasHrSummary
      ? { status: 'Not assessed', reason: 'No fidelity assessment is available for this activity.' }
      : null;
  }

  const status = {
    high: 'High confidence',
    moderate: 'Moderate confidence',
    low: 'Low confidence',
    unreliable: 'Unreliable',
    unknown: 'Assessment incomplete',
  }[measurement.measurementConfidence];
  const evidence: string[] = [];
  if (measurement.sourceForActivity === 'wrist') evidence.push('wrist optical HR');
  if (measurement.sourceForActivity === 'external') evidence.push('external HR source');
  if (measurement.sourceForActivity === 'mixed_possible') evidence.push('possibly mixed HR source');
  if (measurement.activityMotionRisk === 'high') evidence.push('high arm-motion risk');
  evidence.push(...measurement.artifactFlags.map(humanizeHrReason));
  evidence.push(...measurement.reasons.map(humanizeHrReason));
  const reason = [...new Set(evidence)].slice(0, 3).join(' + ');
  return { status, reason: reason || 'Compact trace-quality assessment is available.' };
}

function ZoneBars({ title, unit, zones }: { title: string; unit: string; zones: ActivityZoneBucket[] }) {
  const total = zones.reduce((sum, zone) => sum + zone.secondsInZone, 0);
  return (
    <section className="activity-zone-section" aria-label={title}>
      <h5>{title}</h5>
      <div className="activity-zone-list">
        {zones.map((zone) => {
          const percent = total > 0 ? (zone.secondsInZone / total) * 100 : 0;
          return (
            <div className="activity-zone-row" key={zone.zoneNumber}>
              <span className="activity-zone-label">Z{zone.zoneNumber}</span>
              <div className="activity-zone-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
              <span className="activity-zone-value">
                {formatDuration(zone.secondsInZone)}
                {zone.lowBoundary !== undefined ? ` · ≥${zone.lowBoundary} ${unit}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
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
          || runningDynamics !== undefined;
        const trainingEffectDescriptor = activity.primaryBenefit ?? activity.trainingEffectLabel;
        const hrDetail = hrMeasurementDetail(activity);
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
                    <thead><tr><th>Lap</th><th>Duration</th><th>Avg power</th><th>Avg HR</th></tr></thead>
                    <tbody>
                      {activity.laps.map((lap) => (
                        <tr key={lap.lapIndex}>
                          <td>{lap.lapIndex}</td>
                          <td>{formatDuration(lap.durationSeconds)}</td>
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
          </article>
        );
      })}
    </div>
  );
}
