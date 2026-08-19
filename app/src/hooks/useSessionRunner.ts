import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { checkinService } from '../services/checkinService';
import { preferencesService } from '../services/preferencesService';
import { trainingSettingsService } from '../services/trainingSettingsService';
import { adaptNormalizedExecutionToStrengthSession } from '../sessions/legacyStrengthAdapter';
import { getLocalDateString } from '../utils/localDate';
import type { SessionCompletionPayload } from '../components/session/SessionCompletionSheet';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { resolveEffectiveSession } from '../sessions/choiceResolution';
import { resolveEffectiveInjuryConstraints, resolveInjuryRestrictions } from '../engine/injuryPolicy';
import { ineligibleAlternativeOptionIds } from '../engine/sessionChoiceEligibility';

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
    syncStatus: 'synced' | 'pending' | 'unavailable';
    canUndo: boolean;
    lastRemovedEntry: SessionEntry | null;
    /** True once a recorded choice ended the whole session (D-MCHOICE `end_session`). */
    sessionEnded: boolean;
    /** `SessionOption.id`s an athlete-observed choice must not offer as selectable right now. */
    ineligibleOptionIds: ReadonlySet<string>;

    startFixtureSession: (fixture: SessionDefinition) => Promise<void>;
    startSession: (definition: SessionDefinition, source: SessionSourceRef, options?: { occurrenceId?: string; prescriptionHash?: string }) => Promise<void>;
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
    completeSession: (payload?: SessionCompletionPayload) => Promise<void>;
    abandonSession: (notes?: string) => Promise<void>;
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
    const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'unavailable'>('synced');
    const [lastRemovedEntry, setLastRemovedEntry] = useState<SessionEntry | null>(null);

    // Reloading or backgrounding must not create a second execution. Source-neutral
    // executions restore through the immutable source + prescription binding; fixtures
    // remain the only legacy path that does not carry a prescription hash.
    useEffect(() => {
        let cancelled = false;
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
                if (cancelled) return;
                if (resolved?.status === 'AVAILABLE') setRawDefinition(resolved.data);
                else if (!fixture) setSyncStatus('unavailable');
                setExecution(existing);
                setEntries(existingEntries);
                setElapsedSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(existing.startedAt)) / 1000)));
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

    // Elapsed session timer
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        if (execution && execution.state === 'in_progress') {
            interval = setInterval(() => {
                setElapsedSeconds(prev => prev + 1);
            }, 1000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [execution]);

    // Rest countdown timer
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        if (isRestRunning && restSecondsRemaining > 0) {
            interval = setInterval(() => {
                setRestSecondsRemaining(prev => {
                    if (prev <= 1) {
                        setIsRestRunning(false);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isRestRunning, restSecondsRemaining]);

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
        options: { occurrenceId?: string; prescriptionHash?: string } = {},
    ) => {
        if (isRestoring || execution?.state === 'in_progress') return;
        setRawDefinition(nextDefinition);
        setActiveBlockIndex(0);
        setActiveStepIndex(0);
        setEntries([]);
        setElapsedSeconds(0);
        setLastRemovedEntry(null);
        setSyncStatus('pending');

        const executionId = `exec-${Date.now()}`;
        const today = getLocalDateString();
        try {
            const exec = await sessionExecutionService.startExecution(userId, executionId, {
                sessionSource: source,
                ...(options.occurrenceId ? { occurrenceId: options.occurrenceId } : {}),
                ...(options.prescriptionHash ? { prescriptionHash: options.prescriptionHash } : {}),
                date: today,
            });
            setExecution(exec);
            setSyncStatus('synced');
        } catch (error) {
            setRawDefinition(null);
            setSyncStatus('unavailable');
            throw error;
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
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(execution.startedAt)) / 1000)));
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
        const entryId = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const now = new Date().toISOString();
        const entry: SessionEntry = {
            id: entryId,
            executionId: execution.executionId,
            stepId: activeStep.id,
            exerciseRef: activeStep.exerciseRef,
            ...(side ? { side } : {}),
            ...(selectedOptionId ? { selectedOptionId } : {}),
            completedAt: now,
            createdAt: now,
            updatedAt: now,
            payload: payload.kind === 'repetition'
                ? {
                    ...payload,
                    setIndex: entries.filter(entry => entry.stepId === activeStep.id && entry.payload.kind === 'repetition').length + 1,
                }
                : payload,
        };

        setEntries(prev => [...prev, entry]);
        setSyncStatus('pending');

        try {
            await sessionExecutionService.logEntry(userId, execution.executionId, entry);
            setSyncStatus('synced');
        } catch {
            setSyncStatus('unavailable');
        }

        // Trigger rest timer if prescribed on step
        if (activeStep.rest) {
            const restSec = typeof activeStep.rest === 'number' ? activeStep.rest : activeStep.rest.min;
            if (restSec > 0) {
                setRestSecondsRemaining(restSec);
                setIsRestRunning(true);
            }
        }
    }, [execution, activeStep, entries, userId]);

    const logChoice = useCallback(async (choiceId: string, optionId: string, reason?: string) => {
        if (!execution || execution.state !== 'in_progress' || !activeBlock) return;
        const choice = activeBlock.optionSets?.find(candidate => candidate.id === choiceId);
        if (!choice) return;
        const entryId = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
            await sessionExecutionService.logEntry(userId, execution.executionId, entry);
            setSyncStatus('synced');
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, activeBlock, userId]);

    const editEntry = useCallback(async (entryId: string, updatedPayload: Partial<SessionEntryPayload>) => {
        if (!execution || execution.state !== 'in_progress') return;
        setEntries(prev => prev.map(e => (e.id === entryId ? { ...e, payload: { ...e.payload, ...updatedPayload } as SessionEntryPayload, updatedAt: new Date().toISOString() } : e)));
        const target = entries.find(e => e.id === entryId);
        if (!target) return;
        try {
            await sessionExecutionService.correctEntry(userId, execution.executionId, entryId, {
                payload: { ...target.payload, ...updatedPayload } as SessionEntryPayload,
            });
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, entries, userId]);

    const removeEntry = useCallback(async (entryId: string) => {
        if (!execution || execution.state !== 'in_progress') return;
        const target = entries.find(e => e.id === entryId);
        if (target) {
            setLastRemovedEntry(target);
        }
        setEntries(prev => prev.filter(e => e.id !== entryId));
        try {
            await sessionExecutionService.deleteEntry(userId, execution.executionId, entryId);
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, entries, userId]);

    const undo = useCallback(async () => {
        if (!execution || execution.state !== 'in_progress' || !lastRemovedEntry) return;
        const toRestore = lastRemovedEntry;
        setLastRemovedEntry(null);
        setEntries(prev => [...prev, toRestore]);
        try {
            await sessionExecutionService.logEntry(userId, execution.executionId, toRestore);
        } catch {
            setSyncStatus('unavailable');
        }
    }, [execution, lastRemovedEntry, userId]);

    const startRestTimer = useCallback((seconds: number) => {
        setRestSecondsRemaining(seconds);
        setIsRestRunning(true);
    }, []);

    const skipRestTimer = useCallback(() => {
        setRestSecondsRemaining(0);
        setIsRestRunning(false);
    }, []);

    const completeSession = useCallback(async (payload?: SessionCompletionPayload) => {
        if (!execution || execution.state !== 'in_progress') return;
        // Tissue values stay in the canonical daily check-in.  The execution is only an
        // attribution link, and a conflicting existing link is never overwritten.
        if (payload?.tissueFeedback?.length) {
            const existingCheckin = await checkinService.getCheckin(userId, execution.date);
            const existingResponses = existingCheckin?.tissueResponses ?? {};
            const tissueResponses = { ...existingResponses };
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
    }, [execution, userId]);

    const abandonSession = useCallback(async (notes?: string) => {
        if (!execution || execution.state !== 'in_progress') return;
        await sessionExecutionService.transitionExecution(userId, execution.executionId, 'abandoned', {
            notes,
        });
        setExecution(prev => prev ? { ...prev, state: 'abandoned' } : null);
    }, [execution, userId]);

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
        completeSession,
        abandonSession,
    };
}
