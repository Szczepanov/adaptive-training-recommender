import React, { useState } from 'react';
import type { SessionStep, DistanceEntryPayload } from '../../../sessions/models';

interface DistanceInputCardProps {
    step: SessionStep;
    onSubmit: (payload: DistanceEntryPayload) => void;
}

export const DistanceInputCard: React.FC<DistanceInputCardProps> = ({
    step,
    onSubmit,
}) => {
    const dose = step.dose;
    const defaultMeters = dose?.kind === 'distance'
        ? (typeof dose.meters === 'number' ? dose.meters : (typeof dose.meters === 'object' ? dose.meters.min : (typeof dose.metres === 'number' ? dose.metres : (typeof dose.metres === 'object' ? dose.metres.min : 100))))
        : 100;

    const [meters, setMeters] = useState<string>(String(defaultMeters));
    const [seconds, setSeconds] = useState<string>('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const parsedMeters = parseFloat(meters);
        if (isNaN(parsedMeters) || parsedMeters <= 0) return;

        const parsedSec = seconds.trim().length > 0 ? parseFloat(seconds) : undefined;
        onSubmit({
            kind: 'distance',
            meters: parsedMeters,
            ...(parsedSec !== undefined ? { durationSeconds: parsedSec } : {}),
        });
    };

    return (
        <form className="distance-input-card" onSubmit={handleSubmit}>
            <div className="input-row">
                <label className="input-group">
                    <span className="input-label">Distance (meters)</span>
                    <input
                        type="number"
                        step="1"
                        min="1"
                        value={meters}
                        onChange={e => setMeters(e.target.value)}
                        className="session-input-box"
                        required
                        aria-label="Distance in meters"
                    />
                </label>
                <label className="input-group">
                    <span className="input-label">Time / Split (seconds)</span>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Optional"
                        value={seconds}
                        onChange={e => setSeconds(e.target.value)}
                        className="session-input-box"
                        aria-label="Split duration in seconds"
                    />
                </label>
            </div>

            <button type="submit" className="log-set-btn">
                Log Repetition ⏎
            </button>
        </form>
    );
};
