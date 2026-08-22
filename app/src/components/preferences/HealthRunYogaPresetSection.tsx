import { useState } from 'react';
import { preferencesService } from '../../services/preferencesService';
import { trainingIntentProfileService } from '../../services/trainingIntentProfileService';
import { getErrorMessage } from '../../utils/errors';

interface HealthRunYogaPresetSectionProps {
  userId: string;
  onApplied: () => Promise<void>;
}

export function HealthRunYogaPresetSection({ userId, onApplied }: HealthRunYogaPresetSectionProps) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const applyPreset = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await Promise.all([
        preferencesService.upsertPreferences(userId, {
          preferredRecoveryStyle: 'mixed',
          defaultWeekdayTimeMin: 40,
          defaultWeekendTimeMin: 50,
          preferredModalities: ['Running', 'Mobility'],
          deprioritizedModalities: [],
          avoidedModalities: [],
          unavailableModalities: ['Cycling', 'Strength', 'Field', 'Cross Training'],
          conservativeBias: true,
          extraRecoveryMargin: true,
        }),
        trainingIntentProfileService.upsert(userId, {
          planningMode: 'evergreen',
          priorities: ['health'],
          weeklyCommitment: { minSessions: 3, targetSessions: 4, maxSessions: 5 },
          organizationPreference: 'auto',
          schemaVersion: 1,
        }),
      ]);
      await onApplied();
      setMessage('Health + Running + Yoga preset applied. Review and save any further edits below.');
    } catch (error: unknown) {
      setMessage(getErrorMessage(error) || 'Failed to apply preset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="preference-section">
      <h2>Quick setup</h2>
      <p className="preference-desc">
        Health + Running + Yoga uses evergreen planning, prefers Running and Mobility (the
        catalog bucket for yoga/mobility), excludes Cycling, Strength, Field and Cross Training,
        and adds a conservative recovery margin.
      </p>
      <button type="button" className="login-btn" onClick={applyPreset} disabled={saving}>
        {saving ? 'Applying...' : 'Apply Health + Running + Yoga'}
      </button>
      {message && <p className="preference-desc" role="status">{message}</p>}
    </section>
  );
}
