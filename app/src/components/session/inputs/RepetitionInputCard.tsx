import React, { useState, useRef, useEffect } from 'react';
import type { SessionStep, RepetitionEntryPayload } from '../../../sessions/models';

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
    const [rpe, setRpe] = useState<string>('');

    const prescribedRpe = step.effort?.kind === 'rpe'
        ? step.effort.target
        : step.effort?.rpe;
    const rpePlaceholder = typeof prescribedRpe === 'number'
        ? `Target: ${prescribedRpe}`
        : typeof prescribedRpe === 'object'
            ? `Target: ${prescribedRpe.min}-${prescribedRpe.max}`
            : 'e.g. 7';

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
        const parsedRpe = rpe.trim().length > 0 ? parseFloat(rpe) : undefined;
        if (parsedRpe !== undefined && (!Number.isFinite(parsedRpe) || parsedRpe < 1 || parsedRpe > 10)) return;
        onSubmit({
            kind: 'repetition',
            setIndex: 1, // dynamically indexed by caller
            reps: parsedReps,
            ...(parsedWeight !== undefined ? { weightKg: parsedWeight } : {}),
            isWarmup,
            ...(parsedRpe !== undefined ? { gauge: { scale: 'rpe_rts', value: parsedRpe } } : {}),
        });

        // RPE is an observed value for this set, not a default for the next one.
        setRpe('');

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
                <label className="input-group rpe-input-group">
                    <span className="input-label">Set RPE (optional)</span>
                    <input
                        type="number"
                        step="0.5"
                        min="1"
                        max="10"
                        placeholder={rpePlaceholder}
                        value={rpe}
                        onChange={e => setRpe(e.target.value)}
                        className="session-input-box"
                        aria-label="Set RPE from 1 to 10"
                    />
                </label>
            </div>

            <button type="submit" className="log-set-btn">
                Log Set ⏎
            </button>
        </form>
    );
};
