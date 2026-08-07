import { useState, useEffect, useCallback } from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { decisionComposer } from '../engine/composer';
import { evaluateTraining, evaluateNextDayPlan } from '../engine/rules';
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
  const [nextDayPlan, setNextDayPlan] = useState<NextDayPotentialPlan | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<'green' | 'yellow' | 'red'>('green');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecoveryData, setShowRecoveryData] = useState(false);
  // Yesterday's recommendation, only populated when it's still awaiting an adherence
  // answer -- drives the "did you follow yesterday's plan?" prompt below.
  const [pendingAdherence, setPendingAdherence] = useState<{ date: string; recommendation: DailyRecommendation } | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      setDecisionInput(input);

      // Fetched once, used two ways below: its `.mode` feeds evaluateTraining's
      // hysteresis (see rules.ts postRecoverBufferApplied) regardless of whether it's
      // been answered yet, and its `.adherence` decides whether to show the prompt --
      // deliberately not the same condition, so an already-answered day still informs
      // today's hysteresis.
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

      // A recommendation needs at least today's Garmin recovery snapshot to be meaningful;
      // the check-in, goals, and constraints all fall back to neutral/default values when
      // *absent*. A check-in that exists but is only partially filled in is different --
      // its alreadyTrainedToday (and other) fields silently default to false/neutral when
      // unanswered, which could mask a genuine "already trained, recommend rest" signal.
      // So an incomplete-but-present check-in blocks generation rather than being trusted.
      const checkinUsable = !input.subjectiveCheckin || input.dataQuality.subjectiveCheckinComplete;
      if (input.recoverySnapshot && checkinUsable) {
        const objective = mapSnapshotToEngineInput(input.recoverySnapshot);
        const subjective = mapCheckinToSubjectiveInput(input.subjectiveCheckin);
        const context = mapContextFromGoalsAndConstraints(input.activeGoals, input.activeConstraints, input.preferences);
        const todayRec = evaluateTraining({ subjective, objective }, context, input.date, yesterdayRec?.mode);
        setRecommendation(todayRec);

        const tomorrowPlan = evaluateNextDayPlan({ subjective, objective }, context, input.date, todayRec);
        setNextDayPlan(tomorrowPlan);

        // Persist what was just computed so there's a durable record to compare actual
        // adherence against later -- fire-and-forget, a save failure shouldn't block
        // the dashboard from showing today's recommendation.
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

  const handleLogout = async () => {
    await signOut(auth);
  };

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
      {/* Header */}
      <div className="home-header">
        <h1>Adaptive Coach</h1>
        <button onClick={handleLogout} className="logout-btn">
          Sign Out
        </button>
      </div>

      {/* Profile Completeness Bar */}
      <div className="completeness-section">
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

      {/* Today's Recommendation */}
      <div className="dashboard-card recommendation-card">
        <div className="card-header">
          <h3>Today's Recommendation</h3>
          {recommendation && <span className="status-badge success">Ready</span>}
        </div>
        {recommendation ? (
          <div className="recommendation-content">
            <h4 className="recommendation-title">{recommendation.template.title}</h4>
            <p className="recommendation-meta">
              {recommendation.template.category} · {recommendation.template.durationMin}-{recommendation.template.durationMax} min
            </p>
            <p className="recommendation-description">{recommendation.template.description}</p>
            <p className="recommendation-rationale">{recommendation.rationale}</p>
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

      {/* Tomorrow's Potential Plan Card */}
      {nextDayPlan && (
        <div className="dashboard-card next-day-card">
          <div className="card-header">
            <h3>Tomorrow's Potential Plan</h3>
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

      {/* Quick Actions */}
      <div className="quick-actions">
        <h2>Quick Actions</h2>
        <div className="action-buttons">
          {onViewData && (
            <button onClick={onViewData} className="action-btn secondary">
              📊 View Detailed Data
            </button>
          )}
        </div>
      </div>

      {/* Dashboard Cards */}
      <div className="dashboard-grid">
        {/* Today's Recovery Card */}
        <div className={`dashboard-card ${decisionInput?.recoverySnapshot ? 'clickable' : ''}`} 
             onClick={() => decisionInput?.recoverySnapshot && setShowRecoveryData(!showRecoveryData)}>
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
                  <p>Click to reveal recovery metrics</p>
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
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <button 
          className="quick-action-btn primary"
          onClick={() => onNavigate('checkin')}
        >
          {decisionInput?.subjectiveCheckin?.dataQuality.isComplete ? 'Edit Check-in' : 'Start Check-in'}
        </button>
        <button 
          className="quick-action-btn secondary"
          onClick={() => onNavigate('preferences')}
        >
          Preferences
        </button>
      </div>
    </div>
  );
}
