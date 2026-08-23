import type { DataState } from '../engine/dataState';
import type { ActivityZoneBucket, NormalizedGarminActivity } from '../engine/models';
import './ActivityTelemetry.css';

interface ActivityTelemetryProps {
  state: DataState<NormalizedGarminActivity[]> | null;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return remainder > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes}:00`;
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

export function ActivityTelemetry({ state }: ActivityTelemetryProps) {
  if (state === null) return <p className="activity-telemetry-state">Loading recent activities…</p>;
  if (state.status === 'INVALID') return <p className="activity-telemetry-state error">Stored activity data is malformed and needs repair.</p>;
  if (state.status === 'UNAVAILABLE') return <p className="activity-telemetry-state error">Activity telemetry is temporarily unavailable. Retry the dashboard refresh.</p>;
  if (state.status === 'MISSING' || state.data.length === 0) return <p className="activity-telemetry-state">No activities were recorded in the last seven days.</p>;

  return (
    <div className="activity-telemetry-list">
      {[...state.data].reverse().map((activity) => {
        const hasDetail = (activity.powerInZones?.length ?? 0) > 0
          || (activity.hrInZones?.length ?? 0) > 0
          || (activity.laps?.length ?? 0) > 0
          || activity.normalizedPower !== undefined;
        return (
          <article className="activity-telemetry-card" key={activity.activityId}>
            <header>
              <div>
                <h4>{activity.type.replaceAll('_', ' ')}</h4>
                <p>{activity.date} · {activity.durationMin ?? '—'} min · {activity.intensityTag}</p>
              </div>
              {activity.normalizedPower !== undefined && (
                <div className="activity-power-summary" aria-label="Power summary">
                  <span><strong>{Math.round(activity.normalizedPower)}</strong> W NP</span>
                  {activity.intensityFactor !== undefined && <span><strong>{activity.intensityFactor.toFixed(2)}</strong> IF</span>}
                  {activity.variabilityIndex !== undefined && <span><strong>{activity.variabilityIndex.toFixed(2)}</strong> VI</span>}
                </div>
              )}
            </header>

            {!hasDetail && !activity.runningDynamics && <p className="activity-telemetry-empty">No zone or lap telemetry is available for this activity.</p>}
            {activity.runningDynamics !== undefined && (
              <section className="activity-dynamics" aria-label="Running Dynamics & Biomechanical Symmetry">
                <h5>Running Dynamics & Symmetry</h5>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {activity.runningDynamics.groundContactBalanceLeftPct != null && (
                    <div style={{ background: 'var(--bg-card, #1c1c28)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle, #2e2e3e)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9a9ab0)', display: 'block' }}>GCT Balance (L/R)</span>
                      <strong style={{ fontSize: '0.95rem', color: Math.abs(activity.runningDynamics.groundContactBalanceLeftPct - 50.0) <= 1.0 ? '#10b981' : '#f59e0b' }}>
                        {activity.runningDynamics.groundContactBalanceLeftPct.toFixed(1)}% L / {(100.0 - activity.runningDynamics.groundContactBalanceLeftPct).toFixed(1)}% R
                      </strong>
                    </div>
                  )}
                  {activity.runningDynamics.groundContactTimeMs != null && (
                    <div style={{ background: 'var(--bg-card, #1c1c28)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle, #2e2e3e)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9a9ab0)', display: 'block' }}>Ground Contact Time</span>
                      <strong style={{ fontSize: '0.95rem' }}>{Math.round(activity.runningDynamics.groundContactTimeMs)} ms</strong>
                    </div>
                  )}
                  {activity.runningDynamics.verticalOscillationCm != null && (
                    <div style={{ background: 'var(--bg-card, #1c1c28)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle, #2e2e3e)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9a9ab0)', display: 'block' }}>Vertical Oscillation</span>
                      <strong style={{ fontSize: '0.95rem' }}>{activity.runningDynamics.verticalOscillationCm.toFixed(1)} cm</strong>
                    </div>
                  )}
                  {activity.runningDynamics.verticalRatioPct != null && (
                    <div style={{ background: 'var(--bg-card, #1c1c28)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle, #2e2e3e)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9a9ab0)', display: 'block' }}>Vertical Ratio</span>
                      <strong style={{ fontSize: '0.95rem' }}>{activity.runningDynamics.verticalRatioPct.toFixed(1)}%</strong>
                    </div>
                  )}
                  {activity.runningDynamics.strideLengthM != null && (
                    <div style={{ background: 'var(--bg-card, #1c1c28)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle, #2e2e3e)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9a9ab0)', display: 'block' }}>Stride Length</span>
                      <strong style={{ fontSize: '0.95rem' }}>{activity.runningDynamics.strideLengthM.toFixed(2)} m</strong>
                    </div>
                  )}
                  {activity.runningDynamics.avgRunningPowerWatts != null && (
                    <div style={{ background: 'var(--bg-card, #1c1c28)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-subtle, #2e2e3e)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #9a9ab0)', display: 'block' }}>Running Power</span>
                      <strong style={{ fontSize: '0.95rem' }}>{activity.runningDynamics.avgRunningPowerWatts} W</strong>
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
          </article>
        );
      })}
    </div>
  );
}
