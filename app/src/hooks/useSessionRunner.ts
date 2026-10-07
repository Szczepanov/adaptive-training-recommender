import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
    SessionDefinition,
    SessionExecution,
    SessionEntry,
    SessionEntryPayload,
    SessionStep,
    SessionBlock,
    SessionSourceRef,
} from '../sessions/models';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { sessionOccurrenceService } from '../services/sessionOccurrenceService';
import { checkinService } from '../services/checkinService';
import { preferencesService } from '../services/preferencesService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { adaptNormalizedExecutionToStrengthSession } from '../sessions/legacyStrengthAdapter';
import { getLocalDateString } from '../utils/localDate';
import { sessionDefinitionService } from '../services/sessionDefinitionService';
import { playRestCompleteSound } from '../utils/audioFeedback';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { projectSessionProgress } from '../sessions/sessionProgressProjection';
import { overlayQueuedDiaryState } from '../sessions/sessionDiaryResume';
import { prepareFixtureSessionLaunch } from '../services/sessionAuthoringService';
import { convergeCompletedExecution } from '../services/sessionCompletionConvergence';
import { resolveEffectiveChoiceEntries, resolveEffectiveSession } from '../sessions/choiceResolution';
import { assertChoiceOptionBelongsToChoice } from '../sessions/choiceSelection';
import { resolvePostEntryRestSeconds } from '../sessions/restTiming';
import { completesPrescribedSet } from '../sessions/workSets';
import { adjustRest, closeRest, restSecondsRemainingAt, sessionElapsedSecondsAt, startRest } from '../sessions/restEventTiming';
import type { ActiveRestState, RestEventFields } from '../sessions/restEventTiming';
import type { RestEndReason } from '../sessions/models';
import { resolveEffectiveInjuryConstraints, resolveInjuryRestrictions } from '../engine/injuryPolicy';
import { ineligibleAlternativeOptionIds } from '../engine/sessionChoiceEligibility';
import { EXERCISES_BY_ID } from '../workouts/exercises.ts';
import type { BodyRegion, FitWorkoutFingerprintKind, RegionTissueResponse } from '../engine/models';
import type { SessionCompletionPayload } from '../components/session/SessionCompletionSheet';

/** Two `ExerciseRef`s identify the same performed exercise. Used to scope a step's
 * per-exercise `setIndex` so a mid-session swap (`substituteStepExercise`) starts the
 * replacement exercise's own set count at 1 instead of continuing the original's. */
function sameExerciseRef(a: SessionStep['exerciseRef'], b: SessionStep['exerciseRef']): boolean {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind) return false;
    return a.kind === 'catalog' && b.kind === 'catalog' ? a.exerciseId === b.exerciseId : a.kind === 'unresolved_free_text' && b.kind === 'unresolved_free_text' && a.name === b.name;
}

export interface UseSessionRunnerResult {
    /** The effective, choice-resolved view (ADR-0023 D-MCHOICE) -- see `resolveEffectiveSession`.
     * The persisted/replayed bytes are never mutated; this is a derived read. */
    definition: SessionDefinition | null;
    execution: SessionExecution | null;
    entries: SessionEntry[];
    activeBlock: SessionBlock | null;
    activeStep: SessionStep | null;
    activeBlockIndex: number;
    activeStepIndex: number;
    elapsedSeconds: number;
    restSecondsRemaining: number;
    isRestRunning: boolean;
    isRestoring: boolean;
    syncStatus: 'synced' | 'pending' | 'queued' | 'unavailable';
    resumeStatus: 'none' | 'ready' | 'degraded';
    resumeDegradedReason: string | null;
    canUndo: boolean;
    lastRemovedEntry: SessionEntry | null;
    /** True once a recorded choice ended the whole session (D-MCHOICE `end_session`). */
    sessionEnded: boolean;
    /** `SessionOption.id`s an athlete-observed choice must not offer as selectable right now. */
    ineligibleOptionIds: ReadonlySet<string>;

    startFixtureSession: (fixture: SessionDefinition) => Promise<void>;
    startSession: (definition: SessionDefinition, source: SessionSourceRef, options?: { occurrenceId?: string; prescriptionHash?: string; allowDuplicateCompleted?: boolean }) => Promise<void>;
    selectStep: (blockIndex: number, stepIndex: number) => void;
    nextStep: () => void;
    prevStep: () => void;
    logEntry: (payload: SessionEntryPayload, side?: 'left' | 'right' | 'bilateral', selectedOptionId?: string) => Promise<void>;
    /** Records an athlete's answer to an authored `SessionChoice` as its own execution event. */
    logChoice: (choiceId: string, optionId: string, reason?: string, supersedesChoiceEntryId?: string) => Promise<void>;
    editEntry: (entryId: string, updatedPayload: Partial<SessionEntryPayload>) => Promise<void>;
    removeEntry: (entryId: string) => Promise<void>;
    undo: () => Promise<void>;
    startRestTimer: (seconds: number) => void;
    skipRestTimer: () => void;
    addRestSeconds: (seconds: number) => void;
    substituteStepExercise: (blockIndex: number, stepIndex: number, replacement: {
        exerciseRef: SessionStep['exerciseRef'];
        title?: string;
        dose?: SessionStep['dose'];
        /** `undefined` leaves the step's current tempo/notes untouched; `null` explicitly clears it. */
        tempo?: string | null;
        rest?: SessionStep['rest'];
        notes?: string | null;
    }) => void;
    saveAsNewTemplate: (title: string, summary?: string) => Promise<string>;
    completeSession: (payload?: SessionCompletionPayload) => Promise<void>;
    abandonSession: (notes?: string) => Promise<void>;
}

