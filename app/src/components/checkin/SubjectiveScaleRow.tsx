import React from 'react';

export interface SubjectiveScaleRowProps {
  id: string;
  label: string;
  desc?: string;
  value: number;
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
  // Severity-based accents: amber for warning, red for severe, neutral blue for normal/good
  const isSevere = isInverted ? value >= 8 : value <= 3;
  const isWarning = isInverted ? value >= 6 && value < 8 : value === 4;
  const severityClass = isSevere ? 'status-severe' : isWarning ? 'status-warning' : 'status-normal';

  return (
    <div className={`subjective-scale-row ${severityClass}`} data-scale={id}>
      <div className="scale-row-header">
        <label htmlFor={`slider-${id}`} className="scale-row-label">
          {label}
        </label>
        <div className={`scale-row-value-badge ${severityClass}`} aria-live="polite">
          <span className="scale-value-number">{value}</span>
          <span className="scale-value-max">/10</span>
        </div>
      </div>

      <div className="scale-slider-track-wrap">
        <input
          id={`slider-${id}`}
          type="range"
          min="1"
          max="10"
          step="1"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`subjective-slider ${severityClass}`}
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={value}
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
