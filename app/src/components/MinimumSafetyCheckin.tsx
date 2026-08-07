import { useState } from 'react';
import type { DailySubjectiveCheckin } from '../engine/models';
import { checkinService } from '../services/checkinService';
import { getErrorMessage } from '../utils/errors';
import './MinimumSafetyCheckin.css';

interface MinimumSafetyCheckinProps {
  userId: string;
  existingCheckin: DailySubjectiveCheckin | null;
  onCompleted: () => void;
}

type Answer = boolean | null;

function initialBoolean(value: boolean | undefined): Answer {
  return typeof value === 'boolean' ? value : null;
}

/** Low-friction gate for today's safety-critical check-in subset. */
export function MinimumSafetyCheckin({ userId, existingCheckin, onCompleted }: MinimumSafetyCheckinProps) {
  const [painOrInjury, setPainOrInjury] = useState<Answer>(() => initialBoolean(existingCheckin?.painOrInjury));
  const [illnessSymptoms, setIllnessSymptoms] = useState<Answer>(() => initialBoolean(existingCheckin?.illnessSymptoms));
  const [alreadyTrainedToday, setAlreadyTrainedToday] = useState<Answer>(() => initialBoolean(existingCheckin?.alreadyTrainedToday));
  const [fatigue, setFatigue] = useState<number | null>(() => existingCheckin?.fatigue ?? existingCheckin?.soreness ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReadyToSave = painOrInjury !== null
    && illnessSymptoms !== null
    && alreadyTrainedToday !== null
    && fatigue !== null;

  const save = async () => {
    if (!isReadyToSave) {
      setError('Answer each safety question before continuing.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await checkinService.upsertTodayCheckin(userId, {
        ...existingCheckin,
        painOrInjury,
        illnessSymptoms,
        alreadyTrainedToday,
        fatigue,
      });
      onCompleted();
    } catch (cause: unknown) {
      setError(getErrorMessage(cause) || 'Unable to save the safety check-in.');
    } finally {
      setSaving(false);
    }
  };

  const answers: Array<{
    id: 'painOrInjury' | 'illnessSymptoms' | 'alreadyTrainedToday';
    label: string;
    value: Answer;
    setValue: (value: Answer) => void;
  }> = [
    { id: 'painOrInjury', label: 'Any pain or injury today?', value: painOrInjury, setValue: setPainOrInjury },
    { id: 'illnessSymptoms', label: 'Feeling ill or unwell?', value: illnessSymptoms, setValue: setIllnessSymptoms },
    { id: 'alreadyTrainedToday', label: 'Already trained today?', value: alreadyTrainedToday, setValue: setAlreadyTrainedToday },
  ];

  return (
    <section className="minimum-safety-checkin" aria-labelledby="minimum-safety-title">
      <h5 id="minimum-safety-title">Quick safety check</h5>
      <p>Confirm these before receiving a training plan.</p>
      {answers.map(({ id, label, value, setValue }) => (
        <fieldset className="minimum-safety-question" key={id}>
          <legend>{label}</legend>
          <label><input type="radio" name={id} checked={value === false} onChange={() => setValue(false)} /> No</label>
          <label><input type="radio" name={id} checked={value === true} onChange={() => setValue(true)} /> Yes</label>
        </fieldset>
      ))}
      <label className="minimum-safety-fatigue" htmlFor="minimum-safety-fatigue">
        Current fatigue or soreness: <strong>{fatigue ?? '—'}/10</strong>
        <input id="minimum-safety-fatigue" type="range" min="1" max="10" value={fatigue ?? 5} onChange={(event) => setFatigue(Number(event.target.value))} />
      </label>
      {error && <p className="minimum-safety-error" role="alert">{error}</p>}
      <button type="button" className="minimum-safety-save" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Confirm safety check'}
      </button>
    </section>
  );
}
