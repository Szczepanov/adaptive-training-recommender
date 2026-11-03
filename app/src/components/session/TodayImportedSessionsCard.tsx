import { useEffect, useState } from 'react';
import type { ExternalPlacementStatus, ExternalPrescriptionStep } from '../../engine/models';
import type { PlacedSession } from '../../engine/externalPlacement';
import type { ExternalSessionDecision } from '../../engine/externalSession';
import {
  externalSessionDisplayPrescription,
  sessionDefinitionToDisplayPrescription,
} from '../../engine/externalSessionProfiles';
import { prepareExternalPlanSessionLaunch } from '../../services/sessionAuthoringService';
import { sessionExecutionService } from '../../services/sessionExecutionService';
import { sessionOccurrenceService } from '../../services/sessionOccurrenceService';
import { canLaunchExternalPlanSession } from '../../sessions/sessionLaunch';
import type { SessionExecution, SessionReferenceBinding } from '../../sessions/models';
import { WorkoutExportMenu } from '../WorkoutExportMenu';
import './TodayImportedSessionsCard.css';

const MODALITY_ICON: Record<string, string> = {
  Running: '🏃',
  Cycling: '🚴',
  Walking: '🚶',
  Strength: '🏋️',
  Field: '⚽',
  Mobility: '🧘',
  'Cross Training': '🔀',
  None: '💤',
  running: '🏃',
  cycling: '🚴',
  walking: '🚶',
  strength: '🏋️',
  field: '⚽',
  mobility: '🧘',
  cross_training: '🔀',
};

const STATUS_LABEL: Record<ExternalPlacementStatus, string> = {
  planned: 'Planned',
  moved: 'Moved',
  completed: 'Done ✓',
  dropped: 'Dropped',
  superseded: 'Replaced',
};

function formatStepDuration(step: ExternalPrescriptionStep): string | null {
  const parts: string[] = [];
  if (step.sets && step.sets > 1) parts.push(`${step.sets}×`);
  if (step.repeat !== undefined) parts.push(`${step.repeat} reps`);
  if (step.durationMin !== undefined) parts.push(`${step.durationMin} min`);
  else if (step.durationSec !== undefined) parts.push(`${step.durationSec} s`);
  const main = parts.join(' ');
  const rec = step.recoveryMin !== undefined
    ? `${step.recoveryMin} min easy`
    : step.recoverySec !== undefined
      ? `${step.recoverySec} s easy`
      : null;
  if (main && rec) return `${main} (${rec})`;
  return main || rec || null;
}

export interface TodayImportedSessionsCardProps {
  userId: string;
  date: string;
  planId: string;
  revision: number;
  planTitle: string;
  contentHash: string;
  /** Sessions to render as full cards in this section. */
  sessions: readonly PlacedSession[];
  /** All placed sessions on `date` (including any primary session shown in MorningDecisionCard). */
  allTodaySessions: readonly PlacedSession[];
  /** Session ID already rendered in the primary MorningDecisionCard above, if any. */
  primaryDisplayedSessionId?: string | null;
  /** Whether clinical safety escalation blocks workout details, export, and session launch. */
  clinicalEscalationRequired?: boolean;
  /** Only individually adjudicated proceed sessions can launch from this authored-dose view. */
  verdictsBySessionId?: Readonly<Record<string, ExternalSessionDecision | undefined>>;
  /** Callback to open SessionRunner for a launched or resumed session. */
  onStartSession?: (binding: SessionReferenceBinding, options?: { allowDuplicateCompleted?: boolean }) => void | Promise<void>;
}