/**
 * A reusable template starts from the raw working definition, not the choice-resolved view.
 * Exercise swaps intentionally change that raw definition; one-off athlete choices remain
 * execution evidence and must not be folded into a template that still offers those choices.
 */
export function createCustomTemplateDefinition(
    source: SessionDefinition,
    templateId: string,
    title: string,
    summary?: string,
): SessionDefinition {
    const movementComposition = source.movementComposition?.map(requirement => {
        const hasStructuredEvidence = requirement.stepIds.some(stepId => source.blocks
            .flatMap(block => block.steps)
            .some(step => step.id === stepId && step.compositionPatterns?.includes(requirement.pattern)));
        return !hasStructuredEvidence && requirement.status === 'required'
            ? { ...requirement, status: 'relaxed' as const, reason: 'Saved template no longer has structured evidence for this movement component.' }
            : requirement;
    });
    return {
        ...source,
        id: templateId,
        revision: 1,
        title: title.trim().length > 0 ? title.trim() : source.title,
        ...(summary !== undefined ? { summary } : {}),
        ...(movementComposition ? { movementComposition } : {}),
    };
}

export function useSessionRunner(userId: string, fixtures: readonly SessionDefinition[] = []): UseSessionRunnerResult {
    // Fixtures are launch inputs only. Resume never consults their current bytes.
    void fixtures;
    const [rawDefinition, setRawDefinition] = useState<SessionDefinition | null>(null);
    const [ineligibleOptionIds, setIneligibleOptionIds] = useState<ReadonlySet<string>>(new Set());
    const [execution, setExecution] = useState<SessionExecution | null>(null);
    const [entries, setEntries] = useState<SessionEntry[]>([]);
    const [activeBlockIndex, setActiveBlockIndex] = useState<number>(0);
    const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
    const [restSecondsRemaining, setRestSecondsRemaining] = useState<number>(0);
    const [isRestRunning, setIsRestRunning] = useState<boolean>(false);
    const [isRestoring, setIsRestoring] = useState<boolean>(true);
    const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'queued' | 'unavailable'>('synced');
    const [resumeStatus, setResumeStatus] = useState<'none' | 'ready' | 'degraded'>('none');
    const [resumeDegradedReason, setResumeDegradedReason] = useState<string | null>(null);
    const [lastRemovedEntry, setLastRemovedEntry] = useState<SessionEntry | null>(null);
    const diaryFailedRef = useRef(false);
    const refreshDiaryRef = useRef<(() => void) | null>(null);
    const diaryWriteOptions = useMemo(() => ({
        acknowledgeLocally: true,
        onLocallyAccepted: () => { refreshDiaryRef.current?.(); },
        onAcknowledged: () => { refreshDiaryRef.current?.(); },
        onFailed: () => {
            diaryFailedRef.current = true;
            setSyncStatus('unavailable');
        },
    }), []);

    useEffect(() => {
        if (!execution) return;
        let latestEntries: SessionEntry[] | null = null;
        const refresh = () => {
            if (!latestEntries) return;
            try {
                const diary = overlayQueuedDiaryState(latestEntries, null, sessionExecutionService.getDiaryReceipts(userId, execution.executionId));
                setEntries(diary.entries);
                setLastRemovedEntry(diary.lastDeletedEntry);
                if (diary.status === 'degraded') {
                    setResumeStatus('degraded');
                    setResumeDegradedReason(diary.reason);
                    setSyncStatus('unavailable');
                    return;
                }
                if (rawDefinition && resumeDegradedReason === 'queued-diary-causal-conflict') {
                    setResumeStatus('ready');
                    setResumeDegradedReason(null);
                }
                setSyncStatus(diaryFailedRef.current || diary.failedReceiptCount > 0
                    ? 'unavailable' : diary.queuedReceiptCount > 0 ? 'queued' : 'synced');
            } catch { setSyncStatus('unavailable'); }
        };
        refreshDiaryRef.current = refresh;
        const stopSync = sessionExecutionService.watchDiarySync(userId, execution.executionId, pending => {
            refresh();
            if (!latestEntries && !diaryFailedRef.current && resumeStatus !== 'degraded') setSyncStatus(pending ? 'queued' : 'synced');
        }, () => { diaryWriteOptions.onFailed(); refresh(); });
        const stopEntries = sessionExecutionService.watchEntries(userId, execution.executionId, (_entries, _deleted, all) => {
            latestEntries = all;
            refresh();
        }, diaryWriteOptions.onFailed);
        return () => { refreshDiaryRef.current = null; stopSync(); stopEntries(); };
    }, [userId, execution, diaryWriteOptions, resumeStatus, resumeDegradedReason, rawDefinition]);
    // A React state update is not synchronous. Keep this separate from `execution` so a
    // double-tap in the gap before the start write resolves cannot create two executions.
    // The H4 claim transaction remains the cross-tab authority for claimed intraday members;
    // this guard protects the ordinary runner's local launch affordances too.
    const startInFlightRef = useRef(false);
    const terminalInFlightRef = useRef<Promise<void> | null>(null);

    // PR 3 (training-occurrence plan): the currently-running rest's durable start state,
    // if any. A ref (not state) because closing it must read the latest value
    // synchronously from inside the countdown interval/event handlers without waiting for
    // a re-render, and clearing it immediately on close is what makes closeActiveRest
    // idempotent against a duplicate/racing close call. Never reconstructed on
    // restore/reload (see the restore effect above) -- an in-flight rest is simply lost
    // across a reload rather than resumed or fabricated, satisfying "app
    // interruption/resume does not fabricate duration".
    const activeRestRef = useRef<ActiveRestState | null>(null);

    // Local-only manual countdown started via `startRestTimer` (no durable rest
    // event to attribute it to). Stored as a wall-clock deadline so a throttled
    // tab derives the same remainder a durable rest does. Null when no manual
    // countdown is armed; a durable `activeRestRef` rest always wins when both
    // are somehow set.
    const manualRestDeadlineRef = useRef<number | null>(null);

    /** Closes the active rest (if any) into a durable event and persists it with a
     * deterministic id derived from the rest's own identity (afterEntryId + startedAt),
     * so a retried write overwrites the same document rather than duplicating it. Returns
     * the write promise so `completeSession`/`abandonSession` can await it -- a
     * session-ending rest event must land before the execution's own state transition
     * (see firestore.rules' restEvents `in_progress` gate). Other call sites intentionally
     * fire-and-forget since they have no such ordering requirement.
     *
     * `activeRestRef` is cleared synchronously to prevent duplicate closes. The SDK's
     * persistent queue retains the closed record across disconnect/reload and retries
     * its same identity. Terminal transitions retain the server-acknowledged ordering. */
    const closeActiveRest = useCallback((endReason: RestEndReason): Promise<void> | undefined => {
        const active = activeRestRef.current;
        if (!active || !execution) return undefined;
        activeRestRef.current = null;
        // `Date.now()`-based so the persisted end instant agrees with the same
        // wall clock the live remainder is derived from (identical to `new
        // Date()` in production; consistent under a `Date.now` mock in tests).
        const endedAt = new Date(Date.now()).toISOString();
        const fields: RestEventFields = closeRest(active, endedAt, endReason);
        const restEventId = `rest-${Date.parse(fields.startedAt)}-${fields.afterEntryId}`;
        const now = new Date(Date.now()).toISOString();
        const restEvent = {
            id: restEventId,
            executionId: execution.executionId,
            ...fields,
            createdAt: now,
            updatedAt: now,
        };
        return sessionExecutionService.logRestEvent(userId, execution.executionId, restEvent,
            endReason === 'session_ended' ? { onFailed: diaryWriteOptions.onFailed } : diaryWriteOptions);
    }, [execution, userId, diaryWriteOptions]);

    // Reloading never replays current source bytes. The persisted prescription and
    // local accepted diary queue are the only authorities. An in-flight rest is deliberately
    // cleared before any restore work and is never reconstructed.
    useEffect(() => {
        let cancelled = false;
        activeRestRef.current = null;
        manualRestDeadlineRef.current = null;
        setRestSecondsRemaining(0);
        setIsRestRunning(false);
        setResumeStatus('none');
        setResumeDegradedReason(null);

        sessionExecutionService.findInProgressExecution(userId)
            .then(async existing => {
                if (!existing) return;
                const diary = await sessionExecutionService.getResumeDiaryState(userId, existing.executionId);
                if (cancelled) return;
                setExecution(existing);
                setEntries(diary.entries);
                setLastRemovedEntry(diary.lastDeletedEntry);
                setElapsedSeconds(sessionElapsedSecondsAt(existing.startedAt, Date.now()));

                if (diary.status === 'degraded') {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason(diary.reason);
                    setSyncStatus('unavailable');
                    return;
                }
                if (!existing.prescriptionHash) {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason('missing-prescription-hash');
                    setSyncStatus('unavailable');
                    return;
                }
                const resolved = await resolveSessionDefinition(userId, existing.sessionSource, existing.prescriptionHash);
                if (cancelled) return;
                if (resolved.status !== 'AVAILABLE') {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason(`prescription-${resolved.status.toLowerCase()}`);
                    setSyncStatus('unavailable');
                    return;
                }
                const cursor = projectSessionProgress(resolved.data, diary.entries);
                setRawDefinition(resolved.data);
                setActiveBlockIndex(cursor.blockIndex);
                setActiveStepIndex(cursor.stepIndex);
                setResumeStatus('ready');
                setResumeDegradedReason(null);
                setSyncStatus(diary.failedReceiptCount > 0
                    ? 'unavailable'
                    : diary.queuedReceiptCount > 0 ? 'queued' : 'synced');
            })
            .catch(() => {
                if (!cancelled) {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason('resume-read-unavailable');
                    setSyncStatus('unavailable');
                }
            })
            .finally(() => {
                if (!cancelled) setIsRestoring(false);
            });
        return () => { cancelled = true; };
    }, [userId]);

    useEffect(() => {
        let active = true;
        let recovering = false;
        const recover = async () => {
            if (recovering) return;
            recovering = true;
            try {
                const terminal = await sessionExecutionService.getTerminalExecutions(userId);
                for (const completed of terminal) {
                    if (!active) break;
                    if (completed.state === 'completed') await convergeCompletedExecution(userId, completed);
                    else if (completed.occurrenceId) await sessionOccurrenceService.transitionOccurrenceState(
                        userId, completed.occurrenceId, 'abandoned', completed.updatedAt,
                    ).catch(error => console.warn('[useSessionRunner] Abandon recovery failed:', error));
                }
            } catch (error) {
                console.warn('[useSessionRunner] Terminal recovery unavailable:', error);
            } finally { recovering = false; }
        };
        void recover();
        window.addEventListener('online', recover);
        return () => { active = false; window.removeEventListener('online', recover); };
    }, [userId]);

    // Wall-clock timers: the interval is only a repaint trigger. Both the session
    // elapsed display and the rest countdown are re-derived from timestamps on
    // every tick, so a backgrounded/throttled tab that missed callbacks shows
    // the correct value on its next repaint instead of a callback count that
    // drifted low. A rest whose deadline passed while backgrounded completes
    // exactly once: `closeActiveRest` clears `activeRestRef` synchronously, so
    // a second tick in the same quiescence window finds no active rest.
    const resyncWallClockTimers = useCallback(() => {
        if (!execution || execution.state !== 'in_progress') return;
        const nowMs = Date.now();
        setElapsedSeconds(sessionElapsedSecondsAt(execution.startedAt, nowMs));
        const active = activeRestRef.current;
        if (active) {
            const remaining = restSecondsRemainingAt(active, nowMs);
            setRestSecondsRemaining(remaining);
            if (remaining <= 0) {
                manualRestDeadlineRef.current = null;
                setIsRestRunning(false);
                playRestCompleteSound();
                closeActiveRest('timer_elapsed')?.catch(err => console.warn('[useSessionRunner] Failed to persist rest event:', err));
            }
            return;
        }
        const manualDeadline = manualRestDeadlineRef.current;
        if (manualDeadline !== null) {
            const remaining = Number.isFinite(manualDeadline)
                ? Math.max(0, Math.ceil((manualDeadline - nowMs) / 1000))
                : 0;
            setRestSecondsRemaining(remaining);
            if (remaining <= 0) {
                manualRestDeadlineRef.current = null;
                setIsRestRunning(false);
                playRestCompleteSound();
            }
        }
    }, [execution, closeActiveRest]);

    // Repaint trigger while a session is in progress.
    useEffect(() => {
        if (!execution || execution.state !== 'in_progress') return;
        resyncWallClockTimers();
        const interval = setInterval(resyncWallClockTimers, 1000);
        return () => {
            clearInterval(interval);
        };
    }, [execution, resyncWallClockTimers]);

    // A throttled tab may not fire the interval at all while hidden; resync
    // immediately on visibility/focus return instead of waiting for the next tick.
    useEffect(() => {
        if (!execution || execution.state !== 'in_progress') return undefined;
        document.addEventListener('visibilitychange', resyncWallClockTimers);
        window.addEventListener('focus', resyncWallClockTimers);
        return () => {
            document.removeEventListener('visibilitychange', resyncWallClockTimers);
            window.removeEventListener('focus', resyncWallClockTimers);
        };
    }, [execution, resyncWallClockTimers]);

    // The athlete-facing effective view: recorded choices folded onto the raw, immutable
    // definition. `resolveEffectiveSession` always resolves actions from `rawDefinition`
    // itself, never from a prior derived result, so this is safe to recompute on every
    // entries change. See `sessions/choiceResolution.ts`.
    const effectiveView = useMemo(
        () => (rawDefinition ? resolveEffectiveSession(rawDefinition, entries) : null),
        [rawDefinition, entries],
    );
    const definition = effectiveView?.definition ?? null;
    const sessionEnded = effectiveView?.sessionEnded ?? false;

    // Alternative eligibility only depends on the day's resolved constraints and the
    // (raw) definition's authored alternatives, not on entries -- recomputed once per
    // session start/restore rather than on every logged entry.
    useEffect(() => {
        let cancelled = false;
        // No sync setState here: with no definition there is no active step, so nothing
        // ever reads a stale `ineligibleOptionIds` before the next session start
        // recomputes it fresh below.
        if (!rawDefinition) return undefined;
        const today = getLocalDateString();
        Promise.all([
            trainingSettingsService.getTrainingSettings(userId),
            checkinService.getCheckin(userId, today),
        ]).then(([settings, todaysCheckin]) => {
            if (cancelled) return;
            const effectiveInjuries = resolveEffectiveInjuryConstraints(settings.injuries, todaysCheckin?.tissueResponses, today);
            const { restrictedModalities } = resolveInjuryRestrictions(effectiveInjuries, today);
            setIneligibleOptionIds(ineligibleAlternativeOptionIds(rawDefinition, restrictedModalities));
        }).catch(() => {
            // Fail closed on the display side, not on the write path: if constraints can't
            // be read, no alternative is flagged eligible or ineligible either way -- the
            // athlete still sees every authored option, same as before this feature existed.
            if (!cancelled) setIneligibleOptionIds(new Set());
        });
        return () => {
            cancelled = true;
        };
    }, [rawDefinition, userId]);

    const activeBlock = definition?.blocks[activeBlockIndex] ?? null;
    const activeStep = activeBlock?.steps[activeStepIndex] ?? null;

    const startSession = useCallback(async (
        nextDefinition: SessionDefinition,
        source: SessionSourceRef,
        options: {
            occurrenceId?: string;
            prescriptionHash?: string;
            allowDuplicateCompleted?: boolean;
            fitWorkoutFingerprint?: string;
            fitWorkoutFingerprintKind?: FitWorkoutFingerprintKind;
        } = {},
    ) => {
        if (isRestoring || resumeStatus === 'degraded' || execution?.state === 'in_progress' || startInFlightRef.current) return;
        if (!options.prescriptionHash) throw new Error('A pinned prescription is required to start a session.');
        startInFlightRef.current = true;
        activeRestRef.current = null;
        manualRestDeadlineRef.current = null;
        setRawDefinition(nextDefinition);
        setActiveBlockIndex(0);
        setActiveStepIndex(0);
        setEntries([]);
        setElapsedSeconds(0);
        setLastRemovedEntry(null);
        setSyncStatus('pending');

        let fitWorkoutFingerprint = options.fitWorkoutFingerprint;
        let fitWorkoutFingerprintKind = options.fitWorkoutFingerprintKind;
        if (!fitWorkoutFingerprint || !fitWorkoutFingerprintKind) {
            // Semantic workout identity is only trustworthy when it comes from the exact
            // canonical payload used for Garmin export. SessionDefinition is an executable
            // adapter and can intentionally omit display/export-only targets, so deriving a
            // hard-match fingerprint here could create a false mismatch.
            fitWorkoutFingerprint = undefined;
            fitWorkoutFingerprintKind = undefined;
        }

        const executionId = `exec-${Date.now()}`;
        const today = getLocalDateString();
        try {
            const exec = await sessionExecutionService.startExecution(userId, executionId, {
                sessionSource: source,
                ...(options.occurrenceId ? { occurrenceId: options.occurrenceId } : {}),
                ...(options.prescriptionHash ? { prescriptionHash: options.prescriptionHash } : {}),
                ...(fitWorkoutFingerprint ? { fitWorkoutFingerprint } : {}),
                ...(fitWorkoutFingerprintKind ? { fitWorkoutFingerprintKind } : {}),
                date: today,
                ...(options.allowDuplicateCompleted ? { allowDuplicateCompleted: true } : {}),
            });
            setExecution(exec);
            diaryFailedRef.current = false;
            setResumeStatus('ready');
            setResumeDegradedReason(null);
            setSyncStatus('synced');
            if (exec.executionId !== executionId) {
                const diary = await sessionExecutionService.getResumeDiaryState(userId, exec.executionId);
                setEntries(diary.entries);
                setLastRemovedEntry(diary.lastDeletedEntry);
                setElapsedSeconds(sessionElapsedSecondsAt(exec.startedAt, Date.now()));
                const resolved = exec.prescriptionHash
                    ? await resolveSessionDefinition(userId, exec.sessionSource, exec.prescriptionHash) : null;
                if (diary.status === 'degraded' || resolved?.status !== 'AVAILABLE') {
                    setRawDefinition(null);
                    setResumeStatus('degraded');
                    setResumeDegradedReason(diary.status === 'degraded' ? diary.reason : 'prescription-unavailable');
                    setSyncStatus('unavailable');
                    return;
                }
                setRawDefinition(resolved.data);
                const cursor = projectSessionProgress(resolved.data, diary.entries);
                setActiveBlockIndex(cursor.blockIndex);
                setActiveStepIndex(cursor.stepIndex);
                setSyncStatus(diary.failedReceiptCount > 0 ? 'unavailable' : diary.queuedReceiptCount > 0 ? 'queued' : 'synced');
            }
        } catch (error) {
            setRawDefinition(null);
            setSyncStatus('unavailable');
            throw error;
        } finally {
            startInFlightRef.current = false;
        }
    }, [execution?.state, isRestoring, resumeStatus, userId]);

    const startFixtureSession = useCallback(async (fixture: SessionDefinition) => {
        const prepared = await prepareFixtureSessionLaunch(userId, fixture);
        await startSession(prepared.definition, prepared.binding.sessionSource, {
            prescriptionHash: prepared.binding.prescriptionHash,
        });
    }, [startSession, userId]);

    const selectStep = useCallback((blockIndex: number, stepIndex: number) => {
        if (!definition) return;
        if (blockIndex >= 0 && blockIndex < definition.blocks.length) {
            const block = definition.blocks[blockIndex];
            if (stepIndex >= 0 && stepIndex < block.steps.length) {
                setActiveBlockIndex(blockIndex);
                setActiveStepIndex(stepIndex);
            }
        }
    }, [definition]);

    const nextStep = useCallback(() => {
        if (!definition || !activeBlock) return;
        // A choice-driven end_block (D-MCHOICE) skips the block's remaining -- now
        // optional, per resolveEffectiveSession -- steps rather than stepping through
        // them one at a time.
        const blockEnded = effectiveView?.endedBlockIds.has(activeBlock.id) ?? false;
        if (!blockEnded && activeStepIndex + 1 < activeBlock.steps.length) {
            setActiveStepIndex(activeStepIndex + 1);
        } else if (activeBlockIndex + 1 < definition.blocks.length) {
            setActiveBlockIndex(activeBlockIndex + 1);
            setActiveStepIndex(0);
        }
    }, [definition, activeBlock, activeBlockIndex, activeStepIndex, effectiveView]);

    const prevStep = useCallback(() => {
        if (!definition) return;
        if (activeStepIndex > 0) {
            setActiveStepIndex(activeStepIndex - 1);
        } else if (activeBlockIndex > 0) {
            const prevBlock = definition.blocks[activeBlockIndex - 1];
            setActiveBlockIndex(activeBlockIndex - 1);
            setActiveStepIndex(Math.max(0, prevBlock.steps.length - 1));
        }
    }, [definition, activeBlockIndex, activeStepIndex]);

    const logEntry = useCallback(async (
        payload: SessionEntryPayload,
        side?: 'left' | 'right' | 'bilateral',
        selectedOptionId?: string,
    ) => {
        if (!execution || execution.state !== 'in_progress' || !activeStep) return;
        if (payload.kind === 'choice') throw new Error('Choice entries must be recorded through logChoice.');
        const governingChoice = resolveEffectiveChoiceEntries(entries)
            .filter(entry => rawDefinition?.blocks.some(block => {
                const choice = block.optionSets?.find(candidate => candidate.id === entry.payload.choiceId);
                if (!choice) return false;
                if (choice.appliesAtStepId === activeStep.id) return true;
                const option = choice.options.find(candidate => candidate.id === entry.payload.optionId);
                return option?.actions.some(action => 'targetStepId' in action && action.targetStepId === activeStep.id) ?? false;
            }))
            .at(-1);
        const entryId = `entry-${Date.now()}-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const entry: SessionEntry = {
            id: entryId,
            executionId: execution.executionId,
            stepId: activeStep.id,
            exerciseRef: activeStep.exerciseRef,
            ...(activeStep.compositionPatterns ? { compositionPatterns: activeStep.compositionPatterns } : {}),
            ...(activeStep.degradedComposition ? { degradedComposition: activeStep.degradedComposition } : {}),
            ...(side ? { side } : {}),
            ...(governingChoice
                ? { governingChoiceEntryId: governingChoice.id, selectedOptionId: governingChoice.payload.optionId }
                : selectedOptionId ? { selectedOptionId } : {}),
            completedAt: now,
            createdAt: now,
            updatedAt: now,
            payload: payload.kind === 'repetition'
                ? {
                    ...payload,
                    // Scoped to the step's *current* exercise, not just its stepId -- a mid-session
                    // swap (substituteStepExercise) must not inherit the replaced exercise's set count.
                    setIndex: entries.filter(entry => entry.stepId === activeStep.id && entry.payload.kind === 'repetition' && sameExerciseRef(entry.exerciseRef, activeStep.exerciseRef)).length + 1,
                }
                : payload,
        };

        setEntries(prev => [...prev, entry]);
        setSyncStatus('pending');

        // Rest belongs to the performed set, not to persistence completion. Start it at the same
        // optimistic boundary as the entry so a slow write can never resurrect a timer the athlete
        // already skipped or adjusted while the write was in flight. Structured warm-up steps do
        // not inherit the generic fallback when their author intentionally omitted rest.
        // A still-running previous rest means this set started before its timer completed --
        // close that prior rest as next_set_started (real elapsed time, not the prescribed
        // duration) before starting the new one.
        closeActiveRest('next_set_started')?.catch(err => console.warn('[useSessionRunner] Failed to persist rest event:', err));
        const restSec = completesPrescribedSet(activeStep, entries, entry)
            ? resolvePostEntryRestSeconds(activeStep, activeBlock?.role) : 0;
        if (restSec > 0) {
            manualRestDeadlineRef.current = null;
            setRestSecondsRemaining(restSec);
            setIsRestRunning(true);
            activeRestRef.current = startRest(entryId, now, restSec);
        }

        try {
            await sessionExecutionService.logEntry(userId, execution.executionId, entry, diaryWriteOptions);
        } catch {
            setSyncStatus('unavailable');
            // The rest timer above starts optimistically (same rationale as the optimistic
            // setEntries call), tied to this entry's id. If the entry itself never
            // persisted, a later timer/skip/session-close must not go on to write a durable
            // rest event whose afterEntryId references an entry that doesn't exist.
            if (activeRestRef.current?.afterEntryId === entryId) {
                activeRestRef.current = null;
                setIsRestRunning(false);
            }
        }
    }, [execution, activeStep, activeBlock, rawDefinition, entries, userId, closeActiveRest, diaryWriteOptions]);

    const logChoice = useCallback(async (
        choiceId: string,
        optionId: string,
        reason?: string,
        supersedesChoiceEntryId?: string,
    ) => {
        if (!execution || execution.state !== 'in_progress' || !activeBlock) return;
        const choice = activeBlock.optionSets?.find(candidate => candidate.id === choiceId);
        if (!choice) return;
        assertChoiceOptionBelongsToChoice(choice, optionId);
        const effectiveChoice = resolveEffectiveChoiceEntries(entries)
            .find(entry => entry.payload.choiceId === choiceId);
        if (effectiveChoice && !supersedesChoiceEntryId) {
            throw new Error('A recorded choice can only be corrected by explicitly superseding its effective event.');
        }
        if (supersedesChoiceEntryId && effectiveChoice?.id !== supersedesChoiceEntryId) {
            throw new Error('A corrected choice must supersede the current effective event for the same authored choice.');
        }
        const entryId = `entry-${Date.now()}-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const entry: SessionEntry = {
            id: entryId,
            executionId: execution.executionId,
            stepId: choice.appliesAtStepId,
            selectedOptionId: optionId,
            ...(supersedesChoiceEntryId ? { supersedesChoiceEntryId } : {}),
            completedAt: now,
            createdAt: now,
            updatedAt: now,
            payload: { kind: 'choice', choiceId, optionId, ...(reason ? { reason } : {}) },
        };

        setEntries(prev => [...prev, entry]);
        setSyncStatus('pending');

        try {
            await sessionExecutionService.logEntry(userId, execution.executionId, entry, diaryWriteOptions);
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, activeBlock, entries, userId, diaryWriteOptions]);

    const editEntry = useCallback(async (entryId: string, updatedPayload: Partial<SessionEntryPayload>) => {
        if (!execution || execution.state !== 'in_progress') return;
        const target = entries.find(e => e.id === entryId);
        if (!target) return;
        if (target.payload.kind === 'choice') throw new Error('Choice entries are append-only; record a corrected choice instead.');
        setEntries(prev => prev.map(e => (e.id === entryId ? { ...e, payload: { ...e.payload, ...updatedPayload } as SessionEntryPayload, updatedAt: new Date().toISOString() } : e)));
        try {
            await sessionExecutionService.correctEntry(userId, execution.executionId, entryId, {
                payload: { ...target.payload, ...updatedPayload } as SessionEntryPayload,
            }, diaryWriteOptions);
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, entries, userId, diaryWriteOptions]);

    const removeEntry = useCallback(async (entryId: string) => {
        if (!execution || execution.state !== 'in_progress') return;
        const target = entries.find(e => e.id === entryId);
        if (!target) return;
        if (target.payload.kind === 'choice') throw new Error('Choice entries are append-only; record a corrected choice instead.');
        setLastRemovedEntry(target);
        setEntries(prev => prev.filter(e => e.id !== entryId));
        try {
            await sessionExecutionService.deleteEntry(userId, execution.executionId, entryId, diaryWriteOptions);
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, entries, userId, diaryWriteOptions]);

    const undo = useCallback(async () => {
        if (!execution || execution.state !== 'in_progress' || !lastRemovedEntry) return;
        const toRestore = lastRemovedEntry;
        setLastRemovedEntry(null);
        if (toRestore.payload.kind === 'choice') throw new Error('Choice entries are append-only and cannot be restored as a correction.');
        setEntries(prev => [...prev, { ...toRestore, deletedAt: null }]);
        try {
            await sessionExecutionService.restoreEntry(userId, execution.executionId, toRestore.id, diaryWriteOptions);
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, lastRemovedEntry, userId, diaryWriteOptions]);

    // Not currently wired into any UI (no `afterEntryId` context to attribute a durable
    // rest event to) -- left as local-only countdown state, matching its existing
    // behavior, rather than fabricating a rest-event association it has no evidence for.
    const startRestTimer = useCallback((seconds: number) => {
        const total = Math.max(1, Math.round(seconds));
        manualRestDeadlineRef.current = Date.now() + total * 1000;
        setRestSecondsRemaining(total);
        setIsRestRunning(true);
    }, []);

    const skipRestTimer = useCallback(() => {
        manualRestDeadlineRef.current = null;
        setRestSecondsRemaining(0);
        setIsRestRunning(false);
        closeActiveRest('skipped')?.catch(err => console.warn('[useSessionRunner] Failed to persist rest event:', err));
    }, [closeActiveRest]);

    const addRestSeconds = useCallback((seconds: number) => {
        const active = activeRestRef.current;
        if (active) {
            const next = adjustRest(active, seconds);
            activeRestRef.current = next;
            // The deadline moved deterministically: repaint the derived remainder
            // now rather than waiting for the next one-second tick.
            setRestSecondsRemaining(restSecondsRemainingAt(next, Date.now()));
            return;
        }
        const manualDeadline = manualRestDeadlineRef.current;
        if (manualDeadline !== null) {
            const nextDeadline = manualDeadline + seconds * 1000;
            manualRestDeadlineRef.current = nextDeadline;
            const nowMs = Date.now();
            setRestSecondsRemaining(Number.isFinite(nextDeadline)
                ? Math.max(0, Math.ceil((nextDeadline - nowMs) / 1000))
                : 0);
            return;
        }
        setRestSecondsRemaining(prev => Math.max(0, prev + seconds));
    }, []);

    const substituteStepExercise = useCallback((
        blockIndex: number,
        stepIndex: number,
        replacement: {
            exerciseRef: SessionStep['exerciseRef'];
            title?: string;
            dose?: SessionStep['dose'];
            /** `undefined` leaves the step's current tempo/notes untouched; `null` explicitly clears it. */
            tempo?: string | null;
            rest?: SessionStep['rest'];
            notes?: string | null;
            compositionPatterns?: SessionStep['compositionPatterns'];
        },
    ) => {
        setRawDefinition(prev => {
            if (!prev) return prev;
            const nextBlocks = prev.blocks.map((block, bIdx) => {
                if (bIdx !== blockIndex) return block;
                const nextSteps = block.steps.map((step, sIdx) => {
                    if (sIdx !== stepIndex) return step;
                    const resolvedTitle = replacement.title
                        ?? (replacement.exerciseRef?.kind === 'catalog' ? replacement.exerciseRef.exerciseId : (replacement.exerciseRef?.kind === 'unresolved_free_text' ? replacement.exerciseRef.name : step.id));
                    const compositionPatterns = replacement.exerciseRef?.kind === 'catalog'
                        ? EXERCISES_BY_ID.get(replacement.exerciseRef.exerciseId)?.compositionPatterns
                        : undefined;
                    const requiredPatterns = prev.movementComposition
                        ?.filter(requirement => requirement.status === 'required' && requirement.stepIds.includes(step.id))
                        .map(requirement => requirement.pattern) ?? step.compositionPatterns ?? [];
                    const lostRequiredPattern = requiredPatterns.find(pattern => !compositionPatterns?.includes(pattern));
                    const nextStep: SessionStep = {
                        ...step,
                        exerciseRef: replacement.exerciseRef,
                        degradedComposition: undefined,
                        ...(lostRequiredPattern && replacement.exerciseRef?.kind === 'catalog'
                            ? { degradedComposition: { pattern: lostRequiredPattern, reason: 'Athlete selected a catalog exercise that does not preserve this movement component.' } }
                            : {}),
                        title: resolvedTitle,
                        ...(replacement.dose ? { dose: replacement.dose } : {}),
                        ...(replacement.rest !== undefined ? { rest: replacement.rest } : {}),
                    };
                    if (compositionPatterns?.length) nextStep.compositionPatterns = compositionPatterns;
                    else delete nextStep.compositionPatterns;
                    if (replacement.tempo === null) delete nextStep.tempo;
                    else if (replacement.tempo !== undefined) nextStep.tempo = replacement.tempo;
                    if (replacement.notes === null) delete nextStep.notes;
                    else if (replacement.notes !== undefined) nextStep.notes = replacement.notes;
                    return nextStep;
                });
                return { ...block, steps: nextSteps };
            });
            return { ...prev, blocks: nextBlocks };
        });
    }, []);

    const saveAsNewTemplate = useCallback(async (title: string, summary?: string): Promise<string> => {
        if (!rawDefinition) throw new Error('No active session definition to save.');
        const templateId = `custom-session-${crypto.randomUUID()}`;
        const newDef = createCustomTemplateDefinition(rawDefinition, templateId, title, summary);
        const saved = await sessionDefinitionService.saveDefinitionRevision(userId, newDef);
        return saved.header.definitionId;
    }, [rawDefinition, userId]);

    const completeSession = useCallback(async (payload?: SessionCompletionPayload) => {
        if (!execution) return;
        if (terminalInFlightRef.current) return terminalInFlightRef.current;

        const operation = (async () => {
            if (execution.state === 'completed') {
                await convergeCompletedExecution(userId, execution, definition?.dominantModality);
                return;
            }
            if (execution.state !== 'in_progress') return;

            manualRestDeadlineRef.current = null;
            setIsRestRunning(false);
            try {
                await closeActiveRest('session_ended');
            } catch (err) {
                console.warn('[useSessionRunner] Failed to persist rest event:', err);
            }

            const submittedAt = new Date().toISOString();
            const note = payload?.notes?.trim();
            const completionEvidence = payload ? {
                submittedAt,
                ...(payload.sessionRpe !== undefined ? { sessionRpe: payload.sessionRpe } : {}),
                ...(payload.completedFraction !== undefined ? { completedFraction: payload.completedFraction } : {}),
                ...(payload.unexpectedFatigue !== undefined ? { unexpectedFatigue: payload.unexpectedFatigue } : {}),
                ...(note ? { note } : {}),
            } : undefined;
            const outcome = await sessionExecutionService.transitionExecutionTerminal(
                userId,
                execution.executionId,
                'completed',
                {
                    ...(payload?.sessionRpe !== undefined ? { sessionRpe: payload.sessionRpe } : {}),
                    ...(note ? { notes: note } : {}),
                    ...(completionEvidence ? { completionEvidence } : {}),
                },
                async (batch, terminalExecution) => {
                    if (payload?.tissueFeedback?.length) {
                        const existingCheckin = await checkinService.getCheckin(userId, terminalExecution.date);
                        const existingResponses = (existingCheckin?.tissueResponses ?? {}) as Partial<Record<BodyRegion, RegionTissueResponse>>;
                        const tissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> = { ...existingResponses };
                        for (const item of payload.tissueFeedback) {
                            const existingSource = existingResponses[item.region]?.sourceSessionRef;
                            if (existingSource && (
                                existingSource.kind !== 'execution'
                                || existingSource.id !== terminalExecution.executionId
                                || existingSource.date !== terminalExecution.date
                            )) throw new Error(`A tissue response for ${item.region} is already linked to another session`);
                            tissueResponses[item.region] = {
                                region: item.region,
                                morningState: existingResponses[item.region]?.morningState ?? 'normal',
                                painDuringTraining: item.painDuringTraining,
                                afterTrainingState: item.afterTrainingState ?? item.painDuringTraining,
                                sourceSessionRef: { kind: 'execution', id: terminalExecution.executionId, date: terminalExecution.date },
                            };
                        }
                        await checkinService.upsertCheckin(userId, {
                            date: terminalExecution.date,
                            painOrInjury: true,
                            tissueResponses,
                        });
                    }
                    const persistedEntries = await sessionExecutionService.getEntries(userId, execution.executionId);
                    if (!persistedEntries.some(entry => entry.payload.kind === 'repetition')) return;
                    const adaptedSession = adaptNormalizedExecutionToStrengthSession({
                        execution: terminalExecution,
                        entries: persistedEntries,
                    });
                    if (adaptedSession.exercises.length > 0) {
                        await preferencesService.applyOneRepMaxDerivations(userId, adaptedSession, submittedAt, batch);
                    }
                },
            );
            setExecution(outcome.execution);
            if (outcome.status === 'already_abandoned') throw new Error('This session was already abandoned. Its logged entries are retained.');

            await convergeCompletedExecution(userId, outcome.execution, definition?.dominantModality);
        })();
        terminalInFlightRef.current = operation;
        try {
            await operation;
        } finally {
            if (terminalInFlightRef.current === operation) terminalInFlightRef.current = null;
        }
    }, [execution, userId, definition, closeActiveRest]);

    const abandonSession = useCallback(async (notes?: string) => {
        if (!execution) return;
        if (terminalInFlightRef.current) return terminalInFlightRef.current;

        const operation = (async () => {
            if (execution.state === 'completed') {
                await convergeCompletedExecution(userId, execution, definition?.dominantModality);
                return;
            }
            if (execution.state !== 'in_progress') return;

            manualRestDeadlineRef.current = null;
            setIsRestRunning(false);
            try {
                await closeActiveRest('session_ended');
            } catch (err) {
                console.warn('[useSessionRunner] Failed to persist rest event:', err);
            }
            const note = notes?.trim();
            const outcome = await sessionExecutionService.transitionExecutionTerminal(
                userId,
                execution.executionId,
                'abandoned',
                note ? { notes: note } : undefined,
            );
            setExecution(outcome.execution);

            if (outcome.status === 'already_completed') {
                await convergeCompletedExecution(userId, outcome.execution, definition?.dominantModality);
                throw new Error('This session was already completed.');
            }
            if (outcome.execution.occurrenceId) {
                try {
                    await sessionOccurrenceService.transitionOccurrenceState(
                        userId,
                        outcome.execution.occurrenceId,
                        'abandoned',
                        outcome.execution.updatedAt,
                    );
                } catch (err) {
                    console.warn('[useSessionRunner] Failed to converge occurrence state to abandoned:', err);
                }
            }
        })();
        terminalInFlightRef.current = operation;
        try {
            await operation;
        } finally {
            if (terminalInFlightRef.current === operation) terminalInFlightRef.current = null;
        }
    }, [execution, userId, definition, closeActiveRest]);

    return {
        definition,
        execution,
        entries,
        activeBlock,
        activeStep,
        activeBlockIndex,
        activeStepIndex,
        elapsedSeconds,
        restSecondsRemaining,
        isRestRunning,
        isRestoring,
        syncStatus,
        resumeStatus,
        resumeDegradedReason,
        canUndo: lastRemovedEntry !== null && lastRemovedEntry.payload.kind !== 'choice',
        lastRemovedEntry,
        sessionEnded,
        ineligibleOptionIds,

        startFixtureSession,
        startSession,
        selectStep,
        nextStep,
        prevStep,
        logEntry,
        logChoice,
        editEntry,
        removeEntry,
        undo,
        startRestTimer,
        skipRestTimer,
        addRestSeconds,
        substituteStepExercise,
        saveAsNewTemplate,
        completeSession,
        abandonSession,
    };
}
