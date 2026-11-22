/**
 * Presentational card subsections for `CompletedWorkoutList`.
 * Keep these hook-free: `CompletedWorkoutList.interaction.test.tsx` calls function
 * components directly without a React runtime.
 */
import type { CompletedWorkoutView, ManualLinkCandidate } from '../training-occurrence/completedWorkoutView';
import { sourceKeyForRef } from '../training-occurrence/sourceIdentity';
import {
  formatRunningPower,
  formatTrainingEffectDescriptor,
  hasRunningDynamics,
  hrMeasurementDetail,
} from './activityTelemetryFormat';
import type { CompletedWorkoutListProps } from './CompletedWorkoutList';
import {
  formatLocalTime,
  formatPerformed,
  formatRest,
  formatTarget,
  stepStatus,
} from './completedWorkoutFormat';
import { ZoneBars } from './ZoneBars';
import { ActivityLaps } from './ActivityLaps';
import { ActivityDetailsFetchButton } from './ActivityDetailsFetchButton';
import { ActivityDetailsEditor } from './ActivityDetailsEditor';

export type { CompletedWorkoutListProps };

export function StructuredDetail({ structured }: { structured: NonNullable<CompletedWorkoutView['structured']> }) {
  const { comparison, steps, performedRest } = structured;
  const comparisonByStepId = new Map(comparison.stepComparisons.map(step => [step.stepId, step] as const));
  return (
    <section className="activity-exercise-sets completed-workout-structured" aria-label="Prescribed vs performed">
      <h5>Sets, reps &amp; rest</h5>
      <p className="completed-workout-summary">
        {comparison.completedStepsCount}/{comparison.totalPlannedSteps} steps completed
        {comparison.missingRequiredStepsCount > 0 ? ` · ${comparison.missingRequiredStepsCount} required step(s) missed` : ''}
        {comparison.summary.totalTonnageKg > 0 ? ` · ${Math.round(comparison.summary.totalTonnageKg)} kg total tonnage` : ''}
        {performedRest === 'not_recorded' ? ' · actual rest not recorded for this session' : ''}
        {performedRest === 'unavailable' ? ' · actual rest could not be loaded' : ''}
      </p>
      {steps.map(step => (
        <div className="completed-workout-step" key={step.stepId}>
          <div className="completed-workout-step-head">
            <strong>{step.title}</strong>
            <span className="completed-workout-step-status">
              {step.unplanned ? 'added during session' : stepStatus(comparisonByStepId.get(step.stepId))}
            </span>
          </div>
          {step.plannedTitle && <p className="completed-workout-step-swap">Swapped from {step.plannedTitle}</p>}
          {!step.unplanned && <p className="completed-workout-step-target">Target: {formatTarget(step.prescribed)}</p>}
          {step.sets.length > 0 && (
            <ol className="completed-workout-sets" aria-label={`${step.title} sets`}>
              {step.sets.map(set => {
                const rest = set.rest ? formatRest(set.rest) : null;
                return (
                  <li key={set.entryId} className={set.isWarmup ? 'is-warmup' : undefined}>
                    <span className="completed-workout-set-label">{set.isWarmup ? `Warm-up ${set.setNumber}` : `Set ${set.setNumber}`}</span>
                    <span className="completed-workout-set-performed">{set.side ? `${set.side === 'left' ? 'Left' : 'Right'} · ` : ''}{formatPerformed(set.payload)}</span>
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

export function HeartRateSummary({ activity }: { activity: NonNullable<CompletedWorkoutView['garmin']> }) {
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

export function GarminExerciseSetsTable({ sets }: { sets: NonNullable<NonNullable<CompletedWorkoutView['garmin']>['exerciseSets']> }) {
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

export function GarminEnrichment({ workout, userId, legacyRpe, onDetailsFetched }: { workout: CompletedWorkoutView; userId?: string; legacyRpe?: number | null; onDetailsFetched?: () => void }) {
  const activity = workout.garmin;
  if (!activity) return null;

  const runningDynamics = hasRunningDynamics(activity.runningDynamics) ? activity.runningDynamics : undefined;
  const runningPower = runningDynamics ? formatRunningPower(runningDynamics) : null;
  const hrDetail = hrMeasurementDetail(activity);
  const trainingEffectDescriptor = activity.primaryBenefit ?? activity.trainingEffectLabel;

  return (
    <>
      <HeartRateSummary activity={activity} />
      {userId && <ActivityDetailsEditor userId={userId} activityId={activity.activityId} providerType={activity.type} legacyRpe={legacyRpe} />}
      {userId && <ActivityDetailsFetchButton key={`${userId}:${activity.activityId}`} userId={userId}
        activityId={activity.activityId} hasLaps={!!activity.laps?.length} onFetched={onDetailsFetched} />}
      <ActivityLaps activity={activity} userId={userId} />
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

export function ManualLinkOffer({ workout, candidates, onLinkSources }: {
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

export function ProvenanceDisclosure({ workout, onUnlinkSource }: { workout: CompletedWorkoutView; onUnlinkSource?: CompletedWorkoutListProps['onUnlinkSource'] }) {
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
