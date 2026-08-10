import { useState, useEffect, useCallback } from 'react';
import { preferencesService } from '../services/preferencesService';
import { trainingIntentProfileService } from '../services/trainingIntentProfileService';
import { DEFAULT_TRAINING_INTENT_PROFILE } from '../engine/evergreenStrategy';
import type { UserPreferences, RecoveryStyle, TimeOfDay, ExplanationVerbosity, PlanningMode, TrainingIntentProfile, TrainingPriority } from '../engine/models';
import { CANONICAL_MODALITIES } from '../utils/modalities';
import { getErrorMessage } from '../utils/errors';
import './Preferences.css';

interface PreferencesProps {
  userId: string;
  onNavigate?: (screen: 'home' | 'checkin' | 'goals' | 'constraints' | 'preferences') => void;
}

type TrainingIntentProfileDraft = Omit<TrainingIntentProfile, 'userId' | 'createdAt' | 'updatedAt'>;

function defaultTrainingIntentProfile(): TrainingIntentProfileDraft {
  return {
    ...DEFAULT_TRAINING_INTENT_PROFILE,
    priorities: [...DEFAULT_TRAINING_INTENT_PROFILE.priorities],
    weeklyCommitment: { ...DEFAULT_TRAINING_INTENT_PROFILE.weeklyCommitment },
  };
}

const TRAINING_PRIORITY_OPTIONS: Array<{ value: TrainingPriority; label: string }> = [
  { value: 'health', label: 'Health and energy' },
  { value: 'balanced_performance', label: 'Balanced fitness' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'strength_muscle', label: 'Strength and muscle' },
  { value: 'speed_power', label: 'Speed and power' },
  { value: 'sport_readiness', label: 'Sport readiness' },
];

