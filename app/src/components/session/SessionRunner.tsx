import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RangeOrNumber, SessionDefinition, SessionEntry, SessionEntryPayload, SessionExecution, SessionReferenceBinding, SessionStep } from '../../sessions/models';
import type { SessionStepSummary } from '../../workouts/strengthSessionEntry';
import { useSessionRunner } from '../../hooks/useSessionRunner';
import { useOverloadHistory } from '../../hooks/useOverloadHistory';
import type { ExerciseIdentity } from '../../workouts/overloadHistory';
import { resolveStepInputProfile } from '../../sessions/inputProfiles';
import { comparePlannedVsPerformed } from '../../sessions/performedComparison';
import { RepetitionInputCard } from './inputs/RepetitionInputCard';
import { DurationInputCard } from './inputs/DurationInputCard';
import { DistanceInputCard } from './inputs/DistanceInputCard';
import { CheckoffInputCard } from './inputs/CheckoffInputCard';
import { SessionCompletionSheet } from './SessionCompletionSheet';
import { sessionDefinitionService, type SessionDefinitionHeader } from '../../services/sessionDefinitionService';
import { prepareUnplannedSessionLaunch } from '../../services/sessionAuthoringService';
import { getGroupProgress } from '../../sessions/groupProgression';
import { GroupProgress } from './GroupProgress';
import { ChoiceCard } from './ChoiceCard';
import './SessionRunner.css';

// Import positive fixtures for quick unplanned session launch
import fixture01 from '../../sessions/fixtures/01-full-body-maintenance.json';
import fixture02 from '../../sessions/fixtures/02-lower-olympic-variants.json';
import fixture03 from '../../sessions/fixtures/03-upper-body-absorption-and-spin.json';
import fixture04 from '../../sessions/fixtures/04-friday-field-drills.json';
import fixture05 from '../../sessions/fixtures/05-timed-trunk-and-tissue.json';
import fixture06 from '../../sessions/fixtures/06-protocol-locked-sprint-jump-test.json';
import fixture08 from '../../sessions/fixtures/08-recovery-spin-companion.json';

const AVAILABLE_FIXTURES: SessionDefinition[] = [
    fixture01 as unknown as SessionDefinition,
    fixture02 as unknown as SessionDefinition,
    fixture03 as unknown as SessionDefinition,
    fixture04 as unknown as SessionDefinition,
    fixture05 as unknown as SessionDefinition,
    fixture06 as unknown as SessionDefinition,
    fixture08 as unknown as SessionDefinition,
];

function formatRange(value: RangeOrNumber): string {
    return typeof value === 'number' ? String(value) : `${value.min}–${value.max}`;
}

function formatEffort(step: SessionStep): string | null {
    const effort = step.effort;
    if (!effort) return null;

    if (effort.kind === 'rpe' && effort.target !== undefined) return `RPE ${formatRange(effort.target)}`;
    if (effort.kind === 'rir' && effort.target !== undefined) return `${formatRange(effort.target)} RIR`;
    if (effort.rpe !== undefined) return `RPE ${formatRange(effort.rpe)}`;
    if (effort.rir !== undefined) return `${formatRange(effort.rir)} RIR`;
    return null;
}

interface SessionRunnerProps {
    userId: string;
    /** A persisted M3 binding plus the exact snapshot-resolved definition to execute. */
    initialSession?: { definition: SessionDefinition; binding: SessionReferenceBinding };
    onInitialSessionHandled?: () => void;
    onImportSession?: () => void;
    onBuildSession?: () => void;
    onSessionStateChange?: (execution: SessionExecution | null) => void;
    onClose?: () => void;
}

