
import type { PlanningMode, TrainingPriority } from '../../engine/models';
import type { TrainingIntentProfileDraft } from './usePreferences';

const TRAINING_PRIORITY_OPTIONS: Array<{ value: TrainingPriority; label: string }> = [
  { value: 'health', label: 'Health and energy' },
  { value: 'balanced_performance', label: 'Balanced fitness' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'strength_muscle', label: 'Strength and muscle' },
  { value: 'speed_power', label: 'Speed and power' },
  { value: 'sport_readiness', label: 'Sport readiness' },
];

interface TrainingPlanSectionProps {
  trainingIntentProfile: TrainingIntentProfileDraft;
  updateTrainingIntentProfile: (update: Partial<TrainingIntentProfileDraft>) => void;
  toggleTrainingPriority: (priority: TrainingPriority) => void;
  moveTrainingPriority: (priority: TrainingPriority, direction: -1 | 1) => void;
  updateWeeklyCommitment: (key: keyof TrainingIntentProfileDraft['weeklyCommitment'], value: number) => void;
}

export function TrainingPlanSection({
  trainingIntentProfile,
  updateTrainingIntentProfile,
  toggleTrainingPriority,
  moveTrainingPriority,
  updateWeeklyCommitment
}: TrainingPlanSectionProps) {
  return (
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
  );
}
