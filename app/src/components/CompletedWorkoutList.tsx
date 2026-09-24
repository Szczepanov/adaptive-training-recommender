/**
 * PR 2 (ADR-0034): the canonical-occurrence replacement for `ActivityTelemetry` when
 * `activitiesReadModelPolicy` resolves to `'canonical-v1'`. One card per physical workout
 * rather than one card per provider row -- a matched structured+Garmin workout renders
 * once, with Adaptive prescription/performance as the primary content and Garmin
 * telemetry as enrichment, never the reverse (ADR-0034 "Source precedence rules").
 */
import { useState } from 'react';
import type { IntensityGauge } from '../engine/models';
import { formatSessionLoad } from '../sessions/loadDisplay';
import type { RangeOrNumber, SessionEffort, SessionEntryPayload } from '../sessions/models';
import type { PerformedSessionComparison } from '../sessions/performedComparison';
import { manualLinkCandidatesFor, type CompletedWorkoutView, type ManualLinkCandidate } from '../training-occurrence/completedWorkoutView';
import type { PerformedRestDetail, PrescribedStepTarget, StructuredStepDetail } from '../training-occurrence/structuredSetDetail';
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
  /** Offered on a structured-only workout when a same-day Garmin-only workout could be the
   * same session recorded on the watch (see `manualLinkCandidatesFor`). */
  onLinkSources?: (structuredOccurrenceId: string, providerOccurrenceId: string) => void;
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
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  });
}

function formatRange(value: RangeOrNumber, format: (n: number) => string = String): string {
  return typeof value === 'number' ? format(value) : `${format(value.min)}–${format(value.max)}`;
}

