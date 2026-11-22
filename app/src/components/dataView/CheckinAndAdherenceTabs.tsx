import type { DataStateSummary } from '../../engine/dataState';
import type { DailySubjectiveCheckin } from '../../engine/models';
import { describeSourceState, type AdherenceStats } from './dataViewFormat';

export function CheckinTab({
  subjectiveCheckin,
  sourceStateStatus,
}: {
  subjectiveCheckin: DailySubjectiveCheckin | null;
  sourceStateStatus?: DataStateSummary['status'];
}) {
  return (
    <div className="data-section">
      <h3>Daily Check-in</h3>
      {sourceStateStatus !== undefined && sourceStateStatus !== 'AVAILABLE' && (
        <p className="data-state-notice">{describeSourceState(sourceStateStatus)}</p>
      )}
      {subjectiveCheckin ? (
        <div className="data-grid">
          <div className="data-group">
            <h4>Subjective Metrics</h4>
            <div className="data-item">
              <span className="data-label">Readiness:</span>
              <span className="data-value">{subjectiveCheckin.readiness ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Sleep Quality:</span>
              <span className="data-value">{subjectiveCheckin.sleepQuality ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Fatigue:</span>
              <span className="data-value">{subjectiveCheckin.fatigue ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Soreness:</span>
              <span className="data-value">{subjectiveCheckin.soreness ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Mental Stress:</span>
              <span className="data-value">{subjectiveCheckin.mentalStress ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Motivation:</span>
              <span className="data-value">{subjectiveCheckin.motivation ?? 'N/A'}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Health Flags</h4>
            <div className="data-item">
              <span className="data-label">Pain/Injury:</span>
              <span className="data-value">{subjectiveCheckin.painOrInjury ? 'Yes' : 'No'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Illness Symptoms:</span>
              <span className="data-value">{subjectiveCheckin.illnessSymptoms ? 'Yes' : 'No'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Unusually Limited Time:</span>
              <span className="data-value">{subjectiveCheckin.unusuallyLimitedTime ? 'Yes' : 'No'}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Availability</h4>
            <div className="data-item">
              <span className="data-label">Time Available (min):</span>
              <span className="data-value">{subjectiveCheckin.availability?.timeAvailableMin ?? 'N/A'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Preferred Modality:</span>
              <span className="data-value">{subjectiveCheckin.availability?.preferredModalityToday ?? 'None'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Indoor Only:</span>
              <span className="data-value">{subjectiveCheckin.availability?.indoorOnly ? 'Yes' : 'No'}</span>
            </div>
          </div>

          <div className="data-group">
            <h4>Data Quality</h4>
            <div className="data-item">
              <span className="data-label">Is Complete:</span>
              <span className="data-value">{subjectiveCheckin.dataQuality.isComplete ? 'Yes' : 'No'}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Missing Fields:</span>
              <span className="data-value">
                {subjectiveCheckin.dataQuality.missingFields.join(', ') || 'None'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p>No check-in data available</p>
      )}
    </div>
  );
}

export function AdherenceTab({ adherenceStats }: { adherenceStats: AdherenceStats | null }) {
  return (
    <div className="data-section">
      <h3>Adherence (last 30 days)</h3>
      {adherenceStats === null ? (
        <p>Loading...</p>
      ) : adherenceStats.totalRecommendations > 0 ? (
        <div className="data-grid">
          <div className="data-group">
            <h4>Overall</h4>
            <div className="data-item">
              <span className="data-label">Recommendations Generated:</span>
              <span className="data-value">{adherenceStats.totalRecommendations}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Answered:</span>
              <span className="data-value">{adherenceStats.answered}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Awaiting Response:</span>
              <span className="data-value">{adherenceStats.awaitingResponse}</span>
            </div>
            <div className="data-item">
              <span className="data-label">Followed Rate:</span>
              <span className="data-value">
                {adherenceStats.answered > 0 ? `${adherenceStats.followedRate}%` : 'N/A (no answers yet)'}
              </span>
            </div>
            <div className="data-item">
              <span className="data-label">Followed / Modified / Skipped:</span>
              <span className="data-value">
                {adherenceStats.followedCount} / {adherenceStats.modifiedCount} / {adherenceStats.skippedCount}
              </span>
            </div>
          </div>

          <div className="data-group">
            <h4>Followed Rate by Mode</h4>
            {(['train', 'modify', 'recover'] as const).map(mode => (
              <div className="data-item" key={mode}>
                <span className="data-label">{mode.charAt(0).toUpperCase() + mode.slice(1)}:</span>
                <span className="data-value">
                  {adherenceStats.byMode[mode].total > 0
                    ? `${adherenceStats.byMode[mode].followedRate}% (n=${adherenceStats.byMode[mode].total})`
                    : 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p>No recommendations recorded yet -- this fills in as the dashboard generates and you answer the daily "did you follow this?" prompt.</p>
      )}
    </div>
  );
}
