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

/**
 * Pure read adapter converting normalized execution records (M2.7 / ADR-0023)
 * back to StrengthSession models for backwards compatibility with overload history,
 * 1RM derivation, and legacy reporting.
 */
export function adaptNormalizedExecutionToStrengthSession(
    record: NormalizedExecutionRecord,
): StrengthSession {
    const repEntries = record.entries.filter(
        (e): e is SessionEntry & { payload: Extract<SessionEntry['payload'], { kind: 'repetition' }> } =>
            e.payload.kind === 'repetition',
    );

    const exerciseMap = new Map<string, { exercise: LoggedExercise; sets: LoggedSet[] }>();

    for (const entry of repEntries) {
        let exerciseId: string | null = null;
        let freeTextName: string | undefined = undefined;

        if (entry.exerciseRef?.kind === 'catalog') {
            exerciseId = entry.exerciseRef.exerciseId;
        } else if (entry.exerciseRef?.kind === 'unresolved_free_text') {
            freeTextName = entry.exerciseRef.name;
        }

        const key = exerciseId !== null ? `catalog:${exerciseId}` : `free:${freeTextName ?? 'unknown'}`;

        if (!exerciseMap.has(key)) {
            exerciseMap.set(key, {
                exercise: {
                    exerciseId,
                    ...(freeTextName ? { freeTextName } : {}),
                    sets: [],
                },
                sets: [],
            });
        }

        const group = exerciseMap.get(key)!;
        const p = entry.payload;
        group.sets.push({
            setIndex: p.setIndex,
            reps: p.reps,
            weightKg: p.weightKg !== undefined ? p.weightKg : null,
            isWarmup: p.isWarmup ?? false,
            completedAt: entry.completedAt,
            ...(p.gauge ? { gauge: p.gauge } : {}),
        });
    }

    const exercises: LoggedExercise[] = [];
    for (const group of exerciseMap.values()) {
        group.sets.sort((a, b) => a.setIndex - b.setIndex || a.completedAt.localeCompare(b.completedAt));
        exercises.push({
            ...group.exercise,
            sets: group.sets,
        });
    }

    return {
        userId: record.execution.userId,
        sessionId: record.execution.executionId,
        date: record.execution.date,
        startedAt: record.execution.startedAt,
        ...(record.execution.completedAt ? { completedAt: record.execution.completedAt } : {}),
        updatedAt: record.execution.updatedAt,
        state: record.execution.state,
        ...(record.execution.sessionRpe !== undefined ? { sessionRpe: record.execution.sessionRpe } : {}),
        ...(record.execution.notes !== undefined ? { notes: record.execution.notes } : {}),
        exercises,
        schemaVersion: 1,
    };
}
