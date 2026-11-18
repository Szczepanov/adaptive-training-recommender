import React, { useEffect, useRef, useState } from 'react';
import type { SessionStep, DistanceEntryPayload } from '../../../sessions/models';
import { stepAcceptsMassLoad } from '../../../sessions/stepLoadCapability';
import { RpeField } from './RpeField';
import { runSingleFlight } from './repetitionSubmit';
import { buildDistancePayload, type SideKey } from './setPayloads';

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
    const showLoad = stepAcceptsMassLoad(step);
    const [loadKg, setLoadKg] = useState<string>(suggestedLoadKg !== undefined ? String(suggestedLoadKg) : '');
    const [selectedSide, setSelectedSide] = useState<'left' | 'right'>(nextSide ?? 'left');
    // Each side keeps its own RPE draft, so the left side's effort is never logged on the right.
    const [rpeBySide, setRpeBySide] = useState<Record<SideKey, string>>({ left: '', right: '', bilateral: '' });
    const sideKey: SideKey = perSide ? selectedSide : 'bilateral';
    const rpe = rpeBySide[sideKey];
    // The optional split time is per side too: a blank right side must not reuse the left's time.
    const [secondsBySide, setSecondsBySide] = useState<Record<SideKey, string>>({ left: '', right: '', bilateral: '' });
    const seconds = secondsBySide[sideKey];
    // Bumped on every edit, per field and side, so a finished save clears only the fields the
    // athlete has not touched since submitting (an edited RPE must not keep an old split, or vice versa).
    const editRevisionRef = useRef<Record<'rpe' | 'seconds', Record<SideKey, number>>>({
        rpe: { left: 0, right: 0, bilateral: 0 },
        seconds: { left: 0, right: 0, bilateral: 0 },
    });
    const touch = (field: 'rpe' | 'seconds') => {
        const current = editRevisionRef.current;
        editRevisionRef.current = { ...current, [field]: { ...current[field], [sideKey]: current[field][sideKey] + 1 } };
    };
    const setRpe = (value: string) => { touch('rpe'); setRpeBySide(prev => ({ ...prev, [sideKey]: value })); };
    const setSeconds = (value: string) => { touch('seconds'); setSecondsBySide(prev => ({ ...prev, [sideKey]: value })); };
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const submitInFlightRef = useRef(false);

    useEffect(() => {
        if (nextSide) setSelectedSide(nextSide);
    }, [nextSide, performedEntryCount, step.id]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const payload = buildDistancePayload({ meters, seconds, loadKg, rpe }, showLoad);
        if (!payload) return;
        const loggedSide = sideKey;
        const rpeRevision = editRevisionRef.current.rpe[loggedSide];
        const secondsRevision = editRevisionRef.current.seconds[loggedSide];
        // One write at a time: the runner appends the entry optimistically and this card then
        // moves to the other side, so a second tap mid-write must not log a side not performed.
        await runSingleFlight(submitInFlightRef, async () => {
            setIsSubmitting(true);
            try {
                await onSubmit(payload, perSide ? selectedSide : undefined);
                if (editRevisionRef.current.rpe[loggedSide] === rpeRevision) setRpeBySide(prev => ({ ...prev, [loggedSide]: '' }));
                if (editRevisionRef.current.seconds[loggedSide] === secondsRevision) setSecondsBySide(prev => ({ ...prev, [loggedSide]: '' }));
            } finally {
                setIsSubmitting(false);
            }
        });
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

            <button type="submit" className="log-set-btn" disabled={isSubmitting} aria-label={perSide ? `Log ${selectedSide} side distance` : 'Log distance split'}>
                Log
            </button>
        </form>
    );
};
