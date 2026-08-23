
import type { UserPreferences } from '../../engine/models';

interface PerformanceSectionsProps {
  preferences: UserPreferences;
  updateCapability: (key: 'powerMeter' | 'heartRateMonitor' | 'cadenceData', enabled: boolean) => void;
  updatePerformanceProfile: (key: 'ftpWatts' | 'thresholdPaceSecPerKm' | 'lthrBpm' | 'cyclingLthr' | 'weightKg' | 'bodyFatPct', value: string) => void;
  updateEstimated1Rm: (exerciseId: string, value: string) => void;
}

export function PerformanceSections({
  preferences,
  updateCapability,
  updatePerformanceProfile,
  updateEstimated1Rm
}: PerformanceSectionsProps) {
  const isLbs = preferences.preferredUnits.weight === 'lbs';
  const weightKg = preferences.performanceProfile?.weightKg ?? null;
  const displayWeight = weightKg !== null
    ? (isLbs ? (weightKg * 2.20462).toFixed(1) : String(weightKg))
    : '';

  const ftpWatts = preferences.performanceProfile?.cycling?.ftpWatts ?? preferences.performanceProfile?.ftpWatts ?? null;
  const wKg = ftpWatts && weightKg && weightKg > 0 ? (ftpWatts / weightKg) : null;

  const handleWeightChange = (rawInput: string) => {
    if (rawInput.trim() === '') {
      updatePerformanceProfile('weightKg', '');
      return;
    }
    const num = Number(rawInput);
    if (!Number.isFinite(num) || num <= 0) return;
    const finalKg = isLbs ? num / 2.20462 : num;
    updatePerformanceProfile('weightKg', finalKg.toFixed(2));
  };

  const weightSource = preferences.performanceProfile?.targetSources?.weightKg;
  const bodyFatSource = preferences.performanceProfile?.targetSources?.bodyFatPct;
  const weightMeasuredAt = preferences.performanceProfile?.weightMeasuredAt;

  return (
    <>
      <div className="preference-section">
        <h2>Body Composition & Biometrics</h2>
        <p className="preference-desc">
          Body mass enables power-to-weight (W/kg) and relative-strength calculations. Garmin can refresh weight after a weigh-in; body-fat percentage is stored as biometric context.
        </p>
        <div className="units-grid">
          <div className="unit-group">
            <label htmlFor="athlete-weight">Body Weight ({isLbs ? 'lbs' : 'kg'})</label>
            <input
              key={`athlete-weight-${isLbs ? 'lbs' : 'kg'}-${weightKg ?? 'empty'}`}
              id="athlete-weight"
              type="number"
              min={isLbs ? 44 : 20}
              max={isLbs ? 772 : 350}
              step="0.1"
              defaultValue={displayWeight}
              onBlur={(e) => handleWeightChange(e.target.value)}
              placeholder={isLbs ? 'e.g. 165' : 'e.g. 75.0'}
            />
            {weightSource && (
              <small className="target-source">
                Source: {weightSource}
                {weightMeasuredAt ? ` (${weightMeasuredAt.slice(0, 10)})` : ''}
              </small>
            )}
          </div>
          <div className="unit-group">
            <label htmlFor="athlete-body-fat">Body Fat (%)</label>
            <input
              id="athlete-body-fat"
              type="number"
              min="3"
              max="60"
              step="0.1"
              value={preferences.performanceProfile?.bodyFatPct ?? ''}
              onChange={(e) => updatePerformanceProfile('bodyFatPct', e.target.value)}
              placeholder="e.g. 14.5"
            />
            <small className="target-source">
              {bodyFatSource ? `Source: ${bodyFatSource}` : 'Optional biometric context'}
            </small>
          </div>
        </div>

        {wKg !== null && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'var(--card-bg, #1a1a24)', borderRadius: '8px', border: '1px solid var(--border-subtle, #2e2e3e)' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #9a9ab0)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cycling Power-to-Weight</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent, #6366f1)', marginTop: '0.1rem' }}>
                {wKg.toFixed(2)} <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>W/kg</span>
              </div>
            </div>
            <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--text-muted, #71717a)', fontSize: '0.8rem' }}>
              Derived from {ftpWatts} W FTP and {displayWeight} {isLbs ? 'lb' : 'kg'} body weight.
            </small>
          </div>
        )}
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
          ].map(([exerciseId, label]) => {
            const e1rmVal = preferences.performanceProfile?.strength?.estimated1RmKg?.[exerciseId] ?? preferences.performanceProfile?.estimated1RmKg?.[exerciseId] ?? null;
            const bwRatio = e1rmVal && weightKg && weightKg > 0 ? (e1rmVal / weightKg).toFixed(2) : null;
            return (
              <div className="unit-group" key={exerciseId}>
                <label htmlFor={`e1rm-${exerciseId}`}>{label} e1RM (kg)</label>
                <input
                  id={`e1rm-${exerciseId}`}
                  type="number"
                  min="1"
                  step="2.5"
                  value={e1rmVal ?? ''}
                  onChange={(e) => updateEstimated1Rm(exerciseId, e.target.value)}
                />
                {bwRatio && (
                  <small className="target-source">{bwRatio}× bodyweight</small>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}