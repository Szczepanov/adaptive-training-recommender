import React from 'react';
import type { SessionStep } from '../../../sessions/models';
import { rpePlaceholderFor } from './rpeGauge';

/** RPE input for hold and distance sets; parse with `buildRpeGauge` from `./rpeGauge`. */
interface RpeFieldProps {
    step: SessionStep;
    value: string;
    onChange: (value: string) => void;
}

export const RpeField: React.FC<RpeFieldProps> = ({ step, value, onChange }) => (
    <label className="input-group">
        <span className="input-label">RPE (1-10)</span>
        <input
            type="number"
            step="0.5"
            min="1"
            max="10"
            placeholder={rpePlaceholderFor(step)}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="session-input-box"
            aria-label="Set RPE from 1 to 10"
        />
    </label>
);
