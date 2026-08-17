import { useMemo, useState } from 'react';
import { useStrengthSessionRunner } from '../hooks/useStrengthSessionRunner';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds';
import type { IntensityGauge } from '../engine/models';
import { EXERCISES } from '../workouts/exercises';
import { formatElapsed } from '../workouts/restTimer';
import './StrengthSessionRunner.css';

interface StrengthSessionRunnerProps {
    userId: string;
}

const STRENGTH_EXERCISES = EXERCISES.filter(exercise => exercise.modality === 'strength');

function gaugeLabel(gauge: IntensityGauge | undefined): string | null {
    if (!gauge) return null;
    switch (gauge.scale) {
        case 'rir': return `${gauge.value} RIR`;
        case 'rpe_rts': return `RPE ${gauge.value}`;
        case 'velocity_loss': return `${gauge.percent}% velocity loss`;
        case 'technical': return gauge.met ? 'Quality met' : 'Quality missed';
    }
}

/** Confirm-or-amend set-entry UI (ADR-0021, S1.5). Persists on every logged set, not on
 *  "finish" -- see `useStrengthSessionRunner.logSet` for why. Rendered without any
 *  `@testing-library/react` interaction testing (this repo has none); correctness of the
 *  underlying rules lives in `strengthSessionEntry.test.ts` and
 *  `strengthSessionService.test.ts`, which this component only orchestrates. */
