import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RangeOrNumber, SessionDefinition, SessionEntry, SessionEntryPayload, SessionExecution, SessionReferenceBinding, SessionStep } from '../../sessions/models';
import type { SessionStepSummary } from '../../workouts/strengthSessionEntry';
import { useSessionRunner } from '../../hooks/useSessionRunner';
import { useOverloadHistory } from '../../hooks/useOverloadHistory';
import type { ExerciseIdentity } from '../../workouts/overloadHistory';
import { resolveStepInputProfile } from '../../sessions/inputProfiles';
import { comparePlannedVsPerformed } from '../../sessions/performedComparison';
import { formatSessionLoad } from '../../sessions/loadDisplay';
import { RepetitionInputCard } from './inputs/RepetitionInputCard';
import { DurationInputCard } from './inputs/DurationInputCard';
import { DistanceInputCard } from './inputs/DistanceInputCard';
import { CheckoffInputCard } from './inputs/CheckoffInputCard';
import { SessionCompletionSheet } from './SessionCompletionSheet';

import { sessionDefinitionService, type SessionDefinitionHeader } from '../../services/sessionDefinitionService';
import { prepareUnplannedSessionLaunch } from '../../services/sessionAuthoringService';
import { archivedSavedDefinitionError } from '../../sessions/sessionLaunch';
import { getGroupProgress, targetEntriesForGroupStep } from '../../sessions/groupProgression';
import { stepName } from '../../sessions/stepDisplay';
import { GroupProgress } from './GroupProgress';
import { ChoiceCard } from './ChoiceCard';
import { ExerciseSwapModal } from './ExerciseSwapModal';
import { SessionDefinitionPreview } from './SessionDefinitionPreview';
import { isSoundEnabled, setSoundEnabled } from '../../utils/audioFeedback';
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

/** M4.3: `notEarlierThanMinutesAfter` is an authored timing constraint (e.g. tissue/hydration
 * recovery before a companion), not just documentation -- a companion with none set is always
 * eligible immediately. */
