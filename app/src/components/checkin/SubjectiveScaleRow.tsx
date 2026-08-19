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
  return (
    <div className={`subjective-scale-row ${isInverted ? 'is-inverted' : ''}`} data-scale={id}>
      <div className="scale-row-header">
        <div className="scale-row-info">
          <label htmlFor={`slider-${id}`} className="scale-row-label">
            {label}
          </label>
          {desc && <span className="scale-row-desc">{desc}</span>}
        </div>
        <div className="scale-row-value-badge" aria-live="polite">
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
          className="subjective-slider"
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={value}
          aria-label={label}
        />
        <div className="scale-endpoint-labels">
          <span className="endpoint-label low">{lowLabel}</span>
          <span className="endpoint-label high">{highLabel}</span>
        </div>
      </div>
    </div>
  );
};
