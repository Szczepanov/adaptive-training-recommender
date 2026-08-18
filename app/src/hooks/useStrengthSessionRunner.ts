import { useCallback, useEffect, useState } from 'react';
import type { LoggedExercise, LoggedSet, StrengthSession } from '../engine/models';
import { strengthSessionService } from '../services/strengthSessionService';
import { recommendationService } from '../services/recommendationService';
import { checkinService } from '../services/checkinService';
import { finalizeStrengthSession } from '../services/strengthSessionCompletion';
import { getLocalDateString } from '../utils/localDate';
import {
    appendSetToExercise,
    amendLoggedSet,
    buildLoggedSet,
    extractPlannedStrengthExercises,
    prefillNextSet,
    removeSetFromExercise,
    replaceSetInExercise,
    resolveInitialExerciseIndex,
    resolveStepNavigation,
    upsertExercise,
    type PlannedStrengthExercise,
    type SessionStepSummary,
    type SetEntryDraft,
} from '../workouts/strengthSessionEntry';
import type { SessionCompletionPayload } from '../components/session/SessionCompletionSheet';

export interface UseStrengthSessionRunnerResult {
    loading: boolean;
    saving: boolean;
    error: string | null;
    session: StrengthSession | null;
    plannedExercises: PlannedStrengthExercise[];
    navigationSteps: SessionStepSummary[];
    activeExerciseIndex: number | null;
    draft: SetEntryDraft;
    canUndo: boolean;
    syncStatusForSet: (exercise: LoggedExercise, set: LoggedSet) => 'synced' | 'pending' | 'unavailable';
    start: () => Promise<void>;
    selectExercise: (exerciseId: string | null, freeTextName?: string) => void;
    selectStep: (step: SessionStepSummary) => void;
    updateDraft: (patch: Partial<SetEntryDraft>) => void;
    logSet: () => Promise<void>;
    editSet: (exerciseIndex: number, setIndex: number, updatedDraft: SetEntryDraft) => Promise<void>;
    removeSet: (exerciseIndex: number, setIndex: number) => Promise<void>;
    undo: () => Promise<void>;
    finishSession: (payload?: SessionCompletionPayload) => Promise<boolean>;
    abandonSession: () => Promise<boolean>;
}

const EMPTY_DRAFT: SetEntryDraft = { reps: 1, weightKg: null, isWarmup: false };

function setSyncKey(exercise: LoggedExercise, set: LoggedSet): string {
    return `${exercise.exerciseId ?? `free:${exercise.freeTextName ?? ''}`}:${set.setIndex}:${set.completedAt}`;
}

function sessionSetKeys(session: StrengthSession): Set<string> {
    return new Set(session.exercises.flatMap(exercise => exercise.sets.map(set => setSyncKey(exercise, set))));
}

