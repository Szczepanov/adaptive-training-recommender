import { useEffect, useMemo, useRef, useState } from 'react';
import { useStrengthSessionRunner } from '../hooks/useStrengthSessionRunner';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds';
import { useOverloadHistory } from '../hooks/useOverloadHistory';
import type { IntensityGauge, StrengthSession } from '../engine/models';
import { EXERCISES } from '../workouts/exercises';
import { formatElapsed, latestCompletedSet } from '../workouts/restTimer';
import { SessionStepNavigator } from './session/SessionStepNavigator';
import { SessionCompletionSheet, type SessionCompletionPayload } from './session/SessionCompletionSheet';
import './StrengthSessionRunner.css';

interface StrengthSessionRunnerProps {
    userId: string;
    onSessionStateChange?: (session: StrengthSession | null) => void;
}

const STRENGTH_EXERCISES = EXERCISES.filter(exercise => exercise.modality === 'strength');

function gaugeLabel(gauge: IntensityGauge | undefined): string | null {
    if (!gauge) return null;
    switch (gauge.scale) {
        case 'rir': return `${gauge.value} RIR`;
        case 'rpe_rts': return `RPE ${gauge.value}`;
        case 'velocity_loss': return `${gauge.percent}% vel loss`;
        case 'technical': return gauge.met ? 'Quality met' : 'Quality missed';
    }
}

