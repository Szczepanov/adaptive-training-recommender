import type { UserPreferences } from '../../engine/models';
import './PerformanceSections.css';

interface PerformanceSectionsProps {
  preferences: UserPreferences;
  updateCapability: (key: 'powerMeter' | 'heartRateMonitor' | 'cadenceData', enabled: boolean) => void;
  updatePerformanceProfile: (key: 'ftpWatts' | 'thresholdPaceSecPerKm' | 'lthrBpm' | 'cyclingLthr', value: string) => void;
  updateEstimated1Rm: (exerciseId: string, value: string) => void;
}

export function PerformanceSections({
  preferences,
  updateCapability,
  updatePerformanceProfile,
  updateEstimated1Rm
}: PerformanceSectionsProps) {
  return (
    <>
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

      {preferences.performanceProfile?.racePredictions && (
        <div className="preference-section">
          <h2>Garmin Race Predictions</h2>
          <p className="preference-desc">
            Garmin-estimated finish times imported during sync. Treat them as aerobic benchmarks, not guaranteed race outcomes.
          </p>
          <div className="units-grid race-predictions-grid">
            {[
              { label: '5K', sec: preferences.performanceProfile.racePredictions.fiveKmSec, distKm: 5.0 },
              { label: '10K', sec: preferences.performanceProfile.racePredictions.tenKmSec, distKm: 10.0 },
              { label: 'Half Marathon', sec: preferences.performanceProfile.racePredictions.halfMarathonSec, distKm: 21.0975 },
              { label: 'Marathon', sec: preferences.performanceProfile.racePredictions.marathonSec, distKm: 42.195 },
            ].map(({ label, sec, distKm }) => {
              const isMiles = preferences.preferredUnits.distance === 'miles';
              if (!sec || sec <= 0) return null;
              const h = Math.floor(sec / 3600);
              const m = Math.floor((sec % 3600) / 60);
              const s = sec % 60;
              const timeStr = h > 0
                ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                : `${m}:${s.toString().padStart(2, '0')}`;
              const dist = isMiles ? distKm * 0.621371 : distKm;
              const paceSec = Math.round(sec / dist);
              const paceStr = `${Math.floor(paceSec / 60)}:${(paceSec % 60).toString().padStart(2, '0')}/${isMiles ? 'mi' : 'km'}`;

              return (
                <div className="race-prediction-card" key={label}>
                  <span className="race-prediction-label">{label}</span>
                  <strong className="race-prediction-time">{timeStr}</strong>
                  <small className="race-prediction-pace">Pace {paceStr}</small>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}