export const SessionRunner: React.FC<SessionRunnerProps> = ({
    userId,
    initialSession,
    onInitialSessionHandled,
    onImportSession,
    onBuildSession,
    onSessionStateChange,
    onClose,
}) => {
    const runner = useSessionRunner(userId, AVAILABLE_FIXTURES);
    const overload = useOverloadHistory(userId);
    const initialLaunchAttempted = useRef(false);
    const [showCompletionSheet, setShowCompletionSheet] = useState<boolean>(false);
    const [showAbandonConfirmation, setShowAbandonConfirmation] = useState<boolean>(false);
    const [completionError, setCompletionError] = useState<string | null>(null);
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
    const [editReps, setEditReps] = useState<string>('');
    const [editWeight, setEditWeight] = useState<string>('');
    const [savedDefinitions, setSavedDefinitions] = useState<SessionDefinitionHeader[]>([]);
    const [savedDefinitionsError, setSavedDefinitionsError] = useState<string | null>(null);
    const [startingSavedDefinitionId, setStartingSavedDefinitionId] = useState<string | null>(null);
    const [pendingGroupAdvance, setPendingGroupAdvance] = useState<{
        blockIndex: number;
        stepIndex: number;
        entryCountBefore: number;
    } | null>(null);

    const activeExerciseIdentity = useMemo((): ExerciseIdentity | null => {
        if (!runner.activeStep?.exerciseRef) return null;
        if (runner.activeStep.exerciseRef.kind === 'catalog') {
            return { exerciseId: runner.activeStep.exerciseRef.exerciseId };
        }
        if (runner.activeStep.exerciseRef.kind === 'unresolved_free_text') {
            return { exerciseId: null, freeTextName: runner.activeStep.exerciseRef.name };
        }
        return null;
    }, [runner.activeStep]);

    const { select: selectOverload } = overload;
    useEffect(() => {
        selectOverload(activeExerciseIdentity);
    }, [activeExerciseIdentity, selectOverload]);

    const pastSummary = useMemo(() => {
        if (!overload.history || overload.history.length === 0) return null;
        const latestSession = [...overload.history].reverse().find(entry => entry.sessionId !== runner.execution?.executionId);
        return latestSession?.heaviestSet ?? null;
    }, [overload.history, runner.execution?.executionId]);

    useEffect(() => {
        onSessionStateChange?.(runner.execution);
    }, [onSessionStateChange, runner.execution]);

    useEffect(() => {
        initialLaunchAttempted.current = false;
    }, [initialSession?.binding.prescriptionHash]);

    useEffect(() => {
        let cancelled = false;
        sessionDefinitionService.listDefinitionHeaders(userId).then(result => {
            if (cancelled) return;
            if (result.status === 'AVAILABLE') {
                setSavedDefinitions(result.data);
                setSavedDefinitionsError(null);
            } else if (result.status === 'UNAVAILABLE') {
                setSavedDefinitionsError('Saved sessions are temporarily unavailable.');
            } else if (result.status === 'INVALID') {
                setSavedDefinitionsError('A saved session has invalid data and cannot be listed.');
            }
        }).catch(() => {
            if (!cancelled) setSavedDefinitionsError('Could not load saved sessions.');
        });
        return () => { cancelled = true; };
    }, [userId]);

    useEffect(() => {
        if (!initialSession || runner.isRestoring || initialLaunchAttempted.current) return;
        if (runner.execution?.state === 'in_progress'
            && !runner.definition
            && runner.execution.prescriptionHash === initialSession.binding.prescriptionHash) {
            initialLaunchAttempted.current = true;
            runner.restoreSessionDefinition(initialSession.definition)
                .then(() => onInitialSessionHandled?.())
                .catch(() => { initialLaunchAttempted.current = false; });
            return;
        }
        if (runner.execution) return;
        initialLaunchAttempted.current = true;
        runner.startSession(initialSession.definition, initialSession.binding.sessionSource, {
            occurrenceId: initialSession.binding.occurrenceId,
            prescriptionHash: initialSession.binding.prescriptionHash,
        }).then(() => onInitialSessionHandled?.()).catch(() => {
            initialLaunchAttempted.current = false;
        });
    }, [initialSession, onInitialSessionHandled, runner]);

    const startSavedDefinition = async (header: SessionDefinitionHeader) => {
        setStartingSavedDefinitionId(header.definitionId);
        setSavedDefinitionsError(null);
        try {
            const result = await sessionDefinitionService.getDefinitionRevision(userId, header.definitionId, header.latestRevision);
            if (result.status !== 'AVAILABLE') {
                throw new Error(result.status === 'MISSING' ? 'The latest saved revision is missing.' : 'The saved session cannot be read safely.');
            }
            const launch = await prepareUnplannedSessionLaunch(userId, result.data);
            await runner.startSession(launch.definition, launch.binding.sessionSource, {
                occurrenceId: launch.binding.occurrenceId,
                prescriptionHash: launch.binding.prescriptionHash,
            });
        } catch (error) {
            setSavedDefinitionsError(error instanceof Error ? error.message : 'Could not start the saved session.');
        } finally {
            setStartingSavedDefinitionId(null);
        }
    };

    const handleEntrySubmit = async (payload: SessionEntryPayload) => {
        if (!runner.definition || !runner.activeBlock || !runner.activeStep) return;

        const blockIndex = runner.activeBlockIndex;
        const stepIndex = runner.activeStepIndex;
        const entryCountBefore = runner.entries.length;
        await runner.logEntry(payload);
        setPendingGroupAdvance({ blockIndex, stepIndex, entryCountBefore });
    };

    useEffect(() => {
        if (!pendingGroupAdvance || !runner.definition || runner.entries.length <= pendingGroupAdvance.entryCountBefore) return;

        setPendingGroupAdvance(null);
        const block = runner.definition.blocks[pendingGroupAdvance.blockIndex];
        if (!block) return;

        const progress = getGroupProgress(block, runner.entries, pendingGroupAdvance.stepIndex);
        if (!progress) return;

        if (progress.nextStepIndex !== null) {
            runner.selectStep(pendingGroupAdvance.blockIndex, progress.nextStepIndex);
            return;
        }

        // A completed rotating group advances to the first step of the next non-empty block.
        const nextBlockIndex = runner.definition.blocks.findIndex(
            (candidate, index) => index > pendingGroupAdvance.blockIndex && candidate.steps.length > 0,
        );
        if (nextBlockIndex >= 0) runner.selectStep(nextBlockIndex, 0);
    }, [pendingGroupAdvance, runner]);

    // A choice-driven end_session (D-MCHOICE) routes straight to the completion sheet
    // rather than requiring the athlete to step through every now-optional block.
    useEffect(() => {
        if (runner.sessionEnded) setShowCompletionSheet(true);
    }, [runner.sessionEnded]);

    // If no active session, show fixture picker to start an unplanned session
    if (runner.isRestoring) {
        return <div className="session-runner-container no-active"><p>Restoring an active session…</p></div>;
    }

    if (!runner.definition || !runner.execution || runner.execution.state !== 'in_progress') {
        if (runner.execution?.state === 'in_progress') {
            return (
                <div className="session-runner-container no-active">
                    <h2>Active session needs its stored prescription</h2>
                    <p>Return from the session that started it so the exact snapshot can be restored. Starting another session is disabled.</p>
                </div>
            );
        }
        return (
            <div className="session-runner-container no-active">
                <header className="session-runner-header">
                    <h2>🚀 Start a Structured Session</h2>
                    <p className="session-runner-subtitle">Start a reviewed session, or make one that is stored and validated before execution.</p>
                    {(onImportSession || onBuildSession) && <div className="session-authoring-actions">
                        {onImportSession && <button type="button" className="start-fixture-btn" onClick={onImportSession}>Import session JSON</button>}
                        {onBuildSession && <button type="button" className="start-fixture-btn secondary-authoring-btn" onClick={onBuildSession}>Build session</button>}
                    </div>}
                </header>
                {savedDefinitionsError && <p className="session-runner-error" role="alert">{savedDefinitionsError}</p>}
                {savedDefinitions.length > 0 && <section className="saved-session-library" aria-labelledby="saved-session-library-title">
                    <h3 id="saved-session-library-title">Your saved sessions</h3>
                    <div className="fixture-grid">
                        {savedDefinitions.map(header => <div key={header.definitionId} className="fixture-card">
                            <div className="fixture-info">
                                <span className="fixture-intent-badge">saved · rev {header.latestRevision}</span>
                                <h3 className="fixture-title">{header.title}</h3>
                                {header.dominantModality && <p className="fixture-summary">{header.dominantModality}</p>}
                            </div>
                            <button type="button" className="start-fixture-btn" disabled={startingSavedDefinitionId !== null} onClick={() => startSavedDefinition(header)}>
                                {startingSavedDefinitionId === header.definitionId ? 'Starting…' : 'Start session'}
                            </button>
                        </div>)}
                    </div>
                </section>}
                <div className="fixture-grid">
                    {AVAILABLE_FIXTURES.map(fixture => (
                        <div key={fixture.id} className="fixture-card">
                            <div className="fixture-info">
                                <span className="fixture-intent-badge">{fixture.intent}</span>
                                <h3 className="fixture-title">{fixture.title}</h3>
                                <p className="fixture-summary">{fixture.summary || `${fixture.blocks.length} blocks`}</p>
                            </div>
                            <button
                                type="button"
                                className="start-fixture-btn"
                                onClick={() => runner.startFixtureSession(fixture)}
                            >
                                Start Session →
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const { definition, activeStep, entries } = runner;
    const activeStepEntries = entries.filter(e => e.stepId === activeStep?.id);
    const comparison = comparePlannedVsPerformed(definition, entries);

    const answeredChoiceIds = new Set(
        entries
            .filter(e => e.payload.kind === 'choice')
            .map(e => (e.payload as { choiceId: string }).choiceId),
    );
    // The choice due at the active step -- authored, not yet answered (D-MCHOICE). Other
    // step controls stay blocked until it is resolved: no code path changes a prescribed
    // step without a recorded athlete action.
    const dueChoice = activeStep && runner.activeBlock
        ? (runner.activeBlock.optionSets ?? []).find(choice => choice.appliesAtStepId === activeStep.id && !answeredChoiceIds.has(choice.id)) ?? null
        : null;

    function describeChoiceEntry(entry: SessionEntry): string {
        if (entry.payload.kind !== 'choice') return '';
        const { choiceId, optionId } = entry.payload;
        for (const block of definition.blocks) {
            const choice = block.optionSets?.find(c => c.id === choiceId);
            const option = choice?.options.find(o => o.id === optionId);
            if (option) return option.label;
        }
        return optionId;
    }

    const stepSummaries: SessionStepSummary[] = comparison.stepComparisons.map((sc, idx) => ({
        exerciseIndex: idx,
        exerciseId: null,
        displayName: sc.stepTitle,
        isPlanned: true,
        optional: sc.isOptional,
        targetSets: sc.targetSets,
        targetReps: null,
        targetGauge: null,
        loggedSetsCount: sc.completedSets,
        isComplete: sc.isComplete,
    }));

    const formatTime = (totalSec: number) => {
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const handleStartEdit = (entry: SessionEntry) => {
        setEditingEntryId(entry.id);
        if (entry.payload.kind === 'repetition') {
            setEditReps(String(entry.payload.reps));
            setEditWeight(entry.payload.weightKg !== undefined ? String(entry.payload.weightKg) : '');
        }
    };

    const handleSaveEdit = (entryId: string) => {
        const r = parseInt(editReps, 10);
        const w = editWeight.trim().length > 0 ? parseFloat(editWeight) : undefined;
        if (!isNaN(r) && r > 0) {
            runner.editEntry(entryId, { reps: r, weightKg: w });
        }
        setEditingEntryId(null);
    };

    const inputProfile = activeStep ? resolveStepInputProfile(activeStep) : 'repetition_mass';
    const activeEffort = activeStep ? formatEffort(activeStep) : null;
    const activeBlock = runner.activeBlock;

    return (
        <div className="session-runner-container">
            {/* Top Bar */}
            <div className="session-top-bar">
                <div className="session-header-left">
                    <span className="intent-tag">{definition.intent}</span>
                    <h2 className="session-title-text">{definition.title}</h2>
                </div>
                <div className="session-header-right">
                    <span className="session-timer">⏱️ {formatTime(runner.elapsedSeconds)}</span>
                    <span className={`sync-pill ${runner.syncStatus}`}>{runner.syncStatus}</span>
                </div>
            </div>

            {/* Rest Timer Banner */}
            {runner.isRestRunning && (
                <div className="rest-timer-banner">
                    <span>☕ Rest: <strong>{runner.restSecondsRemaining}s</strong></span>
                    <button type="button" className="skip-rest-btn" onClick={runner.skipRestTimer}>
                        Skip Rest
                    </button>
                </div>
            )}

            {/* Undo Banner */}
            {runner.canUndo && (
                <div className="undo-toast-banner" role="alert">
                    <span>Set removed</span>
                    <button type="button" className="undo-action-btn" onClick={runner.undo}>
                        Undo
                    </button>
                </div>
            )}

            {/* Block & Step Navigation */}
            <div className="step-nav-ribbon">
                {definition.blocks.map((block, bIdx) => (
                    <div key={block.id} className="block-nav-group">
                        <span className="block-role-label">{block.title || block.role}</span>
                        <div className="step-pills">
                            {block.steps.map((step, sIdx) => {
                                const stepCompleted = entries.filter(e => e.stepId === step.id && e.payload.kind !== 'choice').length > 0;
                                const isCurrent = runner.activeBlockIndex === bIdx && runner.activeStepIndex === sIdx;
                                const stepName = step.title || (step.exerciseRef?.kind === 'catalog' ? step.exerciseRef.exerciseId : (step.exerciseRef?.kind === 'unresolved_free_text' ? step.exerciseRef.name : step.id));
                                return (
                                    <button
                                        key={step.id}
                                        type="button"
                                        className={`step-nav-pill ${isCurrent ? 'active' : ''} ${stepCompleted ? 'completed' : ''}`}
                                        onClick={() => runner.selectStep(bIdx, sIdx)}
                                    >
                                        {stepCompleted ? '✓ ' : ''}{stepName}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Active Step Panel */}
            {activeStep && (
                <div className="active-step-panel">
                    <div className="active-step-header">
                        <div className="step-titles">
                            <span className="step-kind-badge">{activeStep.kind}</span>
                            <h3 className="step-name">
                                {activeStep.title || (activeStep.exerciseRef?.kind === 'catalog' ? activeStep.exerciseRef.exerciseId : (activeStep.exerciseRef?.kind === 'unresolved_free_text' ? activeStep.exerciseRef.name : activeStep.id))}
                            </h3>
                            {pastSummary && (
                                <span className="previous-context-chip">
                                    Last: {pastSummary.weightKg !== null ? `${pastSummary.weightKg} kg` : 'BW'} × {pastSummary.reps}
                                </span>
                            )}
                            {activeStep.notes && <p className="step-notes-text">{activeStep.notes}</p>}
                        </div>
                        <div className="step-target-summary">
                            {activeStep.dose?.kind === 'repetition' && (
                                <span>Target: {activeStep.dose.sets} sets × {typeof activeStep.dose.reps === 'number' ? activeStep.dose.reps : `${activeStep.dose.reps.min}-${activeStep.dose.reps.max}`} reps</span>
                            )}
                            {activeStep.dose?.kind === 'duration' && (
                                <span>Target: {typeof activeStep.dose.seconds === 'number' ? activeStep.dose.seconds : `${activeStep.dose.seconds.min}-${activeStep.dose.seconds.max}`}s</span>
                            )}
                            {activeStep.dose?.kind === 'distance' && (
                                <span>Target: {typeof activeStep.dose.meters === 'number' ? `${activeStep.dose.meters}m` : (typeof activeStep.dose.metres === 'number' ? `${activeStep.dose.metres}m` : 'Distance')}</span>
                            )}
                            {activeEffort && <span>Effort: {activeEffort}</span>}
                            {activeStep.rest !== undefined && <span>Rest: {formatRange(activeStep.rest)} sec</span>}
                            {activeStep.tempo && <span>Tempo: {activeStep.tempo}</span>}
                        </div>
                    </div>
                    {activeStep.stopConditions && activeStep.stopConditions.length > 0 && (
                        <ul className="step-stop-conditions">
                            {activeStep.stopConditions.map(condition => <li key={condition}>Stop: {condition}</li>)}
                        </ul>
                    )}
                    {activeBlock && (
                        <GroupProgress
                            block={activeBlock}
                            entries={entries}
                            activeStepIndex={runner.activeStepIndex}
                            onSelectStep={stepIndex => runner.selectStep(runner.activeBlockIndex, stepIndex)}
                        />
                    )}

                    {/* An authored branch point blocks every other control at this step until
                        it is answered (D-MCHOICE) -- no code path changes a prescribed step
                        without a recorded athlete action. */}
                    {dueChoice ? (
                        <ChoiceCard
                            choice={dueChoice}
                            ineligibleOptionIds={runner.ineligibleOptionIds}
                            onSelect={(optionId, reason) => runner.logChoice(dueChoice.id, optionId, reason)}
                        />
                    ) : (
                        /* Step Input Card */
                        <div className="input-card-container">
                            {inputProfile === 'repetition_mass' || inputProfile === 'repetition_bodyweight' ? (
                                <RepetitionInputCard
                                    key={activeStep.id}
                                    step={activeStep}
                                    onSubmit={handleEntrySubmit}
                                />
                            ) : inputProfile === 'duration_hold' ? (
                                <DurationInputCard
                                    key={activeStep.id}
                                    step={activeStep}
                                    onSubmit={handleEntrySubmit}
                                />
                            ) : inputProfile === 'distance_split' ? (
                                <DistanceInputCard
                                    key={activeStep.id}
                                    step={activeStep}
                                    onSubmit={handleEntrySubmit}
                                />
                            ) : (
                                <CheckoffInputCard
                                    key={activeStep.id}
                                    step={activeStep}
                                    onSubmit={handleEntrySubmit}
                                />
                            )}
                        </div>
                    )}

                    {/* Logged Sets for Active Step */}
                    <div className="logged-entries-section">
                        <h4 className="entries-heading">Performed for this step ({activeStepEntries.length})</h4>
                        {activeStepEntries.length === 0 ? (
                            <p className="no-entries-note">No work logged for this step yet.</p>
                        ) : (
                            <ul className="entries-list">
                                {activeStepEntries.map((entry, idx) => (
                                    <li key={entry.id} className="entry-row">
                                        {editingEntryId === entry.id ? (
                                            <div className="entry-edit-box">
                                                <input
                                                    type="number"
                                                    step="0.5"
                                                    value={editWeight}
                                                    onChange={e => setEditWeight(e.target.value)}
                                                    placeholder="kg"
                                                    className="edit-input"
                                                />
                                                <input
                                                    type="number"
                                                    step="1"
                                                    value={editReps}
                                                    onChange={e => setEditReps(e.target.value)}
                                                    placeholder="reps"
                                                    className="edit-input"
                                                />
                                                <button type="button" className="save-edit-btn" onClick={() => handleSaveEdit(entry.id)}>
                                                    Save
                                                </button>
                                                <button type="button" className="cancel-edit-btn" onClick={() => setEditingEntryId(null)}>
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="entry-details">
                                                    <span className="set-num">#{idx + 1}</span>
                                                    {entry.payload.kind === 'repetition' && (
                                                        <span className="set-metrics">
                                                            {entry.payload.weightKg ? `${entry.payload.weightKg} kg × ` : ''}{entry.payload.reps} reps
                                                            {entry.payload.isWarmup && <span className="warmup-badge"> (warm-up)</span>}
                                                            {entry.payload.gauge && <span className="gauge-badge"> [{entry.payload.gauge.scale}: {entry.payload.gauge.scale === 'velocity_loss' ? entry.payload.gauge.percent : (entry.payload.gauge.scale === 'technical' ? (entry.payload.gauge.met ? 'met' : 'failed') : entry.payload.gauge.value)}]</span>}
                                                        </span>
                                                    )}
                                                    {entry.payload.kind === 'duration' && (
                                                        <span className="set-metrics">{entry.payload.seconds}s hold</span>
                                                    )}
                                                    {entry.payload.kind === 'distance' && (
                                                        <span className="set-metrics">{entry.payload.meters}m {entry.payload.durationSeconds ? `(${entry.payload.durationSeconds}s)` : ''}</span>
                                                    )}
                                                    {entry.payload.kind === 'checkoff' && (
                                                        <span className="set-metrics">✓ Completed</span>
                                                    )}
                                                    {entry.payload.kind === 'choice' && (
                                                        <span className="set-metrics">
                                                            Chose: {describeChoiceEntry(entry)}
                                                            {entry.payload.reason && ` — ${entry.payload.reason}`}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="entry-actions">
                                                    {entry.payload.kind === 'repetition' && (
                                                        <button type="button" className="entry-btn edit" onClick={() => handleStartEdit(entry)}>
                                                            Edit
                                                        </button>
                                                    )}
                                                    <button type="button" className="entry-btn remove" onClick={() => runner.removeEntry(entry.id)}>
                                                        ✕
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {/* Bottom Actions */}
            <div className="session-bottom-bar">
                <button
                    type="button"
                    className="finish-session-btn"
                    onClick={() => setShowCompletionSheet(true)}
                >
                    Finish Session ({comparison.completedStepsCount}/{comparison.totalPlannedSteps} complete)
                </button>
                <button
                    type="button"
                    className="abandon-session-btn"
                    onClick={() => {
                        setShowAbandonConfirmation(true);
                        setShowCompletionSheet(true);
                    }}
                >
                    Abandon
                </button>
            </div>

            {/* Completion Sheet */}
            {showCompletionSheet && (
                <SessionCompletionSheet
                    startedAt={runner.execution.startedAt}
                    totalSets={entries.length}
                    steps={stepSummaries}
                    saving={false}
                    openAbandonConfirmation={showAbandonConfirmation}
                    error={completionError}
                    onCancel={() => {
                        setShowCompletionSheet(false);
                        setShowAbandonConfirmation(false);
                        setCompletionError(null);
                    }}
                    onComplete={async (payload) => {
                        try {
                            await runner.completeSession(payload);
                            setShowCompletionSheet(false);
                            setShowAbandonConfirmation(false);
                            setCompletionError(null);
                            if (onClose) onClose();
                        } catch {
                            setCompletionError('Could not save completion feedback. Your session is still open, so you can retry.');
                        }
                    }}
                    onAbandon={async () => {
                        try {
                            await runner.abandonSession();
                            setShowCompletionSheet(false);
                            setShowAbandonConfirmation(false);
                            setCompletionError(null);
                            if (onClose) onClose();
                        } catch {
                            setCompletionError('Could not abandon the session. It remains open, so you can retry.');
                        }
                    }}
                />
            )}
        </div>
    );
};
