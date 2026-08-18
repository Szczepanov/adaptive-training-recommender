import { useState, useEffect } from 'react';
import type { DataState } from '../engine/dataState';
import type { DailyDecisionInput, NormalizedGarminActivity } from '../engine/models';
import { activityService } from '../services/activityService';
import { recommendationService } from '../services/recommendationService';
import { contextBriefService, type ContextBriefResult } from '../services/contextBriefService';
import { addDaysToLocalDateString } from '../utils/localDate';
import { ActivityTelemetry } from './ActivityTelemetry';
import './DataView.css';

interface DataViewProps {
  decisionInput: DailyDecisionInput | null;
  userId: string;
  onBack: () => void;
  initialTab?: DataViewTab;
}

type DataViewTab = 'recovery' | 'activities' | 'checkin' | 'goals' | 'constraints' | 'preferences' | 'adherence' | 'brief';

type AdherenceStats = Awaited<ReturnType<typeof recommendationService.getAdherenceStats>>;

function describeSourceState(status: 'MISSING' | 'INVALID' | 'UNAVAILABLE'): string {
  if (status === 'MISSING') return 'No record exists for this date yet.';
  if (status === 'INVALID') return 'The stored record is malformed and needs repair.';
  return 'The data source is temporarily unavailable. Retry the dashboard refresh.';
}

