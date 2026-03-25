import { useState } from 'react';
import type { DailyDecisionInput } from '../engine/models';
import './DataView.css';

interface DataViewProps {
  decisionInput: DailyDecisionInput | null;
  onBack: () => void;
}

export function DataView({ decisionInput, onBack }: DataViewProps) {
  const [activeTab, setActiveTab] = useState<'recovery' | 'checkin' | 'goals' | 'constraints' | 'preferences'>('recovery');

  if (!decisionInput) {
    return (
      <div className="data-view-container">
        <div className="data-view-header">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <h1>Data View</h1>
        </div>
        <div className="no-data">
          <p>No data available</p>
        </div>
      </div>
    );
  }

  const renderRecoveryData = () => (
    <div className="data-section">
      <h3>Recovery Snapshot</h3>
      <div className="data-grid">
        <div className="data-group">
          <h4>Raw Metrics</h4>
          <div className="data-item">
            <span className="data-label">Date:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.date || 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Sleep Score:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.raw.sleepScore ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Sleep Duration:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.raw.sleepDurationSec 
                ? `${Math.round(decisionInput.recoverySnapshot.raw.sleepDurationSec / 60)} min`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.raw.restingHr ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV Overnight Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.raw.hrvOvernightAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV Status:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.raw.hrvStatus ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Respiration Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.raw.respirationAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Body Battery Wake:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.raw.bodyBatteryWake ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Total Steps:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.raw.totalSteps ?? 'N/A'}</span>
          </div>
        </div>

        <div className="data-group">
          <h4>Derived Metrics</h4>
          <div className="data-item">
            <span className="data-label">Sleep Score 7d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.sleepScore7dAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Sleep Score 28d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.sleepScore28dAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR 7d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.restingHr7dAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR 28d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.restingHr28dAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV 7d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.hrv7dAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV 28d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.hrv28dAvg ?? 'N/A'}</span>
          </div>
        </div>

        <div className="data-group">
          <h4>Deltas</h4>
          <div className="data-item">
            <span className="data-label">Sleep Score vs 7d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.sleepScoreVs7d !== null
                ? `${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs7d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Sleep Score vs 28d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.sleepScoreVs28d !== null
                ? `${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs28d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs28d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR vs 7d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.restingHrVs7d !== null
                ? `${decisionInput.recoverySnapshot!.derived.deltas.restingHrVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.restingHrVs7d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV vs 7d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.hrvVs7d !== null
                ? `${decisionInput.recoverySnapshot!.derived.deltas.hrvVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.hrvVs7d}`
                : 'N/A'
              }
            </span>
          </div>
        </div>

        <div className="data-group">
          <h4>Data Quality</h4>
          <div className="data-item">
            <span className="data-label">Sleep Score Available:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.dataQuality.sleepScoreAvailable ? 'Yes' : 'No'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR Available:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.dataQuality.restingHrAvailable ? 'Yes' : 'No'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV Available:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.dataQuality.hrvAvailable ? 'Yes' : 'No'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Baseline 7d Ready:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.dataQuality.baseline7dReady ? 'Yes' : 'No'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Baseline 28d Ready:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.dataQuality.baseline28dReady ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCheckinData = () => (
    <div className="data-section">
      <h3>Daily Check-in</h3>
      {decisionInput.subjectiveCheckin ? (
        <div className="data-grid">
          <div className="data-group">
            <h4>Subjective Metrics</h4>
            <div className="data-item">
              <span className="data-label">Readiness:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.readiness ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Sleep Quality:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.sleepQuality ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Fatigue:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.fatigue ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Soreness:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.soreness ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Mental Stress:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.mentalStress ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Motivation:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.motivation ?? 'N/A'}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Health Flags</h4>
            <div className="data-item">
              <span className="data-label">Pain/Injury:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.painOrInjury ? 'Yes' : 'No'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Illness Symptoms:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.illnessSymptoms ? 'Yes' : 'No'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Unusually Limited Time:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.unusuallyLimitedTime ? 'Yes' : 'No'}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Availability</h4>
            <div className="data-item">
              <span className="data-label">Time Available (min):</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.availability?.timeAvailableMin ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Preferred Modality:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.availability?.preferredModalityToday ?? 'None'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Indoor Only:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.availability?.indoorOnly ? 'Yes' : 'No'}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Data Quality</h4>
            <div className="data-item">
              <span className="data-label">Is Complete:</span>
              <span className="data-value">{decisionInput.subjectiveCheckin.dataQuality.isComplete ? 'Yes' : 'No'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Missing Fields:</span>
              <span className="data-value">
                {decisionInput.subjectiveCheckin.dataQuality.missingFields.join(', ') || 'None'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p>No check-in data available</p>
      )}
    </div>
  );

  const renderGoalsData = () => (
    <div className="data-section">
      <h3>Active Goals</h3>
      {decisionInput.activeGoals.length > 0 ? (
        <div className="goals-list">
          {decisionInput.activeGoals.map((goal, index) => (
            <div key={`${goal.category}-${index}`} className="goal-detail">
              <h4>{goal.title}</h4>
              <div className="data-item">
                <span className="data-label">Category:</span>
                <span className="data-value">{goal.category}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Domain:</span>
                <span className="data-value">{goal.domain}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Priority:</span>
                <span className="data-value">{goal.priority}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Status:</span>
                <span className="data-value">{goal.status}</span>
              </div>
              {goal.description && (
                <div className="data-item">
                  <span className="data-label">Description:</span>
                  <span className="data-value">{goal.description}</span>
                </div>
              )}
              {goal.targetMetric && (
                <>
                  <div className="data-item">
                    <span className="data-label">Target Metric:</span>
                    <span className="data-value">{goal.targetMetric}</span>
                  </div>
                  <div className="data-item">
                    <span className="data-label">Target Value:</span>
                    <span className="data-value">{goal.targetValue} {goal.targetUnit || ''}</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>No active goals</p>
      )}
    </div>
  );

  const renderConstraintsData = () => (
    <div className="data-section">
      <h3>Active Constraints</h3>
      {decisionInput.activeConstraints.length > 0 ? (
        <div className="constraints-list">
          {decisionInput.activeConstraints.map(constraint => (
            <div key={constraint.key} className="constraint-detail">
              <h4>{constraint.displayName}</h4>
              <div className="data-item">
                <span className="data-label">Category:</span>
                <span className="data-value">{constraint.category}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Type:</span>
                <span className="data-value">{constraint.type}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Value:</span>
                <span className="data-value">
                  {constraint.type === 'boolean' ? (constraint.value ? 'Yes' : 'No') : constraint.value}
                </span>
              </div>
              <div className="data-item">
                <span className="data-label">Severity:</span>
                <span className="data-value">{constraint.severity}</span>
              </div>
              {constraint.description && (
                <div className="data-item">
                  <span className="data-label">Description:</span>
                  <span className="data-value">{constraint.description}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>No active constraints</p>
      )}
    </div>
  );

  const renderPreferencesData = () => (
    <div className="data-section">
      <h3>User Preferences</h3>
      {decisionInput.preferences ? (
        <div className="data-grid">
          <div className="data-group">
            <h4>Recovery Preferences</h4>
            <div className="data-item">
              <span className="data-label">Preferred Recovery Style:</span>
              <span className="data-value">{decisionInput.preferences.preferredRecoveryStyle}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Time Preferences</h4>
            <div className="data-item">
              <span className="data-label">Default Weekday Time:</span>
              <span className="data-value">{decisionInput.preferences.defaultWeekdayTimeMin} min</span>
            </div>
            <div className="data-item">
              <span className="data-label">Default Weekend Time:</span>
              <span className="data-value">{decisionInput.preferences.defaultWeekendTimeMin} min</span>
            </div>
            <div className="data-item">
              <span className="data-label">Preferred Time of Day:</span>
              <span className="data-value">{decisionInput.preferences.preferredTimeOfDay}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Modality Preferences</h4>
            <div className="data-item">
              <span className="data-label">Preferred Modalities:</span>
              <span className="data-value">
                {decisionInput.preferences.preferredModalities.length > 0 
                  ? decisionInput.preferences.preferredModalities.join(', ')
                  : 'None specified'
                }
              </span>
            </div>
            <div className="data-item">
              <span className="data-label">Avoided Modalities:</span>
              <span className="data-value">
                {decisionInput.preferences.avoidedModalities.length > 0
                  ? decisionInput.preferences.avoidedModalities.join(', ')
                  : 'None specified'
                }
              </span>
            </div>
          </div>

          <div className="data-group">
            <h4>UI Preferences</h4>
            <div className="data-item">
              <span className="data-label">Explanation Verbosity:</span>
              <span className="data-value">{decisionInput.preferences.explanationVerbosity}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Units</h4>
            <div className="data-item">
              <span className="data-label">Distance:</span>
              <span className="data-value">{decisionInput.preferences.preferredUnits.distance}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Weight:</span>
              <span className="data-value">{decisionInput.preferences.preferredUnits.weight}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Temperature:</span>
              <span className="data-value">{decisionInput.preferences.preferredUnits.temperature}</span>
            </div>
          </div>
        </div>
      ) : (
        <p>No preferences set</p>
      )}
    </div>
  );

  return (
    <div className="data-view-container">
      <div className="data-view-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1>Data View</h1>
      </div>

      <div className="data-view-tabs">
        <button 
          className={activeTab === 'recovery' ? 'active' : ''}
          onClick={() => setActiveTab('recovery')}
        >
          Recovery
        </button>
        <button 
          className={activeTab === 'checkin' ? 'active' : ''}
          onClick={() => setActiveTab('checkin')}
        >
          Check-in
        </button>
        <button 
          className={activeTab === 'goals' ? 'active' : ''}
          onClick={() => setActiveTab('goals')}
        >
          Goals
        </button>
        <button 
          className={activeTab === 'constraints' ? 'active' : ''}
          onClick={() => setActiveTab('constraints')}
        >
          Constraints
        </button>
        <button 
          className={activeTab === 'preferences' ? 'active' : ''}
          onClick={() => setActiveTab('preferences')}
        >
          Preferences
        </button>
      </div>

      <div className="data-view-content">
        {activeTab === 'recovery' && renderRecoveryData()}
        {activeTab === 'checkin' && renderCheckinData()}
        {activeTab === 'goals' && renderGoalsData()}
        {activeTab === 'constraints' && renderConstraintsData()}
        {activeTab === 'preferences' && renderPreferencesData()}
      </div>
    </div>
  );
}
