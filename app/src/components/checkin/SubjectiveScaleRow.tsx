import React from 'react';

export interface SubjectiveScaleRowProps {
  id: string;
  label: string;
  desc?: string;
  value: number | null;
  lowLabel: string;
  highLabel: string;
  isInverted?: boolean;
  onChange: (value: number) => void;
}

export const SubjectiveScaleRow: React.FC<SubjectiveScaleRowProps> = ({
  id,
  label,
  desc,
  value,
  lowLabel,
  highLabel,
  isInverted = false,
  onChange,
}) => {
  const sliderValue = value ?? 5;
  // An unanswered scale is deliberately distinct from a real midpoint score. The engine can
  // still use its neutral fallback for a partial safety-only check-in, while subjective
  // baseline history only matures from explicitly scored days.
  const severityClass = value === null
    ? 'status-unanswered'
    : isInverted
      ? value >= 8 ? 'status-severe' : value >= 6 ? 'status-warning' : 'status-normal'
      : value <= 3 ? 'status-severe' : value === 4 ? 'status-warning' : 'status-normal';

  return (
    <div className={`subjective-scale-row ${severityClass}`} data-scale={id} data-answered={value !== null}>
      <div className="scale-row-header">
        <label htmlFor={`slider-${id}`} className="scale-row-label">
          {label}
        </label>
        <div className={`scale-row-value-badge ${severityClass}`} aria-live="polite">
          {value === null ? (
            <>
              <span className="scale-value-number">—</span>
              <span className="scale-value-max">not set</span>
            </>
          ) : (
            <>
              <span className="scale-value-number">{value}</span>
              <span className="scale-value-max">/10</span>
            </>
          )}
        </div>
      </div>

      <div className="scale-slider-track-wrap">
        <input
          id={`slider-${id}`}
          type="range"
          min="1"
          max="10"
          step="1"
          value={sliderValue}
          onPointerUp={(event) => {
            // Keep the neutral thumb position purely visual until the athlete completes an
            // interaction. Pointer-down can precede a drag, so recording 5 there briefly
            // fabricates a midpoint observation before the intended value is chosen. Only a
            // primary-button release should count as the athlete's answer; an auxiliary or
            // secondary-button release must not fabricate a value either.
            if (value === null && event.isPrimary && event.button === 0) {
              onChange(Number(event.currentTarget.value));
            }
          }}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`subjective-slider ${severityClass}`}
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={value ?? undefined}
          aria-valuetext={value === null ? 'Not answered' : `${value} out of 10`}
          aria-label={label}
          aria-description={desc}
        />
        <div className="scale-endpoint-labels">
          <span className="endpoint-label low">{lowLabel}</span>
          <span className="endpoint-label high">{highLabel}</span>
        </div>
      </div>
    </div>
  );
};
