import { useEffect, useMemo, useState } from 'react';
import { strengthHistoryReadService } from '../services/strengthHistoryReadService';
import type { StrengthSession } from '../engine/models';
import { distinctLoggedExercises, summarizeExerciseAcrossSessions, type ExerciseIdentity, type ExerciseSessionSummary } from '../workouts/overloadHistory';
import { addDaysToLocalDateString, getLocalDateString } from '../utils/localDate';

/** Thin orchestration over `overloadHistory.ts` (pure, fully unit-tested) and
 *  `strengthHistoryReadService.getSessionsInRange`. No dedicated test file -- same rationale as
 *  every other hook added in this plan: no `@testing-library/react` in this toolchain, and
 *  the two things worth testing (the aggregation math, the query shape) are each tested at
 *  the layer below. */
export interface UseOverloadHistoryResult {
    loading: boolean;
    error: string | null;
    exercises: ExerciseIdentity[];
    selected: ExerciseIdentity | null;
    select: (identity: ExerciseIdentity | null) => void;
    history: ExerciseSessionSummary[];
    invalidRecords: number;
}

const DEFAULT_WINDOW_DAYS = 90;

export function useOverloadHistory(userId: string | null | undefined, windowDays: number = DEFAULT_WINDOW_DAYS): UseOverloadHistoryResult {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<StrengthSession[]>([]);
    const [invalidRecords, setInvalidRecords] = useState(0);
    const [selected, setSelected] = useState<ExerciseIdentity | null>(null);

    useEffect(() => {
        // Same no-userId early-exit shape as App.tsx's loadDecisionInput effect; there is
        // no external system to defer this to when there is nothing to load in the first
        // place.
        if (!userId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        const today = getLocalDateString();
        const throughDateExclusive = addDaysToLocalDateString(today, 1);
        const startInclusive = addDaysToLocalDateString(throughDateExclusive, -windowDays);
        strengthHistoryReadService.getSessionsInRange(userId, startInclusive, throughDateExclusive)
            .then(result => {
                if (cancelled) return;
                setSessions(result.sessions);
                setInvalidRecords(result.invalidRecords);
            })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load strength session history');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [userId, windowDays]);

    const exercises = useMemo(() => distinctLoggedExercises(sessions), [sessions]);
    const history = useMemo(() => (selected ? summarizeExerciseAcrossSessions(sessions, selected) : []), [sessions, selected]);

    return { loading, error, exercises, selected, select: setSelected, history, invalidRecords };
}
