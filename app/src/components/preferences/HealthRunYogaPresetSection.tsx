import { useState } from 'react';
import { preferencesService } from '../../services/preferencesService';
import { trainingIntentProfileService } from '../../services/trainingIntentProfileService';
import { getErrorMessage } from '../../utils/errors';

interface HealthRunYogaPresetSectionProps {
  userId: string;
  onApplied: () => Promise<void>;
}

type PresetMessage = {
  text: string;
  failed: boolean;
};

export function HealthRunYogaPresetSection({ userId, onApplied }: HealthRunYogaPresetSectionProps) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<PresetMessage | null>(null);

  const applyPreset = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const results = await Promise.allSettled([
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

      const fulfilledCount = results.filter((result) => result.status === 'fulfilled').length;
      const rejected = results.find((result) => result.status === 'rejected');

      if (fulfilledCount > 0) {
        await onApplied();
      }

      if (rejected) {
        const detail = getErrorMessage(rejected.reason) || 'One preset save failed.';
        setMessage({
          text:
            fulfilledCount > 0
              ? `The preset was only partly applied: ${detail} Reapply it to complete setup.`
              : detail,
          failed: true,
        });
        return;
      }

      setMessage({
        text: 'Health + Running + Yoga preset applied. Review and save any further edits below.',
        failed: false,
      });
    } catch (error: unknown) {
      setMessage({
        text: getErrorMessage(error) || 'Failed to apply preset.',
        failed: true,
      });
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
      {message && (
        <p
          className={message.failed ? 'error-message' : 'preference-desc'}
          role={message.failed ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
