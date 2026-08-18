import React, { useState, useEffect } from 'react';
import type { SessionStep, DurationEntryPayload } from '../../../sessions/models';

interface DurationInputCardProps {
    step: SessionStep;
    onSubmit: (payload: DurationEntryPayload) => void;
}

export const DurationInputCard: React.FC<DurationInputCardProps> = ({
    step,
    onSubmit,
}) => {
    const dose = step.dose;
    const targetSeconds = dose?.kind === 'duration'
        ? (typeof dose.seconds === 'number' ? dose.seconds : (typeof dose.seconds === 'object' ? dose.seconds.min : 30))
        : 30;

    const [seconds, setSeconds] = useState<string>(String(targetSeconds));
    const [loadKg, setLoadKg] = useState<string>('');
    const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
    const [elapsed, setElapsed] = useState<number>(0);

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
    };

    return (
        <form className="duration-input-card" onSubmit={handleSubmit}>
            <div className="timer-display-row">
                <div className="stopwatch-badge">
                    ⏱️ {elapsed > 0 ? `${elapsed}s` : `Target: ${targetSeconds}s`}
                </div>
                {!isTimerRunning ? (
                    <button
                        type="button"
                        className="timer-control-btn start"
                        onClick={() => { setElapsed(0); setIsTimerRunning(true); }}
                    >
                        Start Timer
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

            <div className="input-row">
                <label className="input-group">
                    <span className="input-label">Hold Time (seconds)</span>
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
                Log Hold ⏎
            </button>
        </form>
    );
};
