import { useEffect, useState } from 'react';
import type { ExternalPlacementStatus, ExternalPrescriptionStep } from '../engine/models';
import type { InjuryConstraint } from '../ledger/models';
import type { PlacedSession } from '../engine/externalPlacement';
import { externalSessionDisplayPrescription } from '../engine/externalSessionProfiles';
import type { PersistedFlagEvaluation } from '../ledger/flagEvaluation';
import type { DailySubjectiveCheckin } from '../ledger/models';
import { hasRecordedRedFlag } from '../ledger/redFlagPause';
import { resolveTodayFlagStripItems, type FlagStripItem, type SessionFlagInput } from '../derived/flags/flagStripItems';
import { evaluateIllnessRiskSymptom } from '../derived/flags/illnessRiskSymptom';
import { evaluateInjuryConstraintTouchesSession } from '../derived/flags/injuryConstraintTouchesSession';
import { flagEvaluationRepository } from '../services/flagEvaluationPersistence';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { FlagStrip } from './FlagStrip';
import {
  externalRestContextForDate,
  type ActiveExternalPlan,
} from '../services/activeExternalPlanService';
import {
  ExternalPlanLaunchValidationError,
  prepareExternalPlanSessionLaunch,
} from '../services/sessionAuthoringService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { sessionOccurrenceService } from '../services/sessionOccurrenceService';
import { isDefinitionBearingExternalSession } from '../sessions/externalPlanV2';
import type { SessionExecution, SessionReferenceBinding } from '../sessions/models';
import type { Screen } from '../types/navigation';
import { LedgerSessionAiCopyButton } from './LedgerSessionAiCopyButton';
import { WorkoutExportMenu } from './WorkoutExportMenu';
import './LedgerTodayCard.css';

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

export interface LedgerTodayCardProps {
  userId: string;
  date: string;
  activeExternalPlan: ActiveExternalPlan | null;
  sessions: readonly PlacedSession[];
  todayCheckIn: DailySubjectiveCheckin | null;
  flags?: readonly FlagStripItem[];
  onNavigate: (screen: Screen) => void;
  onStartSession?: (binding: SessionReferenceBinding, options?: { allowDuplicateCompleted?: boolean }) => void | Promise<void>;
}

