import { useState, useEffect, useCallback, useMemo } from 'react';
import { decisionComposer } from '../engine/composer';
import { evaluateTraining, evaluateNextDayPlan, adjustSessionRecommendation } from '../engine/rules';
import { mapSnapshotToEngineInput, mapCheckinToSubjectiveInput, mapContextFromGoalsAndConstraints } from '../engine/adapters';
import type { DailyDecisionInput, Recommendation, NextDayPotentialPlan, DailyRecommendation } from '../engine/models';
import { recommendationService } from '../services/recommendationService';
import { getPreviousLocalDateString } from '../utils/localDate';
import { AdherencePrompt } from './AdherencePrompt';
import './Home.css';

interface HomeProps {
  userId: string;
  onNavigate: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
  onViewData?: () => void;
}

export function Home({ userId, onNavigate, onViewData }: HomeProps) {
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [adjustmentDirection, setAdjustmentDirection] = useState<'easier' | 'harder' | null>(null);
  const [nextDayPlan, setNextDayPlan] = useState<NextDayPotentialPlan | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<'green' | 'yellow' | 'red'>('green');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecoveryData, setShowRecoveryData] = useState(false);
  const [pendingAdherence, setPendingAdherence] = useState<{ date: string; recommendation: DailyRecommendation } | null>(null);

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
        const context = mapContextFromGoalsAndConstraints(input.activeGoals, input.activeConstraints, input.preferences);
        const todayRec = evaluateTraining({ subjective, objective }, context, input.date, yesterdayRec?.mode);
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
    const context = mapContextFromGoalsAndConstraints(decisionInput.activeGoals, decisionInput.activeConstraints, decisionInput.preferences);
    return { subjective, objective, context };
  }, [decisionInput]);

  const computeAdjustedRecommendation = useCallback((direction: 'easier' | 'harder' | null): Recommendation | null => {
    if (!recommendation) return null;
    if (!direction || !engineInputs || !decisionInput) return recommendation;

    const { subjective, objective, context } = engineInputs;
    return adjustSessionRecommendation(recommendation, direction, { subjective, objective }, context, decisionInput.date) || recommendation;
  }, [recommendation, engineInputs, decisionInput]);

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

          {/* Tomorrow's Provisional Plan Card (Secondary Visual Prominence) */}
          {nextDayPlan && (
            <div className="dashboard-card next-day-card provisional-plan-card">
              <div className="card-header">
                <div className="header-title-group">
                  <h3>Tomorrow — provisional</h3>
                  <span className="provisional-tag">Subject to morning readiness</span>
                </div>
                <span className="status-badge info">{nextDayPlan.date}</span>
              </div>

              {nextDayPlan.isSinglePlan ? (
                <div className="single-plan-container">
                  <div className="single-plan-banner">
                    <span className="banner-icon">📌</span>
                    <div className="banner-text">
                      <strong>Single Mandatory Plan:</strong>
                      <p>{nextDayPlan.singlePlanReason}</p>
                    </div>
                  </div>

                  <div className="recommendation-content">
                    <h4 className="recommendation-title">
                      {nextDayPlan.branches.green.recommendation.template.title}
                    </h4>
                    <p className="recommendation-meta">
                      {nextDayPlan.branches.green.recommendation.template.category} · {nextDayPlan.branches.green.recommendation.template.durationMin}-{nextDayPlan.branches.green.recommendation.template.durationMax} min
                    </p>
                    <p className="recommendation-description">
                      {nextDayPlan.branches.green.recommendation.template.description}
                    </p>
                    <p className="recommendation-rationale">
                      {nextDayPlan.branches.green.recommendation.rationale}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="multi-branch-container">
                  <p className="contingency-intro">
                    Projected morning readiness options:
                  </p>

                  {/* Branch Selector Tabs */}
                  <div className="branch-tabs">
                    <button
                      className={`branch-tab green ${selectedBranch === 'green' ? 'active' : ''}`}
                      onClick={() => setSelectedBranch('green')}
                    >
                      <span className="tier-indicator">🟢</span>
                      <span className="tab-label">Green (High)</span>
                    </button>
                    <button
                      className={`branch-tab yellow ${selectedBranch === 'yellow' ? 'active' : ''}`}
                      onClick={() => setSelectedBranch('yellow')}
                    >
                      <span className="tier-indicator">🟡</span>
                      <span className="tab-label">Yellow (Mid)</span>
                    </button>
                    <button
                      className={`branch-tab red ${selectedBranch === 'red' ? 'active' : ''}`}
                      onClick={() => setSelectedBranch('red')}
                    >
                      <span className="tier-indicator">🔴</span>
                      <span className="tab-label">Red (Low)</span>
                    </button>
                  </div>

                  {/* Branch Details */}
                  {(() => {
                    const branch = nextDayPlan.branches[selectedBranch];
                    return (
                      <div className={`branch-details tier-${selectedBranch}`}>
                        <div className="condition-box">
                          <span className="condition-label">Condition:</span>
                          <span className="condition-text">{branch.condition}</span>
                        </div>

                        <div className="recommendation-content">
                          <h4 className="recommendation-title">{branch.recommendation.template.title}</h4>
                          <p className="recommendation-meta">
                            {branch.recommendation.template.category} · {branch.recommendation.template.durationMin}-{branch.recommendation.template.durationMax} min
                          </p>
                          <p className="recommendation-description">{branch.recommendation.template.description}</p>
                          <p className="recommendation-rationale">{branch.recommendation.rationale}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
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
                        <span className="goal-title">{goal.title}</span>
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

            {/* Active Constraints Card */}
            <div className="dashboard-card" onClick={() => onNavigate('constraints')}>
              <div className="card-header">
                <h3>Active Constraints</h3>
                <span className="card-count">
                  {decisionInput?.activeConstraints.length || 0}
                </span>
              </div>
              
              {decisionInput?.activeConstraints.length ? (
                <div className="constraints-preview">
                  {decisionInput.activeConstraints.slice(0, 3).map(constraint => (
                    <div key={constraint.key} className="constraint-item">
                      <span className="constraint-name">{constraint.displayName}</span>
                      <span className={`constraint-severity ${constraint.severity}`}>
                        {constraint.severity}
                      </span>
                    </div>
                  ))}
                  {decisionInput.activeConstraints.length > 3 && (
                    <p className="more-items">
                      +{decisionInput.activeConstraints.length - 3} more
                    </p>
                  )}
                  <p className="card-action">Tap to manage</p>
                </div>
              ) : (
                <div className="card-empty">
                  <p>No active constraints</p>
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
