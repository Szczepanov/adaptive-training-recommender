import { useState, memo } from 'react';
import type { WeekAheadDay, WeekAheadPlan } from '../engine/planner';
import type { ExternalPlacementStatus, ExternalPrescriptionStep, ExternalRestDirective, NextDayPotentialPlan, PlanningMode, ScheduleOverlay, TrainingIntentProfile } from '../engine/models';
import { capabilityMaintenanceReadout } from '../engine/capabilityMaintenance';
import { resolveRestDatesByDate, type PlacedSession } from '../engine/externalPlacement';
import { externalSessionDisplayPrescription } from '../engine/externalSessionProfiles';
import type { ActiveExternalPlan } from '../services/activeExternalPlanService';
import type { PlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import { addDaysToLocalDateString } from '../utils/localDate';
import { splitCoachingRationale } from '../utils/rationaleDisplay';
import { WorkoutExportMenu } from './WorkoutExportMenu';
import './WeekAheadStrip.css';

const IMPORTED_HORIZON_DAYS = 8; // Today + next 7 days

const IMPORTED_STATUS_LABEL: Record<ExternalPlacementStatus, string> = {
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

interface ImportedOutlookDay {
  date: string;
  offset: number;
  sessions: PlacedSession[];
  dropped: PlacedSession[];
  restDay: ExternalRestDirective | null;
}

function buildImportedOutlookDays(externalPlan: ActiveExternalPlan, today: string): ImportedOutlookDay[] {
  const restByDate = resolveRestDatesByDate(externalPlan.plan);
  const days: ImportedOutlookDay[] = [];
  for (let offset = 0; offset < IMPORTED_HORIZON_DAYS; offset += 1) {
    const date = addDaysToLocalDateString(today, offset);
    const sessions = externalPlan.placed
      .filter(item => item.date === date && item.status !== 'dropped' && item.status !== 'superseded')
      .slice()
      .sort((a, b) => {
        const aOrder = 'intraday' in a.session && a.session.intraday ? a.session.intraday.order : Number.MAX_SAFE_INTEGER;
        const bOrder = 'intraday' in b.session && b.session.intraday ? b.session.intraday.order : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });
    const dropped = externalPlan.placed.filter(item => item.date === date && item.status === 'dropped');
    days.push({
      date,
      offset,
      sessions,
      dropped,
      restDay: restByDate.get(date) ?? null,
    });
  }
  return days;
}

interface WeekAheadStripProps {
  plan: WeekAheadPlan | null;
  nextDayPlan?: NextDayPotentialPlan | null;
  selectedTier?: 'green' | 'yellow' | 'red';
  onSelectTier?: (tier: 'green' | 'yellow' | 'red') => void;
  trainingIntentProfile?: TrainingIntentProfile | null;
  scheduleOverlays?: readonly ScheduleOverlay[];
  /** The **effective** mode from `planningMode.ts` `resolvePlanningContext` (ADR-0017
   * D-MODE) — not `trainingIntentProfile.planningMode`, which records stated intent. An
   * event_directed profile whose events have all passed is planned as evergreen, and
   * reading the persisted field would hide this week's purpose from exactly them. */
  planningMode?: PlanningMode;
  /** When an imported external plan is active, display Today + next 7 days from the imported plan. */
  externalPlan?: ActiveExternalPlan | null;
  /** Today's Warsaw-local YYYY-MM-DD date string for anchoring the imported plan horizon. */
  today?: string;
  /** Optional userId to enable WorkoutExportMenu on imported sessions. */
  userId?: string;
  /** Pauses workout step details and export when clinical escalation is active. */
  clinicalEscalationRequired?: boolean;
  /** Planning authority mode (ADR-0052 Phase 2, #1167). Defaults to 'engine' until P2-8. */
  planningAuthorityMode?: PlanningAuthorityMode;
  /** Optional callback to open or navigate to plan import from the ledger empty state. */
  onImportPlan?: () => void;
}

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

const SHORT_MODALITY_LABEL: Record<string, string> = {
  Running: 'Run',
  Cycling: 'Bike',
  Walking: 'Walk',
  Strength: 'Lift',
  Field: 'Field',
  Mobility: 'Mobility',
  'Cross Training': 'Cross',
  None: 'Rest',
  running: 'Run',
  cycling: 'Bike',
  walking: 'Walk',
  strength: 'Lift',
  field: 'Field',
  mobility: 'Mobility',
  cross_training: 'Cross',
};

/** Choose the compact visual cue used for a schedule overlay in the seven-day strip. */
function scheduleOverlayIcon(overlay: ScheduleOverlay): string {
  if (overlay.category === 'sedentary_rest') return '🎄';
  if (overlay.category === 'high_step_walking') return '🚶';
  if (overlay.category === 'limited_availability') return '⏱️';
  switch (overlay.sport) {
    case 'skiing': return '⛷️';
    case 'volleyball': return '🏐';
    case 'hiking': return '🥾';
    case 'court_sport': return '🎾';
    case 'field_sport': return '⚽';
    default: return '🏃';
  }
}

/** Return a concise athlete-facing label for a schedule overlay category or sport. */
function scheduleOverlayLabel(overlay: ScheduleOverlay): string {
  if (overlay.category === 'active_sport' && overlay.sport) {
    return overlay.sport.replaceAll('_', ' ');
  }
  switch (overlay.category) {
    case 'active_sport': return 'active sport';
    case 'sedentary_rest': return 'sedentary rest';
    case 'high_step_walking': return 'high-step walking';
    case 'limited_availability': return 'limited time';
  }
}

/** `day.template` stays the authored catalog session so coverage/history bookkeeping keys
 * off a stable identity; when the engine auto-applies an easier dose (fatigue-driven
 * modify, or to respect a hard time cap the template's own range didn't fit -- see
 * resolveTimeCapDoseAdjustment), the narrower duration lives in `day.activeDose` instead.
 * Render that one when present so the strip never advertises a duration beyond a
 * constraint the athlete was told is a hard maximum. */
function effectiveDuration(day: WeekAheadDay): { min: number; max: number } {
  return day.activeDose
    ? { min: day.activeDose.durationMin, max: day.activeDose.durationMax }
    : { min: day.template.durationMin, max: day.template.durationMax };
}

const CONFIDENCE_LABEL: Record<WeekAheadDay['confidence'], string> = {
  provisional: 'Provisional',
  projected: 'Projected',
};

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

/** Format a canonical YYYY-MM-DD plan date in UTC so local timezone offsets cannot shift its weekday. */
function weekdayLabel(dateStr: string): string {
  return WEEKDAY_FORMATTER.format(new Date(dateStr + 'T00:00:00Z'));
}

/** Summarize exact primary-strength allocation outcomes without inferring credit from modality. */
function strengthRoleSummary(plan: WeekAheadPlan): string | null {
  const strength = plan.allocationReport.outcomes.filter(outcome => outcome.occurrence.coverageKey === 'primary_strength');
  if (strength.length === 0) return null;

  const planned = strength.filter(outcome => outcome.status === 'fulfilled' || outcome.status === 'reserved'
    || outcome.status === 'planned_beyond_horizon').length;
  const missed = strength.filter(outcome => outcome.status === 'missed');
  const unresolved = strength.filter(outcome => outcome.status === 'unresolved_search_budget').length;
  const beyond = strength.filter(outcome => outcome.status === 'planned_beyond_horizon').length;
  const superseded = strength.filter(outcome => outcome.status === 'superseded').length;
  const roleWord = strength.length === 1 ? 'role' : 'roles';
  const parts = [`Strength ${roleWord}: ${planned}/${strength.length} planned`];

  if (missed.length > 0) {
    const reasons = [...new Set(missed.map(outcome => outcome.reason?.replaceAll('_', ' ') ?? 'unknown reason'))];
    parts.push(`${missed.length} blocked (${reasons.join(', ')})`);
  }
  if (unresolved > 0) parts.push(`${unresolved} still unresolved`);
  if (beyond > 0) parts.push(`${beyond} planned beyond this forecast`);
  if (superseded > 0) parts.push(`${superseded} ended with their planning authority`);
  return `${parts.join('; ')}.`;
}

// ⚡ Bolt Performance Optimization:
// Wrapped WeekAheadStrip in React.memo to prevent unnecessary re-renders when the parent dashboard
// state updates (e.g., toggling workout details).
// Expected Impact: Prevents recalculation and re-rendering of the 7-day strip layout and logic.
export const WeekAheadStrip = memo(function WeekAheadStrip({
  plan,
  nextDayPlan,
  selectedTier = 'green',
  onSelectTier,
  trainingIntentProfile,
  scheduleOverlays,
  planningMode,
  externalPlan,
  today,
  userId,
  clinicalEscalationRequired = false,
  planningAuthorityMode = 'engine',
  onImportPlan,
}: WeekAheadStripProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (externalPlan && today) {
    const importedDays = buildImportedOutlookDays(externalPlan, today);
    const safeImportedIndex = Math.min(selectedIndex, importedDays.length - 1);
    const selectedImported = importedDays[safeImportedIndex];
    const selectedOverlay = scheduleOverlays?.find(
      o => o.startDate <= selectedImported.date && selectedImported.date <= o.endDate,
    );
    const selectedDayLabel = selectedImported.offset === 0
      ? `Today (${weekdayLabel(selectedImported.date)})`
      : selectedImported.offset === 1
        ? `Tomorrow (${weekdayLabel(selectedImported.date)})`
        : weekdayLabel(selectedImported.date);
    const selectedTotalMin = selectedImported.sessions.reduce((sum, s) => sum + s.session.gating.durationMin, 0);
    const selectedTotalMax = selectedImported.sessions.reduce((sum, s) => sum + s.session.gating.durationMax, 0);
    const selectedHeadingTitle = selectedImported.sessions.length > 1
      ? `${selectedImported.sessions.length} Sessions Planned`
      : selectedImported.sessions.length === 1
        ? selectedImported.sessions[0].session.title
        : selectedImported.restDay
          ? 'Authored Rest Day'
          : 'Open / No Session Placed';

    return (
      <div className="dashboard-card week-ahead-card imported-outlook-card">
        <div className="card-header">
          <div className="header-title-group">
            <h3>Today &amp; Next 7 Days · {externalPlan.plan.title}</h3>
            <span className="provisional-tag">
              Imported plan schedule (r{externalPlan.plan.revision})
            </span>
          </div>
        </div>

        <div className="week-ahead-strip imported-week-ahead-strip">
          {importedDays.map((day, index) => {
            const dayOverlay = scheduleOverlays?.find(o => o.startDate <= day.date && day.date <= o.endDate);
            const dayLabel = day.offset === 0
              ? `Today (${weekdayLabel(day.date)})`
              : day.offset === 1
                ? `Tomorrow (${weekdayLabel(day.date)})`
                : weekdayLabel(day.date);
            const totalMin = day.sessions.reduce((sum, s) => sum + s.session.gating.durationMin, 0);
            const totalMax = day.sessions.reduce((sum, s) => sum + s.session.gating.durationMax, 0);
            const isMulti = day.sessions.length > 1;
            const singleSession = day.sessions.length === 1 ? day.sessions[0] : null;
            return (
              <button
                key={day.date}
                type="button"
                className={`week-ahead-tile confidence-provisional ${isMulti ? 'multi-session-tile' : ''} ${index === safeImportedIndex ? 'selected' : ''}`}
                aria-pressed={index === safeImportedIndex}
                onClick={() => setSelectedIndex(index)}
              >
                <span className="tile-weekday">{dayLabel}</span>
                {isMulti ? (
                  <>
                    <span className="tile-session-count-badge">{day.sessions.length} sessions</span>
                    <div className="tile-multi-session-list">
                      {day.sessions.map(item => (
                        <span key={item.session.id} className="tile-session-pill" title={item.session.title}>
                          <span aria-hidden="true">{MODALITY_ICON[item.session.gating.modality] ?? '❔'}</span>
                          <span className="tile-session-pill-label">
                            {SHORT_MODALITY_LABEL[item.session.gating.modality] ?? item.session.gating.modality}
                          </span>
                        </span>
                      ))}
                    </div>
                    <span className="tile-duration">{totalMin}-{totalMax} m</span>
                    <span className="tile-mode-dot mode-train" title={`${day.sessions.length} planned sessions`} />
                  </>
                ) : singleSession ? (
                  <>
                    <span className="tile-icon" aria-hidden="true">
                      {MODALITY_ICON[singleSession.session.gating.modality] ?? '❔'}
                    </span>
                    <span className="tile-category">
                      {SHORT_MODALITY_LABEL[singleSession.session.gating.modality] ?? singleSession.session.gating.modality}
                    </span>
                    <span className="tile-duration">
                      {singleSession.session.gating.durationMin}-{singleSession.session.gating.durationMax} m
                    </span>
                    <span
                      className={`tile-mode-dot ${singleSession.status === 'completed' ? 'mode-completed' : 'mode-train'}`}
                      title={IMPORTED_STATUS_LABEL[singleSession.status]}
                    />
                  </>
                ) : day.restDay ? (
                  <>
                    <span className="tile-icon" aria-hidden="true">💤</span>
                    <span className="tile-category">Rest</span>
                    <span className="tile-duration">Authored</span>
                    <span className="tile-mode-dot mode-recover" title="Authored rest day" />
                  </>
                ) : dayOverlay ? (
                  <>
                    <span className="tile-overlay-icon" title={`${dayOverlay.title} (${dayOverlay.category})`}>
                      {scheduleOverlayIcon(dayOverlay)}
                    </span>
                    <span className="tile-category">{scheduleOverlayLabel(dayOverlay)}</span>
                    <span className="tile-duration">Overlay</span>
                    <span className="tile-mode-dot mode-recover" title={dayOverlay.title} />
                  </>
                ) : (
                  <>
                    <span className="tile-icon" aria-hidden="true">—</span>
                    <span className="tile-category">Open</span>
                    <span className="tile-duration">0 m</span>
                    <span className="tile-mode-dot mode-recover" title="No session placed" />
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="week-ahead-detail confidence-provisional imported-outlook-detail">
          <div className="detail-header">
            <div className="detail-title-group">
              <h4>{selectedHeadingTitle}</h4>
              <span className="detail-date">{selectedDayLabel} · {selectedImported.date}</span>
            </div>
            <span className="status-badge info">
              {selectedImported.sessions.length > 1
                ? `${selectedImported.sessions.length} sessions · ${selectedTotalMin}–${selectedTotalMax} min`
                : selectedImported.sessions.length === 1
                  ? `1 session · ${selectedTotalMin}–${selectedTotalMax} min`
                  : selectedImported.restDay
                    ? 'Authored rest'
                    : 'Open day'}
            </span>
          </div>

          {selectedOverlay && (
            <div className="detail-overlay-callout">
              <span className="detail-overlay-badge">
                {scheduleOverlayIcon(selectedOverlay)} Schedule block:
              </span>
              <span className="detail-overlay-title">{selectedOverlay.title}</span>
              <span className="detail-overlay-hint">
                {selectedOverlay.dailyAvailabilityMinutes === 0
                  ? 'Availability 0 min — anchors diverted'
                  : `${selectedOverlay.dailyAvailabilityMinutes} min available`}
              </span>
            </div>
          )}

          {selectedImported.sessions.length > 0 ? (
            <div
              className="imported-outlook-session-list"
              role="list"
              aria-label={`Planned sessions for ${selectedImported.date}`}
            >
              {selectedImported.sessions.map((item, idx) => {
                const displayPrescription = externalSessionDisplayPrescription(item.session);
                const steps = displayPrescription.steps ?? [];
                const intraday = 'intraday' in item.session ? item.session.intraday : undefined;
                const reducedDef = item.session.scaling && 'reducedDefinition' in item.session.scaling
                  ? item.session.scaling.reducedDefinition
                  : undefined;
                return (
                  <div key={item.session.id} className="imported-outlook-session-card" role="listitem">
                    <div className="imported-outlook-session-header">
                      <div className="imported-outlook-session-title-row">
                        {selectedImported.sessions.length > 1 && (
                          <span className="imported-outlook-session-order">
                            Session {idx + 1} of {selectedImported.sessions.length}
                          </span>
                        )}
                        {intraday?.window && (
                          <span className="imported-outlook-window-badge">
                            🕒 {intraday.window.startLocal}–{intraday.window.endLocal}
                          </span>
                        )}
                        <strong className="imported-outlook-session-title">
                          <span aria-hidden="true">{MODALITY_ICON[item.session.gating.modality] ?? '❔'}</span>{' '}
                          {item.session.title}
                        </strong>
                      </div>
                      <div className="imported-outlook-session-badges">
                        <span className={`imported-outlook-priority-badge priority-${item.session.priority}`}>
                          {item.session.priority}
                        </span>
                        <span className={`imported-outlook-status-badge status-${item.status}`}>
                          {IMPORTED_STATUS_LABEL[item.status]}
                        </span>
                      </div>
                    </div>

                    <p className="detail-meta imported-outlook-session-meta">
                      {SHORT_MODALITY_LABEL[item.session.gating.modality] ?? item.session.gating.modality}
                      {' · '}{item.session.gating.intensity}
                      {' · '}{item.session.gating.durationMin}–{item.session.gating.durationMax} min
                      {item.moved ? ' · Rescheduled from original day' : ''}
                    </p>

                    <p className="detail-rationale">{displayPrescription.summary}</p>

                    {item.session.scaling?.reducible && (item.session.scaling.reducedSummary || reducedDef) && (
                      <p className="imported-outlook-reduced-note">
                        <strong>Reduced option:</strong>{' '}
                        {item.session.scaling.reducedSummary ?? reducedDef?.summary ?? reducedDef?.title}
                      </p>
                    )}

                    {!clinicalEscalationRequired && steps.length > 0 && (
                      <details className="imported-outlook-steps-details">
                        <summary>Workout steps ({steps.length})</summary>
                        <ol className="external-prescription-steps">
                          {steps.map((step, stepIndex) => {
                            const dur = formatStepDuration(step);
                            return (
                              <li key={`${step.name}-${stepIndex}`}>
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

                    {userId && !clinicalEscalationRequired && !item.session.isEvent && (
                      <div className="imported-outlook-export-row">
                        <WorkoutExportMenu
                          userId={userId}
                          date={selectedImported.date}
                          title={item.session.title}
                          modality={item.session.gating.modality}
                          externalSession={item.session}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : selectedImported.restDay ? (
            <p className="detail-rationale">
              Authored rest day in your imported plan ({selectedImported.restDay.id}).
            </p>
          ) : (
            <p className="detail-rationale">
              No session is placed on this date in your imported plan.
            </p>
          )}

          {selectedImported.dropped.length > 0 && (
            <p className="detail-caveat">
              Dropped for this date: {selectedImported.dropped.map(d => d.session.title).join(', ')}.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (planningAuthorityMode === 'ledger') {
    // An imported plan with no resolved date yet is still loading, not missing.
    if (externalPlan) return null;
    return (
      <div className="dashboard-card week-ahead-card week-ahead-ledger-empty" role="region" aria-label="Week ahead">
        <div className="card-header">
          <div className="header-title-group">
            <h3>Today &amp; Next 7 Days</h3>
            <span className="provisional-tag">No imported plan</span>
          </div>
        </div>
        <p className="detail-rationale">
          {onImportPlan
            ? 'No active training plan is imported. Import a coach or AI plan to see your scheduled sessions for the week ahead.'
            : 'No active training plan is imported. Open Plan to import a coach or AI plan for the week ahead.'}
        </p>
        {onImportPlan && (
          <div className="week-ahead-empty-actions">
            <button
              type="button"
              className="week-ahead-import-btn"
              onClick={onImportPlan}
            >
              <span aria-hidden="true">📥 </span>Import a training plan
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!plan || plan.days.length === 0) return null;

  const safeIndex = Math.min(selectedIndex, plan.days.length - 1);
  const selected = plan.days[safeIndex];
  const selectedAuthority = plan.authoritySegments?.find(segment => segment.startDate <= selected.date && selected.date <= segment.endDate);
  const capabilityNotes = capabilityMaintenanceReadout(selectedAuthority
    ? selectedAuthority.evergreen?.capabilityMaintenance ?? null : plan.capabilityMaintenance);
  const beyondHorizon = plan.allocationReport.outcomes.filter(outcome => outcome.status === 'planned_beyond_horizon');
  const selectedOverlay = scheduleOverlays?.find(o => o.startDate <= selected.date && selected.date <= o.endDate);
  const openObjective = plan.microcycleObjectives.find(objective =>
    (objective.completedCredit ?? objective.completedExposures) < (objective.requiredCredit ?? objective.targetExposures),
  );
  const evergreenWeekPurpose = planningMode === 'evergreen' && trainingIntentProfile
    ? `${trainingIntentProfile.weeklyCommitment.targetSessions} typical sessions${openObjective ? `; ${openObjective.title} is still open` : ''}.`
    : null;
  const strengthSummary = strengthRoleSummary(plan);
  // ADR-0018 D-MISS: forecast evidence rendered straight from the shared allocation
  // report, never rebuilt from the selected recommendations, and never presented as
  // completed training.
  const allocationEvidence = plan.allocationReport.outcomes.filter(outcome =>
    outcome.reservation.assignedDate === selected.date || outcome.reservation.nominatedDate === selected.date,
  );
  const allocationNote = (outcome: (typeof allocationEvidence)[number]): string => {
    const { label } = outcome.occurrence;
    switch (outcome.status) {
      case 'fulfilled':
        return `Weekly role covered: ${label}${outcome.reservation.wasMoved ? ' (moved to this safe date)' : ''}.`;
      case 'missed':
        return `Weekly role could not be scheduled safely: ${label} (${outcome.reason?.replaceAll('_', ' ') ?? 'unknown reason'}).`;
      case 'reserved':
        return `Weekly role reserved: ${label}.`;
      case 'planned_beyond_horizon':
        return `Weekly role planned beyond this forecast: ${label}.`;
      case 'superseded':
        return `Weekly role ended with its planning authority: ${label}.`;
      default:
        return `Weekly role still being worked out: ${label}.`;
    }
  };

  return (
    <div className="dashboard-card week-ahead-card">
      <div className="card-header">
        <div className="header-title-group">
          <h3>Next 7 Days</h3>
          <span className="provisional-tag">Recalculates daily as your data changes</span>
        </div>
        {nextDayPlan && !nextDayPlan.isSinglePlan && onSelectTier && (
          <div className="tier-selector" role="group" aria-label="Tomorrow's expected readiness tier">
            <span className="tier-selector-label">Tomorrow:</span>
            <button
              type="button"
              className={`tier-btn tier-green ${selectedTier === 'green' ? 'active' : ''}`}
              aria-pressed={selectedTier === 'green'}
              onClick={() => onSelectTier('green')}
              title="Green: High readiness forecast"
            >
              🟢 Optimal
            </button>
            <button
              type="button"
              className={`tier-btn tier-yellow ${selectedTier === 'yellow' ? 'active' : ''}`}
              aria-pressed={selectedTier === 'yellow'}
              onClick={() => onSelectTier('yellow')}
              title="Yellow: Moderate readiness forecast"
            >
              🟡 Moderate
            </button>
            <button
              type="button"
              className={`tier-btn tier-red ${selectedTier === 'red' ? 'active' : ''}`}
              aria-pressed={selectedTier === 'red'}
              onClick={() => onSelectTier('red')}
              title="Red: Low readiness / mandatory recovery forecast"
            >
              🔴 Low
            </button>
          </div>
        )}
      </div>

      <div className="week-ahead-strip">
        {plan.days.map((day, index) => {
          const dayOverlay = scheduleOverlays?.find(o => o.startDate <= day.date && day.date <= o.endDate);
          return (
            <button
              key={day.date}
              type="button"
              className={`week-ahead-tile confidence-${day.confidence} ${index === safeIndex ? 'selected' : ''}`}
              aria-pressed={index === safeIndex}
              onClick={() => setSelectedIndex(index)}
            >
              <span className="tile-weekday">
                {index === 0 ? `Tomorrow (${weekdayLabel(day.date)})` : weekdayLabel(day.date)}
              </span>
              {dayOverlay ? (
                <span className="tile-overlay-icon" title={`${dayOverlay.title} (${dayOverlay.category})`}>
                  {scheduleOverlayIcon(dayOverlay)}
                </span>
              ) : (
                <span className="tile-icon">{MODALITY_ICON[day.template.modality] ?? '❔'}</span>
              )}
              <span className="tile-category">
                {dayOverlay
                  ? scheduleOverlayLabel(dayOverlay)
                  : (SHORT_MODALITY_LABEL[day.template.modality] ?? day.template.modality)}
              </span>
              <span className="tile-duration">{effectiveDuration(day).min}-{effectiveDuration(day).max} m</span>
              <span className={`tile-mode-dot mode-${day.mode}`} title={day.mode === 'recover' ? 'Recovery' : 'Train'} />
            </button>
          );
        })}
      </div>

      {evergreenWeekPurpose && (
        <p className="week-purpose">Week purpose: {evergreenWeekPurpose}</p>
      )}

      {beyondHorizon.length > 0 && (
        <section className="week-role-summary" aria-label="Roles planned beyond this forecast">
          <strong>Planned beyond this forecast</strong>
          <ul>{beyondHorizon.map(outcome => <li key={outcome.occurrence.id}>
            {outcome.occurrence.label}{outcome.occurrence.plannedDate ? ` (${outcome.occurrence.plannedDate})` : ''}
          </li>)}</ul>
        </section>
      )}

      {capabilityNotes.length > 0 && (
        <section className="week-role-summary" aria-label="Capability maintenance status">
          <strong>Capability maintenance</strong>
          <ul>
            {capabilityNotes.map(note => <li key={note}>{note}</li>)}
          </ul>
        </section>
      )}

      {strengthSummary && (
        <p className="week-role-summary">{strengthSummary}</p>
      )}

      <div className={`week-ahead-detail confidence-${selected.confidence}`}>
        <div className="detail-header">
          <div className="detail-title-group">
            <h4>{selected.template.title}</h4>
            <span className="detail-date">{selected.date}</span>
          </div>
          <span className="status-badge info">
            {CONFIDENCE_LABEL[selected.confidence]}
          </span>
        </div>

        {selectedOverlay && (
          <div className="detail-overlay-callout">
            <span className="detail-overlay-badge">
              {scheduleOverlayIcon(selectedOverlay)} Schedule block:
            </span>
            <span className="detail-overlay-title">{selectedOverlay.title}</span>
            <span className="detail-overlay-hint">
              {selectedOverlay.dailyAvailabilityMinutes === 0
                ? 'Availability 0 min — anchors diverted'
                : `${selectedOverlay.dailyAvailabilityMinutes} min available`}
            </span>
          </div>
        )}

        <p className="detail-meta">
          {selected.template.category} · {effectiveDuration(selected).min}-{effectiveDuration(selected).max} min · {selected.phaseName} phase
        </p>
        {(() => {
          const { coachingNarrative, technicalDetail } = splitCoachingRationale(selected.rationale);
          return (
            <>
              <p className="detail-rationale">{coachingNarrative}</p>
              {technicalDetail && (
                <details className="detail-rationale-technical">
                  <summary>Engine scoring telemetry</summary>
                  <span>{technicalDetail}</span>
                </details>
              )}
            </>
          );
        })()}
        {selected.addressesObjectives && selected.addressesObjectives.length > 0 && (
          <p className="detail-objectives">
            🎯 Works toward: {selected.addressesObjectives.join(', ')}
          </p>
        )}
        {allocationEvidence.map(outcome => (
          <p key={outcome.occurrence.id} className="detail-allocation">{allocationNote(outcome)}</p>
        ))}
        {selected.confidence === 'projected' && (
          <p className="detail-caveat">
            ⚠️ This far out there&apos;s no real recovery data yet -- treat this as the likely
            session <em>type</em>, not a locked prescription. It will adjust automatically
            as each day&apos;s actual readiness comes in.
          </p>
        )}
      </div>
    </div>
  );
});
