import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { writeBatch } from 'firebase/firestore';
import type {
    SessionDefinition,
    SessionExecution,
    SessionEntry,
    SessionEntryPayload,
    SessionStep,
    SessionBlock,
    SessionSourceRef,
} from '../sessions/models';
import { getDb } from '../firebase';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { sessionOccurrenceService } from '../services/sessionOccurrenceService';
import { sessionResponseService } from '../services/sessionResponseService';
import { checkinService } from '../services/checkinService';
import { preferencesService } from '../services/preferencesService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { adaptNormalizedExecutionToStrengthSession } from '../sessions/legacyStrengthAdapter';
import { getLocalDateString } from '../utils/localDate';
import { sessionDefinitionService } from '../services/sessionDefinitionService';
import { playRestCompleteSound } from '../utils/audioFeedback';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { resolveEffectiveSession } from '../sessions/choiceResolution';
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
import { reconcileStructuredCompletion } from '../training-occurrence';

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
    canUndo: boolean;
    lastRemovedEntry: SessionEntry | null;
    /** True once a recorded choice ended the whole session (D-MCHOICE `end_session`). */
    sessionEnded: boolean;
    /** `SessionOption.id`s an athlete-observed choice must not offer as selectable right now. */
    ineligibleOptionIds: ReadonlySet<string>;

    startFixtureSession: (fixture: SessionDefinition) => Promise<void>;
    startSession: (definition: SessionDefinition, source: SessionSourceRef, options?: { occurrenceId?: string; prescriptionHash?: string; allowDuplicateCompleted?: boolean }) => Promise<void>;
    restoreSessionDefinition: (definition: SessionDefinition) => Promise<void>;
    selectStep: (blockIndex: number, stepIndex: number) => void;
    nextStep: () => void;
    prevStep: () => void;
    logEntry: (payload: SessionEntryPayload, side?: 'left' | 'right' | 'bilateral', selectedOptionId?: string) => Promise<void>;
    /** Records an athlete's answer to an authored `SessionChoice` as its own execution event. */
    logChoice: (choiceId: string, optionId: string, reason?: string) => Promise<void>;
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
    const [lastRemovedEntry, setLastRemovedEntry] = useState<SessionEntry | null>(null);
    const diaryFailedRef = useRef(false);
    const diaryWriteOptions = useMemo(() => ({
        acknowledgeLocally: true,
        onFailed: () => {
            diaryFailedRef.current = true;
            setSyncStatus('unavailable');
        },
    }), []);

    useEffect(() => {
        if (!execution) return;
        const stopSync = sessionExecutionService.watchDiarySync(userId, execution.executionId, pending => {
            if (!diaryFailedRef.current) setSyncStatus(pending ? 'queued' : 'synced');
        }, diaryWriteOptions.onFailed);
        const stopEntries = sessionExecutionService.watchEntries(userId, execution.executionId, (current, deleted) => {
            setEntries(current);
            setLastRemovedEntry(deleted);
        }, diaryWriteOptions.onFailed);
        return () => { stopSync(); stopEntries(); };
    }, [userId, execution, diaryWriteOptions]);
    // A React state update is not synchronous. Keep this separate from `execution` so a
    // double-tap in the gap before the start write resolves cannot create two executions.
    // The H4 claim transaction remains the cross-tab authority for claimed intraday members;
    // this guard protects the ordinary runner's local launch affordances too.
    const startInFlightRef = useRef(false);

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

    // Reloading or backgrounding must not create a second execution. Source-neutral
    // executions restore through the immutable source + prescription binding; fixtures
    // remain the only legacy path that does not carry a prescription hash.
    useEffect(() => {
        let cancelled = false;
        // A restored in-progress execution never resumes a rest timer -- whatever rest was
        // running before reload is simply lost, not reconstructed, so no fabricated
        // duration can ever be persisted for it.
        activeRestRef.current = null;
        manualRestDeadlineRef.current = null;
        setRestSecondsRemaining(0);
        setIsRestRunning(false);
        sessionExecutionService.findInProgressExecution(userId)
            .then(async existing => {
                if (!existing) return;
                const source = existing.sessionSource;
                const fixture = source.kind === 'unplanned_fixture'
                    ? fixtures.find(candidate => candidate.id === source.fixtureId)
                    : undefined;
                const resolved = fixture
                    ? { status: 'AVAILABLE' as const, data: fixture }
                    : existing.prescriptionHash
                        ? await resolveSessionDefinition(userId, source, existing.prescriptionHash)
                        : null;
                const existingEntries = await sessionExecutionService.getEntries(userId, existing.executionId);
                const deletedEntry = await sessionExecutionService.getLastDeletedEntry(userId, existing.executionId);
                if (cancelled) return;
                if (resolved?.status === 'AVAILABLE') setRawDefinition(resolved.data);
                else if (!fixture) setSyncStatus('unavailable');
                setExecution(existing);
                setEntries(existingEntries);
                setLastRemovedEntry(deletedEntry);
                setElapsedSeconds(sessionElapsedSecondsAt(existing.startedAt, Date.now()));
            })
            .catch(() => {
                if (!cancelled) setSyncStatus('unavailable');
            })
            .finally(() => {
                if (!cancelled) setIsRestoring(false);
            });
        return () => {
            cancelled = true;
        };
    }, [fixtures, userId]);

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
        if (isRestoring || execution?.state === 'in_progress' || startInFlightRef.current) return;
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
            setSyncStatus('synced');
            if (exec.executionId !== executionId) {
                const existingEntries = await sessionExecutionService.getEntries(userId, exec.executionId);
                setEntries(existingEntries);
                setElapsedSeconds(sessionElapsedSecondsAt(exec.startedAt, Date.now()));
            }
        } catch (error) {
            setRawDefinition(null);
            setSyncStatus('unavailable');
            throw error;
        } finally {
            startInFlightRef.current = false;
        }
    }, [execution?.state, isRestoring, userId]);

    const startFixtureSession = useCallback(async (fixture: SessionDefinition) => {
        await startSession(fixture, {
            kind: 'unplanned_fixture', fixtureId: fixture.id,
        });
    }, [startSession]);

    const restoreSessionDefinition = useCallback(async (nextDefinition: SessionDefinition) => {
        if (!execution || execution.state !== 'in_progress') return;
        const existingEntries = await sessionExecutionService.getEntries(userId, execution.executionId);
        setRawDefinition(nextDefinition);
        setEntries(existingEntries);
        setElapsedSeconds(sessionElapsedSecondsAt(execution.startedAt, Date.now()));
    }, [execution, userId]);

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
            ...(selectedOptionId ? { selectedOptionId } : {}),
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
    }, [execution, activeStep, activeBlock, entries, userId, closeActiveRest, diaryWriteOptions]);

    const logChoice = useCallback(async (choiceId: string, optionId: string, reason?: string) => {
        if (!execution || execution.state !== 'in_progress' || !activeBlock) return;
        const choice = activeBlock.optionSets?.find(candidate => candidate.id === choiceId);
        if (!choice) return;
        const entryId = `entry-${Date.now()}-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        const entry: SessionEntry = {
            id: entryId,
            executionId: execution.executionId,
            stepId: choice.appliesAtStepId,
            selectedOptionId: optionId,
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
    }, [execution, activeBlock, userId, diaryWriteOptions]);

    const editEntry = useCallback(async (entryId: string, updatedPayload: Partial<SessionEntryPayload>) => {
        if (!execution || execution.state !== 'in_progress') return;
        setEntries(prev => prev.map(e => (e.id === entryId ? { ...e, payload: { ...e.payload, ...updatedPayload } as SessionEntryPayload, updatedAt: new Date().toISOString() } : e)));
        const target = entries.find(e => e.id === entryId);
        if (!target) return;
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
        if (target) {
            setLastRemovedEntry(target);
        }
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
        if (!execution || execution.state !== 'in_progress') return;
        // A rest still running when the session ends must be closed and persisted before
        // the execution's own 'completed' transition below -- firestore.rules gates
        // restEvents writes on the execution still being 'in_progress'.
        manualRestDeadlineRef.current = null;
        setIsRestRunning(false);
        try {
            await closeActiveRest('session_ended');
        } catch (err) {
            console.warn('[useSessionRunner] Failed to persist rest event:', err);
        }
        // Tissue values stay in the canonical daily check-in.  The execution is only an
        // attribution link, and a conflicting existing link is never overwritten.
        if (payload?.tissueFeedback?.length) {
            const existingCheckin = await checkinService.getCheckin(userId, execution.date);
            const existingResponses = (existingCheckin?.tissueResponses ?? {}) as Partial<Record<BodyRegion, RegionTissueResponse>>;
            const tissueResponses: Partial<Record<BodyRegion, RegionTissueResponse>> = { ...existingResponses };
            for (const item of payload.tissueFeedback) {
                const existingSource = existingResponses[item.region]?.sourceSessionRef;
                if (existingSource && (
                    existingSource.kind !== 'execution'
                    || existingSource.id !== execution.executionId
                    || existingSource.date !== execution.date
                )) {
                    throw new Error(`A tissue response for ${item.region} is already linked to another session`);
                }
                tissueResponses[item.region] = {
                    region: item.region,
                    morningState: existingResponses[item.region]?.morningState ?? 'normal',
                    painDuringTraining: item.painDuringTraining,
                    afterTrainingState: item.afterTrainingState ?? item.painDuringTraining,
                    sourceSessionRef: { kind: 'execution', id: execution.executionId, date: execution.date },
                };
            }
            await checkinService.upsertCheckin(userId, {
                date: execution.date,
                painOrInjury: true,
                tissueResponses,
            });
        }

        const now = new Date().toISOString();
        const completedExecution = {
            ...execution,
            state: 'completed' as const,
            completedAt: now,
            updatedAt: now,
            ...(payload?.sessionRpe !== undefined ? { sessionRpe: payload.sessionRpe } : {}),
            ...(payload?.notes !== undefined ? { notes: payload.notes } : {}),
        };

        // Derive only from a fresh read of persisted entries. `logEntry` intentionally
        // keeps optimistic UI state on an unavailable write, which must never influence a
        // derived performance value. Both writes below are then queued into one batch and
        // committed together so a failed transition can never leave the 1RM derivation
        // persisted against an execution that is still (or forever) `in_progress` -- see
        // the completion/writeback atomicity note on `transitionExecution`/`applyOneRepMaxDerivations`.
        const persistedEntries = await sessionExecutionService.getEntries(userId, execution.executionId);
        const batch = writeBatch(getDb());
        if (persistedEntries.some(e => e.payload.kind === 'repetition')) {
            const adaptedSession = adaptNormalizedExecutionToStrengthSession({
                execution: completedExecution,
                entries: persistedEntries,
            });
            if (adaptedSession.exercises.length > 0) {
                // Derived writes are deterministic and only replace the same `derived`
                // ownership rung, so a recovery retry after a preferences outage is
                // idempotent for this completed execution.
                await preferencesService.applyOneRepMaxDerivations(userId, adaptedSession, now, batch);
            }
        }

        await sessionExecutionService.transitionExecution(userId, execution.executionId, 'completed', {
            sessionRpe: payload?.sessionRpe,
            notes: payload?.notes,
        }, batch);
        await batch.commit();
        setExecution(completedExecution);

        // H4 Phase 5 / ADR-0036 D-REASSESS: persist the submitted completion-sheet
        // evidence only after the execution is durably completed. A missing response
        // must remain legible as missing, so a response-write failure is fail-closed:
        // completion succeeds and a dependent PM member remains pending until the
        // evidence is available.
        try {
            await sessionResponseService.recordOrUpdateResponse(
                userId,
                { kind: 'execution', id: completedExecution.executionId, date: completedExecution.date },
                'immediate',
                completedExecution.date,
                completedExecution.date,
                {
                    sessionRpe: payload?.sessionRpe,
                    completedFraction: payload?.completedFraction,
                    unexpectedFatigue: payload?.unexpectedFatigue,
                    note: payload?.notes,
                },
                completedExecution.occurrenceId,
                now,
            );
        } catch (err) {
            console.warn('[useSessionRunner] Failed to persist immediate session response:', err);
        }

        if (execution.occurrenceId) {
            try {
                await sessionOccurrenceService.transitionOccurrenceState(
                    userId,
                    execution.occurrenceId,
                    'completed',
                    now,
                );
            } catch (err) {
                console.warn('[useSessionRunner] Failed to transition occurrence state to completed:', err);
            }
        }

        // PR 1 (ADR-0034) shadow reconciliation: fire-and-forget, never affects
        // completion UX or this function's behavior/return value.
        void reconcileStructuredCompletion(userId, completedExecution, definition?.dominantModality)
            .catch(err => console.warn('[training-occurrence] shadow reconciliation failed', err));
    }, [execution, userId, definition, closeActiveRest]);

    const abandonSession = useCallback(async (notes?: string) => {
        if (!execution || execution.state !== 'in_progress') return;
        manualRestDeadlineRef.current = null;
        setIsRestRunning(false);
        try {
            await closeActiveRest('session_ended');
        } catch (err) {
            console.warn('[useSessionRunner] Failed to persist rest event:', err);
        }
        const now = new Date().toISOString();
        const batch = writeBatch(getDb());
        await sessionExecutionService.transitionExecution(userId, execution.executionId, 'abandoned', {
            notes,
        }, batch);
        await batch.commit();
        setExecution(prev => prev ? { ...prev, state: 'abandoned' } : null);

        if (execution.occurrenceId) {
            try {
                await sessionOccurrenceService.transitionOccurrenceState(
                    userId,
                    execution.occurrenceId,
                    'abandoned',
                    now,
                );
            } catch (err) {
                console.warn('[useSessionRunner] Failed to transition occurrence state to abandoned:', err);
            }
        }
    }, [execution, userId, closeActiveRest]);

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
        canUndo: lastRemovedEntry !== null,
        lastRemovedEntry,
        sessionEnded,
        ineligibleOptionIds,

        startFixtureSession,
        startSession,
        restoreSessionDefinition,
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
