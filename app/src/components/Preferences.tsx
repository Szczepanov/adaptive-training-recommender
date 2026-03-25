import { useState, useEffect } from 'react';
import { preferencesService } from '../services/preferencesService';
import type { UserPreferences } from '../engine/models';
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

  useEffect(() => {
    loadPreferences();
  }, [userId]);

  const loadPreferences = async () => {
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
  };

  const handleSave = async () => {
    if (!preferences) return;

    try {
      setSaving(true);
      setError(null);
      await preferencesService.upsertPreferences(userId, preferences);
      setHasChanges(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
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

  const addModality = (modality: string) => {
    if (!preferences || !modality.trim()) return;
    const updated = [...preferences.preferredModalities];
    if (!updated.includes(modality.trim())) {
      updated.push(modality.trim());
      updatePreference('preferredModalities', updated);
    }
  };

  const removeModality = (modality: string) => {
    if (!preferences) return;
    const updated = preferences.preferredModalities.filter(m => m !== modality);
    updatePreference('preferredModalities', updated);
  };

  const addAvoidedModality = (modality: string) => {
    if (!preferences || !modality.trim()) return;
    const updated = [...preferences.avoidedModalities];
    if (!updated.includes(modality.trim())) {
      updated.push(modality.trim());
      updatePreference('avoidedModalities', updated);
    }
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
        <h1>Preferences</h1>
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
        {/* Recovery Style */}
        <div className="preference-section">
          <h2>Recovery Style</h2>
          <div className="segmented-control">
            {['passive', 'active', 'mixed'].map(style => (
              <button
                key={style}
                className={`segment ${preferences.preferredRecoveryStyle === style ? 'active' : ''}`}
                onClick={() => updatePreference('preferredRecoveryStyle', style as any)}
              >
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </button>
            ))}
          </div>
          <p className="preference-desc">
            How do you prefer to recover on rest days?
          </p>
        </div>

        {/* Time Preferences */}
        <div className="preference-section">
          <h2>Default Session Duration</h2>
          <div className="time-inputs">
            <div className="time-input-group">
              <label>Weekdays</label>
              <div className="time-input">
                <input
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
              <label>Weekends</label>
              <div className="time-input">
                <input
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

        {/* Time of Day */}
        <div className="preference-section">
          <h2>Preferred Time of Day</h2>
          <div className="segmented-control">
            {['morning', 'midday', 'evening', 'flexible'].map(time => (
              <button
                key={time}
                className={`segment ${preferences.preferredTimeOfDay === time ? 'active' : ''}`}
                onClick={() => updatePreference('preferredTimeOfDay', time as any)}
              >
                {time.charAt(0).toUpperCase() + time.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Preferred Modalities */}
        <div className="preference-section">
          <h2>Preferred Training Types</h2>
          <div className="modality-list">
            {preferences.preferredModalities.map(modality => (
              <div key={modality} className="modality-chip">
                <span>{modality}</span>
                <button onClick={() => removeModality(modality)}>×</button>
              </div>
            ))}
          </div>
          <div className="add-modality">
            <input
              type="text"
              placeholder="Add training type..."
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  addModality((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = '';
                }
              }}
            />
            <button onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              addModality(input.value);
              input.value = '';
            }}>
              Add
            </button>
          </div>
        </div>

        {/* Avoided Modalities */}
        <div className="preference-section">
          <h2>Avoided Training Types</h2>
          <div className="modality-list">
            {preferences.avoidedModalities.map(modality => (
              <div key={modality} className="modality-chip avoided">
                <span>{modality}</span>
                <button onClick={() => removeAvoidedModality(modality)}>×</button>
              </div>
            ))}
          </div>
          <div className="add-modality">
            <input
              type="text"
              placeholder="Add training type to avoid..."
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  addAvoidedModality((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = '';
                }
              }}
            />
            <button onClick={(e) => {
              const input = e.currentTarget.previousElementSibling as HTMLInputElement;
              addAvoidedModality(input.value);
              input.value = '';
            }}>
              Add
            </button>
          </div>
        </div>

        {/* Explanation Style */}
        <div className="preference-section">
          <h2>Explanation Detail</h2>
          <div className="segmented-control">
            {['brief', 'detailed', 'technical'].map(style => (
              <button
                key={style}
                className={`segment ${preferences.explanationVerbosity === style ? 'active' : ''}`}
                onClick={() => updatePreference('explanationVerbosity', style as any)}
              >
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </button>
            ))}
          </div>
          <p className="preference-desc">
            How much detail do you want in workout explanations?
          </p>
        </div>

        {/* Units */}
        <div className="preference-section">
          <h2>Units of Measurement</h2>
          <div className="units-grid">
            <div className="unit-group">
              <label>Distance</label>
              <select
                value={preferences.preferredUnits.distance}
                onChange={(e) => updateNestedPreference('distance', e.target.value as any)}
              >
                <option value="km">Kilometers</option>
                <option value="miles">Miles</option>
              </select>
            </div>
            <div className="unit-group">
              <label>Weight</label>
              <select
                value={preferences.preferredUnits.weight}
                onChange={(e) => updateNestedPreference('weight', e.target.value as any)}
              >
                <option value="kg">Kilograms</option>
                <option value="lbs">Pounds</option>
              </select>
            </div>
            <div className="unit-group">
              <label>Temperature</label>
              <select
                value={preferences.preferredUnits.temperature}
                onChange={(e) => updateNestedPreference('temperature', e.target.value as any)}
              >
                <option value="celsius">Celsius</option>
                <option value="fahrenheit">Fahrenheit</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="save-section">
        <button 
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
