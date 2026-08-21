import { useEffect, useState } from 'react';
import type { DailyDecisionInput } from '../engine/models';
import type { HealthAnomalyAssessmentRevision } from '../engine/healthAnomalyModels';
import { healthAnomalyAssessmentRepository } from '../services/healthAnomalyPersistence';

interface HealthAnomalyShadowPanelProps {
  userId: string;
  decisionInput: DailyDecisionInput;
}

interface HealthAnomalyShadowTraceProps {
  revision: HealthAnomalyAssessmentRevision;
  decisionInput: DailyDecisionInput;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
}

function yesNoUnknown(value: boolean | null | undefined): string {
  return value === true ? 'Yes' : value === false ? 'No' : 'Unknown';
}

export function HealthAnomalyShadowTrace({ revision, decisionInput }: HealthAnomalyShadowTraceProps) {
  const { assessment } = revision;
  const recovery = decisionInput.recoverySnapshot;
  const checkin = decisionInput.subjectiveCheckin;
  const health = checkin?.healthContext;

  return (
    <div className="data-section" data-testid="health-anomaly-shadow-trace">
      <h3>Health anomaly (shadow)</h3>
      <p className="data-state-notice">
        Developer evidence only. This trace is not a diagnosis and does not alter today&apos;s recommendation.
      </p>

      <div className="data-grid">
        <div className="data-group">
          <h4>Assessment</h4>
          <div className="data-item"><span className="data-label">State:</span><span className="data-value">{assessment.state}</span></div>
          <div className="data-item"><span className="data-label">Evidence level:</span><span className="data-value">{assessment.evidenceLevel}</span></div>
          <div className="data-item"><span className="data-label">Mode:</span><span className="data-value">{revision.mode}</span></div>
          <div className="data-item"><span className="data-label">Evaluator:</span><span className="data-value">{revision.policyVersion}</span></div>
          <div className="data-item"><span className="data-label">Threshold policy:</span><span className="data-value">{revision.thresholdPolicy.policyVersion}</span></div>
          <div className="data-item"><span className="data-label">Revision:</span><span className="data-value">{revision.revisionId}</span></div>
          <div className="data-item"><span className="data-label">Computed:</span><span className="data-value">{revision.computedAt}</span></div>
          <div className="data-item"><span className="data-label">Episode:</span><span className="data-value">{assessment.episodeId ?? 'None'}{assessment.episodeDay ? ` · day ${assessment.episodeDay}` : ''}</span></div>
          <div className="data-item"><span className="data-label">Unexplained persistence:</span><span className="data-value">{assessment.persistenceDays} day(s)</span></div>
        </div>

        {assessment.coreSignals.map(signal => {
          const quality = assessment.dataQuality.find(item => item.signal === signal.signal);
          return (
            <div className="data-group" key={signal.signal}>
              <h4>{signal.signal.toUpperCase()}</h4>
              <div className="data-item"><span className="data-label">Status:</span><span className="data-value">{signal.status}{signal.direction ? ` · ${signal.direction}` : ''}</span></div>
              <div className="data-item"><span className="data-label">Current:</span><span className="data-value">{formatNumber(signal.currentValue)}</span></div>
              <div className="data-item"><span className="data-label">Baseline:</span><span className="data-value">{formatNumber(signal.baselineValue)}</span></div>
              <div className="data-item"><span className="data-label">Scale:</span><span className="data-value">{formatNumber(signal.scaleValue)}</span></div>
              <div className="data-item"><span className="data-label">Standardized deviation:</span><span className="data-value">{formatNumber(signal.standardizedDeviation)}</span></div>
              <div className="data-item"><span className="data-label">Estimator:</span><span className="data-value">{signal.estimator ?? 'N/A'}</span></div>
              <div className="data-item"><span className="data-label">Baseline version:</span><span className="data-value">{signal.baselineVersion ?? 'N/A'}</span></div>
              <div className="data-item"><span className="data-label">History / coverage:</span><span className="data-value">{quality ? `${quality.historyCount} · ${(quality.recentDayCoverage * 100).toFixed(0)}%` : 'N/A'}</span></div>
              <div className="data-item"><span className="data-label">Baseline age:</span><span className="data-value">{quality?.baselineAgeDays ?? 'N/A'} day(s)</span></div>
              <div className="data-item"><span className="data-label">Near-zero scale:</span><span className="data-value">{quality ? yesNoUnknown(quality.zeroOrNearZeroScale) : 'N/A'}</span></div>
              <div className="data-item"><span className="data-label">Quantization/ties:</span><span className="data-value">{quality ? yesNoUnknown(quality.suspectedQuantizationOrTies) : 'N/A'}</span></div>
            </div>
          );
        })}

        <div className="data-group">
          <h4>Recent recovery context</h4>
          <div className="data-item"><span className="data-label">Hard sessions last 3d:</span><span className="data-value">{recovery?.raw.last3DaysHardSessionsCount ?? 'N/A'}</span></div>
          <div className="data-item"><span className="data-label">Yesterday hard activities:</span><span className="data-value">{recovery?.raw.yesterdayTraining?.hardActivityCount ?? 'N/A'}</span></div>
          <div className="data-item"><span className="data-label">Sleep score:</span><span className="data-value">{recovery?.raw.sleepScore ?? 'N/A'}</span></div>
          <div className="data-item"><span className="data-label">Sleep duration:</span><span className="data-value">{recovery?.raw.sleepDurationSec != null ? `${Math.round(recovery.raw.sleepDurationSec / 60)} min` : 'N/A'}</span></div>
          <div className="data-item"><span className="data-label">Garmin stress avg / max:</span><span className="data-value">{recovery?.raw.stress?.avg ?? 'N/A'} / {recovery?.raw.stress?.max ?? 'N/A'}</span></div>
          <div className="data-item"><span className="data-label">Subjective sleep:</span><span className="data-value">{checkin?.sleepQuality ?? 'N/A'}</span></div>
          <div className="data-item"><span className="data-label">Subjective stress:</span><span className="data-value">{checkin?.mentalStress ?? 'N/A'}</span></div>
        </div>

        <div className="data-group">
          <h4>Check-in context</h4>
          <div className="data-item"><span className="data-label">Symptoms:</span><span className="data-value">{yesNoUnknown(health?.symptoms?.present ?? checkin?.illnessSymptoms)}</span></div>
          <div className="data-item"><span className="data-label">Alcohol:</span><span className="data-value">{health?.alcoholDrinksLast24h ?? 'Unknown'}</span></div>
          <div className="data-item"><span className="data-label">Travel:</span><span className="data-value">{health?.travelDisruption ?? 'Unknown'}</span></div>
          <div className="data-item"><span className="data-label">Heat / sauna:</span><span className="data-value">{yesNoUnknown(health?.unusualHeatOrSauna)}</span></div>
          <div className="data-item"><span className="data-label">Dehydration:</span><span className="data-value">{yesNoUnknown(health?.dehydrationOrFluidLoss)}</span></div>
          <div className="data-item"><span className="data-label">Vaccination:</span><span className="data-value">{yesNoUnknown(health?.recentVaccination)}</span></div>
          <div className="data-item"><span className="data-label">Medication change:</span><span className="data-value">{yesNoUnknown(health?.medicationChange)}</span></div>
          <div className="data-item"><span className="data-label">Close sick contact:</span><span className="data-value">{yesNoUnknown(health?.closeSickContact)}</span></div>
        </div>

        <div className="data-group">
          <h4>Explanation coverage</h4>
          {assessment.explanations.length === 0 ? <p>None</p> : assessment.explanations.map((item, index) => (
            <div className="data-item" key={`${item.kind}-${index}`}>
              <span className="data-label">{item.kind}:</span>
              <span className="data-value">{item.strength} · {item.explainsSignals.join(', ')} · {item.evidence.join(', ')}</span>
            </div>
          ))}
        </div>

        <div className="data-group">
          <h4>Residual / supporting evidence</h4>
          <div className="data-item"><span className="data-label">Unexplained:</span><span className="data-value">{assessment.unexplainedEvidence.join(', ') || 'None'}</span></div>
          {assessment.supportingSignals.map(item => (
            <div className="data-item" key={item.code}>
              <span className="data-label">{item.code}:</span>
              <span className="data-value">{item.status} · {String(item.value ?? 'N/A')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HealthAnomalyShadowPanel({ userId, decisionInput }: HealthAnomalyShadowPanelProps) {
  const [revision, setRevision] = useState<HealthAnomalyAssessmentRevision | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const date = decisionInput.date;

  useEffect(() => {
    let cancelled = false;
    healthAnomalyAssessmentRepository.getLatestForDate(userId, date)
      .then(value => {
        if (cancelled) return;
        setRevision(value);
        setLoadState(value ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [userId, date]);

  if (loadState === 'loading') {
    return <div className="data-view-container"><div className="data-section"><h3>Health anomaly (shadow)</h3><p>Loading shadow assessment…</p></div></div>;
  }
  if (loadState === 'error') {
    return <div className="data-view-container"><div className="data-section"><h3>Health anomaly (shadow)</h3><p className="data-state-notice">Could not read the shadow assessment.</p></div></div>;
  }
  if (!revision) {
    return (
      <div className="data-view-container">
        <div className="data-section">
          <h3>Health anomaly (shadow)</h3>
          <p>No shadow assessment is persisted for {date}. Collection requires explicit <code>VITE_HEALTH_ANOMALY_POLICY=shadow-v1</code>.</p>
        </div>
      </div>
    );
  }

  return <div className="data-view-container"><HealthAnomalyShadowTrace revision={revision} decisionInput={decisionInput} /></div>;
}