export function useStrengthSessionRunner(userId: string | null | undefined): UseStrengthSessionRunnerResult {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [session, setSession] = useState<StrengthSession | null>(null);
    const [plannedExercises, setPlannedExercises] = useState<PlannedStrengthExercise[]>([]);
    const [activeExerciseIndex, setActiveExerciseIndex] = useState<number | null>(null);
    const [draft, setDraft] = useState<SetEntryDraft>(EMPTY_DRAFT);
    const [acknowledgedSetKeys, setAcknowledgedSetKeys] = useState<Set<string>>(() => new Set());
    const [syncUnavailable, setSyncUnavailable] = useState(false);
    const [undoStack, setUndoStack] = useState<LoggedExercise[][]>([]);

    const observedSessionId = session?.sessionId;

    // Resume-on-open: an in_progress session left from earlier today is restored and
    // its active exercise is automatically selected (M1.1)
    useEffect(() => {
        if (!userId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        strengthSessionService.findActiveSession(userId)
            .then(async active => {
                if (cancelled) return;
                setSession(active);
                let planned: PlannedStrengthExercise[] = [];
                if (active?.sourceRecommendationDate) {
                    const recommendation = await recommendationService.getRecommendation(userId, active.sourceRecommendationDate);
                    if (!cancelled && recommendation?.prescription) {
                        planned = extractPlannedStrengthExercises(recommendation.prescription);
                        setPlannedExercises(planned);
                    }
                }
                if (active) {
                    const initialIdx = resolveInitialExerciseIndex(active.exercises, planned);
                    setActiveExerciseIndex(initialIdx);
                    if (initialIdx !== null && active.exercises[initialIdx]) {
                        const targetPlan = planned.find(p => p.exerciseId === active.exercises[initialIdx].exerciseId);
                        setDraft(prefillNextSet(active.exercises[initialIdx].sets, targetPlan));
                    }
                }
            })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load an active strength session');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [userId]);

    useEffect(() => {
        if (!userId || !observedSessionId) {
            setAcknowledgedSetKeys(new Set());
            setSyncUnavailable(false);
            return;
        }
        return strengthSessionService.observeSession(userId, observedSessionId, (state, hasPendingWrites) => {
            if (state.status === 'UNAVAILABLE' || state.status === 'INVALID') {
                setSyncUnavailable(true);
                return;
            }
            setSyncUnavailable(false);
            if (state.status === 'AVAILABLE' && !hasPendingWrites) {
                setAcknowledgedSetKeys(sessionSetKeys(state.data));
            }
        });
    }, [userId, observedSessionId]);

    const start = useCallback(async () => {
        if (!userId || saving) return;
        setError(null);
        setSaving(true);
        try {
            const today = getLocalDateString();
            const recommendation = await recommendationService.getRecommendation(userId, today);
            const planned = extractPlannedStrengthExercises(recommendation?.prescription);
            const started = await strengthSessionService.startSession(userId, {
                ...(planned.length > 0 ? { sourceRecommendationDate: today } : {}),
            });
            setSession(started);
            setPlannedExercises(planned);
            const initialIdx = resolveInitialExerciseIndex(started.exercises, planned);
            setActiveExerciseIndex(initialIdx);
            setDraft(EMPTY_DRAFT);
            setUndoStack([]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not start a strength session');
        } finally {
            setSaving(false);
        }
    }, [userId, saving]);

    const selectExercise = useCallback((exerciseId: string | null, freeTextName?: string) => {
        if (!session || saving) return;
        const updated = upsertExercise(session.exercises, exerciseId, freeTextName);
        const isNewlyAdded = updated.length > session.exercises.length;
        const index = exerciseId !== null
            ? updated.findIndex(exercise => exercise.exerciseId === exerciseId)
            : updated.length - 1;
        setActiveExerciseIndex(index);
        const plan = exerciseId !== null ? plannedExercises.find(planned => planned.exerciseId === exerciseId) : undefined;
        setDraft(prefillNextSet(updated[index]?.sets ?? [], plan));
        if (isNewlyAdded) {
            setSession({ ...session, exercises: updated });
            setSaving(true);
            strengthSessionService.saveExercises(userId!, session.sessionId, updated)
                .catch(err => {
                    setError(err instanceof Error ? err.message : 'Could not save the selected exercise');
                })
                .finally(() => setSaving(false));
        }
    }, [session, plannedExercises, userId, saving]);

    const selectStep = useCallback((step: SessionStepSummary) => {
        if (!session || saving) return;
        if (step.exerciseIndex !== null) {
            setActiveExerciseIndex(step.exerciseIndex);
            const plan = step.exerciseId !== null ? plannedExercises.find(p => p.exerciseId === step.exerciseId) : undefined;
            setDraft(prefillNextSet(session.exercises[step.exerciseIndex]?.sets ?? [], plan));
        } else {
            selectExercise(step.exerciseId, step.freeTextName);
        }
    }, [session, saving, plannedExercises, selectExercise]);

    const updateDraft = useCallback((patch: Partial<SetEntryDraft>) => {
        setDraft(current => ({ ...current, ...patch }));
    }, []);

    const logSet = useCallback(async () => {
        if (!session || activeExerciseIndex === null) return;
        setError(null);
        const currentSets = session.exercises[activeExerciseIndex]?.sets ?? [];
        const result = buildLoggedSet(draft, currentSets, new Date().toISOString());
        if (!result.ok) {
            setError(result.error);
            return;
        }
        const updatedExercises = appendSetToExercise(session.exercises, activeExerciseIndex, result.set);
        setSaving(true);
        try {
            await strengthSessionService.saveExercises(userId!, session.sessionId, updatedExercises);
            const updatedSession = { ...session, exercises: updatedExercises };
            setSession(updatedSession);
            const plan = plannedExercises.find(planned => planned.exerciseId === updatedExercises[activeExerciseIndex]?.exerciseId);
            setDraft(prefillNextSet(updatedExercises[activeExerciseIndex]?.sets ?? [], plan));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save that set');
        } finally {
            setSaving(false);
        }
    }, [session, activeExerciseIndex, draft, plannedExercises, userId]);

    const editSet = useCallback(async (exerciseIndex: number, targetSetIndex: number, updatedDraft: SetEntryDraft) => {
        if (!session || saving) return;
        setError(null);
        const exercise = session.exercises[exerciseIndex];
        if (!exercise) return;
        const existingSet = exercise.sets.find(s => s.setIndex === targetSetIndex);
        if (!existingSet) return;

        const result = amendLoggedSet(existingSet, updatedDraft);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        const updatedSet: LoggedSet = result.set;
        const updatedExercises = replaceSetInExercise(session.exercises, exerciseIndex, targetSetIndex, updatedSet);

        setSaving(true);
        try {
            setUndoStack(prev => [...prev.slice(-4), session.exercises]);
            await strengthSessionService.saveExercises(userId!, session.sessionId, updatedExercises);
            setSession({ ...session, exercises: updatedExercises });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not update set');
        } finally {
            setSaving(false);
        }
    }, [session, saving, userId]);

    const removeSet = useCallback(async (exerciseIndex: number, targetSetIndex: number) => {
        if (!session || saving) return;
        setError(null);
        const updatedExercises = removeSetFromExercise(session.exercises, exerciseIndex, targetSetIndex);

        setSaving(true);
        try {
            setUndoStack(prev => [...prev.slice(-4), session.exercises]);
            await strengthSessionService.saveExercises(userId!, session.sessionId, updatedExercises);
            setSession({ ...session, exercises: updatedExercises });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete set');
        } finally {
            setSaving(false);
        }
    }, [session, saving, userId]);

    const undo = useCallback(async () => {
        if (!session || undoStack.length === 0 || saving) return;
        setError(null);
        const prevExercises = undoStack[undoStack.length - 1];
        setSaving(true);
        try {
            await strengthSessionService.saveExercises(userId!, session.sessionId, prevExercises);
            setSession({ ...session, exercises: prevExercises });
            setUndoStack(prev => prev.slice(0, -1));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not undo last action');
        } finally {
            setSaving(false);
        }
    }, [session, undoStack, saving, userId]);

    const closeSession = useCallback(async (next: 'completed' | 'abandoned', payload?: SessionCompletionPayload): Promise<boolean> => {
        if (!session || saving) return false;
        setError(null);
        setSaving(true);
        try {
            const nowIso = new Date().toISOString();
            const metadata = {
                sessionRpe: payload?.sessionRpe,
                notes: payload?.notes,
            };
            // Persist completion feedback before making the session terminal. Otherwise a
            // failed check-in write would leave the athlete unable to retry the feedback.
            if (next === 'completed' && payload?.tissueFeedback && payload.tissueFeedback.length > 0 && userId) {
                const today = session.date || getLocalDateString();
                const existingCheckin = await checkinService.getCheckin(userId, today);
                const existingResponses = existingCheckin?.tissueResponses ?? {};
                const updatedResponses = { ...existingResponses };
                for (const item of payload.tissueFeedback) {
                    const existingSource = existingResponses[item.region]?.sourceSessionRef;
                    if (existingSource && (
                        existingSource.kind !== 'strength'
                        || existingSource.id !== session.sessionId
                        || existingSource.date !== today
                    )) {
                        throw new Error(`A tissue response for ${item.region} is already linked to another session`);
                    }
                    updatedResponses[item.region] = {
                        region: item.region,
                        morningState: existingResponses[item.region]?.morningState ?? 'normal',
                        painDuringTraining: item.painDuringTraining,
                        afterTrainingState: item.afterTrainingState ?? item.painDuringTraining,
                        sourceSessionRef: {
                            kind: 'strength',
                            id: session.sessionId,
                            date: today,
                        },
                    };
                }
                await checkinService.upsertCheckin(userId, {
                    date: today,
                    painOrInjury: true,
                    tissueResponses: updatedResponses,
                });
            }
            const updated = await finalizeStrengthSession(userId!, session, next, nowIso, undefined, metadata);
            setSession(updated);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : `Could not mark the session ${next}`);
            return false;
        } finally {
            setSaving(false);
        }
    }, [session, userId, saving]);

    const finishSession = useCallback((payload?: SessionCompletionPayload) => closeSession('completed', payload), [closeSession]);
    const abandonSession = useCallback(() => closeSession('abandoned'), [closeSession]);

    const syncStatusForSet = useCallback((exercise: LoggedExercise, set: LoggedSet) => {
        if (syncUnavailable) return 'unavailable' as const;
        return acknowledgedSetKeys.has(setSyncKey(exercise, set)) ? 'synced' as const : 'pending' as const;
    }, [acknowledgedSetKeys, syncUnavailable]);

    const navigationSteps = resolveStepNavigation(session?.exercises ?? [], plannedExercises);

    return {
        loading, saving, error, session, plannedExercises, navigationSteps,
        activeExerciseIndex, draft, canUndo: undoStack.length > 0,
        syncStatusForSet,
        start, selectExercise, selectStep, updateDraft, logSet, editSet, removeSet, undo, finishSession, abandonSession,
    };
}
