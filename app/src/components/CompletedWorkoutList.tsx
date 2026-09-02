/**
 * PR 2 (ADR-0034): the canonical-occurrence replacement for `ActivityTelemetry` when
 * `activitiesReadModelPolicy` resolves to `'canonical-v1'`. One card per physical workout
 * rather than one card per provider row -- a matched structured+Garmin workout renders
 * once, with Adaptive prescription/performance as the primary content and Garmin
 * telemetry as enrichment, never the reverse (ADR-0034 "Source precedence rules").
 */
import { useState } from 'react';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { sourceKeyForRef } from '../training-occurrence/sourceIdentity';
import { copyActivityJsonToClipboard } from '../utils/activityJsonExport';
import {
  formatRunningPower,
  formatTrainingEffectDescriptor,
  hasRunningDynamics,
  hrMeasurementDetail,
} from './activityTelemetryFormat';
import { ZoneBars } from './ZoneBars';
import './ActivityTelemetry.css';

interface CompletedWorkoutListProps {
  workouts: CompletedWorkoutView[] | null;
  onReclassify?: (activityId: string) => void;
  /** Diagnostic-only affordance (ADR-0034 "Manual reconciliation UX") -- omitted by
   * default; pass a handler to surface an "Unlink" control on matched workouts. */
  onUnlinkSource?: (performedOccurrenceId: string, sourceKey: string) => void;
}

function sourceBadgeLabel(workout: CompletedWorkoutView): string {
  if (workout.sourceBadge.hasStructured && workout.sourceBadge.hasProvider) {
    return `Adaptive Coach + ${workout.sourceBadge.providers.map(p => p[0]!.toUpperCase() + p.slice(1)).join(', ')}`;
  }
  if (workout.sourceBadge.hasStructured) return 'Adaptive Coach';
  if (workout.sourceBadge.hasProvider) return workout.sourceBadge.providers.map(p => p[0]!.toUpperCase() + p.slice(1)).join(', ');
  return 'Unknown source';
}

function workoutTitle(workout: CompletedWorkoutView): string {
  return workout.structured?.title ?? workout.garmin?.type.replaceAll('_', ' ') ?? 'Workout';
}

function formatLocalTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StructuredDetail({ structured }: { structured: NonNullable<CompletedWorkoutView['structured']> }) {
  const { comparison } = structured;
  return (
    <section className="activity-exercise-sets" aria-label="Prescribed vs performed">
      <h5>Adaptive prescription &amp; performance</h5>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #71717a)', margin: '0 0 0.5rem' }}>
        {comparison.completedStepsCount}/{comparison.totalPlannedSteps} steps completed
        {comparison.missingRequiredStepsCount > 0 ? ` · ${comparison.missingRequiredStepsCount} required step(s) missed` : ''}
        {comparison.summary.totalTonnageKg > 0 ? ` · ${Math.round(comparison.summary.totalTonnageKg)} kg total tonnage` : ''}
      </p>
      <div className="activity-lap-table-wrap">
        <table>
          <thead><tr><th>Step</th><th>Target sets</th><th>Completed</th><th>Warm-up</th><th>Status</th></tr></thead>
          <tbody>
            {comparison.stepComparisons.map(step => {
              const warmupCount = step.entries.filter(entry => entry.payload.kind === 'repetition' && entry.payload.isWarmup).length;
              return (
                <tr key={step.stepId}>
                  <td>{step.stepTitle}</td>
                  <td>{step.targetSets}</td>
                  <td>{step.completedSets}</td>
                  <td>{warmupCount > 0 ? `${warmupCount} warm-up` : '—'}</td>
                  <td>{step.isComplete ? '✓ complete' : step.isOptional ? 'optional, skipped' : '✗ missed'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GarminEnrichment({ workout }: { workout: CompletedWorkoutView }) {
  const activity = workout.garmin;
  if (!activity) return null;

  const runningDynamics = hasRunningDynamics(activity.runningDynamics) ? activity.runningDynamics : undefined;
  const runningPower = runningDynamics ? formatRunningPower(runningDynamics) : null;
  const hrDetail = hrMeasurementDetail(activity);
  const trainingEffectDescriptor = activity.primaryBenefit ?? activity.trainingEffectLabel;

  return (
    <>
      {(activity.trainingEffectAerobic != null || trainingEffectDescriptor) && (
        <p className="activity-te-metrics" style={{ fontSize: '0.8rem', color: 'var(--text-muted, #71717a)' }}>
          {trainingEffectDescriptor ? formatTrainingEffectDescriptor(trainingEffectDescriptor) : ''}
          {activity.trainingEffectAerobic != null ? ` · Aerobic TE ${activity.trainingEffectAerobic.toFixed(1)}` : ''}
          {activity.trainingEffectAnaerobic != null ? ` · Anaerobic TE ${activity.trainingEffectAnaerobic.toFixed(1)}` : ''}
        </p>
      )}
      {hrDetail !== null && (
        <section className="activity-hr-fidelity" aria-label="Heart-rate measurement quality">
          <h5>Heart-rate measurement</h5>
          <p><strong>{hrDetail.status}</strong></p>
          <p className="activity-hr-fidelity-reason">{hrDetail.reason}</p>
        </section>
      )}
      {runningDynamics !== undefined && (
        <section className="activity-dynamics" aria-label="Running Dynamics">
          <h5>Running Dynamics</h5>
          {runningPower !== null && <p>{runningPower}</p>}
        </section>
      )}
      {activity.powerInZones !== undefined && activity.powerInZones.length > 0 && (
        <ZoneBars title="Power zones" unit="W" zones={activity.powerInZones} />
      )}
      {activity.hrInZones !== undefined && activity.hrInZones.length > 0 && (
        <ZoneBars title="Heart-rate zones" unit="bpm" zones={activity.hrInZones} />
      )}
      {activity.exerciseSets !== undefined && activity.exerciseSets.length > 0 && (
        <section className="activity-exercise-sets" aria-label="Garmin-detected exercise sets">
          <h5>{workout.garminExerciseSetsAreDiagnosticOnly ? 'Garmin-detected sets (diagnostic only)' : 'Strength sets & reps'}</h5>
          <div className="activity-lap-table-wrap">
            <table>
              <thead><tr><th>Set</th><th>Exercise</th><th>Reps</th><th>Weight</th></tr></thead>
              <tbody>
                {activity.exerciseSets.map((set, idx) => (
                  <tr key={idx}>
                    <td>{set.setOrder + 1}</td>
                    <td>{(set.exerciseName || set.exerciseCategory || 'Exercise').replaceAll('_', ' ')}</td>
                    <td>{set.repetitionCount ?? '—'}</td>
                    <td>{set.weightKg != null ? `${set.weightKg} kg` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function ProvenanceDisclosure({ workout, onUnlinkSource }: { workout: CompletedWorkoutView; onUnlinkSource?: CompletedWorkoutListProps['onUnlinkSource'] }) {
  const garminSourceKey = workout.garmin
    ? sourceKeyForRef({ kind: 'provider_activity', provider: 'garmin', activityId: workout.garmin.activityId })
    : null;

  return (
    <details className="activity-telemetry-state" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
      <summary>Source provenance</summary>
      <p>State: {workout.reconciliation.state}{workout.reconciliation.matcherVersion ? ` · matcher ${workout.reconciliation.matcherVersion}` : ''}{workout.reconciliation.confidence != null ? ` · confidence ${workout.reconciliation.confidence.toFixed(2)}` : ''}</p>
      {workout.reconciliation.state === 'ambiguous' && <p>Ambiguous match -- kept separate rather than guessed.</p>}
      {onUnlinkSource && workout.sourceBadge.hasStructured && garminSourceKey && (
        <button
          type="button"
          className="btn-reclassify-activity"
          onClick={() => onUnlinkSource(workout.performedOccurrenceId, garminSourceKey)}
        >
          Unlink Garmin source
        </button>
      )}
    </details>
  );
}

export function CompletedWorkoutList({ workouts, onReclassify, onUnlinkSource }: CompletedWorkoutListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (workouts === null) return <p className="activity-telemetry-state">Loading recent activities…</p>;
  if (workouts.length === 0) return <p className="activity-telemetry-state">No workouts were recorded in the last seven days.</p>;

  const handleCopy = async (workout: CompletedWorkoutView) => {
    if (!workout.garmin) return;
    try {
      await copyActivityJsonToClipboard(workout.garmin);
      setCopiedId(workout.performedOccurrenceId);
      window.setTimeout(() => setCopiedId(curr => (curr === workout.performedOccurrenceId ? null : curr)), 2000);
    } catch (err) {
      console.error('Failed to copy activity JSON', err);
    }
  };

  return (
    <div className="activity-telemetry-list">
      {workouts.map(workout => {
        const startTime = formatLocalTime(workout.startedAt);
        const durationMin = workout.startedAt && workout.endedAt
          ? Math.round((Date.parse(workout.endedAt) - Date.parse(workout.startedAt)) / 60000)
          : workout.garmin?.durationMin ?? null;

        return (
          <article className="activity-telemetry-card" key={workout.performedOccurrenceId}>
            <header>
              <div>
                <h4>{workoutTitle(workout)}</h4>
                <p>
                  {workout.localDate ?? '—'}{startTime ? ` · ${startTime}` : ''} · {durationMin ?? '—'} min
                </p>
                <div className="activity-telemetry-badges" aria-label="Source">
                  <span className="activity-telemetry-badge">{sourceBadgeLabel(workout)}</span>
                </div>
              </div>
              <div className="activity-header-right">
                <div className="activity-card-actions">
                  {workout.garmin && (
                    <button
                      type="button"
                      className="btn-copy-activity-json"
                      onClick={() => handleCopy(workout)}
                    >
                      {copiedId === workout.performedOccurrenceId ? '✓ Copied JSON' : '📋 Copy JSON'}
                    </button>
                  )}
                  {onReclassify && workout.garmin && (
                    <button
                      type="button"
                      className="btn-reclassify-activity"
                      onClick={() => onReclassify(workout.garmin!.activityId)}
                    >
                      ✏️ Correct
                    </button>
                  )}
                </div>
              </div>
            </header>

            {workout.structured && <StructuredDetail structured={workout.structured} />}
            <GarminEnrichment workout={workout} />
            {!workout.structured && !workout.garmin && (
              <p className="activity-telemetry-empty">No structured or telemetry detail is available for this occurrence.</p>
            )}
            <ProvenanceDisclosure workout={workout} onUnlinkSource={onUnlinkSource} />
          </article>
        );
      })}
    </div>
  );
}
