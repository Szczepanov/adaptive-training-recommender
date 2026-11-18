import React, { useEffect, useState } from 'react';
import type { SessionStep, DistanceEntryPayload } from '../../../sessions/models';
import { stepAcceptsMassLoad } from '../../../sessions/stepLoadCapability';
import { RpeField } from './RpeField';
import { buildRpeGauge } from './rpeGauge';

interface DistanceInputCardProps {
    step: SessionStep;
    /** Last logged load for this step, else the prescribed fixed mass. */
    suggestedLoadKg?: number;
    /** Side due next for a per-side carry (fewer logged entries, left first). */
    nextSide?: 'left' | 'right';
    /** Changes whenever a distance entry for this step is added/removed, even if nextSide is unchanged. */
    performedEntryCount?: number;
    onSubmit: (payload: DistanceEntryPayload, side?: 'left' | 'right') => void | Promise<void>;
}

export const DistanceInputCard: React.FC<DistanceInputCardProps> = ({
    step,
    suggestedLoadKg,
    nextSide,
    performedEntryCount = 0,
    onSubmit,
}) => {
    const perSide = step.laterality === 'per_side';
    const dose = step.dose;
    const defaultMeters = dose?.kind === 'distance'
        ? (typeof dose.meters === 'number' ? dose.meters : (typeof dose.meters === 'object' ? dose.meters.min : (typeof dose.metres === 'number' ? dose.metres : (typeof dose.metres === 'object' ? dose.metres.min : 100))))
        : 100;

    const [meters, setMeters] = useState<string>(String(defaultMeters));
    const [seconds, setSeconds] = useState<string>('');
    const showLoad = stepAcceptsMassLoad(step);
    const [loadKg, setLoadKg] = useState<string>(suggestedLoadKg !== undefined ? String(suggestedLoadKg) : '');
    const [rpe, setRpe] = useState<string>('');
    const [selectedSide, setSelectedSide] = useState<'left' | 'right'>(nextSide ?? 'left');

    useEffect(() => {
        if (nextSide) setSelectedSide(nextSide);
    }, [nextSide, performedEntryCount, step.id]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const parsedMeters = parseFloat(meters);
        if (isNaN(parsedMeters) || parsedMeters <= 0) return;

        const parsedSec = seconds.trim().length > 0 ? parseFloat(seconds) : undefined;
        const parsedLoad = showLoad && loadKg.trim().length > 0 ? parseFloat(loadKg) : undefined;
        if (parsedLoad !== undefined && (isNaN(parsedLoad) || parsedLoad < 0)) return;
        const gauge = buildRpeGauge(rpe);
        void onSubmit({
            kind: 'distance',
            meters: parsedMeters,
            ...(parsedSec !== undefined ? { durationSeconds: parsedSec } : {}),
            ...(parsedLoad !== undefined ? { loadKg: parsedLoad } : {}),
            ...(gauge ? { gauge } : {}),
        }, perSide ? selectedSide : undefined);
        setRpe('');
    };

    return (
        <form className="distance-input-card" onSubmit={handleSubmit}>
            {perSide && (
                <>
                    <div className="hold-side-selector" role="group" aria-label="Carry side">
                        {(['left', 'right'] as const).map(side => (
                            <button
                                key={side}
                                type="button"
                                className={`hold-side-btn${selectedSide === side ? ' active' : ''}`}
                                aria-pressed={selectedSide === side}
                                onClick={() => setSelectedSide(side)}
                            >
                                {side === 'left' ? 'Left' : 'Right'} side
                            </button>
                        ))}
                    </div>
                    <div className="unilateral-cue-banner">
                        <span>Complete both sides for one set.</span>
                    </div>
                </>
            )}
            <div className="input-row">
                <label className="input-group">
                    <span className="input-label">Distance (meters{perSide ? ' / side' : ''})</span>
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
                {showLoad && (
                    <label className="input-group">
                        <span className="input-label">Load (kg)</span>
                        <input
                            type="number"
                            step="0.5"
                            min="0"
                            placeholder="0"
                            value={loadKg}
                            onChange={e => setLoadKg(e.target.value)}
                            className="session-input-box"
                            aria-label="Load in kilograms"
                        />
                    </label>
                )}
                <RpeField step={step} value={rpe} onChange={setRpe} />
            </div>

            <button type="submit" className="log-set-btn" aria-label={perSide ? `Log ${selectedSide} side distance` : 'Log distance split'}>
                Log
            </button>
        </form>
    );
};
