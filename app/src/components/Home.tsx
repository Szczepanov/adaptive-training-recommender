import { useState, useEffect, useCallback, useMemo } from 'react';
import { decisionComposer } from '../engine/composer';
import { evaluateTrainingWithIntent, evaluateNextDayPlan, adjustSessionRecommendation } from '../engine/rules';
import { mapSnapshotToEngineInput, mapCheckinToSubjectiveInput, mapContextFromGoalsAndTrainingSettings, mapGoalsToUserEvents } from '../engine/adapters';
import { generateWeekAheadPlan, type WeekAheadPlan } from '../engine/planner';
import { evaluatePeriodizationPhase, getDaysToEvent } from '../engine/periodization';
import type { DailyDecisionInput, Recommendation, NextDayPotentialPlan, DailyRecommendation } from '../engine/models';
import { recommendationService } from '../services/recommendationService';
import { addDaysToLocalDateString, getPreviousLocalDateString } from '../utils/localDate';
import { getPrescriptionLegend, resolveWorkoutPrescription } from '../workouts';
import type { WorkoutPrescription } from '../workouts';
import { AdherencePrompt } from './AdherencePrompt';
import { WeekAheadStrip } from './WeekAheadStrip';
import './Home.css';

interface HomeProps {
  userId: string;
  onNavigate: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
  onViewData?: () => void;
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
          <h6>{block.name}</h6>
          {block.steps.map((step) => (
            <article className="plan-step" key={step.id}>
              <div className="plan-step-heading">
                <strong>{step.name}</strong>
                {step.optional && <span className="optional-step">Optional</span>}
              </div>
              <p className="plan-dose">{step.dose}{step.rest ? ` · ${step.rest}` : ''}</p>
              {step.targets.length > 0 && (
                <ul className="plan-targets">{step.targets.map((target) => <li key={target}>{target}</li>)}</ul>
              )}
              {step.cues.length > 0 && (
                <p className="plan-cues"><strong>Cues:</strong> {step.cues.join(' ')}</p>
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
  const [showRecoveryData, setShowRecoveryData] = useState(false);
  const [pendingAdherence, setPendingAdherence] = useState<{ date: string; recommendation: DailyRecommendation } | null>(null);
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

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      setDecisionInput(input);

      const yesterday = getPreviousLocalDateString(input.date);
      const yesterdayRec = await recommendationService.getRecommendation(userId, yesterday).catch(err => {
        console.warn('Failed to load yesterday\'s recommendation:', err);
        return null;
      });
      setPendingAdherence(
        yesterdayRec && yesterdayRec.adherence.respondedAt === null
          ? { date: yesterday, recommendation: yesterdayRec }
          : null
      );

      const checkinUsable = !input.subjectiveCheckin || input.dataQuality.subjectiveCheckinComplete;
      if (input.recoverySnapshot && checkinUsable) {
        const objective = mapSnapshotToEngineInput(input.recoverySnapshot);
        const subjective = mapCheckinToSubjectiveInput(input.subjectiveCheckin);
        const context = mapContextFromGoalsAndTrainingSettings(input.activeGoals, input.trainingSettings, input.preferences);
        const events = mapGoalsToUserEvents(input.activeGoals);
        const baseRecommendation = await evaluateTrainingWithIntent(userId, { subjective, objective }, context, events, input.date, yesterdayRec?.mode);
        const todayRec = {
          ...baseRecommendation,
          prescription: resolveWorkoutPrescription(baseRecommendation, userId, input.date, input.preferences?.performanceProfile) ?? undefined
        };
        setRecommendation(todayRec);

        const tomorrowPlan = evaluateNextDayPlan({ subjective, objective }, context, input.date, todayRec);
        setNextDayPlan(tomorrowPlan);

        recommendationService.saveRecommendation(userId, input.date, todayRec).catch(err =>
          console.warn('Failed to persist recommendation:', err)
        );
      } else {
        setRecommendation(null);
        setNextDayPlan(null);
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
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
    if (!direction || !engineInputs || !decisionInput) return recommendation;

    const { subjective, objective, context } = engineInputs;
    const adjusted = adjustSessionRecommendation(recommendation, direction, { subjective, objective }, context, decisionInput.date);
    if (!adjusted) return recommendation;
    return {
      ...adjusted,
      prescription: resolveWorkoutPrescription(adjusted, userId, decisionInput.date, decisionInput.preferences?.performanceProfile) ?? undefined
    };
  }, [recommendation, engineInputs, decisionInput, userId]);

  const handleAdjustSession = useCallback((direction: 'easier' | 'harder' | null) => {
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
  }, [recommendation, decisionInput, computeAdjustedRecommendation, userId]);

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
      tomorrow: evaluatePeriodizationPhase(events, addDaysToLocalDateString(decisionInput.date, 1)),
    };
  }, [decisionInput]);

  // Extends today's actual (possibly adjusted) recommendation and tomorrow's green
  // preview branch into a rolling 7-day forecast (see planner.ts) -- recomputed on every
  // render from current goals/constraints/preferences/check-in, never persisted, so it
  // stays in lockstep with whatever's driving today's card above.
  const weekAheadPlan: WeekAheadPlan | null = useMemo(() => {
    if (!engineInputs || !decisionInput || !activeRec) return null;
    const { subjective, objective, context } = engineInputs;
    const tomorrowRec = nextDayPlan ? nextDayPlan.branches.green.recommendation : null;
    return generateWeekAheadPlan(
      { subjective, objective },
      context,
      decisionInput.preferences,
      decisionInput.date,
      activeRec,
      tomorrowRec,
      { events: eventPeriodization?.events }
    );
  }, [engineInputs, decisionInput, activeRec, nextDayPlan, eventPeriodization]);

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
                <span className={`status-badge ${activeRec.adjustment ? 'info' : 'success'}`}>
                  {activeRec.adjustment ? `Adjusted (${activeRec.adjustment.direction})` : 'Ready'}
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
                <p className="recommendation-rationale">{activeRec.rationale}</p>
                {activeRec.prescription && <DetailedTodayPlan prescription={activeRec.prescription} />}

                {/* Session Adjustment Controls */}
                <div className="adjustment-control-section">
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
                </div>
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
          <WeekAheadStrip plan={weekAheadPlan} />
        </div>

        {/* Sidebar Context & Status Column (~30%-32%) */}
        <div className="home-sidebar-col">
          {/* Profile Completeness Bar */}
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

          {/* Adherence Prompt (for yesterday's recommendation, if unanswered) */}
          {pendingAdherence && (
            <AdherencePrompt
              userId={userId}
              date={pendingAdherence.date}
              recommendation={pendingAdherence.recommendation}
              onResolved={() => setPendingAdherence(null)}
            />
          )}

          {/* Quick Action Start/Edit Checkin */}
          <div className="sidebar-primary-action">
            <button 
              className="quick-action-btn primary full-width"
              onClick={() => onNavigate('checkin')}
            >
              {decisionInput?.subjectiveCheckin?.dataQuality.isComplete ? 'Edit Daily Check-in' : 'Start Daily Check-in'}
            </button>
          </div>

          {/* Actionable Status Cards */}
          <div className="sidebar-status-cards">
            {/* Today's Recovery Card */}
            <div 
              className={`dashboard-card ${decisionInput?.recoverySnapshot ? 'clickable' : ''}`} 
              onClick={() => decisionInput?.recoverySnapshot && setShowRecoveryData(!showRecoveryData)}
            >
              <div className="card-header">
                <h3>Today's Recovery</h3>
                {decisionInput?.recoverySnapshot ? (
                  <span className="status-badge success">Available</span>
                ) : (
                  <span className="status-badge warning">No Data</span>
                )}
              </div>
              
              {decisionInput?.recoverySnapshot ? (
                <div className={`recovery-metrics ${showRecoveryData ? 'revealed' : 'blurred'}`}>
                  {showRecoveryData ? (
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
                  ) : (
                    <div className="metric-placeholder">
                      <p>Click to reveal metrics</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="card-empty">No Garmin data synced today</p>
              )}
            </div>

            {/* Today's Check-in Card */}
            <div className="dashboard-card" onClick={() => onNavigate('checkin')}>
              <div className="card-header">
                <h3>Today's Check-in</h3>
                {decisionInput?.subjectiveCheckin?.dataQuality.isComplete ? (
                  <span className="status-badge success">Complete ✓</span>
                ) : (
                  <span className="status-badge pending">Incomplete</span>
                )}
              </div>
              
              {decisionInput?.subjectiveCheckin ? (
                <div className="checkin-summary">
                  <div className="readiness-score">
                    <span className="score-label">Readiness</span>
                    <span className="score-value">
                      {(() => {
                        const { readiness, sleepQuality, fatigue, soreness, mentalStress, motivation } = decisionInput.subjectiveCheckin;
                        const values = [readiness, sleepQuality, fatigue, soreness, mentalStress, motivation]
                          .filter(v => v !== null) as number[];
                        return values.length > 0 
                          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
                          : '--';
                      })()}
                    </span>
                  </div>
                  <p className="card-action">Tap to edit</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No check-in today</p>
                  <p className="card-action">Tap to start</p>
                </div>
              )}
            </div>

            {/* Active Goals Card */}
            <div className="dashboard-card" onClick={() => onNavigate('goals')}>
              <div className="card-header">
                <h3>Active Goals</h3>
                <span className="card-count">
                  {decisionInput?.activeGoals.length || 0}
                </span>
              </div>
              
              {decisionInput?.activeGoals.length ? (
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

            {/* Training settings card */}
            <div className="dashboard-card" onClick={() => onNavigate('constraints')}>
              <div className="card-header">
                <h3>Training Settings</h3>
                <span className="card-count">
                  {activeSettings.length}
                </span>
              </div>
              
              {activeSettings.length ? (
                <div className="constraints-preview">
                  {activeSettings.slice(0, 3).map(setting => (
                    <div key={setting.label} className="constraint-item">
                      <span className="constraint-name">{setting.label}</span>
                      <span className={`constraint-severity ${setting.kind}`}>
                        {setting.kind === 'guardrail' ? 'required' : 'available'}
                      </span>
                    </div>
                  ))}
                  {activeSettings.length > 3 && (
                    <p className="more-items">
                      +{activeSettings.length - 3} more
                    </p>
                  )}
                  <p className="card-action">Tap to manage</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No training settings configured</p>
                  <p className="card-action">Tap to configure</p>
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
