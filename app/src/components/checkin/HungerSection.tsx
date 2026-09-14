import React, { useEffect, useState } from 'react';
import type { DailySubjectiveCheckin } from '../../engine/models';

export interface HungerSectionProps {
  hunger1To10: number | null | undefined;
  hungerTiming: DailySubjectiveCheckin['hungerTiming'];
  onChange: (hunger1To10: number | null, hungerTiming: DailySubjectiveCheckin['hungerTiming']) => void;
}

type HungerTiming = Exclude<DailySubjectiveCheckin['hungerTiming'], null | undefined>;

export const HungerSection: React.FC<HungerSectionProps> = ({
  hunger1To10,
  hungerTiming,
  onChange,
}) => {
  const isSet = typeof hunger1To10 === 'number';
  const [pendingTiming, setPendingTiming] = useState<HungerTiming | null>(hungerTiming ?? null);

  useEffect(() => {
    setPendingTiming(hungerTiming ?? null);
  }, [hungerTiming]);

  const handleSelectScore = (val: number) => {
    if (!pendingTiming) return;
    onChange(val, pendingTiming);
  };

  const handleTimingChange = (timing: HungerTiming) => {
    setPendingTiming(timing);
    if (isSet) {
      onChange(hunger1To10, timing);
    }
  };

  const handleClear = () => {
    setPendingTiming(null);
    onChange(null, null);
  };

  return (
    <section className="checkin-section hunger-section" aria-label="Hunger and fueling assessment">
      <div className="section-title-wrap">
        <div className="section-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Hunger Right Now <span className="optional-badge" style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary, #888)', marginLeft: '0.5rem' }}>(Optional)</span></h2>
            <p>Subjective hunger context for fueling observations. Does not affect your training plan.</p>
          </div>
          {isSet && (
            <button
              type="button"
              className="btn-clear-hunger"
              onClick={handleClear}
              style={{
                background: 'none',
                border: '1px solid var(--border-color, #444)',
                borderRadius: '4px',
                color: 'var(--text-secondary, #aaa)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                padding: '0.25rem 0.6rem',
              }}
              aria-label="Clear hunger score"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="hunger-scale-container" style={{ marginTop: '0.75rem' }}>
        <div className="hunger-timing-group" style={{ marginBottom: '0.75rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--surface-bg, rgba(255, 255, 255, 0.03))' }}>
          <span style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>
            Measurement Timing
          </span>
          <div style={{ display: 'flex', gap: '1.5rem' }} role="radiogroup" aria-label="Hunger measurement timing">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="hungerTiming"
                value="morning_pre_breakfast"
                checked={pendingTiming === 'morning_pre_breakfast'}
                onChange={() => handleTimingChange('morning_pre_breakfast')}
              />
              Morning (pre-breakfast)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="radio"
                name="hungerTiming"
                value="other"
                checked={pendingTiming === 'other'}
                onChange={() => handleTimingChange('other')}
              />
              Other timing
            </label>
          </div>
          {!pendingTiming && (
            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary, #aaa)' }}>
              Choose timing context before rating so the longitudinal series is not mislabeled.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary, #aaa)' }}>
          <span>1 = Not hungry at all</span>
          <span>5 = Moderate / typical</span>
          <span>10 = Extremely hungry</span>
        </div>

        <div
          role="radiogroup"
          aria-label="Hunger rating 1 to 10"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(10, 1fr)',
            gap: '0.4rem',
            marginBottom: '1rem',
          }}
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => {
            const isSelected = hunger1To10 === val;
            return (
              <button
                key={val}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Hunger ${val} of 10`}
                disabled={!pendingTiming}
                onClick={() => handleSelectScore(val)}
                className={`hunger-rating-btn ${isSelected ? 'is-selected' : ''}`}
                style={{
                  padding: '0.6rem 0',
                  textAlign: 'center',
                  borderRadius: '6px',
                  border: isSelected ? '2px solid var(--primary-accent, #3b82f6)' : '1px solid var(--border-color, #333)',
                  backgroundColor: isSelected ? 'var(--primary-accent-bg, rgba(59, 130, 246, 0.2))' : 'var(--card-bg, #1e1e1e)',
                  color: isSelected ? 'var(--primary-accent-text, #60a5fa)' : 'var(--text-primary, #e5e5e5)',
                  fontWeight: isSelected ? 'bold' : 'normal',
                  cursor: pendingTiming ? 'pointer' : 'not-allowed',
                  opacity: pendingTiming ? 1 : 0.55,
                  fontSize: '1rem',
                  transition: 'all 0.15s ease',
                }}
              >
                {val}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
