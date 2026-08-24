import React, { useState, useEffect } from 'react';
import type { SessionStep, DurationEntryPayload } from '../../../sessions/models';
import { playCountdownBeep } from '../../../utils/audioFeedback';

interface DurationInputCardProps {
    step: SessionStep;
    suggestedLoadKg?: number;
    suggestedSeconds?: number;
    onSubmit: (payload: DurationEntryPayload) => void;
}

export const DurationInputCard: React.FC<DurationInputCardProps> = ({
    step,
    suggestedLoadKg,
    suggestedSeconds,
    onSubmit,
}) => {
    const dose = step.dose;
    const targetSeconds = suggestedSeconds ?? (dose?.kind === 'duration'
        ? (typeof dose.seconds === 'number' ? dose.seconds : (typeof dose.seconds === 'object' ? dose.seconds.min : 30))
        : 30);

    const [seconds, setSeconds] = useState<string>(String(targetSeconds));
    const [loadKg, setLoadKg] = useState<string>(suggestedLoadKg !== undefined ? String(suggestedLoadKg) : '');
    const [isPrepCountdown, setIsPrepCountdown] = useState<boolean>(false);
    const [prepSeconds, setPrepSeconds] = useState<number>(5);
    const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
    const [elapsed, setElapsed] = useState<number>(0);

    // Update state when step or suggestions change
    useEffect(() => {
        setSeconds(String(targetSeconds));
        if (suggestedLoadKg !== undefined) {
            setLoadKg(String(suggestedLoadKg));
        }
        setIsPrepCountdown(false);
        setIsTimerRunning(false);
        setElapsed(0);
    }, [step.id, targetSeconds, suggestedLoadKg]);

    // 5-second lead-in countdown before hold starts
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        if (isPrepCountdown) {
            if (prepSeconds > 0) {
                if (prepSeconds <= 3) {
                    playCountdownBeep(false);
                }
                interval = setInterval(() => {
                    setPrepSeconds(prev => prev - 1);
                }, 1000);
            } else {
                // Prep finished: play GO sound and start main timer
                playCountdownBeep(true);
                setIsPrepCountdown(false);
                setElapsed(0);
                setIsTimerRunning(true);
            }
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isPrepCountdown, prepSeconds]);

    // Main hold stopwatch
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        if (isTimerRunning) {
            interval = setInterval(() => {
                setElapsed(prev => prev + 1);
            }, 1000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isTimerRunning]);

    const handleStartPrep = () => {
        setPrepSeconds(5);
        setIsPrepCountdown(true);
        setIsTimerRunning(false);
    };

    const handleSkipPrepAndStart = () => {
        playCountdownBeep(true);
        setIsPrepCountdown(false);
        setElapsed(0);
        setIsTimerRunning(true);
    };

    const handleCancelPrep = () => {
        setIsPrepCountdown(false);
        setPrepSeconds(5);
    };

    const handleStopTimerAndSet = () => {
        setIsTimerRunning(false);
        if (elapsed > 0) {
            setSeconds(String(elapsed));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const parsedSec = parseInt(seconds, 10);
        if (isNaN(parsedSec) || parsedSec <= 0) return;

        const parsedLoad = loadKg.trim().length > 0 ? parseFloat(loadKg) : undefined;
        onSubmit({
            kind: 'duration',
            seconds: parsedSec,
            ...(parsedLoad !== undefined ? { loadKg: parsedLoad } : {}),
        });
        setElapsed(0);
        setIsTimerRunning(false);
        setIsPrepCountdown(false);
    };

    return (
        <form className="duration-input-card" onSubmit={handleSubmit}>
            {isPrepCountdown ? (
                <div className="prep-countdown-box" role="status" aria-live="assertive">
                    <div className="prep-number-badge">
                        ⚡ Ready in <strong>{prepSeconds}</strong>s
                    </div>
                    <div className="prep-actions">
                        <button
                            type="button"
                            className="timer-control-btn start"
                            onClick={handleSkipPrepAndStart}
                        >
                            Start Now (Skip Prep)
                        </button>
                        <button
                            type="button"
                            className="timer-control-btn cancel"
                            onClick={handleCancelPrep}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div className="timer-display-row">
                    <div className={`stopwatch-badge ${isTimerRunning ? 'running' : ''}`}>
                        ⏱️ {elapsed > 0 ? `${elapsed}s` : `Target: ${targetSeconds}s${step.laterality === 'per_side' ? ' / side' : ''}`}
                    </div>
                    {!isTimerRunning ? (
                        <button
                            type="button"
                            className="timer-control-btn start"
                            onClick={handleStartPrep}
                        >
                            Start Timer (5s lead-in)
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="timer-control-btn stop"
                            onClick={handleStopTimerAndSet}
                        >
                            Stop ({elapsed}s)
                        </button>
                    )}
                </div>
            )}

            {step.laterality === 'per_side' && (
                <div className="unilateral-cue-banner">
                    <span>💡 <strong>Unilateral Hold</strong>: Complete target time on Left, then repeat on Right.</span>
                </div>
            )}

            <div className="input-row">
                <label className="input-group">
                    <span className="input-label">Hold Time (seconds{step.laterality === 'per_side' ? ' / side' : ''})</span>
                    <input
                        type="number"
                        step="1"
                        min="1"
                        value={seconds}
                        onChange={e => setSeconds(e.target.value)}
                        className="session-input-box"
                        required
                        aria-label="Hold duration in seconds"
                    />
                </label>
                <label className="input-group">
                    <span className="input-label">Extra Load (kg)</span>
                    <input
                        type="number"
                        step="0.5"
                        min="0"
                        placeholder="0"
                        value={loadKg}
                        onChange={e => setLoadKg(e.target.value)}
                        className="session-input-box"
                        aria-label="Extra load in kilograms"
                    />
                </label>
            </div>

            <button type="submit" className="log-set-btn">
                Log Hold{step.laterality === 'per_side' ? ' (Both Sides)' : ''} ⏎
            </button>
        </form>
    );
};