export function StrengthSessionRunner({ userId, onSessionStateChange }: StrengthSessionRunnerProps) {
    const runner = useStrengthSessionRunner(userId);
    const { history: overloadHistory, select: selectOverloadExercise } = useOverloadHistory(userId);
    const [freeTextName, setFreeTextName] = useState('');
    const [catalogExerciseId, setCatalogExerciseId] = useState('');
    const [showManualAdd, setShowManualAdd] = useState(false);
    const [showCompletionSheet, setShowCompletionSheet] = useState(false);
    const [editingSetIndex, setEditingSetIndex] = useState<number | null>(null);
    const [editReps, setEditReps] = useState(1);
    const [editWeight, setEditWeight] = useState<string>('');

    const weightInputRef = useRef<HTMLInputElement>(null);

    const activeExercise = runner.activeExerciseIndex !== null ? runner.session?.exercises[runner.activeExerciseIndex] : undefined;
    const activeSessionId = runner.session?.sessionId;

    useEffect(() => {
        onSessionStateChange?.(runner.session);
    }, [onSessionStateChange, runner.session]);

    useEffect(() => {
        selectOverloadExercise(activeExercise
            ? {
                exerciseId: activeExercise.exerciseId,
                ...(activeExercise.freeTextName ? { freeTextName: activeExercise.freeTextName } : {}),
            }
            : null);
    }, [activeExercise, selectOverloadExercise]);
    const activePlanned = useMemo(
        () => runner.plannedExercises.find(planned => planned.exerciseId === activeExercise?.exerciseId),
        [runner.plannedExercises, activeExercise],
    );

    // Contextual past performance for the active exercise (M1.5)
    const pastSummary = useMemo(() => {
        if (!activeExercise || !overloadHistory) return null;
        if (overloadHistory.length === 0) return null;
        const latestSession = [...overloadHistory].reverse().find(entry => entry.sessionId !== activeSessionId);
        return latestSession?.heaviestSet ?? null;
    }, [activeExercise, overloadHistory, activeSessionId]);

    const lastSetInSession = runner.session ? latestCompletedSet(runner.session.exercises) : null;
    const restSinceIso = runner.session?.state === 'in_progress'
        ? (lastSetInSession?.completedAt ?? runner.session.startedAt)
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
                <button type="button" className="strength-start-btn" disabled={runner.saving} onClick={() => void runner.start()}>
                    {runner.saving ? 'Starting…' : 'Start strength session'}
                </button>
                {runner.error && <p className="strength-error">{runner.error}</p>}
            </div>
        );
    }

    const session = runner.session;
    const isClosed = session.state !== 'in_progress';
    const totalSetsCount = session.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);

    function selectFromCatalog() {
        if (!catalogExerciseId) return;
        runner.selectExercise(catalogExerciseId);
        setCatalogExerciseId('');
        setShowManualAdd(false);
    }

    function addFreeText() {
        const name = freeTextName.trim();
        if (!name) return;
        runner.selectExercise(null, name);
        setFreeTextName('');
        setShowManualAdd(false);
    }

    function onGaugeScaleChange(scale: IntensityGauge['scale'] | '') {
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

    async function handleLogSet() {
        await runner.logSet();
        // Autofocus and select weight input for rapid successive set entry (M1.4)
        if (weightInputRef.current) {
            weightInputRef.current.focus();
            weightInputRef.current.select();
        }
    }

    function handleStartEdit(setIndex: number, currentReps: number, currentWeight: number | null) {
        setEditingSetIndex(setIndex);
        setEditReps(currentReps);
        setEditWeight(currentWeight !== null ? String(currentWeight) : '');
    }

    async function handleSaveEdit(setIndex: number) {
        if (runner.activeExerciseIndex === null) return;
        const weightNum = editWeight.trim() === '' ? null : Number(editWeight);
        await runner.editSet(runner.activeExerciseIndex, setIndex, {
            reps: editReps,
            weightKg: weightNum,
            isWarmup: false,
        });
        setEditingSetIndex(null);
    }

    async function handleRemoveSet(setIndex: number) {
        if (runner.activeExerciseIndex === null) return;
        await runner.removeSet(runner.activeExerciseIndex, setIndex);
    }

    async function handleFinalize(payload: SessionCompletionPayload) {
        if (await runner.finishSession(payload)) {
            setShowCompletionSheet(false);
        }
    }

    async function handleAbandon() {
        if (await runner.abandonSession()) {
            setShowCompletionSheet(false);
        }
    }

    return (
        <div className="strength-runner">
            <div className="strength-runner-header">
                <h3>Strength session</h3>
                <span className={`strength-state strength-state-${session.state}`}>{session.state.replace('_', ' ')}</span>
            </div>

            {runner.canUndo && (
                <div className="undo-toast-banner" role="status">
                    <span>Set modified</span>
                    <button type="button" className="btn-undo" onClick={() => void runner.undo()}>
                        Undo
                    </button>
                </div>
            )}

            {!isClosed && (
                <SessionStepNavigator
                    steps={runner.navigationSteps}
                    activeExerciseIndex={runner.activeExerciseIndex}
                    onSelectStep={runner.selectStep}
                    onAddExerciseClick={() => setShowManualAdd(prev => !prev)}
                />
            )}

            {showManualAdd && !isClosed && (
                <div className="strength-manual-add-block">
                    <div className="strength-manual-add">
                        <select value={catalogExerciseId} onChange={event => setCatalogExerciseId(event.target.value)}>
                            <option value="">Add from catalog…</option>
                            {STRENGTH_EXERCISES.map(exercise => (
                                <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
                            ))}
                        </select>
                        <button type="button" disabled={!catalogExerciseId} onClick={selectFromCatalog}>Add</button>
                    </div>

                    <div className="strength-manual-add">
                        <input
                            type="text"
                            placeholder="Or type custom exercise name"
                            value={freeTextName}
                            onChange={event => setFreeTextName(event.target.value)}
                        />
                        <button type="button" disabled={!freeTextName.trim()} onClick={addFreeText}>Add</button>
                    </div>
                </div>
            )}

            {activeExercise && (
                <div className="strength-active-exercise">
                    <div className="active-exercise-header">
                        <h4>
                            {activeExercise.exerciseId
                                ? (STRENGTH_EXERCISES.find(e => e.id === activeExercise.exerciseId)?.name ?? activeExercise.exerciseId)
                                : activeExercise.freeTextName}
                        </h4>
                        {pastSummary && (
                            <span className="previous-context-chip">
                                Last: {pastSummary.weightKg ?? 'BW'} kg × {pastSummary.reps}
                            </span>
                        )}
                    </div>

                    {!isClosed && (
                        <p className="strength-rest-timer">
                            {lastSetInSession ? 'Rest' : 'Elapsed'}: <span className="rest-value">{formatElapsed(restSeconds)}</span>
                        </p>
                    )}

                    {activeExercise.sets.length > 0 && (
                        <ul className="strength-set-list" aria-label="Logged Sets">
                            {activeExercise.sets.map(set => {
                                const syncStatus = runner.syncStatusForSet(activeExercise, set);
                                const isEditing = editingSetIndex === set.setIndex;

                                if (isEditing) {
                                    return (
                                        <li key={set.setIndex} className="set-editing-row">
                                            <span className="set-index">{set.setIndex}</span>
                                            <input
                                                type="number"
                                                min={1}
                                                value={editReps}
                                                onChange={e => setEditReps(Number(e.target.value))}
                                                aria-label="Edit reps"
                                                style={{ width: '4rem' }}
                                            />
                                            <span>reps @</span>
                                            <input
                                                type="number"
                                                step="0.5"
                                                min={0}
                                                value={editWeight}
                                                onChange={e => setEditWeight(e.target.value)}
                                                placeholder="BW"
                                                aria-label="Edit weight"
                                                style={{ width: '5rem' }}
                                            />
                                            <span>kg</span>
                                            <button type="button" className="set-action-btn" onClick={() => void handleSaveEdit(set.setIndex)}>Save</button>
                                            <button type="button" className="set-action-btn" onClick={() => setEditingSetIndex(null)}>Cancel</button>
                                        </li>
                                    );
                                }

                                return (
                                    <li key={set.setIndex} className={set.isWarmup ? 'warmup' : ''}>
                                        <div className="set-main-info">
                                            <span className="set-index">{set.setIndex}</span>
                                            <span className="set-summary">{set.reps} × {set.weightKg ?? 'BW'}{set.weightKg !== null ? ' kg' : ''}</span>
                                            {gaugeLabel(set.gauge) && <span className="set-gauge">{gaugeLabel(set.gauge)}</span>}
                                            {set.isWarmup && <span className="set-warmup-tag">warm-up</span>}
                                        </div>
                                        <div className="set-right-actions">
                                            <span className={`set-sync set-sync-${syncStatus}`}>
                                                {syncStatus === 'unavailable' ? 'offline' : syncStatus}
                                            </span>
                                            {!isClosed && (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="set-action-btn"
                                                        onClick={() => handleStartEdit(set.setIndex, set.reps, set.weightKg)}
                                                        title="Edit set"
                                                        aria-label={`Edit set ${set.setIndex}`}
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="set-action-btn delete"
                                                        onClick={() => void handleRemoveSet(set.setIndex)}
                                                        title="Delete set"
                                                        aria-label={`Delete set ${set.setIndex}`}
                                                    >
                                                        ✕
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {!isClosed && (
                        <form
                            className="strength-set-entry"
                            onSubmit={e => {
                                e.preventDefault();
                                void handleLogSet();
                            }}
                        >
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
                                    ref={weightInputRef}
                                    type="number"
                                    step="0.5"
                                    min={0}
                                    placeholder="bodyweight"
                                    value={runner.draft.weightKg ?? ''}
                                    onChange={event => runner.updateDraft({ weightKg: event.target.value === '' ? null : Number(event.target.value) })}
                                />
                            </label>
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={runner.draft.isWarmup}
                                    onChange={event => runner.updateDraft({ isWarmup: event.target.checked })}
                                />
                                Warm-up set
                            </label>

                            <label>
                                Intensity Gauge
                                <select value={runner.draft.gauge?.scale ?? ''} onChange={event => onGaugeScaleChange(event.target.value as IntensityGauge['scale'] | '')}>
                                    <option value="">None</option>
                                    <option value="rir">RIR (reps in reserve)</option>
                                    <option value="rpe_rts">RPE (1-10)</option>
                                    <option value="velocity_loss">Velocity loss %</option>
                                    <option value="technical">Technical quality</option>
                                </select>
                            </label>

                            {runner.draft.gauge?.scale === 'rir' && (
                                <label>
                                    RIR Value
                                    <input type="number" min={0} max={10} value={runner.draft.gauge.value} onChange={event => runner.updateDraft({ gauge: { scale: 'rir', value: Number(event.target.value) } })} />
                                </label>
                            )}
                            {runner.draft.gauge?.scale === 'rpe_rts' && (
                                <label>
                                    RPE Value
                                    <input type="number" min={1} max={10} step="0.5" value={runner.draft.gauge.value} onChange={event => runner.updateDraft({ gauge: { scale: 'rpe_rts', value: Number(event.target.value) } })} />
                                </label>
                            )}
                            {runner.draft.gauge?.scale === 'velocity_loss' && (
                                <label>
                                    Max Loss %
                                    <input type="number" min={0} value={runner.draft.gauge.percent} onChange={event => runner.updateDraft({ gauge: { scale: 'velocity_loss', percent: Number(event.target.value) } })} />
                                </label>
                            )}
                            {runner.draft.gauge?.scale === 'technical' && (
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={runner.draft.gauge.met}
                                        onChange={event => runner.updateDraft({ gauge: { scale: 'technical', met: event.target.checked } })}
                                    />
                                    Technical quality met
                                </label>
                            )}

                            {activePlanned && (
                                <p className="strength-target-hint">
                                    Target: {activePlanned.targetSets} × {activePlanned.targetReps ?? '?'}
                                    {activePlanned.targetGauge ? ` @ ${gaugeLabel(activePlanned.targetGauge)}` : ''}
                                </p>
                            )}

                            <button type="submit" className="strength-log-set-btn" disabled={runner.saving}>
                                {runner.saving ? 'Saving…' : 'Log set'}
                            </button>
                        </form>
                    )}
                </div>
            )}

            {runner.error && <p className="strength-error" role="alert">{runner.error}</p>}

            {!isClosed && (
                <div className="strength-session-actions">
                    <button
                        type="button"
                        className="strength-finish-btn"
                        disabled={runner.saving}
                        onClick={() => setShowCompletionSheet(true)}
                    >
                        Finish session
                    </button>
                    <button
                        type="button"
                        disabled={runner.saving}
                        className="strength-abandon-btn"
                        onClick={() => setShowCompletionSheet(true)}
                    >
                        Abandon…
                    </button>
                </div>
            )}

            {showCompletionSheet && (
                <SessionCompletionSheet
                    startedAt={session.startedAt}
                    totalSets={totalSetsCount}
                    steps={runner.navigationSteps}
                    onComplete={handleFinalize}
                    onAbandon={handleAbandon}
                    onCancel={() => setShowCompletionSheet(false)}
                    saving={runner.saving}
                />
            )}
        </div>
    );
}
