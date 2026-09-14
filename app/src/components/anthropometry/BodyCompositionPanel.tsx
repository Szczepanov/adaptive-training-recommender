import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { AnthropometryEntry, AnthropometryMetricId } from '../../anthropometry/models';
import { METRIC_DISPLAY_LABELS, OPTIONAL_EXPANDABLE_METRIC_IDS } from '../../anthropometry/models';
import {
  reduceDailyManualBodyMass,
  reduceDailyProviderBodyMass,
  computeBodyMassTrend,
  computeCircumferenceTrends,
  computeHungerRetrospectiveSummary,
  computeProviderCompositionSummary,
  type CheckinHungerRecord,
  type ProviderCompositionRecord,
} from '../../anthropometry/trends';
import { anthropometryService } from '../../services/anthropometryService';
import { recoverySnapshotService } from '../../services/recoverySnapshotService';
import { checkinService } from '../../services/checkinService';
import { addDaysToLocalDateString, getLocalDateString } from '../../utils/localDate';
import { LogMeasurementsModal } from './LogMeasurementsModal';

export interface BodyCompositionPanelProps {
  userId: string;
  asOfDate?: string;
}

const BODY_MASS_SOURCE_STORAGE_KEY = 'adaptive-training:body-mass:preferred-source';

function loadStoredBodyMassSource(): 'provider' | 'manual' | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(BODY_MASS_SOURCE_STORAGE_KEY);
    return val === 'provider' || val === 'manual' ? val : null;
  } catch {
    return null;
  }
}

function persistBodyMassSource(source: 'provider' | 'manual'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BODY_MASS_SOURCE_STORAGE_KEY, source);
  } catch {
    // Ignore storage errors
  }
}