export function TodayImportedSessionsCard({
  userId,
  date,
  planId,
  revision,
  planTitle,
  contentHash,
  sessions,
  allTodaySessions,
  primaryDisplayedSessionId = null,
  clinicalEscalationRequired = false,
  verdictsBySessionId,
  onStartSession,
}: TodayImportedSessionsCardProps) {
  const [selectedVariants, setSelectedVariants] = useState<Record<string, 'full' | 'reduced'>>({});
  const [executionsBySessionId, setExecutionsBySessionId] = useState<Record<string, SessionExecution>>({});
  const [launchingSessionId, setLaunchingSessionId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !date || sessions.length === 0) return () => { cancelled = true; };
    sessionOccurrenceService.getExternalPlanOccurrencesForDate(userId, date)
      .then(async occurrences => {
        if (cancelled) return;
        const map: Record<string, SessionExecution> = {};
        for (const occ of occurrences) {
          if (occ.externalPlanRef.planId !== planId || occ.externalPlanRef.revision !== revision) continue;
          const exec = await sessionExecutionService.findExistingExecution(userId, {
            date,
            occurrenceId: occ.occurrenceId,
          });
          if (cancelled) return;
          if (exec) {
            const sid = occ.externalPlanRef.sessionId;
            const prev = map[sid];
            if (!prev || exec.state === 'in_progress' || (exec.state === 'completed' && prev.state !== 'in_progress')) {
              map[sid] = exec;
            }
          }
        }
        if (!cancelled) setExecutionsBySessionId(map);
      })
      .catch(() => {
        // Non-blocking: Start button remains available if execution history read fails.
      });
    return () => { cancelled = true; };
  }, [userId, date, planId, revision, sessions]);

  if (sessions.length === 0) return null;

  const isAdditionalView = Boolean(primaryDisplayedSessionId && allTodaySessions.length > sessions.length);
  const heading = isAdditionalView
    ? `Additional Planned ${sessions.length === 1 ? 'Session' : 'Sessions'} Today (${sessions.length} more)`
    : `Today in ${planTitle} (${allTodaySessions.length} ${allTodaySessions.length === 1 ? 'session' : 'sessions'} planned)`;

  const handleLaunch = async (item: PlacedSession) => {
    if (!onStartSession || clinicalEscalationRequired) return;
    const session = item.session;
    if (verdictsBySessionId?.[session.id] !== 'proceed' ||
      !canLaunchExternalPlanSession(session, { verdictDecision: verdictsBySessionId[session.id], isEvent: session.isEvent })) return;
    const existingExec = executionsBySessionId[session.id];
    if (existingExec?.state === 'in_progress' && existingExec.occurrenceId && existingExec.prescriptionHash) {
      onStartSession({
        sessionSource: existingExec.sessionSource,
        occurrenceId: existingExec.occurrenceId,
        prescriptionHash: existingExec.prescriptionHash,
      });
      return;
    }

    const reducedDef = session.scaling && 'reducedDefinition' in session.scaling
      ? session.scaling.reducedDefinition
      : undefined;
    const useReduced = selectedVariants[session.id] === 'reduced' && Boolean(session.scaling?.reducible && reducedDef);

    setLaunchingSessionId(session.id);
    setLaunchError(null);
    try {
      const launch = await prepareExternalPlanSessionLaunch(
        userId,
        {
          planId,
          revision,
          contentHash,
          session,
        },
        {
          date,
          useReducedDefinition: useReduced,
          ...(useReduced ? { scaleVolume: 1 } : {}),
          allowPreviouslyLaunchedOccurrence: true,
        },
      );
      await onStartSession(
        launch.binding,
        existingExec?.state === 'completed' ? { allowDuplicateCompleted: true } : undefined,
      );
    } catch (err) {
      console.warn('Failed to prepare imported session launch:', err);
      setLaunchError(`Could not start ${session.title}. Please try again.`);
    } finally {
      setLaunchingSessionId(null);
    }
  };

  return (
    <section
      className="dashboard-card today-imported-sessions-card"
      aria-label="Planned sessions from imported plan today"
    >
      <div className="today-imported-header">
        <div className="today-imported-title-group">
          <span className="today-imported-kicker">
            📋 Imported Plan · {planTitle} (r{revision})
          </span>
          <h3 className="today-imported-heading">{heading}</h3>
        </div>
        {allTodaySessions.length > 1 && (
          <div className="today-imported-overview-pills" aria-label="All sessions planned for today">
            {allTodaySessions.map((item, idx) => {
              const isPrimaryAbove = item.session.id === primaryDisplayedSessionId;
              return (
                <span
                  key={item.session.id}
                  className={`today-imported-overview-pill ${isPrimaryAbove ? 'is-primary-above' : ''}`}
                >
                  <span aria-hidden="true">{MODALITY_ICON[item.session.gating.modality] ?? '❔'}</span>
                  <span>
                    {idx + 1}. {item.session.title}
                    {isPrimaryAbove ? ' (above)' : ''}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {launchError && (
        <p className="today-imported-error" role="alert">{launchError}</p>
      )}

      <ul className="today-imported-list">
        {sessions.map(item => {
          const { session } = item;
          const orderIndex = allTodaySessions.findIndex(s => s.session.id === session.id);
          const sessionNumber = orderIndex >= 0 ? orderIndex + 1 : 1;
          const intraday = 'intraday' in session ? session.intraday : undefined;
          const reducedDef = session.scaling && 'reducedDefinition' in session.scaling
            ? session.scaling.reducedDefinition
            : undefined;
          const hasReducedVariant = Boolean(session.scaling?.reducible && reducedDef);
          const activeVariant = hasReducedVariant && selectedVariants[session.id] === 'reduced' ? 'reduced' : 'full';
          const displayPrescription = activeVariant === 'reduced' && reducedDef
            ? sessionDefinitionToDisplayPrescription(reducedDef)
            : externalSessionDisplayPrescription(session);
          const steps = displayPrescription.steps ?? [];
          const existingExec = executionsBySessionId[session.id];
          const isCompleted = existingExec?.state === 'completed' || item.status === 'completed';
          const isInProgress = existingExec?.state === 'in_progress';
          const canLaunch = Boolean(
            onStartSession &&
            !clinicalEscalationRequired &&
            verdictsBySessionId?.[session.id] === 'proceed' &&
            canLaunchExternalPlanSession(session, { verdictDecision: verdictsBySessionId[session.id], isEvent: session.isEvent }),
          );

          const durationMin = activeVariant === 'reduced' && reducedDef?.duration
            ? reducedDef.duration.min
            : session.gating.durationMin;
          const durationMax = activeVariant === 'reduced' && reducedDef?.duration
            ? reducedDef.duration.max
            : session.gating.durationMax;

          return (
            <li key={session.id} className="today-imported-session-item">
              <div className="today-imported-session-top">
                <div className="today-imported-session-identity">
                  {allTodaySessions.length > 1 && (
                    <span className="today-imported-order-badge">
                      Session {sessionNumber} of {allTodaySessions.length}
                    </span>
                  )}
                  {intraday?.window && (
                    <span className="today-imported-window-badge">
                      🕒 {intraday.window.startLocal}–{intraday.window.endLocal}
                    </span>
                  )}
                  <h4 className="today-imported-session-title">
                    <span aria-hidden="true">{MODALITY_ICON[session.gating.modality] ?? '❔'}</span>{' '}
                    {session.title}
                  </h4>
                </div>
                <div className="today-imported-badges">
                  <span className={`today-imported-priority priority-${session.priority}`}>
                    {session.priority}
                  </span>
                  <span className={`today-imported-status status-${isCompleted ? 'completed' : item.status}`}>
                    {isInProgress ? 'In progress' : isCompleted ? 'Completed ✓' : STATUS_LABEL[item.status]}
                  </span>
                </div>
              </div>

              <p className="today-imported-meta">
                {session.gating.modality} · {session.gating.intensity} · {durationMin}–{durationMax} min
                {activeVariant === 'reduced' ? ' (reduced version)' : ''}
                {item.moved ? ' · Rescheduled' : ''}
              </p>

              {hasReducedVariant && (
                <div className="today-imported-variant-toggle" role="group" aria-label={`Dose version for ${session.title}`}>
                  <button
                    type="button"
                    className={`today-imported-variant-btn ${activeVariant === 'full' ? 'active' : ''}`}
                    aria-pressed={activeVariant === 'full'}
                    onClick={() => setSelectedVariants(prev => ({ ...prev, [session.id]: 'full' }))}
                  >
                    Full authored dose ({session.gating.durationMin}–{session.gating.durationMax} min)
                  </button>
                  <button
                    type="button"
                    className={`today-imported-variant-btn ${activeVariant === 'reduced' ? 'active' : ''}`}
                    aria-pressed={activeVariant === 'reduced'}
                    onClick={() => setSelectedVariants(prev => ({ ...prev, [session.id]: 'reduced' }))}
                  >
                    Reduced version
                    {reducedDef?.duration ? ` (${reducedDef.duration.min}–${reducedDef.duration.max} min)` : ''}
                  </button>
                </div>
              )}

              <p className="today-imported-summary">{displayPrescription.summary}</p>

              {!hasReducedVariant && session.scaling?.reducible && session.scaling.reducedSummary && (
                <p className="today-imported-reduced-note">
                  <strong>Reduced option:</strong> {session.scaling.reducedSummary}
                </p>
              )}

              {!clinicalEscalationRequired && steps.length > 0 && (
                <details className="today-imported-steps-details">
                  <summary>Workout steps ({steps.length})</summary>
                  <ol className="today-imported-steps-list">
                    {steps.map((step, idx) => {
                      const dur = formatStepDuration(step);
                      return (
                        <li key={`${step.name}-${idx}`}>
                          <span className="step-name">{step.name}</span>
                          {step.target && <span className="step-target">{step.target}</span>}
                          {dur && <span className="step-duration">{dur}</span>}
                          {step.notes && <span className="step-notes">{step.notes}</span>}
                        </li>
                      );
                    })}
                  </ol>
                </details>
              )}

              <div className="today-imported-actions">
                {!clinicalEscalationRequired && !session.isEvent && (
                  <WorkoutExportMenu
                    userId={userId}
                    date={date}
                    title={session.title}
                    modality={session.gating.modality}
                    externalSession={session}
                    garminSyncDisabled={verdictsBySessionId?.[session.id] !== 'proceed'}
                  />
                )}
                {canLaunch && (
                  <button
                    type="button"
                    className={`today-imported-start-btn ${isCompleted ? 'is-redo' : ''}`}
                    disabled={launchingSessionId === session.id}
                    aria-label={
                      isInProgress
                        ? `Resume ${session.title}`
                        : isCompleted
                          ? `Redo ${session.title}`
                          : `Start ${session.title}`
                    }
                    onClick={() => { void handleLaunch(item); }}
                  >
                    {launchingSessionId === session.id
                      ? 'Preparing…'
                      : isInProgress
                        ? `Resume ${session.title} →`
                        : isCompleted
                          ? `Redo ${session.title}`
                          : `Start ${session.title} →`}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
