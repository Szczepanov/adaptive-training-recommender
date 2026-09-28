import React, { useState, useEffect, useCallback } from 'react';
import type { SessionStep, DurationEntryPayload } from '../../../sessions/models';
import { playCountdownBeep } from '../../../utils/audioFeedback';

interface DurationInputCardProps {
    step: SessionStep;
    suggestedLoadKg?: number;
    suggestedSeconds?: number;
    nextSide?: 'left' | 'right';
    onSubmit: (payload: DurationEntryPayload, side?: 'left' | 'right') => void | Promise<void>;
}

export const DurationInputCard: React.FC<DurationInputCardProps> = ({
    step,
    suggestedLoadKg,
    suggestedSeconds,
    nextSide,
    onSubmit,
}) => {
    const dose = step.dose;
    const targetSeconds = suggestedSeconds ?? (dose?.kind === 'duration'
        ? (typeof dose.seconds === 'number' ? dose.seconds : (typeof dose.seconds === 'object' ? dose.seconds.min : 30))
        : 30);

    const [secondsBySide, setSecondsBySide] = useState<Record<'left' | 'right' | 'bilateral', string>>({
        left: String(targetSeconds), right: String(targetSeconds), bilateral: String(targetSeconds),
    });
    const [selectedSide, setSelectedSide] = useState<'left' | 'right'>(nextSide ?? 'left');
    const [loadBySide, setLoadBySide] = useState<Record<'left' | 'right' | 'bilateral', string>>({
        left: suggestedLoadKg !== undefined ? String(suggestedLoadKg) : '',
        right: suggestedLoadKg !== undefined ? String(suggestedLoadKg) : '',
        bilateral: suggestedLoadKg !== undefined ? String(suggestedLoadKg) : '',
    });
    const [isPrepCountdown, setIsPrepCountdown] = useState<boolean>(false);
    const [prepSeconds, setPrepSeconds] = useState<number>(5);
    const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
    const [elapsedBySide, setElapsedBySide] = useState<Record<'left' | 'right' | 'bilateral', number>>({ left: 0, right: 0, bilateral: 0 });
    const timerSide = step.laterality === 'per_side' ? selectedSide : 'bilateral';
    const seconds = secondsBySide[timerSide];
    const loadKg = loadBySide[timerSide];
    const elapsed = elapsedBySide[timerSide];
    const setSeconds = (value: string) => setSecondsBySide(prev => ({ ...prev, [timerSide]: value }));
    const setLoadKg = (value: string) => setLoadBySide(prev => ({ ...prev, [timerSide]: value }));
    const setElapsed = useCallback((value: number | ((previous: number) => number)) => setElapsedBySide(prev => ({
        ...prev,
        [timerSide]: typeof value === 'function' ? value(prev[timerSide]) : value,
    })), [timerSide]);

    useEffect(() => {
        if (!nextSide) return;
        setSelectedSide(nextSide);
        setIsPrepCountdown(false);
        setIsTimerRunning(false);
    }, [nextSide]);

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
    }, [isPrepCountdown, prepSeconds, setElapsed]);

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
    }, [isTimerRunning, setElapsed]);

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
        void onSubmit({
            kind: 'duration',
            seconds: parsedSec,
            ...(parsedLoad !== undefined ? { loadKg: parsedLoad } : {}),
        }, step.laterality === 'per_side' ? selectedSide : undefined);
        setElapsed(0);
        setSeconds(String(targetSeconds));
        setIsTimerRunning(false);
        setIsPrepCountdown(false);
    };

    return (
        <form className="duration-input-card" onSubmit={handleSubmit}>
            {step.laterality === 'per_side' && (
                <div className="hold-side-selector" role="group" aria-label="Hold side">
                    {(['left', 'right'] as const).map(side => (
                        <button
                            key={side}
                            type="button"
                            className={`hold-side-btn${selectedSide === side ? ' active' : ''}`}
                            aria-pressed={selectedSide === side}
                            onClick={() => {
                                setSelectedSide(side);
                                setIsPrepCountdown(false);
                                setIsTimerRunning(false);
                            }}
                        >
                            {side === 'left' ? 'Left' : 'Right'} side
                        </button>
                    ))}
                </div>
            )}
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
                            aria-label={step.laterality === 'per_side' ? `Start ${selectedSide} hold now` : undefined}
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
                            aria-label={step.laterality === 'per_side' ? `Start ${selectedSide} hold timer` : undefined}
                        >
                            Start Timer (5s lead-in)
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="timer-control-btn stop"
                            onClick={handleStopTimerAndSet}
                            aria-label={step.laterality === 'per_side' ? `Stop ${selectedSide} hold timer` : undefined}
                        >
                            Stop ({elapsed}s)
                        </button>
                    )}
                </div>
            )}

            {step.laterality === 'per_side' && (
                <div className="unilateral-cue-banner">
                    <span>Complete both sides for one set.</span>
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

            <button type="submit" className="log-set-btn" aria-label={step.laterality === 'per_side' ? `Log ${selectedSide} hold` : 'Log hold'}>
                Log
            </button>
        </form>
    );
};