export function Preferences({ userId }: PreferencesProps) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [trainingIntentProfile, setTrainingIntentProfile] = useState<TrainingIntentProfileDraft>(defaultTrainingIntentProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const loadPreferences = useCallback(async () => {
    try {
      setLoading(true);
      const [prefs, profileState] = await Promise.all([
        preferencesService.getPreferences(userId),
        trainingIntentProfileService.getProfileState(userId),
      ]);
      
      if (!prefs) {
        // Initialize with defaults
        const defaults = await preferencesService.initializeDefaultPreferences(userId);
        setPreferences(defaults);
      } else {
        setPreferences(prefs);
      }
      if (profileState.status === 'AVAILABLE') {
        setTrainingIntentProfile({
          planningMode: profileState.data.planningMode,
          priorities: profileState.data.priorities,
          weeklyCommitment: profileState.data.weeklyCommitment,
          organizationPreference: profileState.data.organizationPreference,
          schemaVersion: profileState.data.schemaVersion,
        });
      } else {
        setTrainingIntentProfile(defaultTrainingIntentProfile());
        if (profileState.status !== 'MISSING') setError('Training intent could not be loaded. Defaults are shown, but saving may fail until the service is available.');
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
      await Promise.all([
        preferencesService.upsertPreferences(userId, preferences),
        trainingIntentProfileService.upsert(userId, trainingIntentProfile),
      ]);
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

  const updatePerformanceProfile = (
    key: 'ftpWatts' | 'thresholdPaceSecPerKm' | 'lthrBpm' | 'cyclingLthr',
    value: string
  ) => {
    if (!preferences) return;
    const profile = preferences.performanceProfile ?? {};
    const numericValue = value.trim() === '' ? null : Number(value);
    const now = new Date().toISOString();

    const cycling = { ...profile.cycling };
    const running = { ...profile.running };

    if (key === 'ftpWatts') {
      cycling.ftpWatts = numericValue;
      cycling.measuredAt = now;
    } else if (key === 'cyclingLthr') {
      cycling.lthrBpm = numericValue;
      cycling.measuredAt = now;
    } else if (key === 'thresholdPaceSecPerKm') {
      running.thresholdPaceSecPerKm = numericValue;
      running.measuredAt = now;
    } else if (key === 'lthrBpm') {
      running.lthrBpm = numericValue;
      running.measuredAt = now;
    }

    setPreferences({
      ...preferences,
      performanceProfile: {
        ...profile,
        // Legacy top-level sync
        ftpWatts: key === 'ftpWatts' ? numericValue : profile.ftpWatts,
        thresholdPaceSecPerKm: key === 'thresholdPaceSecPerKm' ? numericValue : profile.thresholdPaceSecPerKm,
        lthrBpm: key === 'lthrBpm' ? numericValue : profile.lthrBpm,
        cycling,
        running,
        measuredAt: now
      }
    });
    setHasChanges(true);
  };

  const updateCapability = (key: 'powerMeter' | 'heartRateMonitor' | 'cadenceData', enabled: boolean) => {
    if (!preferences) return;
    const profile = preferences.performanceProfile ?? {};
    setPreferences({
      ...preferences,
      performanceProfile: {
        ...profile,
        capabilities: {
          ...profile.capabilities,
          [key]: enabled
        }
      }
    });
    setHasChanges(true);
  };



  const updateEstimated1Rm = (exerciseId: string, value: string) => {
    if (!preferences) return;
    const estimated1RmKg = { ...(preferences.performanceProfile?.estimated1RmKg ?? {}) };
    if (value.trim() === '') delete estimated1RmKg[exerciseId];
    else estimated1RmKg[exerciseId] = Number(value);
    setPreferences({
      ...preferences,
      performanceProfile: {
        ...preferences.performanceProfile,
        estimated1RmKg,
        measuredAt: new Date().toISOString()
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

  const updateTrainingIntentProfile = (update: Partial<TrainingIntentProfileDraft>) => {
    setTrainingIntentProfile(current => ({ ...current, ...update }));
    setHasChanges(true);
  };

  const updateWeeklyCommitment = (key: keyof TrainingIntentProfileDraft['weeklyCommitment'], value: number) => {
    updateTrainingIntentProfile({
      weeklyCommitment: { ...trainingIntentProfile.weeklyCommitment, [key]: value },
    });
  };

  const toggleTrainingPriority = (priority: TrainingPriority) => {
    const priorities = trainingIntentProfile.priorities.includes(priority)
      ? trainingIntentProfile.priorities.filter(item => item !== priority)
      : [...trainingIntentProfile.priorities, priority];
    updateTrainingIntentProfile({ priorities });
  };

  const moveTrainingPriority = (priority: TrainingPriority, direction: -1 | 1) => {
    const index = trainingIntentProfile.priorities.indexOf(priority);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= trainingIntentProfile.priorities.length) return;
    const priorities = [...trainingIntentProfile.priorities];
    [priorities[index], priorities[nextIndex]] = [priorities[nextIndex], priorities[index]];
    updateTrainingIntentProfile({ priorities });
  };

  const addUnavailableModality = (modality: NonNullable<UserPreferences['unavailableModalities']>[number]) => {
    if (!preferences || !modality) return;
    const unavailableModalities = preferences.unavailableModalities ?? [];
    if (unavailableModalities.includes(modality)) return;
    setPreferences({
      ...preferences,
      unavailableModalities: [...unavailableModalities, modality],
      preferredModalities: preferences.preferredModalities.filter(item => item !== modality),
      avoidedModalities: preferences.avoidedModalities.filter(item => item !== modality),
    });
    setHasChanges(true);
  };

  const removeUnavailableModality = (modality: NonNullable<UserPreferences['unavailableModalities']>[number]) => {
    if (!preferences) return;
    updatePreference('unavailableModalities', (preferences.unavailableModalities ?? []).filter(item => item !== modality));
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
        <div className="preference-section">
          <h2>Training Plan</h2>
          <p className="preference-desc">
            Set the kind of training you want to organize. These are planning inputs, not a promise of a fixed workout every day.
          </p>
          <div className="units-grid">
            <div className="unit-group">
              <label htmlFor="planning-mode">Planning mode</label>
              <select
                id="planning-mode"
                value={trainingIntentProfile.planningMode}
                onChange={(event) => updateTrainingIntentProfile({ planningMode: event.target.value as PlanningMode })}
              >
                <option value="evergreen">Continuous training</option>
                <option value="event_directed">Follow scheduled events</option>
              </select>
            </div>
          </div>
          <p className="preference-desc">Priorities, in order. Select only the outcomes you want this plan to emphasize.</p>
          <div className="priority-options" role="group" aria-label="Training priorities">
            {TRAINING_PRIORITY_OPTIONS.map(option => (
              <label key={option.value} className="priority-option">
                <input
                  type="checkbox"
                  checked={trainingIntentProfile.priorities.includes(option.value)}
                  onChange={() => toggleTrainingPriority(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {trainingIntentProfile.priorities.length > 0 && (
            <div className="priority-order" aria-label="Selected priority order">
              <span>Priority order:</span>
              {trainingIntentProfile.priorities.map((priority, index) => {
                const label = TRAINING_PRIORITY_OPTIONS.find(option => option.value === priority)?.label ?? priority;
                return (
                  <span key={priority} className="priority-order-item">
                    {label}
                    <button type="button" onClick={() => moveTrainingPriority(priority, -1)} disabled={index === 0} aria-label={`Move ${label} earlier`}>↑</button>
                    <button type="button" onClick={() => moveTrainingPriority(priority, 1)} disabled={index === trainingIntentProfile.priorities.length - 1} aria-label={`Move ${label} later`}>↓</button>
                  </span>
                );
              })}
            </div>
          )}
          <p className="preference-desc">Weekly session range</p>
          <div className="time-inputs">
            {([
              ['minSessions', 'Minimum'],
              ['targetSessions', 'Typical'],
              ['maxSessions', 'Maximum'],
            ] as const).map(([key, label]) => (
              <div key={key} className="time-input-group">
                <label htmlFor={`sessions-${key}`}>{label}</label>
                <div className="time-input">
                  <input
                    id={`sessions-${key}`}
                    type="number"
                    min="1"
                    max="14"
                    value={trainingIntentProfile.weeklyCommitment[key]}
                    onChange={(event) => updateWeeklyCommitment(key, Number(event.target.value))}
                  />
                  <span>sessions</span>
                </div>
              </div>
            ))}
          </div>
        </div>

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

        <div className="preference-section">
          <h2>Unavailable Training Types</h2>
          <p className="preference-desc">
            Hard exclusions: these activities will not be offered, even when they would otherwise fit the plan.
          </p>
          <div className="modality-select-group">
            <select
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  addUnavailableModality(event.target.value as NonNullable<UserPreferences['unavailableModalities']>[number]);
                  event.target.value = '';
                }
              }}
            >
              <option value="">+ Add unavailable training type...</option>
              {CANONICAL_MODALITIES.map(item => (
                <option key={item.value} value={item.value} disabled={(preferences.unavailableModalities ?? []).includes(item.value as NonNullable<UserPreferences['unavailableModalities']>[number])}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="modality-list">
            {(preferences.unavailableModalities ?? []).map(modality => (
              <div key={modality} className="modality-chip unavailable">
                <span>{modality}</span>
                <button type="button" aria-label={`Remove ${modality} from unavailable`} onClick={() => removeUnavailableModality(modality)}>×</button>
              </div>
            ))}
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

        <div className="preference-section">
          <h2>Measurement Devices & Equipment</h2>
          <p className="preference-desc">
            Toggle available sensors. Workout steps adapt to your equipment—falling back safely to RPE when a sensor is unconfigured or absent.
          </p>
          <div className="units-grid">
            <div className="unit-group">
              <label htmlFor="cap-power">Power Meter / Smart Trainer</label>
              <select
                id="cap-power"
                value={preferences.performanceProfile?.capabilities?.powerMeter === false ? 'no' : 'yes'}
                onChange={(e) => updateCapability('powerMeter', e.target.value === 'yes')}
              >
                <option value="yes">Available</option>
                <option value="no">Unavailable</option>
              </select>
            </div>
            <div className="unit-group">
              <label htmlFor="cap-hr">Heart Rate Monitor</label>
              <select
                id="cap-hr"
                value={preferences.performanceProfile?.capabilities?.heartRateMonitor === false ? 'no' : 'yes'}
                onChange={(e) => updateCapability('heartRateMonitor', e.target.value === 'yes')}
              >
                <option value="yes">Available</option>
                <option value="no">Unavailable</option>
              </select>
            </div>
            <div className="unit-group">
              <label htmlFor="cap-cadence">Cadence Sensor</label>
              <select
                id="cap-cadence"
                value={preferences.performanceProfile?.capabilities?.cadenceData === false ? 'no' : 'yes'}
                onChange={(e) => updateCapability('cadenceData', e.target.value === 'yes')}
              >
                <option value="yes">Available</option>
                <option value="no">Unavailable</option>
              </select>
            </div>
          </div>
        </div>

        <div className="preference-section">
          <h2>Training Targets</h2>
          <p className="preference-desc">
            Sport-scoped benchmark references. Garmin imports cycling FTP and running threshold targets after daily sync.
          </p>
          <div className="units-grid">
            <div className="unit-group">
              <label htmlFor="ftp-watts">Cycling FTP (watts)</label>
              <input
                id="ftp-watts"
                type="number"
                min="1"
                step="1"
                value={preferences.performanceProfile?.cycling?.ftpWatts ?? preferences.performanceProfile?.ftpWatts ?? ''}
                onChange={(e) => updatePerformanceProfile('ftpWatts', e.target.value)}
              />
            </div>
            <div className="unit-group">
              <label htmlFor="cycling-lthr">Cycling LTHR (bpm)</label>
              <input
                id="cycling-lthr"
                type="number"
                min="1"
                step="1"
                value={preferences.performanceProfile?.cycling?.lthrBpm ?? ''}
                onChange={(e) => updatePerformanceProfile('cyclingLthr', e.target.value)}
              />
              <small className="target-source">Manual cycling HR reference</small>
            </div>
            <div className="unit-group">
              <label htmlFor="threshold-pace">Running threshold pace (sec/km)</label>
              <input
                id="threshold-pace"
                type="number"
                min="1"
                step="1"
                value={preferences.performanceProfile?.running?.thresholdPaceSecPerKm ?? preferences.performanceProfile?.thresholdPaceSecPerKm ?? ''}
                onChange={(e) => updatePerformanceProfile('thresholdPaceSecPerKm', e.target.value)}
              />
            </div>
            <div className="unit-group">
              <label htmlFor="lthr">Running LTHR (bpm)</label>
              <input
                id="lthr"
                type="number"
                min="1"
                step="1"
                value={preferences.performanceProfile?.running?.lthrBpm ?? preferences.performanceProfile?.lthrBpm ?? ''}
                onChange={(e) => updatePerformanceProfile('lthrBpm', e.target.value)}
              />
            </div>
          </div>
          <p className="preference-desc">Estimated 1RM (kg) is optional. It provides a starting load only; the prescribed RIR always takes precedence.</p>
          <div className="units-grid">
            {[
              ['front_squat', 'Front squat'],
              ['romanian_deadlift', 'Romanian deadlift'],
              ['bench_press', 'Bench press']
            ].map(([exerciseId, label]) => (
              <div className="unit-group" key={exerciseId}>
                <label htmlFor={`e1rm-${exerciseId}`}>{label} e1RM (kg)</label>
                <input
                  id={`e1rm-${exerciseId}`}
                  type="number"
                  min="1"
                  step="2.5"
                  value={preferences.performanceProfile?.strength?.estimated1RmKg?.[exerciseId] ?? preferences.performanceProfile?.estimated1RmKg?.[exerciseId] ?? ''}
                  onChange={(e) => updateEstimated1Rm(exerciseId, e.target.value)}
                />
              </div>
            ))}
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
