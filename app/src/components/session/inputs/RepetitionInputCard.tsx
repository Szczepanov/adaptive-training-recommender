import React, { useState, useRef, useEffect } from 'react';
import type { SessionStep, RepetitionEntryPayload } from '../../../sessions/models';
import type { IntensityGauge } from '../../../engine/models';

interface RepetitionInputCardProps {
    step: SessionStep;
    suggestedWeightKg?: number;
    suggestedReps?: number;
    onSubmit: (payload: RepetitionEntryPayload) => void;
}

export const RepetitionInputCard: React.FC<RepetitionInputCardProps> = ({
    step,
    suggestedWeightKg,
    suggestedReps,
    onSubmit,
}) => {
    const dose = step.dose;
    const defaultReps = suggestedReps ?? (dose?.kind === 'repetition' && typeof dose.reps === 'number' ? dose.reps : (dose?.kind === 'repetition' && typeof dose.reps === 'object' ? dose.reps.min : 8));
    const [reps, setReps] = useState<string>(String(defaultReps));
    const [weight, setWeight] = useState<string>(suggestedWeightKg !== undefined ? String(suggestedWeightKg) : '');
    const [isWarmup, setIsWarmup] = useState<boolean>(false);
    const [gauge, setGauge] = useState<IntensityGauge | null>(null);

    const weightRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (weightRef.current) {
            weightRef.current.focus();
            weightRef.current.select();
        }
    }, [step.id]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const parsedReps = parseInt(reps, 10);
        if (isNaN(parsedReps) || parsedReps <= 0) return;

        const parsedWeight = weight.trim().length > 0 ? parseFloat(weight) : undefined;
        onSubmit({
            kind: 'repetition',
            setIndex: 1, // dynamically indexed by caller
            reps: parsedReps,
            ...(parsedWeight !== undefined ? { weightKg: parsedWeight } : {}),
            isWarmup,
            ...(gauge ? { gauge } : {}),
        });

        // Refocus weight input for next set
        if (weightRef.current) {
            weightRef.current.focus();
            weightRef.current.select();
        }
    };

    return (
        <form className="repetition-input-card" onSubmit={handleSubmit}>
            <div className="input-row">
                <label className="input-group">
                    <span className="input-label">Weight (kg)</span>
                    <input
                        ref={weightRef}
                        type="number"
                        step="0.5"
                        min="0"
                        placeholder="BW"
                        value={weight}
                        onChange={e => setWeight(e.target.value)}
                        className="session-input-box"
                        aria-label="Weight in kilograms"
                    />
                </label>
                <label className="input-group">
                    <span className="input-label">Reps</span>
                    <input
                        type="number"
                        step="1"
                        min="1"
                        value={reps}
                        onChange={e => setReps(e.target.value)}
                        className="session-input-box"
                        required
                        aria-label="Repetitions count"
                    />
                </label>
            </div>

            <div className="gauge-row">
                <label className="warmup-toggle">
                    <input
                        type="checkbox"
                        checked={isWarmup}
                        onChange={e => setIsWarmup(e.target.checked)}
                    />
                    <span>Warm-up</span>
                </label>
                <div className="gauge-quick-buttons">
                    <button
                        type="button"
                        className={`gauge-chip ${gauge?.scale === 'rpe_rts' && gauge.value === 8 ? 'active' : ''}`}
                        onClick={() => setGauge(gauge?.scale === 'rpe_rts' && gauge.value === 8 ? null : { scale: 'rpe_rts', value: 8 })}
                    >
                        RPE 8
                    </button>
                    <button
                        type="button"
                        className={`gauge-chip ${gauge?.scale === 'rir' && gauge.value === 2 ? 'active' : ''}`}
                        onClick={() => setGauge(gauge?.scale === 'rir' && gauge.value === 2 ? null : { scale: 'rir', value: 2 })}
                    >
                        2 RIR
                    </button>
                </div>
            </div>

            <button type="submit" className="log-set-btn">
                Log Set ⏎
            </button>
        </form>
    );
};
