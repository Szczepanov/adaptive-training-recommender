import type { TrainingSettings, UserGoal, UserPreferences } from '../../engine/models';
import { SCREEN_LABELS } from '../../types/navigation';

export function GoalsTab({ activeGoals }: { activeGoals: UserGoal[] }) {
  return (
    <div className="data-section">
      <h3>Active Goals</h3>
      {activeGoals.length > 0 ? (
        <div className="goals-list">
          {activeGoals.map((goal, index) => (
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
}

export function ConstraintsTab({ trainingSettings }: { trainingSettings: TrainingSettings }) {
  return (
    <div className="data-section">
      <h3>{SCREEN_LABELS.constraints}</h3>
      <div className="constraints-list">
        <div className="constraint-detail">
          <h4>Available equipment</h4>
          <span className="data-value">{Object.entries(trainingSettings.equipment).filter(([, enabled]) => enabled).map(([name]) => name.replaceAll('_', ' ')).join(', ') || 'None configured'}</span>
        </div>
        <div className="constraint-detail">
          <h4>Safety limits</h4>
          <span className="data-value">{Object.entries(trainingSettings.guardrails).filter(([, enabled]) => enabled).map(([name]) => name.replace('avoid_', 'Block ').replaceAll('_', ' ')).join(', ') || 'None configured'}</span>
        </div>
        <div className="constraint-detail">
          <h4>Time & location</h4>
          <span className="data-value">Weekdays: {trainingSettings.defaults.weekdayMaxMinutes ?? 'No limit'} min; weekends: {trainingSettings.defaults.weekendMaxMinutes ?? 'No limit'} min; {trainingSettings.defaults.environment}</span>
        </div>
      </div>
    </div>
  );
}

export function PreferencesTab({ preferences }: { preferences: UserPreferences | null }) {
  return (
    <div className="data-section">
      <h3>User Preferences</h3>
      {preferences ? (
        <div className="data-grid">
          <div className="data-group">
            <h4>Recovery Preferences</h4>
            <div className="data-item">
              <span className="data-label">Preferred Recovery Style:</span>
              <span className="data-value">{preferences.preferredRecoveryStyle}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Time Preferences</h4>
            <div className="data-item">
              <span className="data-label">Default Weekday Time:</span>
              <span className="data-value">{preferences.defaultWeekdayTimeMin} min</span>
            </div>
            <div className="data-item">
              <span className="data-label">Default Weekend Time:</span>
              <span className="data-value">{preferences.defaultWeekendTimeMin} min</span>
            </div>
            <div className="data-item">
              <span className="data-label">Preferred Time of Day:</span>
              <span className="data-value">{preferences.preferredTimeOfDay}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Modality Preferences</h4>
            <div className="data-item">
              <span className="data-label">Preferred Modalities:</span>
              <span className="data-value">
                {preferences.preferredModalities.length > 0
                  ? preferences.preferredModalities.join(', ')
                  : 'None specified'
                }
              </span>
            </div>
            <div className="data-item">
              <span className="data-label">Avoided Modalities:</span>
              <span className="data-value">
                {preferences.avoidedModalities.length > 0
                  ? preferences.avoidedModalities.join(', ')
                  : 'None specified'
                }
              </span>
            </div>
          </div>

          <div className="data-group">
            <h4>UI Preferences</h4>
            <div className="data-item">
              <span className="data-label">Explanation Verbosity:</span>
              <span className="data-value">{preferences.explanationVerbosity}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Units</h4>
            <div className="data-item">
              <span className="data-label">Distance:</span>
              <span className="data-value">{preferences.preferredUnits.distance}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Weight:</span>
              <span className="data-value">{preferences.preferredUnits.weight}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Temperature:</span>
              <span className="data-value">{preferences.preferredUnits.temperature}</span>
            </div>
          </div>
        </div>
      ) : (
        <p>No preferences set</p>
      )}
    </div>
  );
}
