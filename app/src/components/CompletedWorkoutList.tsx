/**
 * PR 2 (ADR-0034): the canonical-occurrence replacement for `ActivityTelemetry` when
 * `activitiesReadModelPolicy` resolves to `'canonical-v1'`. One card per physical workout
 * rather than one card per provider row -- a matched structured+Garmin workout renders
 * once, with Adaptive prescription/performance as the primary content and Garmin
 * telemetry as enrichment, never the reverse (ADR-0034 "Source precedence rules").
 */
import { useState } from 'react';
import type { ActivityOverride } from '../engine/models';
import { manualLinkCandidatesFor, type CompletedWorkoutView, type ReconciliationSweepStatus } from '../training-occurrence/completedWorkoutView';
import { formatCompletedWorkoutJson, resolveCompletedWorkoutDuration } from '../training-occurrence/completedWorkoutJsonExport';
import { copyDeferredText, StaleCopyError } from '../utils/copyDeferredText';
import { sessionResponseService } from '../services/sessionResponseService';
import { buildWorkoutAiCopy, loadWorkoutResponses, type ResponseLoader } from './completedWorkoutCopy';
import { formatLocalTime, sourceBadgeLabel, workoutTitle } from './completedWorkoutFormat';
import {
  GarminEnrichment,
  ManualLinkOffer,
  ProvenanceDisclosure,
  StructuredDetail,
} from './CompletedWorkoutCardSections';
import { DiagnosticsExportButton, WorkoutSourceDiagnostics, type DiagnosticsWindow } from './WorkoutSourceDiagnostics';
import './ActivityTelemetry.css';

export interface CompletedWorkoutListProps {
  userId?: string;
  onDetailsFetched?: () => void;
  activityOverrides?: Record<string, ActivityOverride>;
  workouts: CompletedWorkoutView[] | null;
  /** The displayed date window; when given, the list offers the bounded source-diagnostics
   * export (#895 WP5). User-initiated only. */
  exportWindow?: DiagnosticsWindow | null;
  /** The window sweep outcome. Only `completed` lets an empty window read as "nothing recorded";
   * anything else (or omitted) leaves it unknown (#895 WP5). */
  windowSweep?: ReconciliationSweepStatus;
  onReclassify?: (activityId: string) => void;
  /** Diagnostic-only affordance (ADR-0034 "Manual reconciliation UX") -- omitted by
   * default; pass a handler to surface an "Unlink" control on matched workouts. */
  onUnlinkSource?: (performedOccurrenceId: string, sourceKey: string) => void;
  /** Offered on a structured-only workout when a same-day Garmin-only workout could be the
   * same session recorded on the watch (see `manualLinkCandidatesFor`). */
  onLinkSources?: (structuredOccurrenceId: string, providerOccurrenceId: string) => void;
}

/** Renders reconciled completed workouts with source badges, structured set comparisons, and provider telemetry. */
export function CompletedWorkoutList({ workouts, exportWindow, windowSweep, onReclassify, onUnlinkSource, onLinkSources, userId, activityOverrides, onDetailsFetched }: CompletedWorkoutListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (workouts === null) return <p className="activity-telemetry-state">Loading recent activities…</p>;
  if (workouts.length === 0) {
    return (
      <>
        {exportWindow && <DiagnosticsExportButton range={exportWindow} result={{ status: 'available', workouts }} sweep={windowSweep} />}
        <p className="activity-telemetry-state">
          {windowSweep === 'completed'
            ? 'No workouts were recorded in the last seven days.'
            : 'No workouts were found, but the latest matching check did not evaluate every recording, so newly synced activities may be missing.'}
        </p>
      </>
    );
  }

  const responseLoader: ResponseLoader | undefined = userId
    ? executionId => sessionResponseService.getResponsesForSourceReadState(userId, { kind: 'execution', id: executionId })
    : undefined;

  const flash = (key: string) => {
    setCopiedId(key);
    setTimeout(() => setCopiedId(curr => (curr === key ? null : curr)), 2000);
  };

  // The text promise is created synchronously in the click so the clipboard write keeps the
  // user gesture (WebKit rejects writes that follow an await on Firestore reads).
  const copyWorkout = async (key: string, errorLabel: string, text: Promise<string>) => {
    try {
      await copyDeferredText(text);
      flash(key);
    } catch (err) {
      if (err instanceof StaleCopyError) return; // a newer copy superseded this one
      console.error(errorLabel, err);
      flash(`fail:${key}`);
    }
  };

  const handleCopy = (workout: CompletedWorkoutView) => copyWorkout(
    workout.performedOccurrenceId,
    'Failed to copy activity JSON',
    loadWorkoutResponses(workout, responseLoader)
      .then(responses => formatCompletedWorkoutJson(workout, new Date().toISOString(), responses)),
  );

  const handleCopyForAi = (workout: CompletedWorkoutView) => copyWorkout(
    `ai:${workout.performedOccurrenceId}`,
    'Failed to copy session report for AI',
    buildWorkoutAiCopy(workout, new Date().toISOString(), responseLoader, userId),
  );

  return (
    <>
    {exportWindow && <DiagnosticsExportButton range={exportWindow} result={{ status: 'available', workouts }} sweep={windowSweep} />}
    <div className="activity-telemetry-list">
      {workouts.map(workout => {
        const duration = resolveCompletedWorkoutDuration(workout);
        const startTime = formatLocalTime(
          duration?.startedAt ?? workout.structured?.execution?.startedAt ?? workout.startedAt ?? workout.garmin?.startedAt,
        );
        const durationMin = duration?.minutes ?? null;

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
                  {(workout.structured || workout.garmin) && (
                    <button
                      type="button"
                      className="btn-copy-activity-json"
                      title="Copy what was performed: exercises, sets, weights, RPE, rest and actual duration"
                      onClick={() => handleCopy(workout)}
                    >
                      {copiedId === `fail:${workout.performedOccurrenceId}` ? 'Copy failed' : copiedId === workout.performedOccurrenceId ? '✓ Copied JSON' : '📋 Copy JSON'}
                    </button>
                  )}
                  {(workout.structured || workout.garmin) && (
                    <button
                      type="button"
                      className="btn-copy-activity-json"
                      title="Copy a Markdown session report to paste into an AI assistant"
                      onClick={() => handleCopyForAi(workout)}
                    >
                      {copiedId === `fail:ai:${workout.performedOccurrenceId}` ? 'Copy failed' : copiedId === `ai:${workout.performedOccurrenceId}` ? '✓ Copied for AI' : '📋 Copy for AI'}
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
            <GarminEnrichment workout={workout} userId={userId} onDetailsFetched={onDetailsFetched} legacyRpe={workout.garmin ? activityOverrides?.[workout.garmin.activityId]?.rpe : undefined} />
            {!workout.structured && !workout.garmin && (
              <p className="activity-telemetry-empty">No session or Garmin detail could be shown for this workout. The source checks below say why.</p>
            )}
            <WorkoutSourceDiagnostics workout={workout} />
            <ProvenanceDisclosure workout={workout} onUnlinkSource={onUnlinkSource} />
          </article>
        );
      })}
    </div>
    </>
  );
}
