import { useEffect, useRef, useState } from 'react';
import type { ActivityLapSummary } from '../engine/models';
import { activityAnnotationService, type LapAnnotation } from '../services/activityAnnotationService';
import { formatDuration, formatLapDistance, formatPace } from './activityTelemetryFormat';
import './ActivityLaps.css';

interface ActivityLapsProps {
  activity: { activityId: string; laps?: ActivityLapSummary[] };
  userId?: string;
}

function LapPowerEditor({ value, rpe, lapIndex, onSave, onCancel }: {
  value: number | undefined;
  rpe: number | null;
  lapIndex: number;
  onSave: (value: number | null, rpe: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const [effort, setEffort] = useState(rpe === null ? '' : String(rpe));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  return <form className="lap-power-editor" onSubmit={async event => {
    event.preventDefault();
    const watts = draft.trim() === '' ? null : Number(draft);
    const perceivedEffort = effort.trim() === '' ? null : Number(effort);
    if (watts !== null && (!Number.isFinite(watts) || watts < 0 || watts > 10000)) {
      setError('Enter average power from 0 to 10,000 W, or leave blank to remove it.');
      return;
    }
    if (perceivedEffort !== null && (!Number.isFinite(perceivedEffort) || perceivedEffort < 1 || perceivedEffort > 10)) {
      setError('Enter RPE from 1 to 10, or leave it blank.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(watts, perceivedEffort);
    } catch {
      setError('Lap details were not saved. Your entries are still here; try Save again.');
      setSaving(false);
    }
  }}>
    <label>
      Average power (W)
      <input ref={input} type="number" min="0" max="10000" step="any" inputMode="decimal"
        aria-label={`Lap ${lapIndex} average power (W)`} value={draft} disabled={saving}
        onChange={event => setDraft(event.target.value)} />
    </label>
    <label>Lap RPE (1–10, optional)
      <input type="number" min="1" max="10" step="any" inputMode="decimal"
        aria-label={`Lap ${lapIndex} RPE (1–10)`} value={effort} disabled={saving}
        onChange={event => setEffort(event.target.value)} />
    </label>
    <span>Leave unrecorded values blank. Clearing a field removes its manual value.</span>
    <div className="lap-power-actions">
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

function LapTable({ activity, userId }: ActivityLapsProps) {
  const [annotations, setAnnotations] = useState<Record<string, LapAnnotation> | null>(userId ? null : {});
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [savedLap, setSavedLap] = useState<number | null>(null);
  const editButton = useRef<HTMLButtonElement | null>(null);
  const focusLap = useRef<number | null>(null);
  useEffect(() => {
    if (editing === null) editButton.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    activityAnnotationService.getLapAnnotations(userId, activity.activityId).then(result => {
      if (!cancelled) { setAnnotations(result); setLoadError(false); }
    }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [userId, activity.activityId, retry]);

  const closeEditor = () => {
    setEditing(null);
  };

  return <section className="activity-laps" aria-label="Lap summaries">
    <h5>Lap summaries</h5>
    {userId && <p className="lap-power-help">Add average watts and RPE for the laps you recorded. Leave warm-up, rest and cooldown values blank if unknown. Manual entries are saved separately from Garmin.</p>}
    {loadError ? <p role="alert">Manual lap details could not be loaded. <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
      : annotations === null && <p role="status">Loading manual lap details…</p>}
    {savedLap !== null && <p role="status">Details saved for lap {savedLap}.</p>}
    <div className="activity-lap-table-wrap">
      <table>
        <thead><tr><th scope="col">Lap</th><th scope="col">Duration</th><th scope="col">Distance</th><th scope="col">Pace</th><th scope="col">Avg power / RPE</th><th scope="col">Avg HR</th></tr></thead>
        <tbody>{activity.laps?.map(lap => {
          const manual = annotations?.[String(lap.lapIndex)]?.averagePowerWatts ?? undefined;
          const rpe = annotations?.[String(lap.lapIndex)]?.rpe ?? null;
          const power = manual ?? lap.averagePowerWatts;
          return <tr key={lap.lapIndex}>
            <th scope="row">{lap.lapIndex}</th>
            <td data-label="Duration">{formatDuration(lap.durationSeconds)}</td>
            <td data-label="Distance">{lap.distanceMeters !== undefined ? formatLapDistance(lap.distanceMeters) : '—'}</td>
            <td data-label="Pace">{lap.averageSpeedMps !== undefined ? formatPace(lap.averageSpeedMps) : '—'}</td>
            <td data-label="Avg power / RPE">
              {editing === lap.lapIndex ? <LapPowerEditor value={manual} rpe={rpe} lapIndex={lap.lapIndex}
                onCancel={closeEditor} onSave={async (watts, effort) => {
                  await activityAnnotationService.saveLapAnnotation(userId!, activity.activityId, lap.lapIndex, { averagePowerWatts: watts, rpe: effort });
                  setAnnotations(previous => {
                    const next = { ...previous };
                    if (watts === null && effort === null) delete next[String(lap.lapIndex)];
                    else next[String(lap.lapIndex)] = { averagePowerWatts: watts, rpe: effort, source: 'manual' };
                    return next;
                  });
                  setSavedLap(lap.lapIndex);
                  closeEditor();
                }} /> : <>
                <span>{power !== undefined ? `${Math.round(power)} W` : '—'}{manual !== undefined ? ' · manual' : ''}</span>
                {rpe !== null && <small className="lap-power-provider">RPE {rpe}/10 · manual</small>}
                {manual !== undefined && lap.averagePowerWatts !== undefined && <small className="lap-power-provider">Garmin: {Math.round(lap.averagePowerWatts)} W</small>}
                {userId && annotations !== null && !loadError && <button type="button" className="lap-power-edit"
                  ref={button => { if (focusLap.current === lap.lapIndex) editButton.current = button; }}
                  disabled={editing !== null} aria-label={`Edit lap ${lap.lapIndex} details`}
                  onClick={() => { focusLap.current = lap.lapIndex; setSavedLap(null); setEditing(lap.lapIndex); }}>Edit watts / RPE</button>}
              </>}
            </td>
            <td data-label="Avg HR">{lap.averageHrBpm !== undefined ? `${Math.round(lap.averageHrBpm)} bpm` : '—'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

export function ActivityLaps(props: ActivityLapsProps) {
  if (!props.activity.laps?.length) return null;
  return <LapTable key={`${props.userId ?? ''}:${props.activity.activityId}`} {...props} />;
}
