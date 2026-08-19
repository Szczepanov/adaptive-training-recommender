import { useState, useEffect, useCallback } from 'react';
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
import { checkinService } from '../services/checkinService';
import { preferencesService } from '../services/preferencesService';
import { adaptNormalizedExecutionToStrengthSession } from '../sessions/legacyStrengthAdapter';
import { getLocalDateString } from '../utils/localDate';
import type { SessionCompletionPayload } from '../components/session/SessionCompletionSheet';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';

export interface UseSessionRunnerResult {
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

    startFixtureSession: (fixture: SessionDefinition) => Promise<void>;
    startSession: (definition: SessionDefinition, source: SessionSourceRef, options?: { occurrenceId?: string; prescriptionHash?: string }) => Promise<void>;
    restoreSessionDefinition: (definition: SessionDefinition) => Promise<void>;
    selectStep: (blockIndex: number, stepIndex: number) => void;
    nextStep: () => void;
    prevStep: () => void;
    logEntry: (payload: SessionEntryPayload, side?: 'left' | 'right' | 'bilateral', selectedOptionId?: string) => Promise<void>;
    editEntry: (entryId: string, updatedPayload: Partial<SessionEntryPayload>) => Promise<void>;
    removeEntry: (entryId: string) => Promise<void>;
    undo: () => Promise<void>;
    startRestTimer: (seconds: number) => void;
    skipRestTimer: () => void;
    completeSession: (payload?: SessionCompletionPayload) => Promise<void>;
    abandonSession: (notes?: string) => Promise<void>;
}

export function useSessionRunner(userId: string, fixtures: readonly SessionDefinition[] = []): UseSessionRunnerResult {
    const [definition, setDefinition] = useState<SessionDefinition | null>(null);
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
                if (resolved?.status === 'AVAILABLE') setDefinition(resolved.data);
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

    const activeBlock = definition?.blocks[activeBlockIndex] ?? null;
    const activeStep = activeBlock?.steps[activeStepIndex] ?? null;

    const startSession = useCallback(async (
        nextDefinition: SessionDefinition,
        source: SessionSourceRef,
        options: { occurrenceId?: string; prescriptionHash?: string } = {},
    ) => {
        if (isRestoring || execution?.state === 'in_progress') return;
        setDefinition(nextDefinition);
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
            setDefinition(null);
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
        setDefinition(nextDefinition);
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
        if (activeStepIndex + 1 < activeBlock.steps.length) {
            setActiveStepIndex(activeStepIndex + 1);
        } else if (activeBlockIndex + 1 < definition.blocks.length) {
            setActiveBlockIndex(activeBlockIndex + 1);
            setActiveStepIndex(0);
        }
    }, [definition, activeBlock, activeBlockIndex, activeStepIndex]);

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

        await sessionExecutionService.transitionExecution(userId, execution.executionId, 'completed', {
            sessionRpe: payload?.sessionRpe,
            notes: payload?.notes,
        });
        const now = new Date().toISOString();
        const completedExecution = {
            ...execution,
            state: 'completed' as const,
            completedAt: now,
            updatedAt: now,
            ...(payload?.sessionRpe !== undefined ? { sessionRpe: payload.sessionRpe } : {}),
            ...(payload?.notes !== undefined ? { notes: payload.notes } : {}),
        };

        // Derive only after the terminal state is durable and only from a fresh read of
        // persisted entries. `logEntry` intentionally keeps optimistic UI state on an
        // unavailable write, which must never influence a derived performance value.
        const persistedEntries = await sessionExecutionService.getEntries(userId, execution.executionId);
        if (persistedEntries.some(e => e.payload.kind === 'repetition')) {
            const adaptedSession = adaptNormalizedExecutionToStrengthSession({
                execution: completedExecution,
                entries: persistedEntries,
            });
            if (adaptedSession.exercises.length > 0) {
                // Derived writes are deterministic and only replace the same `derived`
                // ownership rung, so a recovery retry after a preferences outage is
                // idempotent for this completed execution.
                await preferencesService.applyOneRepMaxDerivations(userId, adaptedSession, now);
            }
        }

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

        startFixtureSession,
        startSession,
        restoreSessionDefinition,
        selectStep,
        nextStep,
        prevStep,
        logEntry,
        editEntry,
        removeEntry,
        undo,
        startRestTimer,
        skipRestTimer,
        completeSession,
        abandonSession,
    };
}