function formatClock(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatEffort(effort: SessionEffort): string | null {
  if (effort.rir !== undefined) return `RIR ${formatRange(effort.rir)}`;
  if (effort.rpe !== undefined) return `RPE ${formatRange(effort.rpe)}`;
  return null;
}

function formatGauge(gauge: IntensityGauge): string {
  switch (gauge.scale) {
    case 'rir': return `RIR ${gauge.value}`;
    case 'rpe_rts': return `RPE ${gauge.value}`;
    case 'velocity_loss': return `VL ${gauge.percent}%`;
    case 'technical': return gauge.met ? 'technique held' : 'technique broke down';
  }
}

function formatTarget(target: PrescribedStepTarget): string {
  const parts: string[] = [];
  if (target.reps !== undefined) parts.push(`${target.sets} × ${formatRange(target.reps)}`);
  else if (target.seconds !== undefined) parts.push(`${target.sets} × ${formatRange(target.seconds, formatClock)}`);
  else if (target.meters !== undefined) parts.push(`${target.sets} × ${formatRange(target.meters)} m`);
  else parts.push(`${target.sets} ${target.sets === 1 ? 'set' : 'sets'}`);
  if (target.load) parts[0] += ` @ ${formatSessionLoad(target.load)}`;
  const effort = target.effort ? formatEffort(target.effort) : null;
  if (effort) parts.push(effort);
  if (target.restSeconds !== undefined) parts.push(`rest ${formatRange(target.restSeconds, formatClock)}`);
  return parts.join(' · ');
}

function formatPerformed(payload: SessionEntryPayload): string {
  switch (payload.kind) {
    case 'repetition': {
      const work = payload.weightKg !== undefined && payload.weightKg > 0
        ? `${payload.reps} × ${payload.weightKg} kg`
        : `${payload.reps} reps`;
      return payload.gauge ? `${work} · ${formatGauge(payload.gauge)}` : work;
    }
    case 'duration':
      return `${formatClock(payload.seconds)}${payload.loadKg ? ` @ ${payload.loadKg} kg` : ''}`;
    case 'distance':
      return `${payload.meters} m${payload.durationSeconds !== undefined ? ` in ${formatClock(payload.durationSeconds)}` : ''}`;
    case 'sprint':
      return `${payload.meters} m in ${payload.splitSeconds.toFixed(2)} s`;
    case 'jump_attempt':
      if (payload.heightInches !== undefined) return `${payload.heightInches} in`;
      return payload.distanceMeters !== undefined ? `${payload.distanceMeters} m` : 'Attempt';
    case 'checkoff':
      return payload.completed ? 'Done' : 'Not done';
    case 'choice':
      return 'Choice';
  }
}

/** Rest that ran until the session ended is not rest between sets -- omitted rather
 * than shown as a misleadingly long interval. */
function formatRest(rest: PerformedRestDetail): string | null {
  if (rest.endReason === 'session_ended') return null;
  const actual = rest.endReason === 'skipped' ? `Rest skipped at ${formatClock(rest.actualSeconds)}` : `Rest ${formatClock(rest.actualSeconds)}`;
  return rest.prescribedSeconds !== undefined ? `${actual} (target ${formatClock(rest.prescribedSeconds)})` : actual;
}

function stepStatus(step: StructuredStepDetail, comparison: PerformedSessionComparison['stepComparisons'][number] | undefined): string {
  if (comparison?.isComplete) return '✓ complete';
  if (step.isOptional) return step.sets.length > 0 ? 'optional, partial' : 'optional, skipped';
  return step.sets.length > 0 ? `✗ ${comparison?.completedSets ?? step.sets.length}/${step.prescribed.sets} sets` : '✗ missed';
}

function StructuredDetail({ structured }: { structured: NonNullable<CompletedWorkoutView['structured']> }) {
  const { comparison, steps, hasPerformedRest } = structured;
  const comparisonByStepId = new Map(comparison.stepComparisons.map(step => [step.stepId, step] as const));
  return (
    <section className="activity-exercise-sets completed-workout-structured" aria-label="Prescribed vs performed">
      <h5>Sets, reps &amp; rest</h5>
      <p className="completed-workout-summary">
        {comparison.completedStepsCount}/{comparison.totalPlannedSteps} steps completed
        {comparison.missingRequiredStepsCount > 0 ? ` · ${comparison.missingRequiredStepsCount} required step(s) missed` : ''}
        {comparison.summary.totalTonnageKg > 0 ? ` · ${Math.round(comparison.summary.totalTonnageKg)} kg total tonnage` : ''}
        {hasPerformedRest ? '' : ' · actual rest not recorded for this session'}
      </p>
      {steps.map(step => (
        <div className="completed-workout-step" key={step.stepId}>
          <div className="completed-workout-step-head">
            <strong>{step.title}</strong>
            <span className="completed-workout-step-status">{stepStatus(step, comparisonByStepId.get(step.stepId))}</span>
          </div>
          <p className="completed-workout-step-target">Target: {formatTarget(step.prescribed)}</p>
          {step.sets.length > 0 && (
            <ol className="completed-workout-sets" aria-label={`${step.title} sets`}>
              {step.sets.map(set => {
                const rest = set.rest ? formatRest(set.rest) : null;
                return (
                  <li key={set.entryId} className={set.isWarmup ? 'is-warmup' : undefined}>
                    <span className="completed-workout-set-label">{set.isWarmup ? `Warm-up ${set.setNumber}` : `Set ${set.setNumber}`}</span>
                    <span className="completed-workout-set-performed">{formatPerformed(set.payload)}</span>
                    {rest && <span className="completed-workout-set-rest">{rest}</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ))}
    </section>
  );
}

function HeartRateSummary({ activity }: { activity: NonNullable<CompletedWorkoutView['garmin']> }) {
  if (activity.averageHr === null && activity.maxHr === undefined) return null;
  const parts: string[] = [];
  if (activity.averageHr !== null) parts.push(`Avg ${Math.round(activity.averageHr)} bpm`);
  if (activity.maxHr !== undefined) parts.push(`Max ${Math.round(activity.maxHr)} bpm`);
  if (activity.durationMin !== null) parts.push(`${activity.durationMin} min recorded on watch`);
  return (
    <p className="completed-workout-hr" aria-label="Heart rate">
      <strong>Heart rate</strong> · {parts.join(' · ')}
    </p>
  );
}

function GarminExerciseSetsTable({ sets }: { sets: NonNullable<NonNullable<CompletedWorkoutView['garmin']>['exerciseSets']> }) {
  return (
    <div className="activity-lap-table-wrap">
      <table>
        <thead><tr><th>Set</th><th>Exercise</th><th>Reps</th><th>Weight</th></tr></thead>
        <tbody>
          {sets.map((set, idx) => (
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
      <HeartRateSummary activity={activity} />
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
        workout.garminExerciseSetsAreDiagnosticOnly ? (
          // A structured source is canonical for exercise/reps/weight (ADR-0034); Garmin's
          // own recognition stays inspectable but collapsed, never a competing listing.
          <details className="activity-exercise-sets completed-workout-diagnostics">
            <summary>Garmin-detected sets (diagnostic only)</summary>
            <GarminExerciseSetsTable sets={activity.exerciseSets} />
          </details>
        ) : (
          <section className="activity-exercise-sets" aria-label="Garmin-detected exercise sets">
            <h5>Strength sets &amp; reps</h5>
            <GarminExerciseSetsTable sets={activity.exerciseSets} />
          </section>
        )
      )}
    </>
  );
}

function ManualLinkOffer({ workout, candidates, onLinkSources }: {
  workout: CompletedWorkoutView;
  candidates: ManualLinkCandidate[];
  onLinkSources: NonNullable<CompletedWorkoutListProps['onLinkSources']>;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="completed-workout-link-offer" aria-label="Link watch recording">
      <p>Recorded this on your watch too? Link it to see heart rate with these sets.</p>
      {candidates.map(candidate => {
        const start = formatLocalTime(candidate.activity.startedAt);
        const label = [
          candidate.activity.type.replaceAll('_', ' '),
          start,
          candidate.activity.durationMin !== null ? `${candidate.activity.durationMin} min` : null,
        ].filter(Boolean).join(' · ');
        return (
          <button
            key={candidate.providerOccurrenceId}
            type="button"
            className="btn-reclassify-activity"
            onClick={() => onLinkSources(workout.performedOccurrenceId, candidate.providerOccurrenceId)}
          >
            Link Garmin {label}
          </button>
        );
      })}
    </section>
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

export function CompletedWorkoutList({ workouts, onReclassify, onUnlinkSource, onLinkSources }: CompletedWorkoutListProps) {
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
            {onLinkSources && (
              <ManualLinkOffer workout={workout} candidates={manualLinkCandidatesFor(workout, workouts)} onLinkSources={onLinkSources} />
            )}
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
