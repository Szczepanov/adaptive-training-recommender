import { useEffect, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import type { NutritionTrackingAdherence } from '../../engine/models';
import { NUTRITION_ADHERENCE_OPTIONS } from '../../utils/nutritionAdherence';
import './NutritionAdherenceSection.css';

export interface NutritionAdherenceSectionProps {
  value: NutritionTrackingAdherence | null | undefined;
  onChange: (next: NutritionTrackingAdherence | null) => void;
  yesterdayIntakeKcal?: number | null;
  hasIntakeData?: boolean;
}

export function NutritionAdherenceSection({
  value,
  yesterdayIntakeKcal,
  hasIntakeData,
  onChange,
}: NutritionAdherenceSectionProps) {
  const isSet = value !== null && value !== undefined;
  const selectedOption = NUTRITION_ADHERENCE_OPTIONS.find((option) => option.value === value);
  const [disclosureOpen, setDisclosureOpen] = useState(isSet);

  useEffect(() => {
    if (isSet) setDisclosureOpen(true);
  }, [isSet]);

  const handleDisclosureToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setDisclosureOpen(event.currentTarget.open);
  };

  const handleSelect = (optionValue: NutritionTrackingAdherence) => {
    // ARIA radio semantics: selecting the active option keeps it selected.
    // Clearing is an explicit action via the Clear button.
    onChange(optionValue);
  };

  const handleClear = () => {
    onChange(null);
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'ArrowDown' && key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const count = NUTRITION_ADHERENCE_OPTIONS.length;
    const currentIndex = Math.max(
      0,
      NUTRITION_ADHERENCE_OPTIONS.findIndex((opt) => opt.value === value),
    );
    const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + delta + count) % count;
    const nextOption = NUTRITION_ADHERENCE_OPTIONS[nextIndex];
    onChange(nextOption.value);
    const grid = event.currentTarget;
    const nextButton = grid.querySelectorAll<HTMLButtonElement>('.nutrition-adherence-card')[nextIndex];
    nextButton?.focus();
  };

  const renderContextSummary = () => {
    if (yesterdayIntakeKcal === undefined && hasIntakeData === undefined) {
      return null;
    }

    let statusText: string;
    if (hasIntakeData && yesterdayIntakeKcal != null) {
      statusText = `${Math.round(yesterdayIntakeKcal).toLocaleString('en-US')} kcal`;
    } else if (hasIntakeData) {
      statusText = 'Intake reported; calories unavailable';
    } else {
      statusText = 'No intake data synced';
    }

    return (
      <div className="nutrition-adherence-context" aria-label="Yesterday synced nutrition telemetry">
        <span className="nutrition-adherence-context-label">Yesterday&apos;s synced intake (D-1):</span>
        <span className="nutrition-adherence-context-value">{statusText}</span>
      </div>
    );
  };

  return (
    <details
      className="checkin-section nutrition-adherence-section"
      aria-label="Yesterday calorie tracking scoring"
      open={disclosureOpen}
      onToggle={handleDisclosureToggle}
    >
      <summary className="checkin-disclosure-summary">
        <h2>
          Yesterday&apos;s Calorie Tracking (D-1){' '}
          <span className="optional-badge">(Optional)</span>
        </h2>
        <span className="checkin-disclosure-status">{selectedOption?.label ?? 'Not reported'}</span>
      </summary>

      <div className="checkin-disclosure-content">
        <div className="checkin-disclosure-heading-row">
          <p>Describe yesterday&apos;s logging completeness and whether it was a full-day fast.</p>
          {isSet && (
            <button
              type="button"
              className="btn-clear-adherence"
              onClick={handleClear}
              aria-label="Clear calorie tracking score"
            >
              Clear
            </button>
          )}
        </div>

        {renderContextSummary()}

        <div
          className="nutrition-adherence-grid"
          role="radiogroup"
          aria-label="Calorie tracking adherence options"
          onKeyDown={handleGridKeyDown}
        >
        {NUTRITION_ADHERENCE_OPTIONS.map((opt, index) => {
          const selected = value === opt.value;
          const isRovingTarget = isSet ? selected : index === 0;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={isRovingTarget ? 0 : -1}
              className={`nutrition-adherence-card ${selected ? `is-selected adherence-${opt.value}` : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              <div className="nutrition-adherence-card-header">
                <span className="nutrition-adherence-title">{opt.label}</span>
                <span className="nutrition-adherence-badge">{opt.badge}</span>
              </div>
              <span className="nutrition-adherence-desc">{opt.description}</span>
            </button>
          );
        })}
        </div>

        <p className="nutrition-adherence-helper">
          Self-reported logging-quality context only. “Full-Day Fast” means no caloric intake for the whole day. Zero recommendation authority; does not alter your training plan (ADR-0042).
        </p>
      </div>
    </details>
  );
}
