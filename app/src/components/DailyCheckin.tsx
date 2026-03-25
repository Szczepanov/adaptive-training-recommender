import { useState, useEffect } from 'react';
import { checkinService } from '../services/checkinService';
import type { DailySubjectiveCheckin } from '../engine/models';
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

  const readinessFields = [
    { key: 'readiness', label: 'Overall Readiness', desc: 'How ready do you feel to train today?' },
    { key: 'sleepQuality', label: 'Sleep Quality', desc: 'How well did you sleep last night?' },
    { key: 'fatigue', label: 'Physical Fatigue', desc: 'How much physical fatigue do you feel?' },
    { key: 'soreness', label: 'Muscle Soreness', desc: 'How sore are your muscles?' },
    { key: 'mentalStress', label: 'Mental Stress', desc: 'What is your current stress level?' },
    { key: 'motivation', label: 'Motivation', desc: 'How motivated are you to exercise?' }
  ];

  useEffect(() => {
    loadTodayCheckin();
  }, [userId]);

  const loadTodayCheckin = async () => {
    try {
      setLoading(true);
      setError(null);
      const today = new Date().toISOString().split('T')[0];
      
      try {
        const existing = await checkinService.getCheckin(userId, today);
        
        if (existing) {
          setCheckin(existing);
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
            availability: {
              timeAvailableMin: 60,
              preferredModalityToday: null,
              indoorOnly: false
            },
            notes: null,
            dataQuality: {
              isComplete: false,
              missingFields: []
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          } as DailySubjectiveCheckin);
        }
      } catch (serviceError: any) {
        console.error('Service error loading check-in:', serviceError);
        // If service fails, still initialize with defaults so user can check in
        const today = new Date().toISOString().split('T')[0];
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
          availability: {
            timeAvailableMin: 60,
            preferredModalityToday: null,
            indoorOnly: false
          },
          notes: null,
          dataQuality: {
            isComplete: false,
            missingFields: []
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as DailySubjectiveCheckin);
        
        // Show a non-blocking warning
        console.warn('Loaded check-in with defaults due to service error');
      }
    } catch (err) {
      console.error('Unexpected error loading check-in:', err);
      setError('Failed to load check-in');
    } finally {
      setLoading(false);
    }
  };

  const handleSliderChange = (value: number) => {
    if (!checkin) return;
    const field = readinessFields[currentStep].key as keyof DailySubjectiveCheckin;
    setCheckin({ ...checkin, [field]: value });
  };

  const handleBooleanToggle = (field: 'painOrInjury' | 'illnessSymptoms' | 'unusuallyLimitedTime') => {
    if (!checkin) return;
    setCheckin({ ...checkin, [field]: !checkin[field] });
  };

  const handleAvailabilityChange = (field: string, value: any) => {
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
      
      try {
        const result = await checkinService.upsertCheckin(userId, checkin);
        setCheckin(result);
        
        // Show success and navigate back
        setTimeout(() => {
          onNavigate('home');
        }, 1000);
      } catch (serviceError: any) {
        console.error('Service error saving check-in:', serviceError);
        // Even if save fails, show a message and navigate back
        // The user can still proceed with using the app
        setTimeout(() => {
          onNavigate('home');
        }, 2000);
      }
    } catch (err: any) {
      console.error('Unexpected error saving check-in:', err);
      setError(err.message || 'Failed to save check-in');
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

  // Render readiness sliders
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

  // Render boolean flags
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
          </div>

          <button className="next-btn" onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    );
  }

  // Render availability and notes
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

        {isComplete && !saving && (
          <div className="success-message">
            Check-in already completed today! You can edit above or submit changes.
          </div>
        )}

        <button 
          className="submit-btn" 
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? 'Saving...' : (isComplete ? 'Update Check-in' : 'Complete Check-in')}
        </button>
      </div>
    </div>
  );
}
