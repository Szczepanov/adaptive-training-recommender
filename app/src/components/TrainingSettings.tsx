import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { BodyRegion, GuardrailKey, InjuryConstraint, SessionTemplate, TrainingSettings as TrainingSettingsModel } from '../engine/models';
import { resolveInjuryRestrictions } from '../engine/injuryPolicy';
import { trainingSettingsService, type TrainingSettingsUpdate } from '../services/trainingSettingsService';
import { getLocalDateString } from '../utils/localDate';
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
  outdoor_bike: 'Bicycle (outdoor)',
  swim_access: 'Pool / swim access',
};

const guardrailDetails: Record<GuardrailKey, { label: string; effect: string }> = {
  avoid_high_impact: { label: 'Block high-impact training', effect: 'Running, jumping, and field sessions will not be recommended.' },
  avoid_heavy_lower_body: { label: 'Block heavy lower-body work', effect: 'Heavy lower-body strength, running, and field sessions will not be recommended.' },
  avoid_overhead_pressing: { label: 'Block overhead pressing', effect: 'Templates containing overhead pressing will not be recommended.' },
  avoid_heavy_spinal_loading: { label: 'Block heavy spinal loading', effect: 'Templates containing heavy spinal loading will not be recommended.' },
};

const injuryRegions: Array<{ value: BodyRegion; label: string }> = [
  { value: 'knee', label: 'Knee' }, { value: 'achilles', label: 'Achilles' }, { value: 'ankle', label: 'Ankle' },
  { value: 'calf', label: 'Calf' }, { value: 'hamstring', label: 'Hamstring' }, { value: 'quadriceps', label: 'Quadriceps' },
  { value: 'adductor_groin', label: 'Adductor / groin' }, { value: 'hip', label: 'Hip' }, { value: 'lower_back', label: 'Lower back' },
  { value: 'shoulder', label: 'Shoulder' }, { value: 'elbow', label: 'Elbow' }, { value: 'wrist', label: 'Wrist' },
];
const injuryModalities: SessionTemplate['modality'][] = ['Running', 'Cycling', 'Swimming', 'Walking', 'Strength', 'Field', 'Mobility', 'Cross Training'];
const emptyInjuryDraft = { region: '', severity: 'limit' as InjuryConstraint['severity'], restrictedModalities: [] as SessionTemplate['modality'][], reviewBy: '', note: '' };

