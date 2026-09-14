import React, { useState } from 'react';
import type {
  AnthropometryEntry,
  AnthropometryMeasurementContext,
  AnthropometryMeasurementItem,
  AnthropometryMetricId,
  Laterality,
} from '../../anthropometry/models';
import {
  ANTHROPOMETRY_PROTOCOL_V1,
  CORE_WEEKLY_METRIC_IDS,
  LIMB_METRIC_IDS,
  METRIC_DISPLAY_LABELS,
  OPTIONAL_EXPANDABLE_METRIC_IDS,
  SECONDARY_METRIC_IDS,
} from '../../anthropometry/models';
import {
  deriveObservedAtForLocalDate,
  exceedsCircumferenceTolerance,
  summarizeMeasurementItem,
} from '../../anthropometry/protocol';
import { anthropometryService } from '../../services/anthropometryService';
import { getLocalDateString } from '../../utils/localDate';
import { getErrorMessage } from '../../utils/errors';

export interface LogMeasurementsModalProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** If present, indicates provider weight is already synced today */
  todayProviderWeightKg?: number | null;
  /** Existing entry to correct/edit */
  entryToEdit?: AnthropometryEntry | null;
}

interface MetricFormState {
  enabled: boolean;
  laterality: Laterality;
  r1: string;
  r2: string;
  r3: string;
}

const INITIAL_METRIC_STATE: MetricFormState = {
  enabled: false,
  laterality: 'unspecified',
  r1: '',
  r2: '',
  r3: '',
};

