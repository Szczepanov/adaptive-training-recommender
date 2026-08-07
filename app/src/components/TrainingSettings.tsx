import { useCallback, useEffect, useState } from 'react';
import type { GuardrailKey, TrainingSettings as TrainingSettingsModel } from '../engine/models';
import { trainingSettingsService, type TrainingSettingsUpdate } from '../services/trainingSettingsService';
import './TrainingSettings.css';

interface TrainingSettingsProps {
  userId: string;
}

const equipmentLabels: Record<keyof TrainingSettingsModel['equipment'], string> = {
  free_weights: 'Free weights',
  cable_machine: 'Cable machine',
  treadmill: 'Treadmill',
  indoor_bike: 'Stationary bike',
  pullup_bar: 'Pull-up bar',
};

const guardrailDetails: Record<GuardrailKey, { label: string; effect: string }> = {
  avoid_high_impact: { label: 'Block high-impact training', effect: 'Running, jumping, and field sessions will not be recommended.' },
  avoid_heavy_lower_body: { label: 'Block heavy lower-body work', effect: 'Heavy lower-body strength, running, and field sessions will not be recommended.' },
  avoid_overhead_pressing: { label: 'Block overhead pressing', effect: 'Templates containing overhead pressing will not be recommended.' },
  avoid_heavy_spinal_loading: { label: 'Block heavy spinal loading', effect: 'Templates containing heavy spinal loading will not be recommended.' },
};

export function TrainingSettings({ userId }: TrainingSettingsProps) {
  const [settings, setSettings] = useState<TrainingSettingsModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await trainingSettingsService.getTrainingSettings(userId));
      setError(null);
    } catch (cause) {
      console.error('Unable to load training settings', cause);
      setError('Unable to load training settings. Please try again.');
    }
  }, [userId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const save = async (update: TrainingSettingsUpdate) => {
    try {
      const updated = await trainingSettingsService.updateTrainingSettings(userId, update);
      setSettings(updated);
      setError(null);
    } catch (cause) {
      console.error('Unable to save training settings', cause);
      setError('Unable to save that setting. Please try again.');
    }
  };

  if (!settings) return <main className="training-settings"><p>{error ?? 'Loading training settings…'}</p></main>;

  return (
    <main className="training-settings">
      <header>
        <h1>Training Settings</h1>
        <p>Equipment determines what can be prescribed. Safety limits are always enforced. Preferences only break ties between suitable options.</p>
      </header>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {!settings.migration.legacyReviewed && (
        <section className="settings-review" aria-labelledby="legacy-review-title">
          <h2 id="legacy-review-title">Review migrated settings</h2>
          <p>We could not safely infer your previous equipment and injury toggles. Confirm the settings below before relying on them.</p>
          <button type="button" onClick={() => void save({ migration: { legacyReviewed: true } })}>I have reviewed these settings</button>
        </section>
      )}

      <section aria-labelledby="equipment-title">
        <h2 id="equipment-title">Available equipment</h2>
        <p className="section-intro">Turn on only equipment you can use for a typical session.</p>
        <div className="settings-list">
          {Object.entries(equipmentLabels).map(([key, label]) => (
            <label className="setting-row" key={key}>
              <input type="checkbox" checked={settings.equipment[key as keyof TrainingSettingsModel['equipment']]} onChange={(event) => void save({ equipment: { [key]: event.target.checked } })} />
              <span><strong>{label}</strong><small>{settings.equipment[key as keyof TrainingSettingsModel['equipment']] ? 'Available for recommendations' : 'Not used in recommendations'}</small></span>
            </label>
          ))}
        </div>
      </section>

      <section aria-labelledby="guardrails-title">
        <h2 id="guardrails-title">Safety limits</h2>
        <p className="section-intro">These limits remove matching sessions from every recommendation, including “Harder”. This is not medical advice.</p>
        <div className="settings-list">
          {Object.entries(guardrailDetails).map(([key, detail]) => (
            <label className="setting-row" key={key}>
              <input type="checkbox" checked={settings.guardrails[key as GuardrailKey]} onChange={(event) => void save({ guardrails: { [key]: event.target.checked } })} />
              <span><strong>{detail.label}</strong><small>{detail.effect}</small></span>
            </label>
          ))}
        </div>
      </section>

      <section aria-labelledby="availability-title">
        <h2 id="availability-title">Time and location</h2>
        <div className="time-inputs">
          <label>Weekday session limit (minutes)<input type="number" min="0" max="1440" value={settings.defaults.weekdayMaxMinutes ?? ''} onChange={(event) => void save({ defaults: { weekdayMaxMinutes: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
          <label>Weekend session limit (minutes)<input type="number" min="0" max="1440" value={settings.defaults.weekendMaxMinutes ?? ''} onChange={(event) => void save({ defaults: { weekendMaxMinutes: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
        </div>
        <fieldset>
          <legend>Training location requirement</legend>
          {(['either', 'indoor', 'outdoor'] as const).map((environment) => <label key={environment}><input type="radio" name="environment" checked={settings.defaults.environment === environment} onChange={() => void save({ defaults: { environment } })} /> {environment === 'either' ? 'Any location' : `${environment[0].toUpperCase()}${environment.slice(1)} only`}</label>)}
        </fieldset>
      </section>

      <section aria-labelledby="preferences-title">
        <h2 id="preferences-title">Recovery preferences</h2>
        <label className="setting-row"><input type="checkbox" checked={settings.preferences.preferActiveRecovery} onChange={(event) => void save({ preferences: { preferActiveRecovery: event.target.checked } })} /><span><strong>Prefer active recovery</strong><small>When recovery is needed, mobility is ranked ahead of total rest when both are suitable.</small></span></label>
      </section>
    </main>
  );
}
