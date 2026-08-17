import { useCallback, useEffect, useState } from 'react';
import type { StrengthSession } from '../engine/models';
import { strengthSessionService } from '../services/strengthSessionService';
import { recommendationService } from '../services/recommendationService';
import { getLocalDateString } from '../utils/localDate';
import {
    appendSetToExercise,
    buildLoggedSet,
    extractPlannedStrengthExercises,
    prefillNextSet,
    upsertExercise,
    type PlannedStrengthExercise,
    type SetEntryDraft,
} from '../workouts/strengthSessionEntry';

/** Thin orchestration over `strengthSessionEntry.ts` (pure logic, fully unit-tested) and
 *  `strengthSessionService.ts` (I/O, fully unit-tested). This repo has no
 *  `@testing-library/react` and no hook has its own test file (e.g. `useGarminSyncStatus`);
 *  the rules that matter are tested at the layers below, not here. */
export interface UseStrengthSessionRunnerResult {
    loading: boolean;
    saving: boolean;
    error: string | null;
    session: StrengthSession | null;
    plannedExercises: PlannedStrengthExercise[];
    activeExerciseIndex: number | null;
    draft: SetEntryDraft;
    start: () => Promise<void>;
    selectExercise: (exerciseId: string | null, freeTextName?: string) => void;
    updateDraft: (patch: Partial<SetEntryDraft>) => void;
    logSet: () => Promise<void>;
    finishSession: () => Promise<void>;
    abandonSession: () => Promise<void>;
}

const EMPTY_DRAFT: SetEntryDraft = { reps: 1, weightKg: null, isWarmup: false };

export function useStrengthSessionRunner(userId: string | null | undefined): UseStrengthSessionRunnerResult {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [session, setSession] = useState<StrengthSession | null>(null);
    const [plannedExercises, setPlannedExercises] = useState<PlannedStrengthExercise[]>([]);
    const [activeExerciseIndex, setActiveExerciseIndex] = useState<number | null>(null);
    const [draft, setDraft] = useState<SetEntryDraft>(EMPTY_DRAFT);

    // Resume-on-open: an in_progress session left from earlier today (or last night, if it
    // crosses midnight -- findActiveSession deliberately ignores `date` for this) is
    // restored rather than silently orphaned. This is also where a stale session gets
    // abandoned (S1.4), so opening the runner is the "opportunistic" trigger the service
    // was designed around.
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
                if (active?.sourceRecommendationDate) {
                    const recommendation = await recommendationService.getRecommendation(userId, active.sourceRecommendationDate);
                    if (!cancelled) setPlannedExercises(extractPlannedStrengthExercises(recommendation?.prescription));
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

    const start = useCallback(async () => {
        if (!userId) return;
        setError(null);
        try {
            const today = getLocalDateString();
            const recommendation = await recommendationService.getRecommendation(userId, today);
            const planned = extractPlannedStrengthExercises(recommendation?.prescription);
            const started = await strengthSessionService.startSession(userId, {
                ...(planned.length > 0 ? { sourceRecommendationDate: today } : {}),
            });
            setSession(started);
            setPlannedExercises(planned);
            setActiveExerciseIndex(null);
            setDraft(EMPTY_DRAFT);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not start a strength session');
        }
    }, [userId]);

    const selectExercise = useCallback((exerciseId: string | null, freeTextName?: string) => {
        if (!session) return;
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
            // Persisted immediately, matching every other write in this hook -- an added
            // exercise with zero sets is still real session state (e.g. "planned but not
            // yet started"), not something to lose on a killed app before the first set.
            strengthSessionService.saveExercises(userId!, session.sessionId, updated).catch(err => {
                setError(err instanceof Error ? err.message : 'Could not save the selected exercise');
            });
        }
    }, [session, plannedExercises, userId]);

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
            // D-SETLOG: persist the moment the set is logged, not batched until "Done".
            // await resolves against the local cache immediately even offline (S1.1); it
            // does not wait for a server round-trip.
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

    const closeSession = useCallback(async (next: 'completed' | 'abandoned') => {
        if (!session) return;
        setError(null);
        try {
            const updated = await strengthSessionService.transitionState(userId!, session.sessionId, next);
            setSession(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : `Could not mark the session ${next}`);
        }
    }, [session, userId]);

    const finishSession = useCallback(() => closeSession('completed'), [closeSession]);
    const abandonSession = useCallback(() => closeSession('abandoned'), [closeSession]);

    return {
        loading, saving, error, session, plannedExercises, activeExerciseIndex, draft,
        start, selectExercise, updateDraft, logSet, finishSession, abandonSession,
    };
}