export function LedgerTodayCard({
  userId,
  date,
  activeExternalPlan,
  sessions,
  todayCheckIn,
  flags,
  onNavigate,
  onStartSession,
}: LedgerTodayCardProps) {
  const [executionsBySessionId, setExecutionsBySessionId] = useState<Record<string, SessionExecution>>({});
  const [launchingKey, setLaunchingKey] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [capturedFlags, setCapturedFlags] = useState<readonly PersistedFlagEvaluation[]>([]);
  const [injuryConstraints, setInjuryConstraints] = useState<readonly InjuryConstraint[] | null>(null);

  const planId = activeExternalPlan?.plan.planId ?? null;
  const revision = activeExternalPlan?.plan.revision ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!userId || !date || !planId || revision === null || sessions.length === 0) {
      setExecutionsBySessionId({});
      return () => { cancelled = true; };
    }
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
        // Non-blocking: Start remains available if execution history read fails.
      });
    return () => { cancelled = true; };
  }, [userId, date, planId, revision, sessions]);

  useEffect(() => {
    let cancelled = false;
    if (flags !== undefined || !userId || !date) return () => { cancelled = true; };
    Promise.all([
      flagEvaluationRepository.getInRangeState(userId, date, date).catch(() => null),
      trainingSettingsService.peekTrainingSettingsState(userId).catch(() => null),
    ]).then(([flagState, settingsState]) => {
      if (cancelled) return;
      if (flagState?.status === 'AVAILABLE') {
        setCapturedFlags(flagState.data);
      } else {
        setCapturedFlags([]);
      }
      if (settingsState?.status === 'AVAILABLE') {
        setInjuryConstraints(settingsState.data.injuries ?? null);
      } else {
        setInjuryConstraints(null);
      }
    });
    return () => { cancelled = true; };
  }, [userId, date, flags]);

  const flagStripItems: readonly FlagStripItem[] = flags ?? resolveTodayFlagStripItems({
    capturedFlags,
    sessionEvaluations: activeExternalPlan
      ? sessions.map((item): SessionFlagInput => {
        const sessionRef = `external_plan:${activeExternalPlan.plan.planId}@${activeExternalPlan.plan.revision}:${item.session.id}`;
        const definition = 'definition' in item.session ? item.session.definition : null;
        return {
          sessionRef,
          sessionTitle: item.session.title,
          evaluation: evaluateInjuryConstraintTouchesSession(injuryConstraints, date, definition),
        };
      })
      : undefined,
    fallbackIllnessRisk: todayCheckIn ? evaluateIllnessRiskSymptom(todayCheckIn) : null,
  });

  if (!activeExternalPlan) {
    return (
      <section className="dashboard-card ledger-today-card" aria-label="Today's training plan">
        <div className="ledger-today-header">
          <span className="ledger-today-kicker">Today</span>
          <h2 className="ledger-today-heading">No imported plan — import one</h2>
        </div>
        <div className="ledger-today-empty">
          <p className="ledger-today-empty-copy">
            Import a training plan from your coach or AI to see today&apos;s sessions and launch them as authored.
          </p>
          <button
            type="button"
            className="ledger-today-nav-btn"
            onClick={() => onNavigate('plan')}
          >
            Go to Plan &amp; Import →
          </button>
        </div>
      </section>
    );
  }

  if (sessions.length === 0) {
    const restContext = externalRestContextForDate(activeExternalPlan, date);
    return (
      <section className="dashboard-card ledger-today-card" aria-label="Today's training plan">
        <div className="ledger-today-header">
          <span className="ledger-today-kicker">
            📋 {activeExternalPlan.plan.title} (r{activeExternalPlan.plan.revision})
          </span>
          <h2 className="ledger-today-heading">
            {restContext ? 'Rest day in your plan' : 'Nothing scheduled today'}
          </h2>
        </div>
        <div className="ledger-today-empty">
          <p className="ledger-today-empty-copy">
            {restContext
              ? 'Scheduled rest day in your plan.'
              : 'No sessions are scheduled for today.'}
          </p>
          <button
            type="button"
            className="ledger-today-nav-btn"
            onClick={() => onNavigate('plan')}
          >
            View plan →
          </button>
        </div>
      </section>
    );
  }

  const redFlagPaused = hasRecordedRedFlag(todayCheckIn);

  const handleLaunch = async (item: PlacedSession, useReduced: boolean) => {
    if (!onStartSession || redFlagPaused) return;
    const { session } = item;
    if (!isDefinitionBearingExternalSession(session) || session.isEvent) return;

    const existingExec = executionsBySessionId[session.id];
    const key = `${session.id}:${useReduced ? 'reduced' : 'authored'}`;
    setLaunchingKey(key);
    setLaunchError(null);
    try {
      if (!useReduced && existingExec?.state === 'in_progress' && existingExec.occurrenceId && existingExec.prescriptionHash) {
        await onStartSession({
          sessionSource: existingExec.sessionSource,
          occurrenceId: existingExec.occurrenceId,
          prescriptionHash: existingExec.prescriptionHash,
        });
        return;
      }

      const launch = await prepareExternalPlanSessionLaunch(
        userId,
        {
          planId: activeExternalPlan.plan.planId,
          revision: activeExternalPlan.plan.revision,
          contentHash: activeExternalPlan.header.contentHash,
          session,
        },
        {
          date,
          useReducedDefinition: useReduced,
          // Ledger mode: the athlete chose the coach's reduced form; no engine verdict
          // bounds its duration. Identity/intent/modality checks still apply.
          ...(useReduced ? { skipEngineDurationCeiling: true } : {}),
          allowPreviouslyLaunchedOccurrence: true,
        },
      );
      await onStartSession(
        launch.binding,
        existingExec?.state === 'completed' ? { allowDuplicateCompleted: true } : undefined,
      );
    } catch (err) {
      console.warn('Failed to prepare ledger session launch:', err);
      setLaunchError(
        err instanceof ExternalPlanLaunchValidationError
          ? `${session.title} can't be started as imported, so retrying won't help. Check this session in your plan and re-import a corrected version.`
          : `Could not start ${session.title}. Please try again.`,
      );
    } finally {
      setLaunchingKey(null);
    }
  };

  return (
    <section className="dashboard-card ledger-today-card" aria-label="Today's training plan">
      <div className="ledger-today-header">
        <span className="ledger-today-kicker">
          📋 Imported Plan · {activeExternalPlan.plan.title} (r{activeExternalPlan.plan.revision})
        </span>
        <h2 className="ledger-today-heading">
          Today in {activeExternalPlan.plan.title} ({sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} planned)
        </h2>
      </div>

      {redFlagPaused && (
        <div className="ledger-today-redflag-pause" role="alert">
          <strong>Training paused for clinical evaluation</strong>
          Today&apos;s check-in recorded a clinical red-flag symptom. Seek clinical evaluation before starting a session.
        </div>
      )}

      {!todayCheckIn && (
        <div className="ledger-today-checkin-prompt">
          <p className="ledger-today-checkin-copy">
            No check-in yet today. It&apos;s optional, but it records how you feel alongside today&apos;s sessions.
          </p>
          <button
            type="button"
            className="ledger-today-checkin-btn"
            onClick={() => onNavigate('checkin')}
          >
            Check in first
          </button>
        </div>
      )}

      {launchError && (
        <p className="ledger-today-error" role="alert">{launchError}</p>
      )}

      <ul className="ledger-today-list">
        {sessions.map((item, idx) => {
          const { session } = item;
          const intraday = 'intraday' in session ? session.intraday : undefined;
          const reducedDef = session.scaling && 'reducedDefinition' in session.scaling
            ? session.scaling.reducedDefinition
            : undefined;
          const hasReducedVariant = Boolean(session.scaling?.reducible && reducedDef);
          const displayPrescription = externalSessionDisplayPrescription(session);
          const steps = displayPrescription.steps ?? [];
          const existingExec = executionsBySessionId[session.id];
          const isCompleted = existingExec?.state === 'completed' || item.status === 'completed';
          const isInProgress = existingExec?.state === 'in_progress';
          const canLaunch = Boolean(
            onStartSession &&
            !redFlagPaused &&
            isDefinitionBearingExternalSession(session) &&
            !session.isEvent,
          );
          const isBusy = launchingKey !== null && launchingKey.startsWith(`${session.id}:`);

          return (
            <li key={session.id} className="ledger-today-session-item">
              <div className="ledger-today-session-top">
                <div className="ledger-today-session-identity">
                  {sessions.length > 1 && (
                    <span className="ledger-today-order-badge">
                      Session {idx + 1} of {sessions.length}
                    </span>
                  )}
                  {intraday?.window && (
                    <span className="ledger-today-window-badge">
                      🕒 {intraday.window.startLocal}–{intraday.window.endLocal}
                    </span>
                  )}
                  <h3 className="ledger-today-session-title">
                    <span aria-hidden="true">{MODALITY_ICON[session.gating.modality] ?? '❔'}</span>{' '}
                    {session.title}
                  </h3>
                </div>
                <div className="ledger-today-badges">
                  <span className={`ledger-today-priority priority-${session.priority}`}>
                    {session.priority}
                  </span>
                  <span className={`ledger-today-status status-${isCompleted ? 'completed' : item.status}`}>
                    {isInProgress ? 'In progress' : isCompleted ? 'Completed ✓' : STATUS_LABEL[item.status]}
                  </span>
                </div>
              </div>

              <p className="ledger-today-meta">
                {session.gating.modality} · {session.gating.intensity} · {session.gating.durationMin}–{session.gating.durationMax} min
                {item.moved ? ' · Rescheduled' : ''}
              </p>

              <p className="ledger-today-summary">{displayPrescription.summary}</p>

              {hasReducedVariant && reducedDef && (
                <p className="ledger-today-reduced-note">
                  <strong>Reduced version available:</strong> {reducedDef.title}
                  {reducedDef.duration ? ` (${reducedDef.duration.min}–${reducedDef.duration.max} min)` : ''}
                </p>
              )}

              {!redFlagPaused && steps.length > 0 && (
                <details className="ledger-today-steps-details">
                  <summary>Workout steps ({steps.length})</summary>
                  <ol className="ledger-today-steps-list">
                    {steps.map((step, stepIdx) => {
                      const dur = formatStepDuration(step);
                      return (
                        <li key={`${step.name}-${stepIdx}`}>
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

              {!redFlagPaused && (
                <div className="ledger-today-actions">
                  {!session.isEvent && (
                    <WorkoutExportMenu
                      userId={userId}
                      date={date}
                      title={session.title}
                      modality={session.gating.modality}
                      externalSession={session}
                      garminSyncDisabled={false}
                    />
                  )}
                  {existingExec?.state === 'completed' && (
                    <LedgerSessionAiCopyButton userId={userId} execution={existingExec} title={session.title} />
                  )}
                  {canLaunch && (
                    <>
                      <button
                        type="button"
                        className={`ledger-today-start-btn ${isCompleted ? 'is-redo' : ''}`}
                        disabled={isBusy}
                        aria-label={
                          isInProgress
                            ? `Resume ${session.title}`
                            : isCompleted
                              ? `Redo ${session.title}`
                              : `Start ${session.title}`
                        }
                        onClick={() => { void handleLaunch(item, false); }}
                      >
                        {launchingKey === `${session.id}:authored`
                          ? 'Preparing…'
                          : isInProgress
                            ? `Resume ${session.title} →`
                            : isCompleted
                              ? `Redo ${session.title}`
                              : `Start ${session.title} →`}
                      </button>

                      {hasReducedVariant && !isInProgress && (
                        <button
                          type="button"
                          className="ledger-today-reduced-btn"
                          disabled={isBusy}
                          aria-label={`Start reduced version of ${session.title}`}
                          onClick={() => { void handleLaunch(item, true); }}
                        >
                          {launchingKey === `${session.id}:reduced`
                            ? 'Preparing…'
                            : 'Start reduced version'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <FlagStrip flags={flagStripItems} />
    </section>
  );
}
