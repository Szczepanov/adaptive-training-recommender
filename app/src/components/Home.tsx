import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { decisionComposer } from '../engine/composer';
import type { DailyDecisionInput } from '../engine/models';
import './Home.css';

interface HomeProps {
  userId: string;
  onNavigate: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
}

export function Home({ userId, onNavigate }: HomeProps) {
  const [decisionInput, setDecisionInput] = useState<DailyDecisionInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, [userId]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const input = await decisionComposer.composeDailyDecisionInput(userId);
      setDecisionInput(input);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

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

      {/* Dashboard Cards */}
      <div className="dashboard-grid">
        {/* Today's Recovery Card */}
        <div className="dashboard-card">
          <div className="card-header">
            <h3>Today's Recovery</h3>
            {decisionInput?.recoverySnapshot ? (
              <span className="status-badge success">Available</span>
            ) : (
              <span className="status-badge warning">No Data</span>
            )}
          </div>
          
          {decisionInput?.recoverySnapshot ? (
            <div className="recovery-metrics">
              <div className="metric">
                <span className="metric-label">Sleep Score</span>
                <span className="metric-value">
                  {decisionInput.recoverySnapshot.raw.sleepScore ?? '--'}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">HRV Delta</span>
                <span className="metric-value">
                  {decisionInput.recoverySnapshot.derived.deltas.hrvVs7d !== null 
                    ? `${decisionInput.recoverySnapshot.derived.deltas.hrvVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot.derived.deltas.hrvVs7d}`
                    : '--'
                  }
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Body Battery</span>
                <span className="metric-value">
                  {decisionInput.recoverySnapshot.raw.bodyBatteryWake ?? '--'}
                </span>
              </div>
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