export function StrengthSessionRunner({ userId }: StrengthSessionRunnerProps) {
    const runner = useStrengthSessionRunner(userId);
    const [gaugeScale, setGaugeScale] = useState<IntensityGauge['scale'] | ''>('');
    const [freeTextName, setFreeTextName] = useState('');
    const [catalogExerciseId, setCatalogExerciseId] = useState('');

    const activeExercise = runner.activeExerciseIndex !== null ? runner.session?.exercises[runner.activeExerciseIndex] : undefined;
    const activePlanned = useMemo(
        () => runner.plannedExercises.find(planned => planned.exerciseId === activeExercise?.exerciseId),
        [runner.plannedExercises, activeExercise],
    );

    // S1.6: timestamp-based, not an accumulating interval -- see useElapsedSeconds. "Since"
    // is the last logged set of THIS exercise, falling back to session start before any set
    // exists yet (there is nothing to rest from otherwise).
    const lastSetInExercise = activeExercise?.sets[activeExercise.sets.length - 1];
    const restSinceIso = runner.session?.state === 'in_progress'
        ? (lastSetInExercise?.completedAt ?? runner.session.startedAt)
        : null;
    const restSeconds = useElapsedSeconds(restSinceIso);

    if (runner.loading) {
        return <div className="strength-runner"><p className="card-empty">Loading strength session…</p></div>;
    }

    if (!runner.session) {
        return (
            <div className="strength-runner strength-runner-start">
                <h3>Strength session</h3>
                <p className="card-empty">No session in progress.</p>
                <button type="button" className="strength-start-btn" onClick={() => void runner.start()}>
                    Start strength session
                </button>
                {runner.error && <p className="strength-error">{runner.error}</p>}
            </div>
        );
    }

    const session = runner.session;
    const isClosed = session.state !== 'in_progress';

    function selectPlanned(exerciseId: string) {
        runner.selectExercise(exerciseId);
        setCatalogExerciseId('');
        setFreeTextName('');
    }

    function selectFromCatalog() {
        if (!catalogExerciseId) return;
        runner.selectExercise(catalogExerciseId);
        setCatalogExerciseId('');
    }

    function addFreeText() {
        const name = freeTextName.trim();
        if (!name) return;
        runner.selectExercise(null, name);
        setFreeTextName('');
    }

    function onGaugeScaleChange(scale: IntensityGauge['scale'] | '') {
        setGaugeScale(scale);
        if (scale === '') {
            runner.updateDraft({ gauge: undefined });
            return;
        }
        const current = runner.draft.gauge;
        if (scale === 'rir') runner.updateDraft({ gauge: { scale: 'rir', value: current && 'value' in current ? current.value : 3 } });
        else if (scale === 'rpe_rts') runner.updateDraft({ gauge: { scale: 'rpe_rts', value: current && 'value' in current ? current.value : 7 } });
        else if (scale === 'velocity_loss') runner.updateDraft({ gauge: { scale: 'velocity_loss', percent: current && 'percent' in current ? current.percent : 15 } });
        else if (scale === 'technical') runner.updateDraft({ gauge: { scale: 'technical', met: true } });
    }

    return (
        <div className="strength-runner">
            <div className="strength-runner-header">
                <h3>Strength session</h3>
                <span className={`strength-state strength-state-${session.state}`}>{session.state.replace('_', ' ')}</span>
            </div>

            {!isClosed && (
                <div className="strength-exercise-picker">
                    {runner.plannedExercises.length > 0 && (
                        <div className="strength-planned-list">
                            {runner.plannedExercises.map(planned => (
                                <button
                                    key={planned.exerciseId}
                                    type="button"
                                    className={`strength-planned-btn ${activeExercise?.exerciseId === planned.exerciseId ? 'active' : ''}`}
                                    onClick={() => selectPlanned(planned.exerciseId)}
                                >
                                    <span className="planned-name">{planned.name}</span>
                                    <span className="planned-target">
                                        {planned.targetSets} × {planned.targetReps ?? '?'}
                                        {planned.targetGauge ? ` @ ${gaugeLabel(planned.targetGauge)}` : ''}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="strength-manual-add">
                        <select value={catalogExerciseId} onChange={event => setCatalogExerciseId(event.target.value)}>
                            <option value="">Add exercise from catalog…</option>
                            {STRENGTH_EXERCISES.map(exercise => (
                                <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
                            ))}
                        </select>
                        <button type="button" disabled={!catalogExerciseId} onClick={selectFromCatalog}>Add</button>
                    </div>

                    <div className="strength-manual-add">
                        <input
                            type="text"
                            placeholder="Or type an exercise not in the catalog"
                            value={freeTextName}
                            onChange={event => setFreeTextName(event.target.value)}
                        />
                        <button type="button" disabled={!freeTextName.trim()} onClick={addFreeText}>Add</button>
                    </div>
                </div>
            )}

            {activeExercise && (
                <div className="strength-active-exercise">
                    <h4>{activeExercise.exerciseId ? (STRENGTH_EXERCISES.find(e => e.id === activeExercise.exerciseId)?.name ?? activeExercise.exerciseId) : activeExercise.freeTextName}</h4>

                    {!isClosed && (
                        <p className="strength-rest-timer">
                            {lastSetInExercise ? 'Rest' : 'Elapsed'}: <span className="rest-value">{formatElapsed(restSeconds)}</span>
                        </p>
                    )}

                    {activeExercise.sets.length > 0 && (
                        <ul className="strength-set-list">
                            {activeExercise.sets.map(set => (
                                <li key={set.setIndex} className={set.isWarmup ? 'warmup' : ''}>
                                    <span className="set-index">{set.setIndex}</span>
                                    <span className="set-summary">{set.reps} × {set.weightKg ?? 'BW'}{set.weightKg !== null ? ' kg' : ''}</span>
                                    {gaugeLabel(set.gauge) && <span className="set-gauge">{gaugeLabel(set.gauge)}</span>}
                                    {set.isWarmup && <span className="set-warmup-tag">warm-up</span>}
                                </li>
                            ))}
                        </ul>
                    )}

                    {!isClosed && (
                        <div className="strength-set-entry">
                            <label>
                                Reps
                                <input
                                    type="number"
                                    min={1}
                                    value={runner.draft.reps}
                                    onChange={event => runner.updateDraft({ reps: Number(event.target.value) })}
                                />
                            </label>
                            <label>
                                Weight (kg)
                                <input
                                    type="number"
                                    step="0.5"
                                    min={0}
                                    placeholder="bodyweight"
                                    value={runner.draft.weightKg ?? ''}
                                    onChange={event => runner.updateDraft({ weightKg: event.target.value === '' ? null : Number(event.target.value) })}
                                />
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={runner.draft.isWarmup}
                                    onChange={event => runner.updateDraft({ isWarmup: event.target.checked })}
                                />
                                Warm-up
                            </label>

                            <label>
                                Gauge
                                <select value={gaugeScale} onChange={event => onGaugeScaleChange(event.target.value as IntensityGauge['scale'] | '')}>
                                    <option value="">None</option>
                                    <option value="rir">RIR (reps in reserve)</option>
                                    <option value="rpe_rts">RPE (1-10)</option>
                                    <option value="velocity_loss">Velocity loss %</option>
                                    <option value="technical">Technical quality</option>
                                </select>
                            </label>

                            {runner.draft.gauge?.scale === 'rir' && (
                                <input type="number" min={0} max={10} value={runner.draft.gauge.value} onChange={event => runner.updateDraft({ gauge: { scale: 'rir', value: Number(event.target.value) } })} />
                            )}
                            {runner.draft.gauge?.scale === 'rpe_rts' && (
                                <input type="number" min={1} max={10} step="0.5" value={runner.draft.gauge.value} onChange={event => runner.updateDraft({ gauge: { scale: 'rpe_rts', value: Number(event.target.value) } })} />
                            )}
                            {runner.draft.gauge?.scale === 'velocity_loss' && (
                                <input type="number" min={0} value={runner.draft.gauge.percent} onChange={event => runner.updateDraft({ gauge: { scale: 'velocity_loss', percent: Number(event.target.value) } })} />
                            )}
                            {runner.draft.gauge?.scale === 'technical' && (
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={runner.draft.gauge.met}
                                        onChange={event => runner.updateDraft({ gauge: { scale: 'technical', met: event.target.checked } })}
                                    />
                                    Quality met
                                </label>
                            )}

                            {activePlanned && (
                                <p className="strength-target-hint">
                                    Target: {activePlanned.targetSets} × {activePlanned.targetReps ?? '?'}
                                    {activePlanned.targetGauge ? ` @ ${gaugeLabel(activePlanned.targetGauge)}` : ''}
                                </p>
                            )}

                            <button type="button" className="strength-log-set-btn" disabled={runner.saving} onClick={() => void runner.logSet()}>
                                {runner.saving ? 'Saving…' : 'Log set'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {runner.error && <p className="strength-error">{runner.error}</p>}

            {!isClosed && (
                <div className="strength-session-actions">
                    <button type="button" onClick={() => void runner.finishSession()}>Finish session</button>
                    <button type="button" className="strength-abandon-btn" onClick={() => void runner.abandonSession()}>Abandon</button>
                </div>
            )}
        </div>
    );
}
