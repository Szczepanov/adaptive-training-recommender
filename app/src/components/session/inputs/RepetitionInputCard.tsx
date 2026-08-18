import React, { useState, useRef, useEffect } from 'react';
import type { SessionStep, RepetitionEntryPayload } from '../../../sessions/models';
import type { IntensityGauge } from '../../../engine/models';

interface RepetitionInputCardProps {
    step: SessionStep;
    suggestedWeightKg?: number;
    suggestedReps?: number;
    onSubmit: (payload: RepetitionEntryPayload) => void;
}

type GaugeScaleType = 'none' | 'rpe' | 'rir' | 'velocity_loss' | 'technical';

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

    useEffect(() => {
        if (weightRef.current) {
            weightRef.current.focus();
            weightRef.current.select();
        }
    }, [step.id]);

    const buildGauge = (): IntensityGauge | undefined => {
        if (gaugeScale === 'rpe') {
            const val = gaugeVal.trim().length > 0 ? parseFloat(gaugeVal) : undefined;
            if (val !== undefined && Number.isFinite(val) && val >= 1 && val <= 10) {
                return { scale: 'rpe_rts', value: val };
            }
        } else if (gaugeScale === 'rir') {
            const val = gaugeVal.trim().length > 0 ? parseFloat(gaugeVal) : undefined;
            if (val !== undefined && Number.isFinite(val) && val >= 0 && val <= 10) {
                return { scale: 'rir', value: val };
            }
        } else if (gaugeScale === 'velocity_loss') {
            const val = gaugeVal.trim().length > 0 ? parseFloat(gaugeVal) : undefined;
            if (val !== undefined && Number.isFinite(val) && val >= 0 && val <= 100) {
                return { scale: 'velocity_loss', percent: val };
            }
        } else if (gaugeScale === 'technical') {
            return {
                scale: 'technical',
                met: technicalMet,
                ...(technicalNote.trim().length > 0 ? { note: technicalNote.trim() } : {}),
            };
        }
        return undefined;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const parsedReps = parseInt(reps, 10);
        if (isNaN(parsedReps) || parsedReps <= 0) return;

        const parsedWeight = weight.trim().length > 0 ? parseFloat(weight) : undefined;
        const gauge = buildGauge();

        onSubmit({
            kind: 'repetition',
            setIndex: 1, // dynamically indexed by caller
            reps: parsedReps,
            ...(parsedWeight !== undefined ? { weightKg: parsedWeight } : {}),
            isWarmup,
            ...(gauge ? { gauge } : {}),
        });

        // Reset gauge value for next set
        setGaugeVal('');
        setTechnicalNote('');

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
                            aria-label="Reps in reserve"
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
                            aria-label="Velocity loss percentage"
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
                        </div>
                    )}
                </div>
            </div>

            <button type="submit" className="log-set-btn">
                Log Set ⏎
            </button>
        </form>
    );
};
