import type { ReactNode } from 'react';
import type { DataStateSummary } from '../../engine/dataState';
import type { DailyRecoverySnapshot } from '../../engine/models';
import {
  describeSourceState,
  formatCandidateBaseline,
  formatCandidateDelta,
  formatSleepStageMinutes,
  VERSION_GATED_NOT_AVAILABLE,
} from './dataViewFormat';

interface RecoveryTabProps {
  recoverySnapshot: DailyRecoverySnapshot | null;
  sourceStateStatus?: DataStateSummary['status'];
}

interface CandidateBaselineRow {
  readonly label: string;
  readonly minVersion: 4 | 5;
  readonly values: (derived: DailyRecoverySnapshot['derived']) => [
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
    number | null | undefined,
  ];
}

const CANDIDATE_BASELINE_ROWS: readonly CandidateBaselineRow[] = [
  {
    label: 'Sleep Score:',
    minVersion: 4,
    values: d => [d.sleepScore7dMedian, d.sleepScore28dMedian, d.sleepScore28dMad, d.deltas.sleepScoreVs7dMedian, d.deltas.sleepScoreVs28dMedian],
  },
  {
    label: 'Resting HR:',
    minVersion: 4,
    values: d => [d.restingHr7dMedian, d.restingHr28dMedian, d.restingHr28dMad, d.deltas.restingHrVs7dMedian, d.deltas.restingHrVs28dMedian],
  },
  {
    label: 'HRV:',
    minVersion: 4,
    values: d => [d.hrv7dMedian, d.hrv28dMedian, d.hrv28dMad, d.deltas.hrvVs7dMedian, d.deltas.hrvVs28dMedian],
  },
  {
    label: 'Steps:',
    minVersion: 4,
    values: d => [d.steps7dMedian, d.steps28dMedian, d.steps28dMad, d.deltas.stepsVs7dMedian, d.deltas.stepsVs28dMedian],
  },
  {
    label: 'Body Battery Wake:',
    minVersion: 5,
    values: d => [d.bodyBatteryWake7dMedian, d.bodyBatteryWake28dMedian, d.bodyBatteryWake28dMad, d.deltas.bodyBatteryWakeVs7dMedian, d.deltas.bodyBatteryWakeVs28dMedian],
  },
  {
    label: 'Stress Avg:',
    minVersion: 5,
    values: d => [d.stressAvg7dMedian, d.stressAvg28dMedian, d.stressAvg28dMad, d.deltas.stressAvgVs7dMedian, d.deltas.stressAvgVs28dMedian],
  },
  {
    label: 'Stress Max:',
    minVersion: 5,
    values: d => [d.stressMax7dMedian, d.stressMax28dMedian, d.stressMax28dMad, d.deltas.stressMaxVs7dMedian, d.deltas.stressMaxVs28dMedian],
  },
  {
    label: 'Training Readiness Score:',
    minVersion: 5,
    values: d => [d.trainingReadinessScore7dMedian, d.trainingReadinessScore28dMedian, d.trainingReadinessScore28dMad, d.deltas.trainingReadinessScoreVs7dMedian, d.deltas.trainingReadinessScoreVs28dMedian],
  },
];

interface DeltaRow {
  readonly label: string;
  readonly select: (deltas: DailyRecoverySnapshot['derived']['deltas']) => number | null | undefined;
}

const DELTA_ROWS: readonly DeltaRow[] = [
  { label: 'Sleep Score vs 7d:', select: d => d.sleepScoreVs7d },
  { label: 'Sleep Score vs 28d:', select: d => d.sleepScoreVs28d },
  { label: 'Resting HR vs 7d:', select: d => d.restingHrVs7d },
  { label: 'Resting HR vs 28d:', select: d => d.restingHrVs28d },
  { label: 'HRV vs 7d:', select: d => d.hrvVs7d },
  { label: 'HRV vs 28d:', select: d => d.hrvVs28d },
  { label: 'Steps vs 7d:', select: d => d.stepsVs7d },
  { label: 'Steps vs 28d:', select: d => d.stepsVs28d },
];

function renderCandidateBaselineValue(
  row: CandidateBaselineRow,
  derived: DailyRecoverySnapshot['derived'] | undefined,
  baselineVersion: number,
): string {
  if (baselineVersion < row.minVersion) return VERSION_GATED_NOT_AVAILABLE;
  const [m7, m28, mad28, d7, d28] = derived
    ? row.values(derived)
    : ([undefined, undefined, undefined, undefined, undefined] as const);
  return formatCandidateBaseline(m7, m28, mad28, d7, d28);
}

function DataItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="data-item">
      <span className="data-label">{label}</span>
      <span className="data-value">{value}</span>
    </div>
  );
}

export function RecoveryTab({ recoverySnapshot, sourceStateStatus }: RecoveryTabProps) {
  const baselineVersion = recoverySnapshot?.derived.baselineComputationVersion ?? 0;

  return (
    <div className="data-section">
      <h3>Recovery Snapshot</h3>
      {sourceStateStatus !== undefined && sourceStateStatus !== 'AVAILABLE' && (
        <p className="data-state-notice">{describeSourceState(sourceStateStatus)}</p>
      )}
      <div className="data-grid">
        <div className="data-group">
          <h4>Raw Metrics</h4>
          <DataItem label="Date:" value={recoverySnapshot?.date || 'N/A'} />
          <DataItem label="Sleep Score:" value={recoverySnapshot?.raw.sleepScore ?? 'N/A'} />
          <DataItem
            label="Sleep Duration:"
            value={
              recoverySnapshot?.raw.sleepDurationSec
                ? `${Math.round(recoverySnapshot.raw.sleepDurationSec / 60)} min`
                : 'N/A'
            }
          />
          {recoverySnapshot?.raw.deepSleepSec != null && (
            <DataItem
              label="Sleep Stages (Deep / REM / Light / Awake):"
              value={`${formatSleepStageMinutes(recoverySnapshot.raw.deepSleepSec)} / ${formatSleepStageMinutes(recoverySnapshot.raw.remSleepSec)} / ${formatSleepStageMinutes(recoverySnapshot.raw.lightSleepSec)} / ${formatSleepStageMinutes(recoverySnapshot.raw.awakeSleepSec)}`}
            />
          )}
          {recoverySnapshot?.raw.restlessMomentsCount != null && (
            <DataItem label="Restless Moments:" value={recoverySnapshot.raw.restlessMomentsCount} />
          )}
          <DataItem label="Resting HR:" value={recoverySnapshot?.raw.restingHr ?? 'N/A'} />
          <DataItem label="HRV Overnight Avg:" value={recoverySnapshot?.raw.hrvOvernightAvg ?? 'N/A'} />
          <DataItem label="HRV Status:" value={recoverySnapshot?.raw.hrvStatus ?? 'N/A'} />
          <DataItem label="Respiration Avg:" value={recoverySnapshot?.raw.respirationAvg ?? 'N/A'} />
          <DataItem label="Body Battery Wake:" value={recoverySnapshot?.raw.bodyBatteryWake ?? 'N/A'} />
          <DataItem
            label="Stress Avg / Max:"
            value={`${recoverySnapshot?.raw.stress?.avg ?? 'N/A'} / ${recoverySnapshot?.raw.stress?.max ?? 'N/A'}`}
          />
          <DataItem
            label="Training Readiness:"
            value={`${recoverySnapshot?.raw.trainingReadiness?.score ?? 'N/A'}${recoverySnapshot?.raw.trainingReadiness?.level ? ` (${recoverySnapshot.raw.trainingReadiness.level})` : ''}`}
          />
          <DataItem
            label="Garmin Recovery Time:"
            value={recoverySnapshot?.raw.recoveryTimeHours != null ? `${recoverySnapshot.raw.recoveryTimeHours} hrs` : 'N/A'}
          />
          <DataItem label="Total Steps:" value={recoverySnapshot?.raw.totalSteps ?? 'N/A'} />
          <DataItem
            label="SpO2 (Avg / Min):"
            value={`${recoverySnapshot?.raw.spo2?.avgPct != null ? `${recoverySnapshot.raw.spo2.avgPct}%` : 'N/A'}${recoverySnapshot?.raw.spo2?.minPct != null ? ` / min ${recoverySnapshot.raw.spo2.minPct}%` : ''}`}
          />
          <DataItem
            label="SpO2 (Sleep Avg):"
            value={recoverySnapshot?.raw.spo2?.sleepAvgPct != null ? `${recoverySnapshot.raw.spo2.sleepAvgPct}%` : 'N/A'}
          />
          <DataItem
            label="Skin Temp Deviation:"
            value={
              recoverySnapshot?.raw.skinTempDeviationCelsius != null
                ? `${recoverySnapshot.raw.skinTempDeviationCelsius > 0 ? '+' : ''}${recoverySnapshot.raw.skinTempDeviationCelsius}°C`
                : 'N/A'
            }
          />
        </div>

        <div className="data-group">
          <h4>Derived Metrics</h4>
          <DataItem label="Baseline Computation Version:" value={baselineVersion || 'N/A'} />
          <DataItem label="Sleep Score 7d Avg:" value={recoverySnapshot?.derived.sleepScore7dAvg ?? 'N/A'} />
          <DataItem label="Sleep Score 28d Avg:" value={recoverySnapshot?.derived.sleepScore28dAvg ?? 'N/A'} />
          <DataItem label="Resting HR 7d Avg:" value={recoverySnapshot?.derived.restingHr7dAvg ?? 'N/A'} />
          <DataItem label="Resting HR 28d Avg:" value={recoverySnapshot?.derived.restingHr28dAvg ?? 'N/A'} />
          <DataItem label="HRV 7d Avg:" value={recoverySnapshot?.derived.hrv7dAvg ?? 'N/A'} />
          <DataItem label="HRV 28d Avg:" value={recoverySnapshot?.derived.hrv28dAvg ?? 'N/A'} />
          <DataItem label="HRV 28d Stdev:" value={recoverySnapshot?.derived.hrv28dStdev ?? 'N/A'} />
          <DataItem label="Resting HR 28d Stdev:" value={recoverySnapshot?.derived.restingHr28dStdev ?? 'N/A'} />
          <DataItem label="Sleep Score 28d Stdev:" value={recoverySnapshot?.derived.sleepScore28dStdev ?? 'N/A'} />
          <DataItem label="Steps 7d Avg:" value={recoverySnapshot?.derived.steps7dAvg ?? 'N/A'} />
          <DataItem label="Steps 28d Avg:" value={recoverySnapshot?.derived.steps28dAvg ?? 'N/A'} />
          <DataItem label="Steps 28d Stdev:" value={recoverySnapshot?.derived.steps28dStdev ?? 'N/A'} />
          <DataItem
            label={baselineVersion >= 3 ? 'Respiration 7d Median:' : 'Respiration 7d Avg:'}
            value={recoverySnapshot?.derived.respiration7dAvg ?? 'N/A'}
          />
          <DataItem
            label={baselineVersion >= 3 ? 'Respiration 28d Median:' : 'Respiration 28d Avg:'}
            value={recoverySnapshot?.derived.respiration28dAvg ?? 'N/A'}
          />
          <DataItem
            label="Respiration 28d MAD:"
            value={baselineVersion >= 3 ? recoverySnapshot?.derived.respiration28dMad ?? 'N/A' : VERSION_GATED_NOT_AVAILABLE}
          />
          <DataItem label="Respiration Scoring:" value="Off by default; comparison/replay only" />
        </div>

        <div className="data-group">
          <h4>Observation-only Candidate Baselines</h4>
          <DataItem label="Interpretation:" value="Inspection/export only; these are not additional engine strain inputs." />
          {CANDIDATE_BASELINE_ROWS.map(row => (
            <DataItem
              key={row.label}
              label={row.label}
              value={renderCandidateBaselineValue(row, recoverySnapshot?.derived, baselineVersion)}
            />
          ))}
          <DataItem
            label="Composite-signal caution:"
            value="Body Battery, stress and Training Readiness overlap with HRV/sleep/recovery physiology; do not treat them as independent additive evidence."
          />
        </div>

        <div className="data-group">
          <h4>Deltas</h4>
          {DELTA_ROWS.map(row => (
            <DataItem
              key={row.label}
              label={row.label}
              value={formatCandidateDelta(recoverySnapshot ? row.select(recoverySnapshot.derived.deltas) : undefined)}
            />
          ))}
        </div>

        <div className="data-group">
          <h4>Data Quality</h4>
          <DataItem label="Sleep Score Available:" value={recoverySnapshot?.dataQuality.sleepScoreAvailable ? 'Yes' : 'No'} />
          <DataItem label="Resting HR Available:" value={recoverySnapshot?.dataQuality.restingHrAvailable ? 'Yes' : 'No'} />
          <DataItem label="HRV Available:" value={recoverySnapshot?.dataQuality.hrvAvailable ? 'Yes' : 'No'} />
          <DataItem label="Baseline 7d Ready:" value={recoverySnapshot?.dataQuality.baseline7dReady ? 'Yes' : 'No'} />
          <DataItem label="Baseline 28d Ready:" value={recoverySnapshot?.dataQuality.baseline28dReady ? 'Yes' : 'No'} />
        </div>
      </div>
    </div>
  );
}