export const BodyCompositionPanel: React.FC<BodyCompositionPanelProps> = ({
  userId,
  asOfDate = getLocalDateString(),
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [anthropometryEntries, setAnthropometryEntries] = useState<AnthropometryEntry[]>([]);
  const [providerSnapshots, setProviderSnapshots] = useState<ProviderCompositionRecord[]>([]);
  const [providerWeights, setProviderWeights] = useState<Array<{ date: string; weightKg: number }>>([]);
  const [hungerRecords, setHungerRecords] = useState<CheckinHungerRecord[]>([]);

  // Source preference for body mass ('provider' vs 'manual')
  const [selectedSource, setSelectedSource] = useState<'provider' | 'manual'>(() => {
    return loadStoredBodyMassSource() ?? 'provider';
  });

  // Modal controls
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<AnthropometryEntry | null>(null);
  const [showOptionalCircumferences, setShowOptionalCircumferences] = useState(false);

  // Date ranges
  const current7dDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDaysToLocalDateString(asOfDate, -(6 - i)));
  }, [asOfDate]);

  const prior7dDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDaysToLocalDateString(asOfDate, -(13 - i)));
  }, [asOfDate]);

  const dates28d = useMemo(() => {
    return Array.from({ length: 28 }, (_, i) => addDaysToLocalDateString(asOfDate, -(27 - i)));
  }, [asOfDate]);

  const startDate56d = useMemo(() => {
    return addDaysToLocalDateString(asOfDate, -56);
  }, [asOfDate]);

  const loadAllData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Fetch anthropometry entries (56 days range)
      const anthroData = await anthropometryService.getEntriesInRange(userId, startDate56d, asOfDate);
      setAnthropometryEntries(anthroData);

      // 2. Fetch recovery snapshots for provider weight and body fat
      const snapshotState = await recoverySnapshotService.getRecoverySnapshotsInRangeState(
        userId,
        startDate56d,
        addDaysToLocalDateString(asOfDate, 1),
      );

      if (snapshotState.status === 'AVAILABLE') {
        const weights: Array<{ date: string; weightKg: number }> = [];
        const comp: ProviderCompositionRecord[] = [];
        for (const snap of snapshotState.data) {
          if (snap.raw.weightKg != null && snap.raw.weightKg > 0) {
            weights.push({ date: snap.date, weightKg: snap.raw.weightKg });
          }
          if (snap.raw.bodyFatPct != null && snap.raw.bodyFatPct > 0) {
            comp.push({ date: snap.date, bodyFatPct: snap.raw.bodyFatPct });
          }
        }
        setProviderWeights(weights);
        setProviderSnapshots(comp);
      } else {
        setProviderWeights([]);
        setProviderSnapshots([]);
      }

      // 3. Fetch checkins for hunger retrospective
      const checkinState = await checkinService.getCheckinsInRangeState(
        userId,
        startDate56d,
        addDaysToLocalDateString(asOfDate, 1),
      );

      if (checkinState.status === 'AVAILABLE') {
        setHungerRecords(checkinState.data.map(c => ({
          date: c.date,
          hunger1To10: c.hunger1To10,
          hungerTiming: c.hungerTiming,
        })));
      } else {
        setHungerRecords([]);
      }
    } catch (err: unknown) {
      console.error('[BodyCompositionPanel] Error loading data:', err);
      setError('Failed to load body composition and anthropometry data.');
    } finally {
      setLoading(false);
    }
  }, [userId, startDate56d, asOfDate]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleSourceChange = (src: 'provider' | 'manual') => {
    setSelectedSource(src);
    persistBodyMassSource(src);
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!window.confirm('Are you sure you want to delete this measurement session?')) return;
    try {
      await anthropometryService.deleteEntry(userId, entryId);
      await loadAllData();
    } catch (err: unknown) {
      alert('Failed to delete entry: ' + String(err));
    }
  };

  const handleEditEntry = (entry: AnthropometryEntry) => {
    setEntryToEdit(entry);
    setIsModalOpen(true);
  };

  // --- Calculations ---
  const manualPointsByDate = useMemo(() => {
    return reduceDailyManualBodyMass(anthropometryEntries);
  }, [anthropometryEntries]);

  const providerPointsByDate = useMemo(() => {
    return reduceDailyProviderBodyMass(providerWeights);
  }, [providerWeights]);

  // Today provider weight if available
  const todayProviderWeightKg = useMemo(() => {
    const pt = providerPointsByDate.get(asOfDate);
    return pt ? pt.weightKg : null;
  }, [providerPointsByDate, asOfDate]);

  // Auto fallback to manual if user hasn't explicitly selected provider and provider has 0 points
  const effectiveSource = useMemo(() => {
    const stored = loadStoredBodyMassSource();
    if (!stored) {
      if (providerPointsByDate.size > 0) return 'provider';
      if (manualPointsByDate.size > 0) return 'manual';
    }
    return selectedSource;
  }, [selectedSource, providerPointsByDate.size, manualPointsByDate.size]);

  const activeBodyMassTrend = useMemo(() => {
    const points = effectiveSource === 'provider' ? providerPointsByDate : manualPointsByDate;
    return computeBodyMassTrend(effectiveSource, current7dDates, prior7dDates, points);
  }, [effectiveSource, current7dDates, prior7dDates, providerPointsByDate, manualPointsByDate]);

  const circumferenceTrends = useMemo(() => {
    return computeCircumferenceTrends(anthropometryEntries);
  }, [anthropometryEntries]);

  const hungerMorningSummary = useMemo(() => {
    return computeHungerRetrospectiveSummary(hungerRecords, 'morning_pre_breakfast', current7dDates, dates28d);
  }, [hungerRecords, current7dDates, dates28d]);

  const hungerOtherSummary = useMemo(() => {
    return computeHungerRetrospectiveSummary(hungerRecords, 'other', current7dDates, dates28d);
  }, [hungerRecords, current7dDates, dates28d]);

  const providerCompositionTrend = useMemo(() => {
    return computeProviderCompositionSummary(providerSnapshots, current7dDates);
  }, [providerSnapshots, current7dDates]);

  if (loading) {
    return (
      <div className="data-section">
        <p>Loading body composition and anthropometry data...</p>
      </div>
    );
  }

  return (
    <div className="data-section body-composition-panel">
      {/* Header and Log Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>Body Composition & Fueling Observations</h3>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary, #aaa)', fontSize: '0.9rem' }}>
            Longitudinal body mass, tape circumferences, and fueling context. Strictly observational (no engine authority).
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => { setEntryToEdit(null); setIsModalOpen(true); }}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          📏 Log measurements
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', marginBottom: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Grid of Observation Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {/* Card 1: Body Mass */}
        <div className="observation-card" style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color, #333)', backgroundColor: 'var(--card-bg, #1e1e1e)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0, fontSize: '1rem' }}>⚖️ Body Mass</h4>
            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem' }}>
              <button
                type="button"
                onClick={() => handleSourceChange('provider')}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  border: effectiveSource === 'provider' ? '1px solid #3b82f6' : '1px solid #444',
                  backgroundColor: effectiveSource === 'provider' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  color: effectiveSource === 'provider' ? '#60a5fa' : '#aaa',
                  cursor: 'pointer',
                }}
              >
                Connected Scale
              </button>
              <button
                type="button"
                onClick={() => handleSourceChange('manual')}
                style={{
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  border: effectiveSource === 'manual' ? '1px solid #3b82f6' : '1px solid #444',
                  backgroundColor: effectiveSource === 'manual' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  color: effectiveSource === 'manual' ? '#60a5fa' : '#aaa',
                  cursor: 'pointer',
                }}
              >
                Manual Fallback
              </button>
            </div>
          </div>

          <div style={{ margin: '0.75rem 0' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#fff' }}>
              {activeBodyMassTrend.latestPoint ? `${activeBodyMassTrend.latestPoint.weightKg} kg` : '—'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #aaa)' }}>
              {activeBodyMassTrend.latestPoint
                ? `Latest: ${activeBodyMassTrend.latestPoint.date} (${activeBodyMassTrend.latestPoint.source})`
                : `No ${effectiveSource} records found`}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #333', paddingTop: '0.75rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <span>7-Day Mean:</span>
              <strong>
                {activeBodyMassTrend.current7d.qualifiesForMean && activeBodyMassTrend.current7d.meanWeightKg !== null
                  ? `${activeBodyMassTrend.current7d.meanWeightKg} kg`
                  : 'Insufficient coverage'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <span>Coverage:</span>
              <span>{activeBodyMassTrend.current7d.distinctRecordedDates} / 7 days (min 4 for mean)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Week-over-Week Change:</span>
              <strong>
                {activeBodyMassTrend.weekOverWeekAbsoluteKg !== null
                  ? `${activeBodyMassTrend.weekOverWeekAbsoluteKg > 0 ? '+' : ''}${activeBodyMassTrend.weekOverWeekAbsoluteKg} kg (${activeBodyMassTrend.weekOverWeekPercent! > 0 ? '+' : ''}${activeBodyMassTrend.weekOverWeekPercent}%)`
                  : '—'}
              </strong>
            </div>
          </div>
        </div>

        {/* Card 2: Waist & Abdomen */}
        <div className="observation-card" style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color, #333)', backgroundColor: 'var(--card-bg, #1e1e1e)' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem' }}>📏 Waist & Abdomen</h4>
          {['waist_minimum_cm', 'abdomen_umbilicus_cm'].map((mId) => {
            const key = `${mId}:unspecified:home_anthropometry@1`;
            const trend = circumferenceTrends.get(key);
            return (
              <div key={mId} style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid #2a2a2a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{METRIC_DISPLAY_LABELS[mId as AnthropometryMetricId]}</span>
                  <strong style={{ fontSize: '1.2rem', color: '#60a5fa' }}>
                    {trend?.latestPoint ? `${trend.latestPoint.value} cm` : '—'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)', marginTop: '0.2rem' }}>
                  <span>{trend?.latestPoint ? `Date: ${trend.latestPoint.date}` : 'No measurements'}</span>
                  <span>
                    {trend?.deltaCm !== null && trend?.deltaCm !== undefined
                      ? `Δ ${trend.deltaCm > 0 ? '+' : ''}${trend.deltaCm} cm vs prev`
                      : 'No prior'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Card 3: Hips & Thigh */}
        <div className="observation-card" style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color, #333)', backgroundColor: 'var(--card-bg, #1e1e1e)' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem' }}>📐 Hips & Thigh</h4>
          {/* Hips */}
          {(() => {
            const hipsTrend = circumferenceTrends.get('hips_max_cm:unspecified:home_anthropometry@1');
            return (
              <div style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid #2a2a2a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Hips (maximum)</span>
                  <strong style={{ fontSize: '1.2rem', color: '#60a5fa' }}>
                    {hipsTrend?.latestPoint ? `${hipsTrend.latestPoint.value} cm` : '—'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)', marginTop: '0.2rem' }}>
                  <span>{hipsTrend?.latestPoint ? `Date: ${hipsTrend.latestPoint.date}` : 'No measurements'}</span>
                  <span>
                    {hipsTrend?.deltaCm !== null && hipsTrend?.deltaCm !== undefined
                      ? `Δ ${hipsTrend.deltaCm > 0 ? '+' : ''}${hipsTrend.deltaCm} cm`
                      : 'No prior'}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Thigh (right and/or left) */}
          {(() => {
            const rightThigh = circumferenceTrends.get('thigh_mid_cm:right:home_anthropometry@1');
            const leftThigh = circumferenceTrends.get('thigh_mid_cm:left:home_anthropometry@1');
            const unspecThigh = circumferenceTrends.get('thigh_mid_cm:unspecified:home_anthropometry@1');
            const thigh = rightThigh || unspecThigh || leftThigh;
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    Thigh {thigh?.laterality && thigh.laterality !== 'unspecified' ? `(${thigh.laterality})` : ''}
                  </span>
                  <strong style={{ fontSize: '1.2rem', color: '#60a5fa' }}>
                    {thigh?.latestPoint ? `${thigh.latestPoint.value} cm` : '—'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)', marginTop: '0.2rem' }}>
                  <span>{thigh?.latestPoint ? `Date: ${thigh.latestPoint.date}` : 'No measurements'}</span>
                  <span>
                    {thigh?.deltaCm !== null && thigh?.deltaCm !== undefined
                      ? `Δ ${thigh.deltaCm > 0 ? '+' : ''}${thigh.deltaCm} cm`
                      : 'No prior'}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Card 4: Hunger Retrospective */}
        <div className="observation-card" style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color, #333)', backgroundColor: 'var(--card-bg, #1e1e1e)' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>🍽️ Hunger Retrospective</h4>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)' }}>
            Subjective appetite context (Check-in 1–10). Kept separate by timing context.
          </p>

          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem' }}>Morning (Pre-Breakfast)</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.2rem' }}>
              <span>7-day mean:</span>
              <strong>{hungerMorningSummary.mean7d !== null ? `${hungerMorningSummary.mean7d} / 10 (n=${hungerMorningSummary.recordedDays7d})` : 'No data'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.1rem' }}>
              <span>28-day mean:</span>
              <span>{hungerMorningSummary.mean28d !== null ? `${hungerMorningSummary.mean28d} / 10 (n=${hungerMorningSummary.recordedDays28d})` : 'No data'}</span>
            </div>
          </div>

          {hungerOtherSummary.recordedDays7d > 0 && (
            <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary, #aaa)' }}>
              <span>Other timing context: 7d avg {hungerOtherSummary.mean7d ?? '—'} (n={hungerOtherSummary.recordedDays7d})</span>
            </div>
          )}
        </div>

        {/* Card 5: Scale Estimates (Device/BIA telemetry) */}
        <div className="observation-card" style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color, #333)', backgroundColor: 'var(--card-bg, #1e1e1e)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0, fontSize: '1rem' }}>📊 Device / Scale Estimates</h4>
            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', borderRadius: '4px', backgroundColor: '#333', color: '#ccc' }}>
              Secondary Telemetry
            </span>
          </div>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: 'var(--text-secondary, #aaa)' }}>
            Body fat percentage estimated by your connected scale (BIA). Not directly measured tissue.
          </p>

          <div style={{ margin: '0.5rem 0' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#fff' }}>
              {providerCompositionTrend.latestBodyFatPct !== null ? `${providerCompositionTrend.latestBodyFatPct}%` : '—'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #aaa)' }}>
              {providerCompositionTrend.latestDate ? `Latest: ${providerCompositionTrend.latestDate}` : 'No device estimates'}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #333', paddingTop: '0.5rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>7-day Mean:</span>
              <strong>{providerCompositionTrend.mean7d !== null ? `${providerCompositionTrend.mean7d}% (n=${providerCompositionTrend.recordedDays7d})` : '—'}</strong>
            </div>
          </div>
        </div>

        {/* Card 6: Other Circumferences (Expandable) */}
        <div className="observation-card" style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color, #333)', backgroundColor: 'var(--card-bg, #1e1e1e)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '1rem' }}>📋 Other Circumferences</h4>
            <button
              type="button"
              onClick={() => setShowOptionalCircumferences(!showOptionalCircumferences)}
              style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '0.8rem', cursor: 'pointer' }}
            >
              {showOptionalCircumferences ? '▲ Collapse' : '▼ Expand'}
            </button>
          </div>

          {showOptionalCircumferences ? (
            <div style={{ marginTop: '0.75rem' }}>
              {OPTIONAL_EXPANDABLE_METRIC_IDS.map((mId) => {
                // Check right, unspecified, or left
                const rKey = `${mId}:right:home_anthropometry@1`;
                const uKey = `${mId}:unspecified:home_anthropometry@1`;
                const trend = circumferenceTrends.get(rKey) || circumferenceTrends.get(uKey);
                return (
                  <div key={mId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid #2a2a2a', fontSize: '0.85rem' }}>
                    <span>{METRIC_DISPLAY_LABELS[mId]}</span>
                    <strong>{trend?.latestPoint ? `${trend.latestPoint.value} cm` : '—'}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary, #aaa)' }}>
              Chest, upper arm, forearm, and calf tracking.
            </p>
          )}
        </div>
      </div>

      {/* History Table */}
      <div style={{ marginTop: '2rem' }}>
        <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Measurement Sessions History</h4>
        {anthropometryEntries.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #aaa)' }}>No manual sessions logged yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #444', color: 'var(--text-secondary, #aaa)' }}>
                  <th style={{ padding: '0.5rem' }}>Date</th>
                  <th style={{ padding: '0.5rem' }}>Context</th>
                  <th style={{ padding: '0.5rem' }}>Measurements</th>
                  <th style={{ padding: '0.5rem' }}>Revision</th>
                  <th style={{ padding: '0.5rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...anthropometryEntries].reverse().map((entry) => {
                  const isStandard = entry.context.morningPostVoidPreIntake && !entry.context.trainingBeforeMeasurement;
                  return (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                      <td style={{ padding: '0.5rem', fontWeight: 600 }}>{entry.date}</td>
                      <td style={{ padding: '0.5rem', color: isStandard ? '#10b981' : '#f59e0b' }}>
                        {isStandard ? 'Standard morning' : 'Non-standard'}
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        {entry.measurements.map((m, idx) => (
                          <span key={idx} style={{ display: 'inline-block', marginRight: '0.5rem', backgroundColor: '#2a2a2a', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                            {METRIC_DISPLAY_LABELS[m.metricId]}: {m.value}{m.unit}
                            {m.laterality && m.laterality !== 'unspecified' ? ` (${m.laterality})` : ''}
                          </span>
                        ))}
                      </td>
                      <td style={{ padding: '0.5rem', color: '#888' }}>r{entry.revision}</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => handleEditEntry(entry)}
                          style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', marginRight: '0.75rem' }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEntry(entry.id)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log / Edit Modal */}
      {isModalOpen && (
        <LogMeasurementsModal
          userId={userId}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSaved={loadAllData}
          todayProviderWeightKg={todayProviderWeightKg}
          entryToEdit={entryToEdit}
        />
      )}
    </div>
  );
};