function isCompanionEligibleNow(
    companion: { notEarlierThanMinutesAfter?: number },
    finishedAt: number,
    now: number,
): boolean {
    if (companion.notEarlierThanMinutesAfter === undefined) return true;
    return now >= finishedAt + companion.notEarlierThanMinutesAfter * 60_000;
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

function formatTempoBreakdown(tempo: string): string {
    const cleaned = tempo.replace(/-/g, '');
    if (cleaned.length === 4) {
        const [ecc, pauseBottom, con, pauseTop] = cleaned.split('');
        const conText = con.toUpperCase() === 'X' ? 'Explosive' : `${con}s`;
        return `${tempo} (${ecc}s Lower · ${pauseBottom}s Pause · ${conText} Lift · ${pauseTop}s Top)`;
    }
    return tempo;
}

interface SessionRunnerProps {
    userId: string;
    /** A persisted M3 binding plus the exact snapshot-resolved definition to execute. */
    initialSession?: { definition: SessionDefinition; binding: SessionReferenceBinding };
    onInitialSessionHandled?: () => void;
    onImportSession?: () => void;
    onBuildSession?: (initialDefinition?: SessionDefinition) => void;
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
    const [previewDefinition, setPreviewDefinition] = useState<{
        definition: SessionDefinition;
        header?: SessionDefinitionHeader;
    } | null>(null);
    const [previewingSavedDefinitionId, setPreviewingSavedDefinitionId] = useState<string | null>(null);
    const [editingSavedDefinitionId, setEditingSavedDefinitionId] = useState<string | null>(null);
    const [updatingSavedDefinitionId, setUpdatingSavedDefinitionId] = useState<string | null>(null);
    const [showArchivedDefinitions, setShowArchivedDefinitions] = useState(false);
    // M4.3: a companion is a separately executable session referenced from the one that just
    // finished (SessionDefinition.companionSessions), never an embedded block -- those already
    // render inline within the same execution. Starting one creates its own execution; it may
    // just as well be skipped. `finishedTitle` is only for the prompt's header copy.
    const [companionPrompt, setCompanionPrompt] = useState<{
        finishedTitle: string;
        finishedAt: number;
        companions: NonNullable<SessionDefinition['companionSessions']>;
    } | null>(null);
    const [startingCompanionId, setStartingCompanionId] = useState<string | null>(null);
    const [companionError, setCompanionError] = useState<string | null>(null);
    // Ticks the companion prompt's "available in N minutes" copy toward eligibility -- only
    // runs while the prompt is open, so it costs nothing the rest of the runner's lifetime.
    // Re-synced to Date.now() the instant the prompt opens (not just on the first interval
    // tick) -- otherwise this would hold whatever stale value it had from mount/the previous
    // prompt (e.g. from ~40 minutes into a completed session) for up to 15 seconds, making an
    // immediately-eligible companion appear falsely gated.
    const [companionPromptNow, setCompanionPromptNow] = useState(() => Date.now());
    useEffect(() => {
        if (!companionPrompt) return;
        setCompanionPromptNow(Date.now());
        const interval = setInterval(() => setCompanionPromptNow(Date.now()), 15_000);
        return () => clearInterval(interval);
    }, [companionPrompt]);
    const [soundMuted, setSoundMuted] = useState<boolean>(() => !isSoundEnabled());
    const [showSwapModal, setShowSwapModal] = useState<boolean>(false);
    const [showSaveTemplateModal, setShowSaveTemplateModal] = useState<boolean>(false);
    const [customTemplateTitle, setCustomTemplateTitle] = useState<string>('');
    const [saveTemplateSuccess, setSaveTemplateSuccess] = useState<string | null>(null);
    const [saveTemplateError, setSaveTemplateError] = useState<string | null>(null);
    const [isSavingTemplate, setIsSavingTemplate] = useState<boolean>(false);
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

    const activeStep = runner.activeStep;
    const entries = runner.entries;

    // All logged entries for the active step, including recorded choice answers -- this is
    // the athlete-facing "Performed for this step" list/count below.
    const activeStepEntries = useMemo(() => {
        if (!activeStep) return [];
        return entries.filter(e => e.stepId === activeStep.id);
    }, [activeStep, entries]);

    // Choice answers carry no weight/reps/duration, so they must never be picked as the
    // "latest" set a suggestion is derived from.
    const activeStepWorkEntries = useMemo(
        () => activeStepEntries.filter(e => e.payload.kind !== 'choice'),
        [activeStepEntries],
    );

    const latestActiveEntry = activeStepWorkEntries.length > 0 ? activeStepWorkEntries[activeStepWorkEntries.length - 1] : null;

    const suggestedWeightKg = useMemo(() => {
        if (!activeStep) return undefined;
        if (latestActiveEntry?.payload.kind === 'repetition' && latestActiveEntry.payload.weightKg !== undefined) {
            return latestActiveEntry.payload.weightKg;
        }
        if (pastSummary?.weightKg !== null && pastSummary?.weightKg !== undefined) {
            return pastSummary.weightKg;
        }
        return undefined;
    }, [activeStep, latestActiveEntry, pastSummary]);

    const suggestedReps = useMemo(() => {
        if (!activeStep) return undefined;
        if (latestActiveEntry?.payload.kind === 'repetition') {
            return latestActiveEntry.payload.reps;
        }
        if (activeStep.dose?.kind === 'repetition') {
            return typeof activeStep.dose.reps === 'number' ? activeStep.dose.reps : activeStep.dose.reps.min;
        }
        return undefined;
    }, [activeStep, latestActiveEntry]);

    const suggestedLoadKg = useMemo(() => {
        if (!activeStep) return undefined;
        if (latestActiveEntry?.payload.kind === 'duration' && latestActiveEntry.payload.loadKg !== undefined) {
            return latestActiveEntry.payload.loadKg;
        }
        return undefined;
    }, [activeStep, latestActiveEntry]);

    const suggestedSeconds = useMemo(() => {
        if (!activeStep) return undefined;
        if (latestActiveEntry?.payload.kind === 'duration') {
            return latestActiveEntry.payload.seconds;
        }
        if (activeStep.dose?.kind === 'duration') {
            return typeof activeStep.dose.seconds === 'number' ? activeStep.dose.seconds : (typeof activeStep.dose.seconds === 'object' ? activeStep.dose.seconds.min : 30);
        }
        return undefined;
    }, [activeStep, latestActiveEntry]);

    useEffect(() => {
        onSessionStateChange?.(runner.execution);
    }, [onSessionStateChange, runner.execution]);

    useEffect(() => {
        initialLaunchAttempted.current = false;
    }, [initialSession?.binding.prescriptionHash]);

    const refreshSavedDefinitions = useCallback(async () => {
        try {
            const result = await sessionDefinitionService.listDefinitionHeaders(userId);
            if (result.status === 'AVAILABLE') {
                setSavedDefinitions(result.data);
                setSavedDefinitionsError(null);
            } else if (result.status === 'UNAVAILABLE') {
                setSavedDefinitionsError('Saved sessions are temporarily unavailable.');
            } else if (result.status === 'INVALID') {
                setSavedDefinitionsError('A saved session has invalid data and cannot be listed.');
            }
        } catch {
            setSavedDefinitionsError('Could not load saved sessions.');
        }
    }, [userId]);

    useEffect(() => { void refreshSavedDefinitions(); }, [refreshSavedDefinitions]);

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
        const archivedError = archivedSavedDefinitionError(header, 'This template');
        if (archivedError) {
            setSavedDefinitionsError(archivedError);
            return;
        }
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

    const previewSavedDefinition = async (header: SessionDefinitionHeader) => {
        setPreviewingSavedDefinitionId(header.definitionId);
        setSavedDefinitionsError(null);
        try {
            const result = await sessionDefinitionService.getDefinitionRevision(userId, header.definitionId, header.latestRevision);
            if (result.status !== 'AVAILABLE') {
                throw new Error(result.status === 'MISSING' ? 'The latest saved revision is missing.' : 'The saved session cannot be read safely.');
            }
            setPreviewDefinition({ definition: result.data, header });
        } catch (error) {
            setSavedDefinitionsError(error instanceof Error ? error.message : 'Could not preview the saved session.');
        } finally {
            setPreviewingSavedDefinitionId(null);
        }
    };

    const editSavedDefinition = async (header: SessionDefinitionHeader, duplicate: boolean) => {
        if (!onBuildSession) return;
        setEditingSavedDefinitionId(header.definitionId);
        setSavedDefinitionsError(null);
        try {
            const result = await sessionDefinitionService.getDefinitionRevision(userId, header.definitionId, header.latestRevision);
            if (result.status !== 'AVAILABLE') {
                throw new Error(result.status === 'MISSING' ? 'The latest saved revision is missing.' : 'The saved template cannot be read safely.');
            }
            onBuildSession(duplicate
                ? {
                    ...result.data,
                    id: `custom-session-${crypto.randomUUID()}`,
                    revision: 1,
                    title: `${result.data.title} copy`,
                }
                : { ...result.data, revision: result.data.revision + 1 });
        } catch (error) {
            setSavedDefinitionsError(error instanceof Error ? error.message : 'Could not open the saved template.');
        } finally {
            setEditingSavedDefinitionId(null);
        }
    };

    const setSavedDefinitionArchived = async (header: SessionDefinitionHeader, archived: boolean) => {
        setUpdatingSavedDefinitionId(header.definitionId);
        setSavedDefinitionsError(null);
        try {
            await sessionDefinitionService.setDefinitionArchived(userId, header.definitionId, archived);
            await refreshSavedDefinitions();
        } catch (error) {
            setSavedDefinitionsError(error instanceof Error ? error.message : 'Could not update the saved template.');
        } finally {
            setUpdatingSavedDefinitionId(null);
        }
    };

    /** Resolves a companion's `definitionRef` the same two ways the fixture/saved-session
     * pickers above already resolve a startable definition -- a known reviewed fixture
     * (covers the M0.2 corpus's recovery-spin companion) or one of the athlete's own saved
     * manual definitions -- and starts it as its own independent, no-selection-authority
     * execution (D-MAUTH `unplanned_log`), exactly like starting any other unplanned session. */
    const startCompanion = async (companion: NonNullable<SessionDefinition['companionSessions']>[number]) => {
        if (companionPrompt && !isCompanionEligibleNow(companion, companionPrompt.finishedAt, companionPromptNow)) {
            setCompanionError(`"${companion.definitionRef}" isn't available yet -- it opens ${companion.notEarlierThanMinutesAfter} minutes after the primary session finished.`);
            return;
        }
        setStartingCompanionId(companion.id);
        setCompanionError(null);
        try {
            const fixture = AVAILABLE_FIXTURES.find(candidate => candidate.id === companion.definitionRef);
            if (fixture) {
                await runner.startFixtureSession(fixture);
                setCompanionPrompt(null);
                return;
            }
            const header = savedDefinitions.find(candidate => candidate.definitionId === companion.definitionRef);
            if (header) {
                const archivedError = archivedSavedDefinitionError(header, `"${companion.definitionRef}"`);
                if (archivedError) throw new Error(archivedError);
                const result = await sessionDefinitionService.getDefinitionRevision(userId, header.definitionId, header.latestRevision);
                if (result.status !== 'AVAILABLE') throw new Error('The companion session cannot be read safely.');
                const launch = await prepareUnplannedSessionLaunch(userId, result.data);
                await runner.startSession(launch.definition, launch.binding.sessionSource, {
                    occurrenceId: launch.binding.occurrenceId,
                    prescriptionHash: launch.binding.prescriptionHash,
                });
                setCompanionPrompt(null);
                return;
            }
            throw new Error(`Could not find "${companion.definitionRef}" among reviewed fixtures or your saved sessions.`);
        } catch (error) {
            setCompanionError(error instanceof Error ? error.message : 'Could not start the companion session.');
        } finally {
            setStartingCompanionId(null);
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

    const definition = runner.definition;
    const activeBlock = runner.activeBlock;

    // ⚡ Bolt: Memoize AST comparison, choice lookups, step summaries, and group progress before early returns
    const comparison = useMemo(
        () => (definition ? comparePlannedVsPerformed(definition, entries) : null),
        [definition, entries],
    );

    const answeredChoiceIds = useMemo(
        () => new Set(
            entries
                .filter(e => e.payload.kind === 'choice')
                .map(e => (e.payload as { choiceId: string }).choiceId),
        ),
        [entries],
    );

    // The choice due at the active step is authored and not yet answered. Other step
    // controls stay blocked until it is resolved, so a prescribed step never changes
    // without a recorded athlete action (D-MCHOICE).
    const dueChoice = useMemo(
        () => activeStep && activeBlock
            ? (activeBlock.optionSets ?? []).find(choice => choice.appliesAtStepId === activeStep.id && !answeredChoiceIds.has(choice.id)) ?? null
            : null,
        [activeStep, activeBlock, answeredChoiceIds],
    );

    const stepSummaries: SessionStepSummary[] = useMemo(
        () => (comparison
            ? comparison.stepComparisons.map((sc, idx) => ({
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
            }))
            : []),
        [comparison],
    );

    const stepCompletedCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const e of entries) {
            if (e.stepId && e.payload.kind !== 'choice') {
                counts.set(e.stepId, (counts.get(e.stepId) ?? 0) + 1);
            }
        }
        return counts;
    }, [entries]);

    // The rest banner previews the next step, including rotation within circuits and
    // supersets, instead of naming the set that was just logged.
    const restNextStep = useMemo(() => {
        if (!definition || !activeBlock) return null;
        const groupProgress = getGroupProgress(activeBlock, entries, runner.activeStepIndex);
        if (groupProgress) {
            return groupProgress.nextStepIndex !== null ? activeBlock.steps[groupProgress.nextStepIndex] : null;
        }
        if (runner.activeStepIndex + 1 < activeBlock.steps.length) {
            return activeBlock.steps[runner.activeStepIndex + 1];
        }
        const nextBlock = definition.blocks.find(
            (candidate, index) => index > runner.activeBlockIndex && candidate.steps.length > 0,
        );
        return nextBlock ? nextBlock.steps[0] : null;
    }, [definition, activeBlock, entries, runner.activeStepIndex, runner.activeBlockIndex]);

    // If no active session, show fixture picker to start an unplanned session
    if (runner.isRestoring) {
        return <div className="session-runner-container no-active"><p>Restoring an active session…</p></div>;
    }

    if (!definition || !comparison || !runner.execution || runner.execution.state !== 'in_progress') {
        // M4.3: offered once, right after the primary session finishes (completed or
        // abandoned) -- never concurrently with it. Starting a companion creates its own
        // execution and takes over this same "active session" view normally; skipping just
        // dismisses the prompt. Takes priority over the ordinary picker below.
        if (companionPrompt) {
            return (
                <div className="session-runner-container no-active">
                    <header className="session-runner-header">
                        <h2>Companion session available</h2>
                        <p className="session-runner-subtitle">
                            {companionPrompt.finishedTitle} lists {companionPrompt.companions.length === 1 ? 'a' : companionPrompt.companions.length}
                            {' '}separately executable companion{companionPrompt.companions.length === 1 ? '' : 's'}. Start now or later — skipping records nothing.
                        </p>
                    </header>
                    {companionError && <p className="session-runner-error" role="alert">{companionError}</p>}
                    <div className="fixture-grid">
                        {companionPrompt.companions.map(companion => {
                            const eligible = isCompanionEligibleNow(companion, companionPrompt.finishedAt, companionPromptNow);
                            const minutesRemaining = eligible ? 0 : Math.ceil((companionPrompt.finishedAt + (companion.notEarlierThanMinutesAfter ?? 0) * 60_000 - companionPromptNow) / 60_000);
                            return (
                                <div key={companion.id} className="fixture-card">
                                    <div className="fixture-info">
                                        <span className="fixture-intent-badge">{companion.relation.replaceAll('_', ' ')}{companion.optional ? ' · optional' : ''}</span>
                                        <h3 className="fixture-title">{companion.definitionRef}</h3>
                                        {companion.note && <p className="fixture-summary">{companion.note}</p>}
                                        {!eligible && <p className="fixture-summary">Available in {minutesRemaining} minute{minutesRemaining === 1 ? '' : 's'}.</p>}
                                    </div>
                                    <button
                                        type="button"
                                        className="start-fixture-btn"
                                        disabled={startingCompanionId !== null || !eligible}
                                        onClick={() => startCompanion(companion)}
                                    >
                                        {startingCompanionId === companion.id ? 'Starting…' : eligible ? 'Start companion →' : 'Not yet available'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <div className="session-authoring-actions">
                        <button type="button" className="start-fixture-btn secondary-authoring-btn" onClick={() => { setCompanionPrompt(null); onClose?.(); }}>
                            Not now
                        </button>
                    </div>
                </div>
            );
        }
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
                {previewDefinition ? (
                    <section className="session-definition-preview-screen" aria-labelledby="session-definition-preview-title">
                        <button type="button" className="preview-back-button" onClick={() => setPreviewDefinition(null)}>
                            ← All structured sessions
                        </button>
                        <h2 id="session-definition-preview-title" className="sr-only">Session preview</h2>
                        <SessionDefinitionPreview
                            definition={previewDefinition.definition}
                            onStart={() => {
                                if (previewDefinition.header) {
                                    void startSavedDefinition(previewDefinition.header);
                                } else {
                                    void runner.startFixtureSession(previewDefinition.definition);
                                }
                            }}
                        />
                    </section>
                ) : <>
                <header className="session-runner-header">
                    <h2>🚀 Start a Structured Session</h2>
                    <p className="session-runner-subtitle">Start a reviewed session, or make one that is stored and validated before execution.</p>
                    {(onImportSession || onBuildSession) && <div className="session-authoring-actions">
                        {onImportSession && <button type="button" className="start-fixture-btn" onClick={onImportSession}>Import session JSON</button>}
                        {onBuildSession && <button type="button" className="start-fixture-btn secondary-authoring-btn" onClick={() => onBuildSession()}>Build session</button>}
                    </div>}
                </header>
                {savedDefinitionsError && <p className="session-runner-error" role="alert">{savedDefinitionsError}</p>}
                {savedDefinitions.some(header => header.status === 'active') && <section className="saved-session-library" aria-labelledby="saved-session-library-title">
                    <h3 id="saved-session-library-title">Your custom templates</h3>
                    <div className="fixture-grid">
                        {savedDefinitions.filter(header => header.status === 'active').map(header => <div key={header.definitionId} className="fixture-card">
                            <div className="fixture-info">
                                <span className="fixture-intent-badge">custom · rev {header.latestRevision}</span>
                                <h3 className="fixture-title">{header.title}</h3>
                                {header.dominantModality && <p className="fixture-summary">{header.dominantModality}</p>}
                            </div>
                            <div className="fixture-card-actions">
                                <button
                                    type="button"
                                    className="preview-fixture-btn"
                                    disabled={previewingSavedDefinitionId !== null}
                                    onClick={() => { void previewSavedDefinition(header); }}
                                >
                                    {previewingSavedDefinitionId === header.definitionId ? 'Loading…' : 'Preview'}
                                </button>
                                <button type="button" className="start-fixture-btn" disabled={startingSavedDefinitionId !== null} onClick={() => { void startSavedDefinition(header); }}>
                                    {startingSavedDefinitionId === header.definitionId ? 'Starting…' : 'Start session'}
                                </button>
                                {onBuildSession && <button type="button" className="preview-fixture-btn" disabled={editingSavedDefinitionId !== null} onClick={() => { void editSavedDefinition(header, false); }}>
                                    {editingSavedDefinitionId === header.definitionId ? 'Loading…' : 'Edit'}
                                </button>}
                                {onBuildSession && <button type="button" className="preview-fixture-btn" disabled={editingSavedDefinitionId !== null} onClick={() => { void editSavedDefinition(header, true); }}>
                                    Duplicate
                                </button>}
                                <button type="button" className="preview-fixture-btn" disabled={updatingSavedDefinitionId !== null} onClick={() => { void setSavedDefinitionArchived(header, true); }}>
                                    {updatingSavedDefinitionId === header.definitionId ? 'Updating…' : 'Archive'}
                                </button>
                            </div>
                        </div>)}
                    </div>
                </section>}
                {savedDefinitions.some(header => header.status === 'archived') && <section className="saved-session-library" aria-labelledby="archived-session-library-title">
                    <button type="button" className="preview-back-button" onClick={() => setShowArchivedDefinitions(current => !current)}>
                        {showArchivedDefinitions ? 'Hide archived templates' : `Show archived templates (${savedDefinitions.filter(header => header.status === 'archived').length})`}
                    </button>
                    {showArchivedDefinitions && <div className="fixture-grid">
                        {savedDefinitions.filter(header => header.status === 'archived').map(header => <div key={header.definitionId} className="fixture-card">
                            <div className="fixture-info">
                                <span className="fixture-intent-badge">archived · rev {header.latestRevision}</span>
                                <h3 className="fixture-title">{header.title}</h3>
                            </div>
                            <div className="fixture-card-actions">
                                <button type="button" className="preview-fixture-btn" disabled={previewingSavedDefinitionId !== null} onClick={() => { void previewSavedDefinition(header); }}>
                                    {previewingSavedDefinitionId === header.definitionId ? 'Loading…' : 'Preview'}
                                </button>
                                <button type="button" className="start-fixture-btn" disabled={updatingSavedDefinitionId !== null} onClick={() => { void setSavedDefinitionArchived(header, false); }}>
                                    {updatingSavedDefinitionId === header.definitionId ? 'Updating…' : 'Restore'}
                                </button>
                            </div>
                        </div>)}
                    </div>}
                </section>}
                <div className="fixture-grid">
                    {AVAILABLE_FIXTURES.map(fixture => (
                        <div key={fixture.id} className="fixture-card">
                            <div className="fixture-info">
                                <span className="fixture-intent-badge">{fixture.intent}</span>
                                <h3 className="fixture-title">{fixture.title}</h3>
                                <p className="fixture-summary">{fixture.summary || `${fixture.blocks.length} blocks`}</p>
                            </div>
                            <div className="fixture-card-actions">
                                <button type="button" className="preview-fixture-btn" onClick={() => setPreviewDefinition({ definition: fixture })}>
                                    Preview
                                </button>
                                <button
                                    type="button"
                                    className="start-fixture-btn"
                                    onClick={() => { void runner.startFixtureSession(fixture); }}
                                >
                                    Start Session →
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                </>}
            </div>
        );
    }

    const describeChoiceEntry = (entry: SessionEntry): string => {
        if (entry.payload.kind !== 'choice') return '';
        const { choiceId, optionId } = entry.payload;
        for (const block of definition.blocks) {
            const choice = block.optionSets?.find(c => c.id === choiceId);
            const option = choice?.options.find(o => o.id === optionId);
            if (option) return option.label;
        }
        return optionId;
    };

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

    const handleSaveCustomTemplate = async () => {
        if (!definition) return;
        setIsSavingTemplate(true);
        setSaveTemplateError(null);
        setSaveTemplateSuccess(null);
        try {
            const title = customTemplateTitle.trim() || `${definition.title} (Custom)`;
            await runner.saveAsNewTemplate(title);
            await refreshSavedDefinitions();
            setSaveTemplateSuccess(`Saved as template "${title}"!`);
            setTimeout(() => {
                setShowSaveTemplateModal(false);
                setSaveTemplateSuccess(null);
            }, 1600);
        } catch (error) {
            setSaveTemplateError(error instanceof Error ? error.message : 'Could not save custom template.');
        } finally {
            setIsSavingTemplate(false);
        }
    };

    // Shared by onComplete/onAbandon below: both run a runner transition, close the sheet on
    // success, offer a companion (or close the runner) exactly the same way, and surface the
    // same kind of retryable error on failure -- only the action and its error copy differ.
    const finishSession = async (action: () => Promise<void>, errorMessage: string) => {
        // Captured before the runner action clears runner.definition, so the companion prompt
        // (if any) still knows what just finished and what it separately unlocks.
        const finishedTitle = definition.title;
        const companions = definition.companionSessions;
        try {
            await action();
            setShowCompletionSheet(false);
            setShowAbandonConfirmation(false);
            setCompletionError(null);
            // A skipped/abandoned primary session still leaves an independently executable
            // companion (e.g. the recovery spin) worth offering -- it is never gated on the
            // primary's own completion.
            if (companions && companions.length > 0) {
                setCompanionPrompt({ finishedTitle, finishedAt: Date.now(), companions });
            } else if (onClose) {
                onClose();
            }
        } catch {
            setCompletionError(errorMessage);
        }
    };

    const inputProfile = activeStep ? resolveStepInputProfile(activeStep) : 'repetition_mass';
    const activeEffort = activeStep ? formatEffort(activeStep) : null;

    return (
        <div className="session-runner-container">
            {/* Top Bar */}
            <div className="session-top-bar">
                <div className="session-header-left">
                    <span className="intent-tag">{definition.intent}</span>
                    <h2 className="session-title-text">{definition.title}</h2>
                </div>
                <div className="session-header-right">
                    <button
                        type="button"
                        className="sound-toggle-btn"
                        onClick={() => {
                            const next = !soundMuted;
                            setSoundMuted(next);
                            setSoundEnabled(!next);
                        }}
                        title={soundMuted ? 'Sound muted (click to unmute)' : 'Sound enabled (click to mute)'}
                        aria-label={soundMuted ? 'Unmute sound' : 'Mute sound'}
                    >
                        {soundMuted ? '🔇' : '🔊'}
                    </button>
                    <button
                        type="button"
                        className="save-template-header-btn"
                        onClick={() => {
                            setCustomTemplateTitle(definition.title);
                            setShowSaveTemplateModal(true);
                        }}
                        title="Save adjusted workout as a new template"
                    >
                        💾 Save Template
                    </button>
                    <span className="session-timer">⏱️ {formatTime(runner.elapsedSeconds)}</span>
                    <span className={`sync-pill ${runner.syncStatus}`}>{runner.syncStatus}</span>
                </div>
            </div>

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
                                const stepCompletedSets = stepCompletedCounts.get(step.id) ?? 0;
                                // Shares the same target-set contract GroupProgress uses below, so a
                                // rotating group's block.rounds (not just the step's own dose.sets)
                                // is honored consistently between the two displays.
                                const targetSets = targetEntriesForGroupStep(block, step);
                                const isStepComplete = stepCompletedSets >= targetSets;
                                const isCurrent = runner.activeBlockIndex === bIdx && runner.activeStepIndex === sIdx;
                                return (
                                    <button
                                        key={step.id}
                                        type="button"
                                        className={`step-nav-pill ${isCurrent ? 'active' : ''} ${isStepComplete ? 'completed' : ''}`}
                                        onClick={() => runner.selectStep(bIdx, sIdx)}
                                    >
                                        {isStepComplete ? '✓ ' : (stepCompletedSets > 0 ? `(${stepCompletedSets}/${targetSets}) ` : '')}{stepName(step)}
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
                            <div className="step-kind-row">
                                <span className="step-kind-badge">{activeStep.kind}</span>
                                <button
                                    type="button"
                                    className="swap-step-btn"
                                    onClick={() => setShowSwapModal(true)}
                                    title="Swap or modify this exercise"
                                >
                                    🔄 Swap Exercise
                                </button>
                            </div>
                            <h3 className="step-name">
                                {stepName(activeStep)}
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
                                <span>Target: {activeStep.dose.sets} sets × {typeof activeStep.dose.reps === 'number' ? activeStep.dose.reps : `${activeStep.dose.reps.min}-${activeStep.dose.reps.max}`} reps{activeStep.laterality === 'per_side' ? ' (each side)' : ''}</span>
                            )}
                            {activeStep.dose?.kind === 'duration' && (
                                <span>Target: {activeStep.dose.sets ? `${activeStep.dose.sets} sets × ` : ''}{typeof activeStep.dose.seconds === 'number' ? activeStep.dose.seconds : `${activeStep.dose.seconds.min}-${activeStep.dose.seconds.max}`}s{activeStep.laterality === 'per_side' ? ' (each side)' : ''}</span>
                            )}
                            {activeStep.dose?.kind === 'distance' && (
                                <span>Target: {activeStep.dose.sets ? `${activeStep.dose.sets} sets × ` : ''}{typeof activeStep.dose.meters === 'number' ? `${activeStep.dose.meters}m` : (typeof activeStep.dose.metres === 'number' ? `${activeStep.dose.metres}m` : 'Distance')}{activeStep.laterality === 'per_side' ? ' (each side)' : ''}</span>
                            )}
                            {activeStep.laterality === 'per_side' && (
                                <span className="laterality-tag">Unilateral (Left &amp; Right)</span>
                            )}
                             {activeEffort && <span>Effort: {activeEffort}</span>}
                             {activeStep.load && <span>Load: {formatSessionLoad(activeStep.load)}</span>}
                             {activeStep.rest !== undefined && <span>Rest: {formatRange(activeStep.rest)} sec</span>}
                            {activeStep.tempo && <span>Tempo: {formatTempoBreakdown(activeStep.tempo)}</span>}
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
                            {/* A rest is advisory, not a lock. Keep the countdown and its controls
                             * alongside the active logging form until it reaches zero or is skipped. */}
                            {runner.isRestRunning && (
                                <div className="rest-timer-banner" role="status" aria-live="polite">
                                    <div className="rest-timer-info">
                                        <span>☕ Rest: <strong>{runner.restSecondsRemaining}s</strong></span>
                                        {restNextStep && (
                                            <span className="rest-next-preview">
                                                Next: {stepName(restNextStep)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="rest-timer-actions">
                                        <button type="button" className="rest-adjust-btn" onClick={() => runner.addRestSeconds(30)}>
                                            +30s
                                        </button>
                                        <button type="button" className="skip-rest-btn" onClick={runner.skipRestTimer}>
                                            Skip Rest
                                        </button>
                                    </div>
                                </div>
                            )}
                            {inputProfile === 'repetition_mass' || inputProfile === 'repetition_bodyweight' ? (
                                <RepetitionInputCard
                                    key={activeStep.id}
                                    step={activeStep}
                                    suggestedWeightKg={suggestedWeightKg}
                                    suggestedReps={suggestedReps}
                                    defaultIsWarmup={activeBlock?.role === 'warmup'}
                                    onSubmit={handleEntrySubmit}
                                />
                            ) : inputProfile === 'duration_hold' ? (
                                <DurationInputCard
                                    key={activeStep.id}
                                    step={activeStep}
                                    suggestedLoadKg={suggestedLoadKg}
                                    suggestedSeconds={suggestedSeconds}
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
                    onComplete={payload => finishSession(
                        () => runner.completeSession(payload),
                        'Could not save completion feedback. Your session is still open, so you can retry.',
                    )}
                    onAbandon={() => finishSession(
                        () => runner.abandonSession(),
                        'Could not abandon the session. It remains open, so you can retry.',
                    )}
                />
            )}

            {/* Exercise Swap Modal */}
            {showSwapModal && activeStep && (
                <ExerciseSwapModal
                    step={activeStep}
                    onSwap={(replacement) => {
                        runner.substituteStepExercise(runner.activeBlockIndex, runner.activeStepIndex, replacement);
                        setShowSwapModal(false);
                    }}
                    onClose={() => setShowSwapModal(false)}
                />
            )}

            {/* Save Custom Template Modal */}
            {showSaveTemplateModal && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="save-template-modal-title">
                    <div className="exercise-swap-modal save-template-modal">
                        <div className="swap-modal-header">
                            <h3 id="save-template-modal-title">Save as Custom Template</h3>
                            <button type="button" className="close-btn" onClick={() => setShowSaveTemplateModal(false)} aria-label="Close">✕</button>
                        </div>
                        <p className="swap-subtitle">
                            Save your adjusted workout (including any swapped exercises) so you can start it again anytime.
                        </p>
                        {saveTemplateError && <p className="session-runner-error" role="alert">{saveTemplateError}</p>}
                        {saveTemplateSuccess && <p className="save-template-success" role="status">✓ {saveTemplateSuccess}</p>}
                        <label className="swap-input-group">
                            <span className="swap-label">Template Title</span>
                            <input
                                type="text"
                                className="swap-input-box"
                                value={customTemplateTitle}
                                onChange={e => setCustomTemplateTitle(e.target.value)}
                                placeholder="e.g. Upper-Body Absorption (Single Dumbbell)"
                                autoFocus
                            />
                        </label>
                        <div className="swap-modal-actions">
                            <button type="button" className="cancel-swap-btn" onClick={() => setShowSaveTemplateModal(false)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="confirm-swap-btn"
                                disabled={isSavingTemplate || !customTemplateTitle.trim()}
                                onClick={handleSaveCustomTemplate}
                            >
                                {isSavingTemplate ? 'Saving…' : 'Save Template'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