export function TrainingSettings({ userId }: TrainingSettingsProps) {
  const [settings, setSettings] = useState<TrainingSettingsModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [injuryDraft, setInjuryDraft] = useState(emptyInjuryDraft);
  const [editingInjuryIndex, setEditingInjuryIndex] = useState<number | null>(null);

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
      return updated;
    } catch (cause) {
      console.error('Unable to save training settings', cause);
      setError('Unable to save that setting. Please try again.');
      return null;
    }
  };

  const saveInjury = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings) return;
    const injury: InjuryConstraint = {
      severity: injuryDraft.severity,
      ...(injuryDraft.region ? { region: injuryDraft.region as BodyRegion } : {}),
      ...(injuryDraft.restrictedModalities.length > 0 ? { restrictedModalities: injuryDraft.restrictedModalities } : {}),
      ...(injuryDraft.reviewBy ? { reviewBy: injuryDraft.reviewBy } : {}),
      ...(injuryDraft.note.trim() ? { note: injuryDraft.note.trim() } : {}),
    };
    const nextInjuries = [...(settings.injuries ?? [])];
    if (editingInjuryIndex === null) nextInjuries.push(injury);
    else nextInjuries[editingInjuryIndex] = injury;
    if (await save({ injuries: nextInjuries })) {
      setInjuryDraft(emptyInjuryDraft);
      setEditingInjuryIndex(null);
    }
  };

  const editInjury = (injury: InjuryConstraint, index: number) => {
    setEditingInjuryIndex(index);
    setInjuryDraft({
      region: injury.region ?? '',
      severity: injury.severity,
      restrictedModalities: injury.restrictedModalities ?? [],
      reviewBy: injury.reviewBy ?? '',
      note: injury.note ?? '',
    });
  };

  const today = getLocalDateString();
  // ⚡ Bolt: Memoize derived injury restrictions to prevent recalculation on every draft keystroke
  const derivedRestrictions = useMemo(
    () => resolveInjuryRestrictions(settings?.injuries, today),
    [settings?.injuries, today],
  );
  const hasDerived = derivedRestrictions.restrictedModalities.length > 0
    || derivedRestrictions.impliedGuardrails.length > 0
    || derivedRestrictions.restrictedCategories.length > 0;

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
        <h2 id="equipment-title">Available equipment & sport access</h2>
        <p className="section-intro">Turn on only equipment and venues you can reliably use for a typical session. Pool access may be indoor or outdoor.</p>
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

      <section aria-labelledby="injuries-title">
        <h2 id="injuries-title">Active Injury Constraints</h2>
        <p className="section-intro">Structured injuries dynamically derive guardrails, restricted modalities, and restricted categories. Expired review dates are automatically ignored.</p>

        <form onSubmit={saveInjury} className="injury-form">
          <h3>{editingInjuryIndex === null ? 'Add injury constraint' : 'Edit injury constraint'}</h3>
          <label>Body region
            <select value={injuryDraft.region} onChange={(event) => setInjuryDraft(current => ({ ...current, region: event.target.value }))}>
              <option value="">No specific region</option>
              {injuryRegions.map(region => <option key={region.value} value={region.value}>{region.label}</option>)}
            </select>
          </label>
          <label>Severity
            <select value={injuryDraft.severity} onChange={(event) => setInjuryDraft(current => ({ ...current, severity: event.target.value as InjuryConstraint['severity'] }))}>
              <option value="monitor">Monitor</option>
              <option value="limit">Limit</option>
              <option value="exclude">Exclude</option>
            </select>
          </label>
          <fieldset>
            <legend>Explicitly restricted modalities (optional)</legend>
            {injuryModalities.map(modality => <label key={modality}>
              <input type="checkbox" checked={injuryDraft.restrictedModalities.includes(modality)} onChange={(event) => setInjuryDraft(current => ({
                ...current,
                restrictedModalities: event.target.checked
                  ? [...current.restrictedModalities, modality]
                  : current.restrictedModalities.filter(item => item !== modality),
              }))} /> {modality}
            </label>)}
          </fieldset>
          <label>Review by (optional)<input type="date" value={injuryDraft.reviewBy} onChange={(event) => setInjuryDraft(current => ({ ...current, reviewBy: event.target.value }))} /></label>
          <label>Note (optional)<textarea value={injuryDraft.note} onChange={(event) => setInjuryDraft(current => ({ ...current, note: event.target.value }))} /></label>
          <button type="submit">{editingInjuryIndex === null ? 'Add injury constraint' : 'Save injury constraint'}</button>
          {editingInjuryIndex !== null && <button type="button" onClick={() => { setInjuryDraft(emptyInjuryDraft); setEditingInjuryIndex(null); }}>Cancel editing</button>}
        </form>

        {settings.injuries && settings.injuries.length > 0 ? (
          <div className="injuries-list">
            {settings.injuries.map((inj, index) => (
              <div key={index} className="setting-row injury-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}>
                <div>
                  <strong>{inj.region ? inj.region.toUpperCase().replace('_', ' ') : 'General Activity'}</strong> ({inj.severity})
                  {inj.reviewBy && <small style={{ display: 'block' }}>Review by: {inj.reviewBy}</small>}
                  {inj.note && <small style={{ display: 'block' }}>Note: {inj.note}</small>}
                </div>
                <div>
                  <button type="button" onClick={() => editInjury(inj, index)}>Edit</button>
                  <button type="button" onClick={() => {
                    const nextInjuries = (settings.injuries ?? []).filter((_, i) => i !== index);
                    if (editingInjuryIndex === index) { setInjuryDraft(emptyInjuryDraft); setEditingInjuryIndex(null); }
                    void save({ injuries: nextInjuries });
                  }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p><small>No active injuries recorded.</small></p>
        )}

        {hasDerived && (
          <div className="derived-restrictions" style={{ marginTop: '12px', padding: '8px 12px', background: '#f5f5f5', borderRadius: '4px' }}>
            <h4>Derived Restrictions (Read-only)</h4>
            {derivedRestrictions.restrictedModalities.length > 0 && <p><small><strong>Restricted Modalities:</strong> {derivedRestrictions.restrictedModalities.join(', ')}</small></p>}
            {derivedRestrictions.impliedGuardrails.length > 0 && <p><small><strong>Implied Guardrails:</strong> {derivedRestrictions.impliedGuardrails.join(', ')}</small></p>}
            {derivedRestrictions.restrictedCategories.length > 0 && <p><small><strong>Restricted Categories:</strong> {derivedRestrictions.restrictedCategories.join(', ')}</small></p>}
          </div>
        )}
      </section>
    </main>
  );
}
