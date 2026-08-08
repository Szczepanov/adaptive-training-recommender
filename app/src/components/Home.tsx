import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { decisionComposer } from '../engine/composer';
import { evaluateTrainingWithIntent, evaluateNextDayPlanWithIntent, adjustSessionRecommendation } from '../engine/rules';
import { mapSnapshotToEngineInput, mapCheckinToSubjectiveInput, mapContextFromGoalsAndTrainingSettings, mapGoalsToUserEvents } from '../engine/adapters';
import { generateWeekAheadPlanWithIntent, type WeekAheadPlan } from '../engine/planner';
import { prepareTrainingHistorySnapshot } from '../engine/trainingIntent';
import type { TrainingHistorySnapshot } from '../engine/trainingHistorySnapshot';
import { buildRecommendationAudit } from '../engine/provenance';
import { evaluatePeriodizationPhase, getDaysToEvent } from '../engine/periodization';
import { resolveExecutionDose } from '../engine/dose';
import type { DailyDecisionInput, Recommendation, NextDayPotentialPlan, DailyRecommendation } from '../engine/models';
import { recommendationService } from '../services/recommendationService';
import { getPreviousLocalDateString } from '../utils/localDate';
import { getPrescriptionLegend, resolveWorkoutPrescription } from '../workouts';
import type { WorkoutPrescription } from '../workouts';
import { AdherencePrompt } from './AdherencePrompt';
import { MinimumSafetyCheckin } from './MinimumSafetyCheckin';
import { WeekAheadStrip } from './WeekAheadStrip';
import {
  canGenerateNormalRecommendation,
  createProvisionalSafetyRecommendation,
  getMinimumSafetyCheckinStatus,
} from '../engine/safetyCheckin';
import './Home.css';

interface HomeProps {
  userId: string;
  onNavigate: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
  onViewData?: () => void;
}

const MODE_LABELS: Record<Recommendation['mode'], string> = {
  train: 'Normal load',
  modify: 'Reduced load',
  recover: 'Recovery day',
};

function formatEventTiming(daysToEvent: number | null): string {
  if (daysToEvent === 0) return 'Today';
  if (daysToEvent === null) return '';
  return daysToEvent > 0 ? `In ${daysToEvent} days` : `${Math.abs(daysToEvent)} days ago`;
}