export function DataView({ decisionInput, userId, initialTab = 'recovery' }: DataViewProps) {
  const [activeTab, setActiveTab] = useState<DataViewTab>(initialTab);
  const [brief, setBrief] = useState<ContextBriefResult | null>(null);
  // Tagged with the date it belongs to, so a failure for one date is not rendered
  // against another. Deriving visibility this way avoids clearing state from inside
  // the effect body, which react-hooks/set-state-in-effect correctly rejects.
  const [briefError, setBriefError] = useState<{ date: string; message: string } | null>(null);
  const [briefCopied, setBriefCopied] = useState(false);
  // null doubles as "not loaded yet" -- once getAdherenceStats resolves it's always a
  // real (possibly all-zero) stats object, so this alone distinguishes loading from an
  // answer of "nothing recorded yet" without a separate loading flag.
  const [adherenceStats, setAdherenceStats] = useState<AdherenceStats | null>(null);
  const [activityWindow, setActivityWindow] = useState<{
    userId: string;
    asOfDate: string;
    state: DataState<NormalizedGarminActivity[]>;
  } | null>(null);

  useEffect(() => {
    if (activeTab !== 'adherence' || adherenceStats) return;
    let cancelled = false;
    recommendationService.getAdherenceStats(userId, 30).then(stats => {
      if (!cancelled) setAdherenceStats(stats);
    });
    return () => { cancelled = true; };
  }, [activeTab, userId, adherenceStats]);

  const briefDate = decisionInput?.date;
  useEffect(() => {
    // Both userId and asOfDate must match the cached window, or a user switch on the same
    // calendar date would skip the fetch and later render the previous user's activities.
    if (activeTab !== 'activities' || !briefDate
      || (activityWindow?.userId === userId && activityWindow.asOfDate === briefDate)) return;
    let cancelled = false;
    const startInclusive = addDaysToLocalDateString(briefDate, -6);
    const throughExclusive = addDaysToLocalDateString(briefDate, 1);
    activityService.getActivitiesInRange(userId, startInclusive, throughExclusive).then((state) => {
      if (!cancelled) setActivityWindow({ userId, asOfDate: briefDate, state });
    });
    return () => { cancelled = true; };
  }, [activeTab, userId, briefDate, activityWindow?.userId, activityWindow?.asOfDate]);

  useEffect(() => {
    // Keyed on the date the brief was built for, not merely on its presence: a scenario
    // switch or a midnight rollover changes `briefDate`, and a presence-only guard would
    // leave the previous day's brief and range on screen indefinitely.
    // `briefDate` must be defined for the comparison to settle: passing undefined lets the
    // service default to today, whose asOfDate would never equal undefined and would
    // re-trigger this effect on every render.
    if (activeTab !== 'brief' || !briefDate || brief?.asOfDate === briefDate) return;
    let cancelled = false;
    contextBriefService.build(userId, briefDate)
      .then(result => { if (!cancelled) { setBrief(result); setBriefError(null); } })
      .catch(() => {
        if (cancelled) return;
        // Drop the stale result rather than leaving the previous date's brief and range on
        // screen under an error banner -- Copy would otherwise hand the athlete yesterday's
        // window while the page claims today's.
        setBrief(null);
        setBriefCopied(false);
        setBriefError({ date: briefDate, message: 'Could not assemble the brief. Retry the dashboard refresh.' });
      });
    return () => { cancelled = true; };
  }, [activeTab, userId, brief?.asOfDate, briefDate]);

  const copyBrief = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief.text);
      setBriefError(null);
      setBriefCopied(true);
      window.setTimeout(() => setBriefCopied(false), 2000);
    } catch {
      // Clipboard permission can be denied; the textarea below is always selectable.
      setBriefCopied(false);
      setBriefError({ date: brief.asOfDate, message: 'Copy was blocked. Select the text below and copy it manually.' });
    }
  };

  if (!decisionInput) {
    return (
      <div className="data-view-container">
        <div className="data-view-header">
          <h1>Detailed Data & Telemetry</h1>
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
      {decisionInput.sourceStates?.recoverySnapshot.status !== undefined
        && decisionInput.sourceStates.recoverySnapshot.status !== 'AVAILABLE' && (
          <p className="data-state-notice">{describeSourceState(decisionInput.sourceStates.recoverySnapshot.status)}</p>
        )}
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
          <div className="data-item">
            <span className="data-label">HRV 28d Stdev:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.hrv28dStdev ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR 28d Stdev:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.restingHr28dStdev ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Sleep Score 28d Stdev:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.sleepScore28dStdev ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Steps 7d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.steps7dAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Steps 28d Avg:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.steps28dAvg ?? 'N/A'}</span>
          </div>
          <div className="data-item">
            <span className="data-label">Steps 28d Stdev:</span>
            <span className="data-value">{decisionInput.recoverySnapshot?.derived.steps28dStdev ?? 'N/A'}</span>
          </div>
        </div>

        <div className="data-group">
          <h4>Deltas</h4>
          <div className="data-item">
            <span className="data-label">Sleep Score vs 7d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.sleepScoreVs7d !== null && decisionInput.recoverySnapshot?.derived.deltas.sleepScoreVs7d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs7d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Sleep Score vs 28d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.sleepScoreVs28d !== null && decisionInput.recoverySnapshot?.derived.deltas.sleepScoreVs28d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs28d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.sleepScoreVs28d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR vs 7d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.restingHrVs7d !== null && decisionInput.recoverySnapshot?.derived.deltas.restingHrVs7d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.restingHrVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.restingHrVs7d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Resting HR vs 28d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.restingHrVs28d !== null && decisionInput.recoverySnapshot?.derived.deltas.restingHrVs28d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.restingHrVs28d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.restingHrVs28d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV vs 7d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.hrvVs7d !== null && decisionInput.recoverySnapshot?.derived.deltas.hrvVs7d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.hrvVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.hrvVs7d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">HRV vs 28d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.hrvVs28d !== null && decisionInput.recoverySnapshot?.derived.deltas.hrvVs28d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.hrvVs28d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.hrvVs28d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Steps vs 7d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.stepsVs7d !== null && decisionInput.recoverySnapshot?.derived.deltas.stepsVs7d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.stepsVs7d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.stepsVs7d}`
                : 'N/A'
              }
            </span>
          </div>
          <div className="data-item">
            <span className="data-label">Steps vs 28d:</span>
            <span className="data-value">
              {decisionInput.recoverySnapshot?.derived.deltas.stepsVs28d !== null && decisionInput.recoverySnapshot?.derived.deltas.stepsVs28d !== undefined
                ? `${decisionInput.recoverySnapshot!.derived.deltas.stepsVs28d > 0 ? '+' : ''}${decisionInput.recoverySnapshot!.derived.deltas.stepsVs28d}`
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
      {decisionInput.sourceStates?.subjectiveCheckin.status !== undefined
        && decisionInput.sourceStates.subjectiveCheckin.status !== 'AVAILABLE' && (
          <p className="data-state-notice">{describeSourceState(decisionInput.sourceStates.subjectiveCheckin.status)}</p>
        )}
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
      <h3>Training Settings</h3>
      <div className="constraints-list">
        <div className="constraint-detail">
          <h4>Available equipment</h4>
          <span className="data-value">{Object.entries(decisionInput.trainingSettings.equipment).filter(([, enabled]) => enabled).map(([name]) => name.replaceAll('_', ' ')).join(', ') || 'None configured'}</span>
        </div>
        <div className="constraint-detail">
          <h4>Safety limits</h4>
          <span className="data-value">{Object.entries(decisionInput.trainingSettings.guardrails).filter(([, enabled]) => enabled).map(([name]) => name.replace('avoid_', 'Block ').replaceAll('_', ' ')).join(', ') || 'None configured'}</span>
        </div>
        <div className="constraint-detail">
          <h4>Time & location</h4>
          <span className="data-value">Weekdays: {decisionInput.trainingSettings.defaults.weekdayMaxMinutes ?? 'No limit'} min; weekends: {decisionInput.trainingSettings.defaults.weekendMaxMinutes ?? 'No limit'} min; {decisionInput.trainingSettings.defaults.environment}</span>
        </div>
      </div>
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

  const visibleBriefError = briefError && briefError.date === briefDate ? briefError.message : null;

  const renderContextBrief = () => (
    <div className="data-section">
      <h3>Context brief</h3>
      <p className="brief-intro">
        A summary of the last {brief?.windowDays ?? 14} days — constraints, recovery trend, completed
        training, subjective scores, and adherence — for pasting into an external planner.
        Read-only: generating it changes nothing.
      </p>
      {visibleBriefError && <p className="data-state-notice">{visibleBriefError}</p>}
      {!brief && !visibleBriefError && <p>Assembling...</p>}
      {brief && (
        <>
          {brief.unavailableSources.length > 0 && (
            <p className="data-state-notice">
              Could not read: {brief.unavailableSources.join(', ')}. The brief below is incomplete.
            </p>
          )}
          <div className="brief-actions">
            <button className="brief-copy" onClick={copyBrief}>
              {briefCopied ? 'Copied' : 'Copy to clipboard'}
            </button>
            <span className="brief-range">{brief.startDate} → {brief.asOfDate}</span>
          </div>
          <textarea className="brief-text" readOnly value={brief.text} rows={24} spellCheck={false} />
        </>
      )}
    </div>
  );

  const renderAdherenceData = () => (
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

  return (
    <div className="data-view-container">
      <div className="data-view-header">
        <div>
          <h1>Detailed Data & Telemetry</h1>
          <p className="header-subtitle">Inspect engine inputs, recovery metrics, activity telemetry, and adherence.</p>
        </div>
      </div>

      <div className="data-view-tabs">
        <button 
          className={activeTab === 'recovery' ? 'active' : ''}
          onClick={() => setActiveTab('recovery')}
        >
          Recovery
        </button>
        <button
          className={activeTab === 'activities' ? 'active' : ''}
          onClick={() => setActiveTab('activities')}
        >
          Activities
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
          Training Settings
        </button>
        <button
          className={activeTab === 'preferences' ? 'active' : ''}
          onClick={() => setActiveTab('preferences')}
        >
          Preferences
        </button>
        <button
          className={activeTab === 'adherence' ? 'active' : ''}
          onClick={() => setActiveTab('adherence')}
        >
          Adherence
        </button>
        <button
          className={activeTab === 'brief' ? 'active' : ''}
          onClick={() => setActiveTab('brief')}
        >
          Context brief
        </button>
      </div>

      <div className="data-view-content">
        {activeTab === 'recovery' && renderRecoveryData()}
        {activeTab === 'activities' && (
          <div className="data-section">
            <h3>Recent activity telemetry</h3>
            <ActivityTelemetry
              state={activityWindow && activityWindow.userId === userId && activityWindow.asOfDate === briefDate ? activityWindow.state : null}
            />
          </div>
        )}
        {activeTab === 'checkin' && renderCheckinData()}
        {activeTab === 'goals' && renderGoalsData()}
        {activeTab === 'constraints' && renderConstraintsData()}
        {activeTab === 'adherence' && renderAdherenceData()}
        {activeTab === 'preferences' && renderPreferencesData()}
        {activeTab === 'brief' && renderContextBrief()}
      </div>
    </div>
  );
}
