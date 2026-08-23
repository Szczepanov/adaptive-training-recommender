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
          || (activity.exerciseSets?.length ?? 0) > 0
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

            {!hasDetail && <p className="activity-telemetry-empty">No zone or lap telemetry is available for this activity.</p>}
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
