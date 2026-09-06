import type {
  PhysicalWorkCheckin,
  PhysicalWorkDuration,
  PhysicalWorkIntensity,
  PhysicalWorkLoadArea,
} from '../../engine/models';

export interface PhysicalWorkSectionProps {
  value?: PhysicalWorkCheckin;
  onChange: (next: PhysicalWorkCheckin | undefined) => void;
}

const DURATION_OPTIONS: Array<{ value: PhysicalWorkDuration; label: string }> = [
  { value: 'short', label: '< 1 hr' },
  { value: 'medium', label: '1–3 hrs' },
  { value: 'extended', label: '3+ hrs' },
];

const INTENSITY_OPTIONS: Array<{ value: PhysicalWorkIntensity; label: string }> = [
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
  { value: 'exhausting', label: 'Exhausting' },
];

const LOAD_AREA_OPTIONS: Array<{ value: PhysicalWorkLoadArea; label: string }> = [
  { value: 'grip_forearms', label: 'Grip & Forearms' },
  { value: 'upper_body', label: 'Upper Body (Pull/Shoulders)' },
  { value: 'lower_back_spine', label: 'Lower Back & Spine' },
  { value: 'legs_carrying', label: 'Legs & Carrying' },
];

export function PhysicalWorkSection({ value, onChange }: PhysicalWorkSectionProps) {
  const isPerformed = Boolean(value?.performed);

  const handleToggle = (checked: boolean) => {
    if (!checked) {
      onChange(undefined);
      return;
    }
    onChange({
      performed: true,
      duration: value?.duration ?? 'medium',
      intensity: value?.intensity ?? 'moderate',
      loadAreas: value?.loadAreas ?? ['upper_body', 'lower_back_spine'],
      notes: value?.notes ?? null,
    });
  };

  const updateField = (patch: Partial<PhysicalWorkCheckin>) => {
    onChange({
      performed: true,
      duration: 'medium',
      intensity: 'moderate',
      loadAreas: ['upper_body', 'lower_back_spine'],
      ...value,
      ...patch,
    });
  };

  const handleToggleLoadArea = (area: PhysicalWorkLoadArea) => {
    const current = value?.loadAreas ?? [];
    const next = current.includes(area)
      ? current.filter(a => a !== area)
      : [...current, area];
    updateField({ loadAreas: next });
  };

  return (
    <div className="physical-work-card">
      <label className={`boolean-toggle-card ${isPerformed ? 'is-active' : ''}`}>
        <input
          type="checkbox"
          checked={isPerformed}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span className="toggle-checkmark"></span>
        <div className="toggle-info">
          <strong>🔨 Unlogged Physical Work / Manual Labor (Yesterday)</strong>
          <span>Chainsaw/tree work, heavy yardwork, construction, hauling timber</span>
        </div>
      </label>

      {isPerformed && (
        <div className="physical-work-details" aria-label="Physical work details">
          <p className="physical-work-helper-text">
            Wearables miss isometric grip, heavy lifting, and spinal loading when heart rate stays low. Logging this protects your muscles and central nervous system from being overloaded today.
          </p>

          <div className="physical-work-row">
            <span className="physical-work-label">Duration</span>
            <div className="physical-work-chips" role="group" aria-label="Work duration">
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`physical-work-chip ${value?.duration === opt.value ? 'is-selected' : ''}`}
                  aria-pressed={value?.duration === opt.value}
                  onClick={() => updateField({ duration: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="physical-work-row">
            <span className="physical-work-label">Effort</span>
            <div className="physical-work-chips" role="group" aria-label="Work effort">
              {INTENSITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`physical-work-chip ${value?.intensity === opt.value ? 'is-selected' : ''}`}
                  aria-pressed={value?.intensity === opt.value}
                  onClick={() => updateField({ intensity: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="physical-work-row">
            <span className="physical-work-label">Main strain areas</span>
            <div className="physical-work-chips" role="group" aria-label="Main strain areas">
              {LOAD_AREA_OPTIONS.map(opt => {
                const isSelected = (value?.loadAreas ?? []).includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`physical-work-chip ${isSelected ? 'is-selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => handleToggleLoadArea(opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="physical-work-notes">
            Work notes (optional)
            <input
              type="text"
              maxLength={200}
              value={value?.notes ?? ''}
              placeholder="e.g. Chainsaw work and hauling heavy timber"
              onChange={e => updateField({ notes: e.target.value || null })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
