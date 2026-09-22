import type { KeyboardEvent } from 'react';
import type { NutritionTrackingAdherence } from '../../engine/models';
import {
  NUTRITION_ADHERENCE_OPTIONS,
  toggleNutritionAdherence,
} from '../../utils/nutritionAdherence';
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

  const handleSelect = (optionValue: NutritionTrackingAdherence) => {
    onChange(toggleNutritionAdherence(value, optionValue));
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
    } else {
      statusText = 'No intake synced (unlogged)';
    }

    return (
      <div className="nutrition-adherence-context" aria-label="Yesterday synced nutrition telemetry">
        <span className="nutrition-adherence-context-label">Synced from Garmin yesterday (D-1):</span>
        <span className="nutrition-adherence-context-value">{statusText}</span>
      </div>
    );
  };

  return (
    <section className="checkin-section nutrition-adherence-section" aria-label="Yesterday calorie tracking scoring">
      <div className="section-title-wrap">
        <div className="nutrition-adherence-header-row">
          <div>
            <h2>
              Yesterday&apos;s Calorie Tracking (D-1){' '}
              <span
                className="optional-badge"
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 'normal',
                  color: 'var(--text-secondary, #888)',
                  marginLeft: '0.5rem',
                }}
              >
                (Optional)
              </span>
            </h2>
            <p>Score your logging completeness to verify dietary data quality and deliberate fasting.</p>
          </div>
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
        Helps identify unlogged meals and verify true fasting days. Zero recommendation authority; does not alter your training plan (ADR-0042).
      </p>
    </section>
  );
}
