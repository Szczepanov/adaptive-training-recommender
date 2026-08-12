
import type { UserPreferences, RecoveryStyle, TimeOfDay, ExplanationVerbosity } from '../../engine/models';

interface StyleSectionsProps {
  preferences: UserPreferences;
  updatePreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  updateNestedPreference: <K extends keyof UserPreferences['preferredUnits']>(key: K, value: UserPreferences['preferredUnits'][K]) => void;
}

export function StyleSections({ preferences, updatePreference, updateNestedPreference }: StyleSectionsProps) {
  return (
    <>
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
    </>
  );
}
