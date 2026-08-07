import { useState, useEffect, useCallback } from 'react';
import { preferencesService } from '../services/preferencesService';
import type { UserPreferences, RecoveryStyle, TimeOfDay, ExplanationVerbosity } from '../engine/models';
import { CANONICAL_MODALITIES } from '../utils/modalities';
import { getErrorMessage } from '../utils/errors';
import './Preferences.css';

interface PreferencesProps {
  userId: string;
  onNavigate?: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
}

export function Preferences({ userId }: PreferencesProps) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const loadPreferences = useCallback(async () => {
    try {
      setLoading(true);
      const prefs = await preferencesService.getPreferences(userId);
      
      if (!prefs) {
        // Initialize with defaults
        const defaults = await preferencesService.initializeDefaultPreferences(userId);
        setPreferences(defaults);
      } else {
        setPreferences(prefs);
      }
    } catch (err) {
      console.error('Error loading preferences:', err);
      setError('Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleSave = async () => {
    if (!preferences) return;

    try {
      setSaving(true);
      setError(null);
      await preferencesService.upsertPreferences(userId, preferences);
      setHasChanges(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    loadPreferences();
    setHasChanges(false);
  };

  const updatePreference = <K extends keyof UserPreferences>(
    key: K, 
    value: UserPreferences[K]
  ) => {
    if (!preferences) return;
    setPreferences({ ...preferences, [key]: value });
    setHasChanges(true);
  };

  const updateNestedPreference = <K extends keyof UserPreferences['preferredUnits']>(
    key: K,
    value: UserPreferences['preferredUnits'][K]
  ) => {
    if (!preferences) return;
    setPreferences({
      ...preferences,
      preferredUnits: {
        ...preferences.preferredUnits,
        [key]: value
      }
    });
    setHasChanges(true);
  };

  const addPreferredModality = (modality: string) => {
    if (!preferences || !modality.trim()) return;
    const trimmed = modality.trim();
    const updatedPreferred = [...preferences.preferredModalities];
    if (!updatedPreferred.includes(trimmed)) {
      updatedPreferred.push(trimmed);
    }
    // Clean cross-list conflict automatically (Mutual Exclusion for preferences)
    const updatedAvoided = preferences.avoidedModalities.filter(m => m !== trimmed);

    setPreferences({
      ...preferences,
      preferredModalities: updatedPreferred,
      avoidedModalities: updatedAvoided,
    });
    setHasChanges(true);
  };

  const removePreferredModality = (modality: string) => {
    if (!preferences) return;
    const updated = preferences.preferredModalities.filter(m => m !== modality);
    updatePreference('preferredModalities', updated);
  };

  const addAvoidedModality = (modality: string) => {
    if (!preferences || !modality.trim()) return;
    const trimmed = modality.trim();
    const updatedAvoided = [...preferences.avoidedModalities];
    if (!updatedAvoided.includes(trimmed)) {
      updatedAvoided.push(trimmed);
    }
    // Clean cross-list conflict automatically (Mutual Exclusion for preferences)
    const updatedPreferred = preferences.preferredModalities.filter(m => m !== trimmed);

    setPreferences({
      ...preferences,
      preferredModalities: updatedPreferred,
      avoidedModalities: updatedAvoided,
    });
    setHasChanges(true);
  };

  const removeAvoidedModality = (modality: string) => {
    if (!preferences) return;
    const updated = preferences.avoidedModalities.filter(m => m !== modality);
    updatePreference('avoidedModalities', updated);
  };

  if (loading) {
    return (
      <div className="preferences-container">
        <div className="loading-state">
          <p>Loading preferences...</p>
        </div>
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="preferences-container">
        <div className="error-state">
          <p>Failed to load preferences</p>
          <button onClick={loadPreferences}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="preferences-container">
      <div className="preferences-header">
        <div>
          <h1>Preferences</h1>
          <p className="header-subtitle">
            Configure how the adaptive engine selects and presents training recommendations.
          </p>
        </div>
        {hasChanges && (
          <span className="unsaved-indicator">Unsaved changes</span>
        )}
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="preferences-content">
        {/* Preferred Training Types */}
        <div className="preference-section">
          <h2>Training I Enjoy</h2>
          <p className="preference-desc">
            Modalities you enjoy. When multiple training types achieve today's objective equally well, preferred types receive a soft boost.
          </p>

          <div className="modality-select-group">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  addPreferredModality(e.target.value);
                  e.target.value = '';
                }
              }}
            >
              <option value="">+ Add canonical training type...</option>
              {CANONICAL_MODALITIES.map((item) => {
                const isSelected = preferences.preferredModalities.includes(item.value);
                const isAvoided = preferences.avoidedModalities.includes(item.value);
                return (
                  <option key={item.value} value={item.value} disabled={isSelected}>
                    {item.label} {isAvoided ? '(In Avoided — selecting will move it)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="modality-list">
            {preferences.preferredModalities.map(modality => (
              <div key={modality} className="modality-chip">
                <span>{modality}</span>
                <button 
                  type="button" 
                  aria-label={`Remove ${modality} from preferred`} 
                  onClick={() => removePreferredModality(modality)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="add-modality-custom">
            <input
              type="text"
              placeholder="Or add custom activity tag (e.g. Padel)..."
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  addPreferredModality((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = '';
                }
              }}
            />
            <button 
              type="button"
              onClick={(e) => {
                const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                addPreferredModality(input.value);
                input.value = '';
              }}
            >
              Add Custom
            </button>
          </div>
        </div>

        {/* Avoided Training Types */}
        <div className="preference-section">
          <h2>Training I'd Rather Avoid</h2>
          <p className="preference-desc">
            Modalities you dislike. The engine will apply a strong soft penalty to avoid prescribing these when viable alternatives exist.
          </p>
          <p className="preference-warning-note">
            💡 <strong>Note:</strong> Safety & injury restrictions (e.g. Achilles pain) belong in <em>Constraints</em>, not Preferences.
          </p>

          <div className="modality-select-group">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  addAvoidedModality(e.target.value);
                  e.target.value = '';
                }
              }}
            >
              <option value="">+ Add canonical training type to avoid...</option>
              {CANONICAL_MODALITIES.map((item) => {
                const isSelected = preferences.avoidedModalities.includes(item.value);
                const isPreferred = preferences.preferredModalities.includes(item.value);
                return (
                  <option key={item.value} value={item.value} disabled={isSelected}>
                    {item.label} {isPreferred ? '(In Preferred — selecting will move it)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="modality-list">
            {preferences.avoidedModalities.map(modality => (
              <div key={modality} className="modality-chip avoided">
                <span>{modality}</span>
                <button 
                  type="button" 
                  aria-label={`Remove ${modality} from avoided`} 
                  onClick={() => removeAvoidedModality(modality)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="add-modality-custom">
            <input
              type="text"
              placeholder="Or add custom activity tag to avoid..."
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  addAvoidedModality((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = '';
                }
              }}
            />
            <button 
              type="button"
              onClick={(e) => {
                const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                addAvoidedModality(input.value);
                input.value = '';
              }}
            >
              Add Custom
            </button>
          </div>
        </div>

        {/* Training Decision Style */}
        <div className="preference-section">
          <h2>Training Decision Style</h2>
          <div className="toggle-group">
            <div className="toggle-info">
              <span className="toggle-title">Extra Recovery Margin</span>
              <p className="preference-desc">
                When readiness signals are borderline or ambiguous, resolve decision uncertainty conservatively by picking lower-risk or lower-dose options.
              </p>
            </div>
            <button
              type="button"
              className={`toggle-switch ${preferences.conservativeBias ? 'active' : ''}`}
              onClick={() => updatePreference('conservativeBias', !preferences.conservativeBias)}
              aria-label="Toggle Extra Recovery Margin"
            >
              <span className="toggle-slider" />
            </button>
          </div>
        </div>

        {/* Recovery Style */}
        <div className="preference-section">
          <h2>Recovery Day Style</h2>
          <p className="preference-desc">
            On recovery days, how do you prefer to recharge?
          </p>
          <div className="segmented-control">
            {[
              { id: 'passive', label: 'Complete Rest' },
              { id: 'active', label: 'Light Movement' },
              { id: 'mixed', label: 'Flexible' }
            ].map(style => (
              <button
                key={style.id}
                type="button"
                className={`segment ${preferences.preferredRecoveryStyle === style.id ? 'active' : ''}`}
                onClick={() => updatePreference('preferredRecoveryStyle', style.id as RecoveryStyle)}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time Preferences */}
        <div className="preference-section">
          <h2>Default Available Duration</h2>
          <p className="preference-desc">
            Default daily time budgets used to filter or scale session durations.
          </p>
          <div className="time-inputs">
            <div className="time-input-group">
              <label htmlFor="weekday-time">Weekdays</label>
              <div className="time-input">
                <input
                  id="weekday-time"
                  type="number"
                  min="0"
                  max="1440"
                  value={preferences.defaultWeekdayTimeMin}
                  onChange={(e) => updatePreference('defaultWeekdayTimeMin', Number(e.target.value))}
                />
                <span>minutes</span>
              </div>
            </div>
            <div className="time-input-group">
              <label htmlFor="weekend-time">Weekends</label>
              <div className="time-input">
                <input
                  id="weekend-time"
                  type="number"
                  min="0"
                  max="1440"
                  value={preferences.defaultWeekendTimeMin}
                  onChange={(e) => updatePreference('defaultWeekendTimeMin', Number(e.target.value))}
                />
                <span>minutes</span>
              </div>
            </div>
          </div>
        </div>

        {/* Preferred Time of Day */}
        <div className="preference-section">
          <h2>Preferred Time of Day</h2>
          <div className="segmented-control">
            {['morning', 'midday', 'evening', 'flexible'].map(time => (
              <button
                key={time}
                type="button"
                className={`segment ${preferences.preferredTimeOfDay === time ? 'active' : ''}`}
                onClick={() => updatePreference('preferredTimeOfDay', time as TimeOfDay)}
              >
                {time.charAt(0).toUpperCase() + time.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Explanation Style */}
        <div className="preference-section">
          <h2>Explanation Detail</h2>
          <p className="preference-desc">
            Controls presentation format. The underlying decision telemetry and reasoning remain fixed.
          </p>
          <div className="segmented-control">
            {[
              { id: 'brief', label: 'Brief' },
              { id: 'detailed', label: 'Detailed' },
              { id: 'technical', label: 'Technical' }
            ].map(style => (
              <button
                key={style.id}
                type="button"
                className={`segment ${preferences.explanationVerbosity === style.id ? 'active' : ''}`}
                onClick={() => updatePreference('explanationVerbosity', style.id as ExplanationVerbosity)}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        {/* Units */}
        <div className="preference-section">
          <h2>Units of Measurement</h2>
          <div className="units-grid">
            <div className="unit-group">
              <label htmlFor="unit-distance">Distance</label>
              <select
                id="unit-distance"
                value={preferences.preferredUnits.distance}
                onChange={(e) => updateNestedPreference('distance', e.target.value as UserPreferences['preferredUnits']['distance'])}
              >
                <option value="km">Kilometers</option>
                <option value="miles">Miles</option>
              </select>
            </div>
            <div className="unit-group">
              <label htmlFor="unit-weight">Weight</label>
              <select
                id="unit-weight"
                value={preferences.preferredUnits.weight}
                onChange={(e) => updateNestedPreference('weight', e.target.value as UserPreferences['preferredUnits']['weight'])}
              >
                <option value="kg">Kilograms</option>
                <option value="lbs">Pounds</option>
              </select>
            </div>
            <div className="unit-group">
              <label htmlFor="unit-temp">Temperature</label>
              <select
                id="unit-temp"
                value={preferences.preferredUnits.temperature}
                onChange={(e) => updateNestedPreference('temperature', e.target.value as UserPreferences['preferredUnits']['temperature'])}
              >
                <option value="celsius">Celsius</option>
                <option value="fahrenheit">Fahrenheit</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Save & Reset Actions */}
      <div className="save-section">
        {hasChanges && (
          <button
            type="button"
            className="reset-btn"
            onClick={handleReset}
            disabled={saving}
          >
            Discard Changes
          </button>
        )}
        <button 
          type="button"
          className={`save-btn ${hasChanges ? 'has-changes' : ''}`}
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}

