import { useEffect, useRef, useState } from 'react';
import { activityAnnotationService, type ActivityAnnotation } from '../services/activityAnnotationService';
import './ActivityLaps.css';

interface Props {
  userId: string;
  activityId: string;
  providerType: string;
  legacyRpe?: number | null;
}

function DetailsForm({ rpe, equipmentLabel, onSave, onCancel }: {
  rpe: number | null;
  equipmentLabel: string | null;
  onSave: (rpe: number | null, equipment: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [effort, setEffort] = useState(rpe === null ? '' : String(rpe));
  const [equipment, setEquipment] = useState(equipmentLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  return <form className="activity-details-form" onSubmit={async event => {
    event.preventDefault();
    const value = effort.trim() === '' ? null : Number(effort);
    if (value !== null && (!Number.isFinite(value) || value < 1 || value > 10)) {
      setError('Enter RPE from 1 to 10, or leave it blank.');
      return;
    }
    setError(null);
    setSaving(true);
    try { await onSave(value, equipment.trim() || null); }
    catch { setError('Activity details were not saved. Your entries are still here; try Save again.'); setSaving(false); }
  }}>
    <label>Whole-activity RPE (1–10, optional)
      <input ref={input} type="number" min="1" max="10" step="any" inputMode="decimal" value={effort}
        disabled={saving} onChange={event => setEffort(event.target.value)} />
    </label>
    <p>Rate the whole workout separately from individual laps. Leave blank if you did not record it.</p>
    <label>Actual equipment (optional)
      <input type="text" maxLength={100} placeholder="e.g. Airbike — Rogue/Assault" value={equipment}
        disabled={saving} onChange={event => setEquipment(event.target.value)} />
    </label>
    <div className="lap-power-actions">
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save activity details'}</button>
      <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

function ActivityDetails({ userId, activityId, providerType, legacyRpe }: Props) {
  const [annotation, setAnnotation] = useState<ActivityAnnotation | null>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const hasEdited = useRef(false);
  useEffect(() => {
    let cancelled = false;
    activityAnnotationService.getActivityAnnotation(userId, activityId).then(value => {
      if (!cancelled) { setAnnotation(value); setError(false); }
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [userId, activityId, retry]);
  useEffect(() => {
    if (!editing && hasEdited.current) editButton.current?.focus();
  }, [editing]);
  const rpe = annotation === null ? legacyRpe ?? null : annotation?.rpe ?? null;

  return <section className="activity-details" aria-label="Activity details">
    <h5>Activity details</h5>
    <p>Recorded by Garmin as: {providerType.replaceAll('_', ' ')}</p>
    {error ? <p role="alert">Activity details could not be loaded. <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>
      : annotation === undefined ? <p role="status">Loading activity details…</p> : <>
        <p>Whole-activity RPE: {rpe === null ? 'Not recorded' : `${rpe}/10 · manual`}</p>
        <p>Actual equipment: {annotation?.equipmentLabel ?? 'Not recorded'}</p>
        <button ref={editButton} type="button" disabled={editing}
          onClick={() => { hasEdited.current = true; setSaved(false); setEditing(true); }}>Edit activity details</button>
        {editing && <DetailsForm rpe={rpe} equipmentLabel={annotation?.equipmentLabel ?? null}
          onCancel={() => setEditing(false)} onSave={async (effort, equipment) => {
            await activityAnnotationService.saveActivityAnnotation(userId, activityId, { rpe: effort, equipmentLabel: equipment });
            setAnnotation({ rpe: effort, equipmentLabel: equipment, source: 'manual' });
            setEditing(false);
            setSaved(true);
          }} />}
        {saved && <p role="status">Activity details saved.</p>}
      </>}
  </section>;
}

export function ActivityDetailsEditor(props: Props) {
  return <ActivityDetails key={`${props.userId}:${props.activityId}`} {...props} />;
}
