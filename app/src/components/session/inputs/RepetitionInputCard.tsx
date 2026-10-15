import React, { useState, useRef, useEffect } from 'react';
import type { SessionStep, RepetitionEntryPayload } from '../../../sessions/models';
import {
    buildRepetitionPayload,
    focusAndSelect,
    runSingleFlight,
    type GaugeScaleType,
} from './repetitionSubmit';

interface RepetitionInputCardProps {
    step: SessionStep;
    suggestedWeightKg?: number;
    suggestedReps?: number;
    defaultIsWarmup?: boolean;
    onSubmit: (payload: RepetitionEntryPayload) => void | Promise<void>;
}

export const RepetitionInputCard: React.FC<RepetitionInputCardProps> = ({
    step,
    suggestedWeightKg,
    suggestedReps,
    defaultIsWarmup = false,
    onSubmit,
}) => {
    const dose = step.dose;
    const defaultReps = suggestedReps ?? (dose?.kind === 'repetition' && typeof dose.reps === 'number' ? dose.reps : (dose?.kind === 'repetition' && typeof dose.reps === 'object' ? dose.reps.min : 8));
    const [reps, setReps] = useState<string>(String(defaultReps));
    const [weight, setWeight] = useState<string>(suggestedWeightKg !== undefined ? String(suggestedWeightKg) : '');
    const [isWarmup, setIsWarmup] = useState<boolean>(defaultIsWarmup);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    // Gauge state
    const [gaugeScale, setGaugeScale] = useState<GaugeScaleType>('rpe');
    const [gaugeVal, setGaugeVal] = useState<string>('');
    const [technicalMet, setTechnicalMet] = useState<boolean>(true);
    const [technicalNote, setTechnicalNote] = useState<string>('');

    const prescribedRpe = step.effort?.kind === 'rpe'
        ? step.effort.target
        : step.effort?.rpe;
    const rpePlaceholder = typeof prescribedRpe === 'number'
        ? `Target: ${prescribedRpe}`
        : typeof prescribedRpe === 'object'
            ? `Target: ${prescribedRpe.min}-${prescribedRpe.max}`
            : 'e.g. 7';

    const weightRef = useRef<HTMLInputElement>(null);
    // React state is not synchronous enough to guard two submit events in the same tick. The ref
    // serializes writes so two rapid Enter/click events cannot receive the same persisted setIndex.
    const submitInFlightRef = useRef(false);

    useEffect(() => {
        setReps(String(defaultReps));
        setWeight(suggestedWeightKg !== undefined ? String(suggestedWeightKg) : '');
        setIsWarmup(defaultIsWarmup);
    }, [step.id, defaultReps, suggestedWeightKg, defaultIsWarmup]);

    useEffect(() => {
        focusAndSelect(weightRef.current);
    }, [step.id]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const payload = buildRepetitionPayload({ reps, weight, isWarmup, gaugeScale, gaugeVal, technicalMet, technicalNote });
        if (!payload) return;

        await runSingleFlight(submitInFlightRef, async () => {
            setIsSubmitting(true);
            try {
                await onSubmit(payload);

                // Reset gauge value for next set only after the write lifecycle has completed.
                setGaugeVal('');
                setTechnicalNote('');

                // Refocus weight input for next set.
                focusAndSelect(weightRef.current);
            } finally {
                setIsSubmitting(false);
            }
        });
    };

    return (
        <form className="repetition-input-card" onSubmit={handleSubmit}>
            {step.laterality === 'per_side' && (
                <div className="unilateral-cue-banner">
                    <span>💡 <strong>Unilateral Movement</strong>: Perform prescribed reps on Left, then repeat on Right.</span>
                </div>
            )}
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
                    <span className="input-label">Reps{step.laterality === 'per_side' ? ' (per side)' : ''}</span>
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
                <div className="gauge-selector-group">
                    <select
                        value={gaugeScale}
                        onChange={e => setGaugeScale(e.target.value as GaugeScaleType)}
                        className="gauge-type-select"
                        aria-label="Intensity gauge scale"
                    >
                        <option value="rpe">RPE</option>
                        <option value="rir">RIR</option>
                        <option value="velocity_loss">Vel Loss %</option>
                        <option value="technical">Technical</option>
                        <option value="none">No Gauge</option>
                    </select>

                    {gaugeScale === 'rpe' && (
                        <input
                            type="number"
                            step="0.5"
                            min="1"
                            max="10"
                            placeholder={rpePlaceholder}
                            value={gaugeVal}
                            onChange={e => setGaugeVal(e.target.value)}
                            className="session-input-box gauge-val-input"
                            aria-label="Set RPE from 1 to 10"
                        />
                    )}

                    {gaugeScale === 'rir' && (
                        <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="10"
                            placeholder="Reps in reserve (e.g. 2)"
                            value={gaugeVal}
                            onChange={e => setGaugeVal(e.target.value)}
                            className="session-input-box gauge-val-input"
                            aria-label="Reps in reserve from 0 to 10"
                        />
                    )}

                    {gaugeScale === 'velocity_loss' && (
                        <input
                            type="number"
                            step="1"
                            min="0"
                            max="100"
                            placeholder="Velocity loss %"
                            value={gaugeVal}
                            onChange={e => setGaugeVal(e.target.value)}
                            className="session-input-box gauge-val-input"
                            aria-label="Velocity loss percentage from 0 to 100"
                        />
                    )}

                    {gaugeScale === 'technical' && (
                        <div className="technical-gauge-inputs">
                            <label className="technical-met-toggle">
                                <input
                                    type="checkbox"
                                    checked={technicalMet}
                                    onChange={e => setTechnicalMet(e.target.checked)}
                                />
                                <span>{technicalMet ? 'Form Maintained' : 'Form Breakdown'}</span>
                            </label>
                            <input
                                type="text"
                                value={technicalNote}
                                onChange={e => setTechnicalNote(e.target.value)}
                                className="session-input-box gauge-val-input"
                                aria-label="Technical form note"
                                placeholder="Optional note"
                            />
                        </div>
                    )}
                </div>
            </div>

            <button type="submit" className="log-set-btn" disabled={isSubmitting} aria-label="Log repetition set">
                {isSubmitting ? 'Logging…' : 'Log'}
            </button>
        </form>
    );
};