function DetailedTodayPlan({ prescription }: { prescription: WorkoutPrescription }) {
  return (
    <section className="detailed-plan" aria-label="Detailed training plan">
      <div className="detailed-plan-header">
        <h5>Today&apos;s Plan</h5>
        <span>{prescription.targetDurationMin} min target</span>
      </div>
      {prescription.displayBlocks.map((block) => (
        <section className={`plan-block plan-block-${block.role}`} key={block.id}>
          <h6 className="plan-block-role">{block.name}</h6>
          {block.steps.map((step) => (
            <article className="plan-step" key={step.id}>
              <div className="plan-step-heading">
                <strong>{step.name}</strong>
                {step.optional && <span className="optional-step">Optional</span>}
              </div>
              <p className="plan-dose">{step.dose}{step.rest ? ` · ${step.rest}` : ''}</p>

              {/* Step Targets */}
              {step.structuredTargets && step.structuredTargets.length > 0 ? (
                <ul className="step-target-list">
                  {step.structuredTargets.map((t, idx) => (
                    <li key={idx} className={`target-item role-${t.role}`}>
                      <span className={`target-role-badge role-${t.role}`}>{t.label}</span>
                      <span className="target-value">{t.valueText}</span>
                    </li>
                  ))}
                </ul>
              ) : step.targets && step.targets.length > 0 ? (
                <ul className="plan-targets">
                  {step.targets.map((target, idx) => (
                    <li key={idx}>{target}</li>
                  ))}
                </ul>
              ) : null}

              {/* Step Cues */}
              {step.cues && step.cues.length > 0 && (
                <div className="step-cues-list">
                  {step.cues.map((cue, idx) => (
                    <p key={idx} className="step-cue">💡 {cue}</p>
                  ))}
                </div>
              )}

              {/* Step Stop Conditions */}
              {step.stopConditions && step.stopConditions.length > 0 && (
                <div className="step-stop-conditions">
                  {step.stopConditions.map((cond, idx) => (
                    <p key={idx} className="step-stop-condition">⚠️ <strong>Stop if:</strong> {cond}</p>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      ))}
      <p className="plan-legend">{getPrescriptionLegend()}</p>
    </section>
  );
}

export function Home({ userId, onNavigate, onViewData }: HomeProps) {
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [adjustmentDirection, setAdjustmentDirection] = useState<'easier' | 'harder' | null>(null);
  const [nextDayPlan, setNextDayPlan] = useState<NextDayPotentialPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWorkoutDetails, setShowWorkoutDetails] = useState(false);
  const [pendingAdherence, setPendingAdherence] = useState<{ date: string; recommendation: DailyRecommendation } | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<TrainingHistorySnapshot | null>(null);
  const dashboardRequest = useRef(0);
  const activeSettings = useMemo(() => {
    if (!decisionInput) return [];
    const { equipment, guardrails, defaults } = decisionInput.trainingSettings;
    const equipmentLabels: Record<keyof typeof equipment, string> = {
      free_weights: 'Free weights available', cable_machine: 'Cable machine available', treadmill: 'Treadmill available', indoor_bike: 'Stationary bike available', pullup_bar: 'Pull-up bar available'
    };
    const guardrailLabels: Record<keyof typeof guardrails, string> = {
      avoid_high_impact: 'Block high-impact training', avoid_heavy_lower_body: 'Block heavy lower-body work', avoid_overhead_pressing: 'Block overhead pressing', avoid_heavy_spinal_loading: 'Block heavy spinal loading'
    };
    return [
      ...Object.entries(equipment).filter(([, enabled]) => enabled).map(([key]) => ({ label: equipmentLabels[key as keyof typeof equipment], kind: 'capability' })),
      ...Object.entries(guardrails).filter(([, enabled]) => enabled).map(([key]) => ({ label: guardrailLabels[key as keyof typeof guardrails], kind: 'guardrail' })),
      ...(defaults.environment === 'either' ? [] : [{ label: `${defaults.environment === 'indoor' ? 'Indoor' : 'Outdoor'} training only`, kind: 'guardrail' }]),
    ];
  }, [decisionInput]);
  const minimumSafetyStatus = useMemo(
    () => getMinimumSafetyCheckinStatus(decisionInput?.subjectiveCheckin),
    [decisionInput?.subjectiveCheckin],
  );
  const canGenerateNormalPlan = canGenerateNormalRecommendation(minimumSafetyStatus);

  const loadDashboardData = useCallback(async () => {
    const requestId = ++dashboardRequest.current;
    const isCurrent = () => requestId === dashboardRequest.current;
    try {
      setLoading(true);
      setError(null);
      setHistorySnapshot(null);
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      if (!isCurrent()) return;
      setDecisionInput(input);

      const recoveryState = input.sourceStates?.recoverySnapshot;
      if (recoveryState && recoveryState.status !== 'AVAILABLE' && recoveryState.status !== 'MISSING') {
        setRecommendation(null);
        setNextDayPlan(null);
        setError(recoveryState.status === 'UNAVAILABLE'
          ? 'Recovery data is temporarily unavailable. Please retry before generating a plan.'
          : 'Recovery data needs repair before generating a plan.');
        return;
      }
      const decisionSourceFailure = input.sourceStates
        && [input.sourceStates.activeGoals, input.sourceStates.preferences, input.sourceStates.trainingSettings]
          .find(state => state.status === 'INVALID' || state.status === 'UNAVAILABLE');
      if (decisionSourceFailure) {
        setRecommendation(null);
        setNextDayPlan(null);
        setError(decisionSourceFailure.status === 'UNAVAILABLE'
          ? 'Decision inputs are temporarily unavailable. Please retry before generating a plan.'
          : 'Decision inputs need repair before generating a plan.');
        return;
      }

      const yesterday = getPreviousLocalDateString(input.date);
      const yesterdayRec = await recommendationService.getRecommendation(userId, yesterday).catch(err => {
        console.warn('Failed to load yesterday\'s recommendation:', err);
        return null;
      });
      if (!isCurrent()) return;
      setPendingAdherence(
        yesterdayRec && yesterdayRec.adherence.respondedAt === null
          ? { date: yesterday, recommendation: yesterdayRec }
          : null
      );

      const safetyStatus = getMinimumSafetyCheckinStatus(input.subjectiveCheckin);
      if (input.recoverySnapshot && canGenerateNormalRecommendation(safetyStatus)) {
        const objective = mapSnapshotToEngineInput(input.recoverySnapshot);
        const subjective = mapCheckinToSubjectiveInput(input.subjectiveCheckin);
        const context = mapContextFromGoalsAndTrainingSettings(input.activeGoals, input.trainingSettings, input.preferences);
        const events = mapGoalsToUserEvents(input.activeGoals);
        const preparedSnapshot = await prepareTrainingHistorySnapshot(userId, input.date);
        if (!isCurrent()) return;
        if (!preparedSnapshot) {
          throw new Error('A revisioned training history snapshot is required for a normal recommendation.');
        }
        setHistorySnapshot(preparedSnapshot);
        const baseRecommendation = await evaluateTrainingWithIntent(
          userId, { subjective, objective }, context, events, input.date, yesterdayRec?.mode, undefined, preparedSnapshot,
        );
        if (!isCurrent()) return;
        const recommendationWithPrescription = {
          ...baseRecommendation,
          prescription: resolveWorkoutPrescription(baseRecommendation, userId, input.date, input.preferences?.performanceProfile, baseRecommendation.executionDose, input.trainingSettings) ?? undefined
        };
        const todayRec = {
          ...recommendationWithPrescription,
          recommendationAudit: buildRecommendationAudit(recommendationWithPrescription, preparedSnapshot) ?? undefined,
        };
        setRecommendation(todayRec);

        const tomorrowPlan = await evaluateNextDayPlanWithIntent(
          userId, events, { subjective, objective }, context, input.date, todayRec, undefined, preparedSnapshot,
        );
        if (!isCurrent()) return;
        setNextDayPlan(tomorrowPlan);

        recommendationService.saveRecommendation(userId, input.date, todayRec).catch(err =>
          console.warn('Failed to persist recommendation:', err)
        );
      } else if (input.recoverySnapshot && safetyStatus !== 'complete') {
        // Unknown subjective safety state must not be converted to neutral values and
        // passed through the ordinary optimizer. This fallback is never persisted as a
        // normal training recommendation.
        setRecommendation(createProvisionalSafetyRecommendation(safetyStatus));
        setAdjustmentDirection(null);
        setNextDayPlan(null);
        setHistorySnapshot(null);
      } else {
        setRecommendation(null);
        setNextDayPlan(null);
        setHistorySnapshot(null);
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const getDataCompleteness = () => {
    if (!decisionInput) return 0;
    
    const { dataQuality } = decisionInput;
    const items = [
      dataQuality.hasRecoverySnapshot,
      dataQuality.hasSubjectiveCheckin,
      dataQuality.profileReady
    ];
    
    const completed = items.filter(Boolean).length;
    return Math.round((completed / items.length) * 100);
  };

  const engineInputs = useMemo(() => {
    if (!decisionInput || !decisionInput.recoverySnapshot) return null;
    const subjective = mapCheckinToSubjectiveInput(decisionInput.subjectiveCheckin);
    const objective = mapSnapshotToEngineInput(decisionInput.recoverySnapshot);
    const context = mapContextFromGoalsAndTrainingSettings(decisionInput.activeGoals, decisionInput.trainingSettings, decisionInput.preferences);
    return { subjective, objective, context };
  }, [decisionInput]);

  const computeAdjustedRecommendation = useCallback((direction: 'easier' | 'harder' | null): Recommendation | null => {
    if (!recommendation) return null;
    if (!canGenerateNormalPlan) return recommendation;
    if (!direction || !engineInputs || !decisionInput) return recommendation;

    const { subjective, objective, context } = engineInputs;
    const adjusted = adjustSessionRecommendation(recommendation, direction, { subjective, objective }, context, decisionInput.date);
    if (!adjusted) return recommendation;
    const plannedDose = adjusted.plannedDose ?? recommendation.plannedDose;
    const executionDose = plannedDose === undefined || !adjusted.envelopes
      ? recommendation.executionDose
      : resolveExecutionDose(plannedDose, adjusted.envelopes.plan, direction);
    const adjustedWithExecution = { ...adjusted, plannedDose, executionDose };
    return {
      ...adjustedWithExecution,
      prescription: resolveWorkoutPrescription(adjustedWithExecution, userId, decisionInput.date, decisionInput.preferences?.performanceProfile, executionDose, decisionInput.trainingSettings) ?? undefined
    };
  }, [recommendation, canGenerateNormalPlan, engineInputs, decisionInput, userId]);

  const handleAdjustSession = useCallback((direction: 'easier' | 'harder' | null) => {
    if (!canGenerateNormalPlan) return;
    setAdjustmentDirection(direction);
    if (!recommendation || !decisionInput) return;

    // Persist the engine's original baseline (templateId/category/modality/rationale)
    // untouched -- only `adjustment` records what the athlete chose on top of it. This
    // keeps `daily_recommendations/{date}` an immutable record of what the algorithm
    // actually prescribed, which is what adherence stats and future model calibration
    // compare against; overwriting those fields with the adjusted variant would silently
    // lose the baseline every time a session is adjusted. See recommendationService.ts.
    const adjusted = direction ? computeAdjustedRecommendation(direction) : null;
    recommendationService.saveRecommendation(userId, decisionInput.date, {
      ...recommendation,
      adjustment: direction ? adjusted?.adjustment : undefined,
    }).catch(err =>
      console.warn('Failed to persist adjusted recommendation:', err)
    );
  }, [recommendation, canGenerateNormalPlan, decisionInput, computeAdjustedRecommendation, userId]);

  const activeRec = useMemo(
    () => computeAdjustedRecommendation(adjustmentDirection),
    [computeAdjustedRecommendation, adjustmentDirection]
  );

  // Goal events are evaluated independently for today and tomorrow: readiness-based
  // recommendation selection still changes in Phase 3, but the week-ahead pipeline and
  // upcoming-event UI must already use date-correct lifecycle/phase semantics.
  const eventPeriodization = useMemo(() => {
    if (!decisionInput) return null;
    const events = mapGoalsToUserEvents(decisionInput.activeGoals);
    return {
      events,
      today: evaluatePeriodizationPhase(events, decisionInput.date),
    };
  }, [decisionInput]);

  // The production planner reads adherence history once, so it must run outside render.
  // Cancellation ensures a prior user/date/goals/check-in/settings state cannot replace
  // the forecast after a newer dashboard snapshot has been composed.
  const [selectedNextDayTier, setSelectedNextDayTier] = useState<'green' | 'yellow' | 'red'>('green');
  const [weekAheadPlan, setWeekAheadPlan] = useState<WeekAheadPlan | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!engineInputs || !decisionInput || !activeRec || !canGenerateNormalPlan || !historySnapshot) {
      setWeekAheadPlan(null);
      return () => { cancelled = true; };
    }
    const { subjective, objective, context } = engineInputs;
    const tomorrowRec = nextDayPlan
      ? (nextDayPlan.branches[selectedNextDayTier]?.recommendation ?? nextDayPlan.branches.green.recommendation)
      : null;
    void generateWeekAheadPlanWithIntent(
      userId,
      { subjective, objective },
      context,
      decisionInput.preferences,
      eventPeriodization?.events ?? [],
      decisionInput.date,
      activeRec,
      tomorrowRec,
      {},
      undefined,
      historySnapshot,
    ).then(plan => {
      if (!cancelled) setWeekAheadPlan(plan);
    }).catch(err => {
      if (!cancelled) {
        console.warn('Failed to generate week-ahead plan:', err);
        setWeekAheadPlan(null);
      }
    });
    return () => { cancelled = true; };
  }, [userId, engineInputs, decisionInput, activeRec, canGenerateNormalPlan, nextDayPlan, selectedNextDayTier, eventPeriodization, historySnapshot]);

  if (loading) {
    return (
      <div className="home-container">
        <div className="loading-state">
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="home-container">
        <div className="error-state">
          <p>{error}</p>
          <button onClick={loadDashboardData}>Retry</button>
        </div>
      </div>
    );
  }

  const completeness = getDataCompleteness();
  const periodizationToday = eventPeriodization?.today ?? null;
  const checkinValues = decisionInput?.subjectiveCheckin
    ? [
        decisionInput.subjectiveCheckin.readiness,
        decisionInput.subjectiveCheckin.sleepQuality,
        decisionInput.subjectiveCheckin.fatigue,
        decisionInput.subjectiveCheckin.soreness,
        decisionInput.subjectiveCheckin.mentalStress,
        decisionInput.subjectiveCheckin.motivation,
      ].filter((value): value is number => value !== null)
    : [];
  const readinessScore = checkinValues.length > 0
    ? Math.round(checkinValues.reduce((sum, value) => sum + value, 0) / checkinValues.length)
    : null;
  const readinessLabel = readinessScore === null
    ? null
    : readinessScore >= 8 ? 'High' : readinessScore >= 5 ? 'Moderate' : 'Low';

  return (
    <div className="home-container">
      <div className="home-dashboard-layout">
        {/* Primary Main Content Column (~68%-70%) */}
        <div className="home-main-col">
          {/* Today's Recommendation (Primary Output) */}
          <div className="dashboard-card recommendation-card">
            <div className="card-header">
              <h3>Today's Recommendation</h3>
              {activeRec && (
                <span className={`status-badge mode-${activeRec.mode}`}>
                  {MODE_LABELS[activeRec.mode]}
                </span>
              )}
            </div>
            {activeRec ? (
              <div className="recommendation-content">
                <h4 className="recommendation-title">
                  {activeRec.template.title}
                  {activeRec.activeDose && (
                    <span className="dose-badge">{activeRec.activeDose.label}</span>
                  )}
                </h4>
                <p className="recommendation-meta">
                  {activeRec.template.category} · {activeRec.activeDose ? `${activeRec.activeDose.durationMin}-${activeRec.activeDose.durationMax}` : `${activeRec.template.durationMin}-${activeRec.template.durationMax}`} min
                </p>
                <p className="recommendation-description">
                  {activeRec.activeDose ? activeRec.activeDose.prescriptionSummary : activeRec.template.description}
                </p>
                <section className="recommendation-why" aria-label="Why this recommendation">
                  <h5>Why this today?</h5>
                  <p>{activeRec.rationale}</p>
                </section>
                {!canGenerateNormalPlan && (
                  <MinimumSafetyCheckin
                    userId={userId}
                    existingCheckin={decisionInput?.subjectiveCheckin ?? null}
                    onCompleted={loadDashboardData}
                  />
                )}
                {activeRec.prescription && (
                  <>
                    <button
                      type="button"
                      className="view-workout-btn"
                      onClick={() => setShowWorkoutDetails((isOpen) => !isOpen)}
                      aria-expanded={showWorkoutDetails}
                    >
                      {showWorkoutDetails ? 'Hide workout' : 'View workout'}
                    </button>
                    {showWorkoutDetails && <DetailedTodayPlan prescription={activeRec.prescription} />}
                  </>
                )}

                {/* Session Adjustment Controls */}
                {canGenerateNormalPlan && <div className="adjustment-control-section">
                  <span className="adjustment-label">Adjust Today's Session Load:</span>
                  <div className="adjustment-button-group">
                    <button
                      type="button"
                      className={`adjustment-btn ${adjustmentDirection === 'easier' ? 'active' : ''}`}
                      onClick={() => handleAdjustSession(adjustmentDirection === 'easier' ? null : 'easier')}
                    >
                      Easier
                    </button>
                    <button
                      type="button"
                      className={`adjustment-btn ${adjustmentDirection === null ? 'active' : ''}`}
                      onClick={() => handleAdjustSession(null)}
                    >
                      As Recommended
                    </button>
                    <button
                      type="button"
                      className={`adjustment-btn ${adjustmentDirection === 'harder' ? 'active' : ''}`}
                      disabled={recommendation?.envelopes?.safety.clinicalFlagActive}
                      title={recommendation?.envelopes?.safety.clinicalFlagActive ? 'Harder option disabled due to active pain/injury flag.' : 'Increase session load'}
                      onClick={() => handleAdjustSession(adjustmentDirection === 'harder' ? null : 'harder')}
                    >
                      Harder
                    </button>
                  </div>

                  {recommendation?.envelopes?.safety.clinicalFlagActive && (
                    <p className="adjustment-notice safety-notice">
                      ⚠️ Harder option is unavailable today because an active pain/injury flag restricts physical loading.
                    </p>
                  )}

                  {activeRec.adjustment && (
                    <div className="adjustment-summary-box">
                      <p>
                        <strong>Session Adjusted ({activeRec.adjustment.direction}):</strong> {activeRec.adjustment.rationale}
                      </p>
                      <button
                        type="button"
                        className="reset-adjustment-btn"
                        onClick={() => handleAdjustSession(null)}
                      >
                        ↺ Reset to As Recommended
                      </button>
                    </div>
                  )}
                </div>}
              </div>
            ) : (
              <p className="card-empty">
                {!decisionInput?.dataQuality.hasRecoverySnapshot
                  ? "No Garmin recovery data synced today yet — that's required to generate a recommendation."
                  : decisionInput.subjectiveCheckin && !decisionInput.dataQuality.subjectiveCheckinComplete
                  ? "Today's check-in is only partially filled in — finish it to get a recommendation."
                  : 'Unable to compute a recommendation yet.'}
              </p>
            )}
          </div>

          {/* Rolling 7-Day Forecast */}
          <WeekAheadStrip
            plan={weekAheadPlan}
            nextDayPlan={nextDayPlan}
            selectedTier={selectedNextDayTier}
            onSelectTier={setSelectedNextDayTier}
          />
        </div>

        {/* Sidebar Context & Status Column (~30%-32%) */}
        <div className="home-sidebar-col">
          {/* Profile Completeness Bar */}
          {completeness < 100 && (
            <div className="completeness-card dashboard-card">
              <div className="completeness-header">
                <span>Profile Completeness</span>
                <span>{completeness}%</span>
              </div>
              <div className="completeness-bar">
                <div
                  className="completeness-fill"
                  style={{ width: `${completeness}%` }}
                />
              </div>
            </div>
          )}

          {/* Adherence Prompt (for yesterday's recommendation, if unanswered) */}
          {pendingAdherence && (
            <AdherencePrompt
              userId={userId}
              date={pendingAdherence.date}
              recommendation={pendingAdherence.recommendation}
              onResolved={() => setPendingAdherence(null)}
            />
          )}

          {/* Actionable Status Cards */}
          <div className="sidebar-status-cards">
            {/* Today's Recovery Card */}
            <div className="dashboard-card">
              <div className="card-header">
                <h3>Today's Recovery</h3>
                {decisionInput?.recoverySnapshot ? (
                  <span className={`status-badge mode-${activeRec?.mode ?? 'train'}`}>
                    {activeRec?.mode === 'recover' ? 'Needs recovery' : activeRec?.mode === 'modify' ? 'Cautious' : 'Good'}
                  </span>
                ) : (
                  <span className="status-badge warning">No Data</span>
                )}
              </div>
              
              {decisionInput?.recoverySnapshot ? (
                <div className="recovery-metrics revealed">
                  <>
                      <div className="metric">
                        <span className="metric-label">Sleep Score</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.sleepScore ?? '--'}
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">Resting HR</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.restingHr ?? '--'}
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">HRV</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.hrvOvernightAvg ?? '--'}
                        </span>
                      </div>
                      <div className="metric">
                        <span className="metric-label">Body Battery</span>
                        <span className="metric-value">
                          {decisionInput.recoverySnapshot.raw.bodyBatteryWake ?? '--'}
                        </span>
                      </div>
                  </>
                </div>
              ) : (
                <p className="card-empty">No Garmin data synced today</p>
              )}
            </div>

            {/* Today's Check-in Card */}
            <div className="dashboard-card" onClick={() => onNavigate('checkin')}>
              <div className="card-header">
                <h3>Today's Check-in</h3>
                {canGenerateNormalPlan ? (
                  <span className="status-badge success">Complete ✓</span>
                ) : (
                  <span className="status-badge pending">Safety check needed</span>
                )}
              </div>
              
              {decisionInput?.subjectiveCheckin ? (
                <div className="checkin-summary">
                  <div className="readiness-score">
                    <span className="score-label">Readiness</span>
                    <span className="score-value">{readinessScore ?? '--'}{readinessScore !== null && <small>/10</small>}</span>
                    {readinessLabel && <span className="readiness-label">{readinessLabel}</span>}
                  </div>
                  <p className="card-action">Edit check-in</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No check-in today</p>
                  <p className="card-action">Start check-in</p>
                </div>
              )}
            </div>

            {/* Event context */}
            <div className="dashboard-card" onClick={() => onNavigate('goals')}>
              <div className="card-header">
                <h3>{periodizationToday?.focusEvent ? 'Focus Event' : 'Active Goals'}</h3>
              </div>
              
              {periodizationToday?.focusEvent ? (
                <div className="goals-preview event-preview">
                  <strong className="event-title">{periodizationToday.focusEvent.title}</strong>
                  <span className="event-meta">
                    {formatEventTiming(periodizationToday.daysToEvent)} · {periodizationToday.phase.phaseName} phase
                  </span>
                  <button type="button" className="card-action" onClick={(e) => { e.stopPropagation(); onNavigate('goals'); }}>Manage goals →</button>
                </div>
              ) : decisionInput?.activeGoals.length ? (
                <div className="goals-preview">
                  {['short-term', 'mid-term', 'long-term'].map(category => {
                    const goal = decisionInput.activeGoals.find(g => g.category === category);
                    return goal ? (
                      <div key={category} className="goal-item">
                        <span className="goal-category">{category}</span>
                        <span className="goal-title">
                          {goal.title}
                          {goal.eventCategory && goal.targetDate && (
                            <span className="goal-event-days"> · 🏁 {(() => {
                              const days = getDaysToEvent(goal.targetDate, decisionInput.date);
                              return days >= 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
                            })()}</span>
                          )}
                        </span>
                      </div>
                    ) : null;
                  })}
                  <p className="card-action">Tap to manage</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No active goals</p>
                  <p className="card-action">Tap to add</p>
                </div>
              )}
            </div>

            {periodizationToday?.staleEvents.length ? (
              <div className="dashboard-card stale-event-card">
                <div className="card-header"><h3>Past Events</h3></div>
                <p>Update the outcome for these events:</p>
                <ul>
                  {periodizationToday.staleEvents.map(event => <li key={event.id}>{event.title}</li>)}
                </ul>
                <button type="button" className="card-action" onClick={() => onNavigate('goals')}>Review goals and events</button>
              </div>
            ) : null}

            {/* Training status */}
            <div className="dashboard-card" onClick={() => onNavigate('constraints')}>
              <div className="card-header">
                <h3>Training Status</h3>
              </div>
              
              {activeSettings.some((setting) => setting.kind === 'guardrail') ? (
                <div className="constraints-preview">
                  {activeSettings.filter((setting) => setting.kind === 'guardrail').slice(0, 3).map(setting => (
                    <div key={setting.label} className="constraint-item">
                      <span className="constraint-name">{setting.label}</span>
                      <span className={`constraint-severity ${setting.kind}`}>
                        {setting.kind === 'guardrail' ? 'required' : 'available'}
                      </span>
                    </div>
                  ))}
                  {activeSettings.filter((setting) => setting.kind === 'guardrail').length > 3 && (
                    <p className="more-items">
                      +{activeSettings.filter((setting) => setting.kind === 'guardrail').length - 3} more
                    </p>
                  )}
                  <p className="card-action">Tap to manage</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No active restrictions</p>
                  <p className="card-action">View training setup</p>
                </div>
              )}
            </div>

            {onViewData && (
              <button onClick={onViewData} className="quick-action-btn secondary full-width">
                📊 View Detailed Data
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
