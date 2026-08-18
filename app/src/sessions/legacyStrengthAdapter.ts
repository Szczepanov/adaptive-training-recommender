import type { StrengthSession, LoggedExercise, LoggedSet } from '../engine/models';
import type { SessionExecution, SessionEntry, ExerciseRef } from './models';

export interface NormalizedExecutionRecord {
    execution: SessionExecution;
    entries: SessionEntry[];
}

/**
 * Permanent pure read adapter converting legacy ADR-0021 StrengthSession v1 documents
 * to version-neutral execution records (M2.7 / ADR-0023).
 *
 * No Firestore bulk migration is performed. Missing step, side, source or occurrence facts
 * remain missing rather than guessed.
 */
export function adaptStrengthSessionToNormalizedExecution(
    session: StrengthSession,
): NormalizedExecutionRecord {
    const execution: SessionExecution = {
        userId: session.userId,
        executionId: session.sessionId,
        sessionSource: session.sourceRecommendationDate
            ? { kind: 'catalog', workoutId: 'legacy_strength', catalogVersion: '1' }
            : { kind: 'manual', definitionId: 'legacy_strength', revision: 1, contentHash: 'legacy' },
        date: session.date,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        updatedAt: session.updatedAt,
        state: session.state,
        sessionRpe: session.sessionRpe,
        notes: session.notes,
        schemaVersion: 1,
    };

    const entries: SessionEntry[] = [];

    session.exercises.forEach((ex: LoggedExercise, exIdx: number) => {
        const exerciseRef: ExerciseRef = ex.exerciseId
            ? { kind: 'catalog', exerciseId: ex.exerciseId }
            : { kind: 'unresolved_free_text', name: ex.freeTextName || 'Unknown exercise' };

        ex.sets.forEach((set: LoggedSet) => {
            const entryId = `${session.sessionId}-ex${exIdx}-set${set.setIndex}`;
            entries.push({
                id: entryId,
                executionId: session.sessionId,
                exerciseRef,
                completedAt: set.completedAt,
                createdAt: set.completedAt,
                updatedAt: set.completedAt,
                payload: {
                    kind: 'repetition',
                    setIndex: set.setIndex,
                    reps: set.reps,
                    ...(set.weightKg !== null ? { weightKg: set.weightKg } : {}),
                    isWarmup: set.isWarmup,
                    ...(set.gauge ? { gauge: set.gauge } : {}),
                },
            });
        });
    });

    return {
        execution,
        entries,
    };
}
