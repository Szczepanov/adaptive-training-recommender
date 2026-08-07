import { useState, useEffect, useCallback } from 'react';
import { checkinService } from '../services/checkinService';
import { recoverySnapshotService } from '../services/recoverySnapshotService';
import type { DailySubjectiveCheckin } from '../engine/models';
import { getLocalDateString } from '../utils/localDate';
import { getErrorMessage } from '../utils/errors';
import './DailyCheckin.css';

interface DailyCheckinProps {
  userId: string;
  onNavigate: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
  onBack?: () => void;
}

export function DailyCheckin({ userId, onNavigate, onBack }: DailyCheckinProps) {
  const [checkin, setCheckin] = useState<Partial<DailySubjectiveCheckin> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [recoverySnapshot, setRecoverySnapshot] = useState<Awaited<ReturnType<typeof recoverySnapshotService.getRecoverySnapshotByDate>>>(null);

  const readinessFields = [
    { key: 'readiness', label: 'Overall Readiness', desc: 'How ready do you feel to train today?' },
    { key: 'sleepQuality', label: 'Sleep Quality', desc: 'How well did you sleep last night?' },
    { key: 'fatigue', label: 'Physical Fatigue', desc: 'How much physical fatigue do you feel?' },
    { key: 'soreness', label: 'Muscle Soreness', desc: 'How sore are your muscles?' },
    { key: 'mentalStress', label: 'Mental Stress', desc: 'What is your current stress level?' },
    { key: 'motivation', label: 'Motivation', desc: 'How motivated are you to exercise?' }
  ];

  const loadTodayCheckin = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const today = getLocalDateString();
      
      try {
        const existing = await checkinService.getCheckin(userId, today);
        const snapshot = await recoverySnapshotService.getRecoverySnapshotByDate(userId, today);
        setRecoverySnapshot(snapshot ?? null);
        
        if (existing) {
          setCheckin(existing);
          if (existing.dataQuality?.isComplete) {
            setIsEditing(false);
          }
        } else {
          // Initialize with defaults
          setCheckin({
            userId,
            date: today,
            readiness: 5,
            sleepQuality: 5,
            fatigue: 5,
            soreness: 5,
            mentalStress: 5,
            motivation: 5,
            painOrInjury: false,
            illnessSymptoms: false,
            unusuallyLimitedTime: false,
            alreadyTrainedToday: false,
            availability: {
              timeAvailableMin: 60,
              preferredModalityToday: null,
              indoorOnly: false
            },
            notes: null,
            submittedAt: new Date().toISOString(),
            dataQuality: {
              isComplete: false,
              missingFields: []
            },
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          } as DailySubjectiveCheckin);
          setIsEditing(true);
        }
      } catch (serviceError: unknown) {
        console.error('Service error loading check-in:', serviceError);
        const today = getLocalDateString();
        setCheckin({
          userId,
          date: today,
          readiness: 5,
          sleepQuality: 5,
          fatigue: 5,
          soreness: 5,
          mentalStress: 5,
          motivation: 5,
          painOrInjury: false,
          illnessSymptoms: false,
          unusuallyLimitedTime: false,
          alreadyTrainedToday: false,
          availability: {
            timeAvailableMin: 60,
            preferredModalityToday: null,
            indoorOnly: false
          },
          notes: null,
          submittedAt: new Date().toISOString(),
          dataQuality: {
            isComplete: false,
            missingFields: []
          },
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as DailySubjectiveCheckin);
        setIsEditing(true);
      }
    } catch (err) {
      console.error('Unexpected error loading check-in:', err);
      setError('Failed to load check-in');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadTodayCheckin();
  }, [loadTodayCheckin]);

  const handleSliderChange = (value: number) => {
    if (!checkin) return;
    const field = readinessFields[currentStep].key as keyof DailySubjectiveCheckin;
    setCheckin({ ...checkin, [field]: value });
  };

  const handleBooleanToggle = (field: 'painOrInjury' | 'illnessSymptoms' | 'unusuallyLimitedTime' | 'alreadyTrainedToday') => {
    if (!checkin) return;
    setCheckin({ ...checkin, [field]: !checkin[field] });
  };

  const handleAvailabilityChange = (field: string, value: number | string | boolean | null) => {
    if (!checkin) return;
    setCheckin({
      ...checkin,
      availability: {
        ...checkin.availability,
        [field]: value
      } as DailySubjectiveCheckin['availability']
    });
  };

  const handleNotesChange = (value: string) => {
    if (!checkin) return;
    setCheckin({ ...checkin, notes: value || null });
  };

  const handleNext = () => {
    const finalStepIndex = readinessFields.length + 1;
    if (currentStep < finalStepIndex) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else if (onBack) {
      onBack();
    }
  };

  const handleSubmit = async () => {
    if (!checkin) return;

    try {
      setSaving(true);
      setError(null);
      const now = new Date().toISOString();
      const isFirstSubmission = !checkin.initialSubmittedAt || !checkin.dataQuality?.isComplete;
      
      const checkinToSave: Partial<DailySubjectiveCheckin> = {
        ...checkin,
        submittedAt: now,
        initialSubmittedAt: isFirstSubmission ? now : checkin.initialSubmittedAt,
        editedAfterWearableReveal: !isFirstSubmission,
      };

      const result = await checkinService.upsertTodayCheckin(userId, checkinToSave);
      setCheckin(result);
      setIsEditing(false);
    } catch (err: unknown) {
      console.error('Unexpected error saving check-in:', err);
      setError(getErrorMessage(err) || 'Failed to save check-in');
    } finally {
      setSaving(false);
    }
  };

  const isComplete = checkin?.dataQuality?.isComplete ?? false;

  if (loading) {
    return (
      <div className="checkin-container">
        <div className="loading-state">
          <p>Loading check-in...</p>
        </div>
      </div>
    );
  }

  if (!checkin) {
    return (
      <div className="checkin-container">
        <div className="error-state">
          <p>Failed to load check-in</p>
          <button onClick={loadTodayCheckin}>Retry</button>
        </div>
      </div>
    );
  }

  // Render Post-Submission Comparison View when check-in is complete and not currently editing
  if (isComplete && !isEditing) {
    const sleepDelta = recoverySnapshot?.derived.deltas.sleepScoreVs7d;
    const rhrDelta = recoverySnapshot?.derived.deltas.restingHrVs7d;
    const hrvDelta = recoverySnapshot?.derived.deltas.hrvVs7d;

    return (
      <div className="checkin-container">
        <button className="back-btn" onClick={() => onNavigate('home')}>
          ← Back to Dashboard
        </button>

        <div className="post-submission-card">
          <div className="post-submission-header">
            <h2>Check-in Complete ✓</h2>
            <p>Your subjective observations have been saved for today.</p>
          </div>

          <div className="post-submission-grid">
            {/* Neutral Column 1: YOUR CHECK-IN */}
            <div className="comparison-column subjective">
              <h3>YOUR CHECK-IN</h3>
              <div className="summary-item">
                <span className="summary-label">Readiness:</span>
                <span className="summary-val">{checkin.readiness}/10</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Sleep Quality:</span>
                <span className="summary-val">{checkin.sleepQuality}/10</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Physical Fatigue:</span>
                <span className="summary-val">{checkin.fatigue}/10</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Muscle Soreness:</span>
                <span className="summary-val">{checkin.soreness}/10</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Stress / Motivation:</span>
                <span className="summary-val">{checkin.mentalStress}/10 · {checkin.motivation}/10</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Pain / Illness:</span>
                <span className="summary-val">
                  {checkin.painOrInjury ? 'Pain Flag' : checkin.illnessSymptoms ? 'Unwell' : 'None'}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Time Available:</span>
                <span className="summary-val">{checkin.availability?.timeAvailableMin ?? 60} min</span>
              </div>
            </div>

            {/* Neutral Column 2: GARMIN CONTEXT */}
            <div className="comparison-column wearable">
              <h3>GARMIN CONTEXT</h3>
              {recoverySnapshot ? (
                <>
                  <div className="summary-item">
                    <span className="summary-label">Sleep Score:</span>
                    <span className="summary-val">
                      {recoverySnapshot.raw.sleepScore ?? '--'}
                      {sleepDelta !== null && sleepDelta !== undefined && (
                        <span className="summary-delta">({sleepDelta > 0 ? `+${sleepDelta}` : sleepDelta} vs 7d)</span>
                      )}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Resting HR:</span>
                    <span className="summary-val">
                      {recoverySnapshot.raw.restingHr ? `${recoverySnapshot.raw.restingHr} bpm` : '--'}
                      {rhrDelta !== null && rhrDelta !== undefined && (
                        <span className="summary-delta">({rhrDelta > 0 ? `+${rhrDelta}` : rhrDelta} vs 7d)</span>
                      )}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">HRV Overnight:</span>
                    <span className="summary-val">
                      {recoverySnapshot.raw.hrvOvernightAvg ? `${recoverySnapshot.raw.hrvOvernightAvg} ms` : '--'}
                      {hrvDelta !== null && hrvDelta !== undefined && (
                        <span className="summary-delta">({hrvDelta > 0 ? `+${hrvDelta}` : hrvDelta} vs 7d)</span>
                      )}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Body Battery:</span>
                    <span className="summary-val">{recoverySnapshot.raw.bodyBatteryWake ?? '--'} / 100</span>
                  </div>
                </>
              ) : (
                <div className="wearable-fallback-note">
                  Your check-in is saved. Garmin recovery data hasn&apos;t synced yet today; today&apos;s recommendation will update automatically when Garmin data becomes available.
                </div>
              )}
            </div>
          </div>

          <div className="post-submission-actions">
            <button 
              type="button" 
              className="btn-secondary"
              onClick={() => {
                setIsEditing(true);
                setCurrentStep(0);
              }}
            >
              Edit Check-in
            </button>
            <button 
              type="button" 
              className="btn-primary"
              onClick={() => onNavigate('home')}
            >
              Done & Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render readiness sliders (Steps 1 to 6)
  if (currentStep < readinessFields.length) {
    const field = readinessFields[currentStep];
    const value = checkin[field.key as keyof DailySubjectiveCheckin] as number || 5;

    return (
      <div className="checkin-container">
        <button className="back-btn" onClick={handleBack}>
          ← Back
        </button>

        <div className="step-indicator">
          Step {currentStep + 1} of {readinessFields.length + 2}
        </div>

        <div className="question-card">
          <h2>{field.label}</h2>
          <p>{field.desc}</p>

          <div className="slider-container">
            <div className="slider-labels">
              <span>Low (1)</span>
              <span>High (10)</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={value}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="readiness-slider"
            />
            <div className="slider-value">
              {value}
            </div>
          </div>

          <button className="next-btn" onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    );
  }

  // Render boolean flags (Step 7)
  if (currentStep === readinessFields.length) {
    return (
      <div className="checkin-container">
        <button className="back-btn" onClick={handleBack}>
          ← Back
        </button>

        <div className="step-indicator">
          Step {readinessFields.length + 1} of {readinessFields.length + 2}
        </div>

        <div className="question-card">
          <h2>Health Status</h2>
          <p>Let us know about any current issues</p>

          <div className="boolean-options">
            <label className="boolean-option">
              <input
                type="checkbox"
                id="painOrInjury"
                checked={checkin.painOrInjury || false}
                onChange={() => handleBooleanToggle('painOrInjury')}
              />
              <span className="checkmark"></span>
              <div className="option-content">
                <strong>Pain or Injury</strong>
                <span>Currently experiencing any pain or injury</span>
              </div>
            </label>

            <label className="boolean-option">
              <input
                type="checkbox"
                id="illnessSymptoms"
                checked={checkin.illnessSymptoms || false}
                onChange={() => handleBooleanToggle('illnessSymptoms')}
              />
              <span className="checkmark"></span>
              <div className="option-content">
                <strong>Illness Symptoms</strong>
                <span>Feeling sick or unwell</span>
              </div>
            </label>

            <label className="boolean-option">
              <input
                type="checkbox"
                id="unusuallyLimitedTime"
                checked={checkin.unusuallyLimitedTime || false}
                onChange={() => handleBooleanToggle('unusuallyLimitedTime')}
              />
              <span className="checkmark"></span>
              <div className="option-content">
                <strong>Limited Time Today</strong>
                <span>Have less time than usual for training</span>
              </div>
            </label>

            <label className="boolean-option">
              <input
                type="checkbox"
                id="alreadyTrainedToday"
                checked={checkin.alreadyTrainedToday || false}
                onChange={() => handleBooleanToggle('alreadyTrainedToday')}
              />
              <span className="checkmark"></span>
              <div className="option-content">
                <strong>Already Trained Today</strong>
                <span>I already completed a session today -- recommend rest/recovery only</span>
              </div>
            </label>
          </div>

          <button className="next-btn" onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    );
  }

  // Render availability and notes (Step 8)
  return (
    <div className="checkin-container">
      <button className="back-btn" onClick={handleBack}>
        ← Back
      </button>

      <div className="step-indicator">
        Step {readinessFields.length + 2} of {readinessFields.length + 2}
      </div>

      <div className="question-card">
        <h2>Availability & Notes</h2>
        <p>Help us plan the perfect session</p>

        <div className="availability-section">
          <div className="form-group">
            <label>Time Available (minutes)</label>
            <input
              type="number"
              min="0"
              max="1440"
              value={checkin.availability?.timeAvailableMin || 60}
              onChange={(e) => handleAvailabilityChange('timeAvailableMin', Number(e.target.value))}
              className="number-input"
            />
          </div>

          <div className="form-group">
            <label>Preferred Modality</label>
            <select
              value={checkin.availability?.preferredModalityToday || ''}
              onChange={(e) => handleAvailabilityChange('preferredModalityToday', e.target.value || null)}
              className="select-input"
            >
              <option value="">No preference</option>
              <option value="Running">Running</option>
              <option value="Cycling">Cycling</option>
              <option value="Strength">Strength Training</option>
              <option value="Mobility">Mobility/Recovery</option>
              <option value="Swimming">Swimming</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <label className="boolean-option">
            <input
              type="checkbox"
              checked={checkin.availability?.indoorOnly || false}
              onChange={(e) => handleAvailabilityChange('indoorOnly', e.target.checked)}
            />
            <span className="checkmark"></span>
            <div className="option-content">
              <strong>Indoor Only</strong>
              <span>Limited to indoor training options</span>
            </div>
          </label>

          <div className="form-group">
            <label>Notes (optional)</label>
            <textarea
              value={checkin.notes || ''}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Any additional information..."
              rows={3}
              className="textarea-input"
            />
          </div>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <button 
          className="submit-btn" 
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? 'Saving...' : (isComplete ? 'Save & Review' : 'Complete Check-in')}
        </button>
      </div>
    </div>
  );
}