export const LogMeasurementsModal: React.FC<LogMeasurementsModalProps> = ({
  userId,
  isOpen,
  onClose,
  onSaved,
  todayProviderWeightKg,
  entryToEdit,
}) => {
  const isEditing = Boolean(entryToEdit);
  const [date, setDate] = useState<string>(entryToEdit?.date || getLocalDateString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Context fields
  const [morningPostVoidPreIntake, setMorningPostVoidPreIntake] = useState<boolean>(
    entryToEdit?.context.morningPostVoidPreIntake ?? true
  );
  const [trainingBeforeMeasurement, setTrainingBeforeMeasurement] = useState<boolean>(
    entryToEdit?.context.trainingBeforeMeasurement ?? false
  );
  const [respiratoryState, setRespiratoryState] = useState<'relaxed_normal_expiration' | 'other'>(
    entryToEdit?.context.respiratoryState ?? 'relaxed_normal_expiration'
  );

  // Manual body mass state
  const existingWeightItem = entryToEdit?.measurements.find(m => m.metricId === 'body_mass_kg');
  const [showManualWeight, setShowManualWeight] = useState<boolean>(
    Boolean(existingWeightItem) || !todayProviderWeightKg
  );
  const [manualWeightKg, setManualWeightKg] = useState<string>(
    existingWeightItem ? String(existingWeightItem.value) : ''
  );

  // Circumference metrics map
  const [metricStates, setMetricStates] = useState<Record<AnthropometryMetricId, MetricFormState>>(() => {
    const initial: Partial<Record<AnthropometryMetricId, MetricFormState>> = {};

    // If editing, populate from entry
    if (entryToEdit) {
      for (const item of entryToEdit.measurements) {
        if (item.metricId === 'body_mass_kg') continue;
        initial[item.metricId] = {
          enabled: true,
          laterality: item.laterality ?? 'unspecified',
          r1: item.readings[0] != null ? String(item.readings[0]) : '',
          r2: item.readings[1] != null ? String(item.readings[1]) : '',
          r3: item.readings[2] != null ? String(item.readings[2]) : '',
        };
      }
    }

    // Default core weekly enabled if not editing
    for (const id of CORE_WEEKLY_METRIC_IDS) {
      if (!initial[id]) {
        initial[id] = { ...INITIAL_METRIC_STATE, enabled: !entryToEdit };
      }
    }
    for (const id of SECONDARY_METRIC_IDS) {
      if (!initial[id]) {
        initial[id] = { ...INITIAL_METRIC_STATE, enabled: false, laterality: 'right' };
      }
    }
    for (const id of OPTIONAL_EXPANDABLE_METRIC_IDS) {
      if (!initial[id]) {
        const isLimb = LIMB_METRIC_IDS.includes(id);
        initial[id] = { ...INITIAL_METRIC_STATE, enabled: false, laterality: isLimb ? 'right' : 'unspecified' };
      }
    }
    return initial as Record<AnthropometryMetricId, MetricFormState>;
  });

  const [showOptionalGroup, setShowOptionalGroup] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleMetricToggle = (id: AnthropometryMetricId) => {
    setMetricStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        enabled: !prev[id]?.enabled,
      },
    }));
  };

  const handleMetricFieldChange = (
    id: AnthropometryMetricId,
    field: keyof MetricFormState,
    val: string | boolean | Laterality
  ) => {
    setMetricStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: val,
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const measurements: AnthropometryMeasurementItem[] = [];

      // 1. Manual weight if enabled
      if (showManualWeight && manualWeightKg.trim()) {
        const wVal = parseFloat(manualWeightKg);
        if (isNaN(wVal) || wVal <= 0) {
          throw new Error('Manual body mass must be a positive number in kg');
        }
        measurements.push(summarizeMeasurementItem('body_mass_kg', [wVal]));
      }

      // 2. Circumference measurements
      for (const [mId, state] of Object.entries(metricStates) as [AnthropometryMetricId, MetricFormState][]) {
        if (!state.enabled) continue;
        const r1Num = parseFloat(state.r1);
        const r2Num = parseFloat(state.r2);

        if (isNaN(r1Num) || isNaN(r2Num) || r1Num <= 0 || r2Num <= 0) {
          throw new Error(`Please provide both Reading 1 and Reading 2 for ${METRIC_DISPLAY_LABELS[mId]}`);
        }

        const readings = [r1Num, r2Num];
        const pairExceeded = exceedsCircumferenceTolerance(r1Num, r2Num);
        if (pairExceeded) {
          const r3Num = parseFloat(state.r3);
          if (isNaN(r3Num) || r3Num <= 0) {
            throw new Error(`The readings for ${METRIC_DISPLAY_LABELS[mId]} differed by more than tolerance. Please record a 3rd reading.`);
          }
          readings.push(r3Num);
        }

        measurements.push(summarizeMeasurementItem(mId, readings, state.laterality));
      }

      if (measurements.length === 0) {
        throw new Error('Please enter at least one measurement');
      }

      const now = new Date().toISOString();
      // The selected `date` may differ from the entry's original logical date (or from
      // today, for a fresh backdated entry) -- observedAt must always resolve back to
      // `date` under Warsaw local time, or persistence validation rejects the save.
      const observedAt = deriveObservedAtForLocalDate(date);
      const context: AnthropometryMeasurementContext = {
        morningPostVoidPreIntake,
        trainingBeforeMeasurement,
        respiratoryState,
        posture: 'standing_relaxed',
        clothing: 'minimal_or_bare_skin',
      };

      if (entryToEdit) {
        const corrected: AnthropometryEntry = {
          ...entryToEdit,
          date,
          observedAt,
          context,
          measurements,
          revision: entryToEdit.revision + 1,
          updatedAt: now,
        };
        await anthropometryService.correctEntry(userId, corrected);
      } else {
        const entryId = `anthro_${date}_${Date.now()}`;
        const newEntry: AnthropometryEntry = {
          id: entryId,
          userId,
          date,
          observedAt,
          protocol: ANTHROPOMETRY_PROTOCOL_V1,
          context,
          measurements,
          schemaVersion: 1,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        await anthropometryService.createEntry(userId, newEntry);
      }

      await onSaved();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const renderCircumferenceInputRow = (id: AnthropometryMetricId) => {
    const state = metricStates[id] || INITIAL_METRIC_STATE;
    const isLimb = LIMB_METRIC_IDS.includes(id);
    const r1Num = parseFloat(state.r1);
    const r2Num = parseFloat(state.r2);
    const hasPair = !isNaN(r1Num) && !isNaN(r2Num) && r1Num > 0 && r2Num > 0;
    const pairExceeded = hasPair && exceedsCircumferenceTolerance(r1Num, r2Num);

    let medianDisplay = '—';
    if (hasPair) {
      const r3Num = parseFloat(state.r3);
      const readings = [r1Num, r2Num];
      if (pairExceeded && !isNaN(r3Num) && r3Num > 0) {
        readings.push(r3Num);
      }
      try {
        const item = summarizeMeasurementItem(id, readings, state.laterality);
        medianDisplay = `${item.value} cm`;
      } catch {
        medianDisplay = '—';
      }
    }

    return (
      <div
        key={id}
        className="metric-entry-card"
        style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color, #333)',
          marginBottom: '0.75rem',
          backgroundColor: state.enabled ? 'var(--card-bg, #1e1e1e)' : 'transparent',
          opacity: state.enabled ? 1 : 0.7,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: state.enabled ? '0.5rem' : 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={state.enabled}
              onChange={() => handleMetricToggle(id)}
            />
            {METRIC_DISPLAY_LABELS[id]}
          </label>

          {state.enabled && isLimb && (
            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem' }}>
              {(['left', 'right', 'unspecified'] as Laterality[]).map(lat => (
                <label key={lat} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`laterality_${id}`}
                    value={lat}
                    checked={state.laterality === lat}
                    onChange={() => handleMetricFieldChange(id, 'laterality', lat)}
                  />
                  {lat.charAt(0).toUpperCase() + lat.slice(1)}
                </label>
              ))}
            </div>
          )}
        </div>

        {state.enabled && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: pairExceeded ? '1fr 1fr 1fr auto' : '1fr 1fr auto', gap: '0.75rem', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)' }}>Reading 1 (cm)</label>
                <input
                  type="number"
                  step="0.1"
                  min="10"
                  max="300"
                  inputMode="decimal"
                  placeholder="e.g. 82.5"
                  value={state.r1}
                  onChange={(e) => handleMetricFieldChange(id, 'r1', e.target.value)}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: '#fff' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)' }}>Reading 2 (cm)</label>
                <input
                  type="number"
                  step="0.1"
                  min="10"
                  max="300"
                  inputMode="decimal"
                  placeholder="e.g. 82.3"
                  value={state.r2}
                  onChange={(e) => handleMetricFieldChange(id, 'r2', e.target.value)}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: '#fff' }}
                />
              </div>
              {pairExceeded && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600 }}>Reading 3 (Prompted)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="10"
                    max="300"
                    inputMode="decimal"
                    placeholder="3rd check"
                    value={state.r3}
                    onChange={(e) => handleMetricFieldChange(id, 'r3', e.target.value)}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '2px solid #f59e0b', backgroundColor: '#2a2a2a', color: '#fff' }}
                  />
                </div>
              )}
              <div style={{ textAlign: 'right', minWidth: '70px' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)' }}>Retained</span>
                <strong style={{ fontSize: '0.95rem', color: '#3b82f6' }}>{medianDisplay}</strong>
              </div>
            </div>
            {pairExceeded && (
              <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.75rem', color: '#f59e0b' }}>
                ⚠️ Readings differed by &gt; 1.0 cm / 1%. Take a 3rd reading; median will be saved.
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        className="modal-content"
        style={{
          backgroundColor: 'var(--surface-bg, #1a1a1a)',
          color: 'var(--text-primary, #fff)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.5rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          border: '1px solid var(--border-color, #333)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              {isEditing ? 'Edit Anthropometry Entry' : 'Log Measurements'}
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #888)' }}>
              Protocol: {ANTHROPOMETRY_PROTOCOL_V1}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '1.5rem', cursor: 'pointer' }}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.75rem', marginBottom: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Date & Context Box */}
          <section style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Measurement Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: '#fff' }}
              />
            </div>

            <div style={{ fontSize: '0.85rem' }}>
              <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>Measurement Conditions</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={morningPostVoidPreIntake}
                    onChange={(e) => setMorningPostVoidPreIntake(e.target.checked)}
                  />
                  Morning, post-void, before food/drink (Standard context)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={trainingBeforeMeasurement}
                    onChange={(e) => setTrainingBeforeMeasurement(e.target.checked)}
                  />
                  Trained prior to measurement today
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                  <span>Trunk respiratory state:</span>
                  <select
                    value={respiratoryState}
                    onChange={(e) =>
                      setRespiratoryState(e.target.value as 'relaxed_normal_expiration' | 'other')
                    }
                    style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: '#fff', fontSize: '0.8rem' }}
                  >
                    <option value="relaxed_normal_expiration">Relaxed end-expiration (Protocol standard)</option>
                    <option value="other">Other / Not standardized</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Provider Weight Detection & Manual Weight Fallback */}
          <section style={{ marginBottom: '1.25rem' }}>
            {todayProviderWeightKg ? (
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.9rem', color: '#60a5fa' }}>Connected Scale Synced</strong>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#93c5fd' }}>
                      Weight for today ({todayProviderWeightKg} kg) is synced from your wearable/scale provider.
                    </p>
                  </div>
                  {!showManualWeight && (
                    <button
                      type="button"
                      onClick={() => setShowManualWeight(true)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #3b82f6', background: 'transparent', color: '#60a5fa', cursor: 'pointer' }}
                    >
                      Add manual weight
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {showManualWeight && (
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #333', backgroundColor: 'var(--card-bg, #1e1e1e)', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>Manual Body Mass (kg)</label>
                  {todayProviderWeightKg && (
                    <button
                      type="button"
                      onClick={() => { setShowManualWeight(false); setManualWeightKg(''); }}
                      style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      Hide manual weight
                    </button>
                  )}
                </div>
                <div style={{ marginTop: '0.4rem' }}>
                  <input
                    type="number"
                    step="0.05"
                    min="30"
                    max="350"
                    inputMode="decimal"
                    placeholder="e.g. 74.5"
                    value={manualWeightKg}
                    onChange={(e) => setManualWeightKg(e.target.value)}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: '#fff' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)' }}>
                    Separate from connected scale; takes 1 single reading.
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* Core Weekly Circumferences */}
          <section style={{ marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0', color: 'var(--text-secondary, #aaa)' }}>
              Core Weekly Set (Waist, Abdomen, Hips)
            </h3>
            {CORE_WEEKLY_METRIC_IDS.map(renderCircumferenceInputRow)}
          </section>

          {/* Useful Secondary (Thigh) */}
          <section style={{ marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0', color: 'var(--text-secondary, #aaa)' }}>
              Secondary Anthropometry (Thigh)
            </h3>
            {SECONDARY_METRIC_IDS.map(renderCircumferenceInputRow)}
          </section>

          {/* Optional Expandable Metrics */}
          <section style={{ marginBottom: '1.25rem' }}>
            <button
              type="button"
              onClick={() => setShowOptionalGroup(!showOptionalGroup)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem',
                background: 'none',
                border: 'none',
                color: '#60a5fa',
                cursor: 'pointer',
                fontSize: '0.9rem',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{showOptionalGroup ? '▼ Hide optional measurements' : '▶ Show other circumferences (Chest, Arm, Calf, Forearm)'}</span>
            </button>
            {showOptionalGroup && (
              <div style={{ marginTop: '0.5rem' }}>
                {OPTIONAL_EXPANDABLE_METRIC_IDS.map(renderCircumferenceInputRow)}
              </div>
            )}
          </section>

          {/* Form Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid #444',
                backgroundColor: 'transparent',
                color: '#aaa',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary"
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: '6px',
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving...' : isEditing ? 'Save Correction' : 'Save Measurements'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
