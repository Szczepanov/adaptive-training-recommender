/**
 * Performed-workout JSON export for the Completed Workout card.
 *
 * Unlike `canonical_workout_v1` (`utils/workoutJsonExport.ts`), which is the *prescription*
 * and feeds Garmin sync, this is what was actually done: every exercise with its prescribed
 * target next to each logged set (reps, weight, duration, distance, RPE/RIR) and the
 * performed rest after it, plus the duration the app itself recorded. Garmin telemetry is
 * attached as enrichment only (ADR-0034 source precedence).
 *
 * Pure: the caller supplies the already-hydrated `CompletedWorkoutView` and `exportedAt`.
 */
import type { IntensityGauge, NormalizedGarminActivity } from '../engine/models';
import type { ExerciseRef, RangeOrNumber, RestEndReason, SessionEntryPayload, SessionLoad } from '../sessions/models';
import type { CompletedWorkoutView, PerformedRestAvailability, StructuredExecutionSummary } from './completedWorkoutView';
import type { SessionResponse } from '../responses/models';
import type { PerformedSetRow, PrescribedStepTarget, StepChoiceDetail, StructuredStepDetail } from './structuredSetDetail';

export const COMPLETED_WORKOUT_EXPORT_SCHEMA = 'completed_workout_v1' as const;

/** Where `duration` came from, most to least authoritative. */
export type CompletedDurationSource = 'app_execution' | 'occurrence' | 'provider';

export interface CompletedWorkoutDuration {
    seconds: number;
    minutes: number;
    source: CompletedDurationSource;
    startedAt?: string;
    endedAt?: string;
}

export interface ExportedSetEffort {
    rpe?: number;
    rir?: number;
    velocityLossPercent?: number;
    techniqueMet?: boolean;
}

export interface ExportedPerformedSet {
    setNumber: number;
    isWarmup: boolean;
    completedAt: string;
    kind: SessionEntryPayload['kind'];
    reps?: number;
    weightKg?: number;
    durationSeconds?: number;
    distanceMeters?: number;
    heightInches?: number;
    completed?: boolean;
    effort?: ExportedSetEffort;
    /** Set when the athlete swapped to a different exercise for this set. */
    performedExercise?: ExerciseRef;
    rest?: {
        actualSeconds: number;
        prescribedSeconds?: number;
        endReason: RestEndReason;
    };
}

export interface ExportedPrescription {
    sets: number;
    reps?: RangeOrNumber;
    seconds?: RangeOrNumber;
    meters?: RangeOrNumber;
    load?: SessionLoad;
    targetRpe?: RangeOrNumber;
    targetRir?: RangeOrNumber;
    restSeconds?: RangeOrNumber;
    tempo?: string;
    notes?: string;
}

export interface ExportedExercise {
    stepId: string;
    /** What was performed: the swapped-in exercise when the athlete swapped mid-session. */
    name: string;
    /** The authored exercise name, present only when a swap replaced it. */
    plannedName?: string;
    /** The authored exercise reference. */
    exercise?: ExerciseRef;
    /** The performed exercise reference, present only when it differs from `exercise`. */
    performedExercise?: ExerciseRef;
    /** True for an exercise the athlete added during the session (no prescription). */
    unplanned?: true;
    optional: boolean;
    prescribed: ExportedPrescription;
    /** Authored choices the athlete resolved during the step. */
    choices?: StepChoiceDetail[];
    performed: {
        workSets: number;
        warmupSets: number;
        /** Work-set repetitions only (warm-ups are reported in `warmupReps` when present). */
        totalReps: number;
        warmupReps?: number;
        tonnageKg: number;
        totalDurationSeconds?: number;
        totalDistanceMeters?: number;
        sets: ExportedPerformedSet[];
    };
}

/** A post-session response, projected to the facts an AI reader needs (no ids or check-in linkage). */
export interface ExportedSessionResponse {
    window: SessionResponse['window'];
    sessionRpe?: number;
    completedFraction?: number;
    unexpectedFatigue?: boolean;
    techniqueNote?: string;
    note?: string;
}

export interface CompletedWorkoutExport {
    schemaVersion: typeof COMPLETED_WORKOUT_EXPORT_SCHEMA;
    exportedAt: string;
    performedOccurrenceId: string;
    title: string;
    localDate?: string;
    modality?: string;
    sources: { structured: boolean; providers: string[] };
    /** Actual duration -- from the app's own execution timestamps whenever available. */
    duration?: CompletedWorkoutDuration;
    session?: {
        executionId: string;
        state: StructuredExecutionSummary['state'];
        executedDefinition?: 'authored' | 'reduced';
        sessionRpe?: number;
        completedFraction?: number;
        unexpectedFatigue?: boolean;
        note?: string;
    };
    summary?: {
        exercises: number;
        workSets: number;
        /** Work-set repetitions only (warm-ups are reported in `warmupReps` when present). */
        totalReps: number;
        warmupReps?: number;
        tonnageKg: number;
        totalDurationSeconds?: number;
        totalDistanceMeters?: number;
        totalPerformedRestSeconds: number;
    };
    /** `not_recorded` means no rest events exist, not zero rest; `unavailable` means unknown. */
    performedRest?: PerformedRestAvailability;
    exercises: ExportedExercise[];
    /** Omitted when responses were not requested; `unavailable` when they could not be read. */
    responses?: ExportedSessionResponse[] | 'unavailable';
    /** Raw provider telemetry, enrichment only. */
    providerActivity?: NormalizedGarminActivity;
}

function secondsBetween(startIso: string | undefined, endIso: string | undefined): number | null {
    if (!startIso || !endIso) return null;
    const ms = Date.parse(endIso) - Date.parse(startIso);
    return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

function durationOf(seconds: number, source: CompletedDurationSource, startedAt?: string, endedAt?: string): CompletedWorkoutDuration {
    return {
        seconds,
        minutes: Math.round(seconds / 60),
        source,
        ...(startedAt ? { startedAt } : {}),
        ...(endedAt ? { endedAt } : {}),
    };
}

/**
 * Actual duration, never the prescription: the app's own execution start/finish first,
 * then the reconciled occurrence window, then the provider recording.
 */
export function resolveCompletedWorkoutDuration(view: CompletedWorkoutView): CompletedWorkoutDuration | undefined {
    const execution = view.structured?.execution;
    const appSeconds = secondsBetween(execution?.startedAt, execution?.completedAt);
    if (execution && appSeconds !== null) {
        return durationOf(appSeconds, 'app_execution', execution.startedAt, execution.completedAt);
    }
    const occurrenceSeconds = secondsBetween(view.startedAt, view.endedAt);
    if (occurrenceSeconds !== null) {
        return durationOf(occurrenceSeconds, 'occurrence', view.startedAt, view.endedAt);
    }
    const providerMin = view.garmin?.durationMin;
    if (typeof providerMin === 'number' && Number.isFinite(providerMin) && providerMin >= 0) {
        return durationOf(Math.round(providerMin * 60), 'provider', view.garmin?.startedAt);
    }
    return undefined;
}

function effortOf(gauge: IntensityGauge | undefined): ExportedSetEffort | undefined {
    if (!gauge) return undefined;
    switch (gauge.scale) {
        case 'rpe_rts': return { rpe: gauge.value };
        case 'rir': return { rir: gauge.value };
        case 'velocity_loss': return { velocityLossPercent: gauge.percent };
        case 'technical': return { techniqueMet: gauge.met };
    }
}

function payloadFields(payload: SessionEntryPayload): Partial<ExportedPerformedSet> {
    switch (payload.kind) {
        case 'repetition': {
            const effort = effortOf(payload.gauge);
            return {
                reps: payload.reps,
                ...(payload.weightKg !== undefined ? { weightKg: payload.weightKg } : {}),
                ...(effort ? { effort } : {}),
            };
        }
        case 'duration':
            return { durationSeconds: payload.seconds, ...(payload.loadKg !== undefined ? { weightKg: payload.loadKg } : {}) };
        case 'distance':
            return {
                distanceMeters: payload.meters,
                ...(payload.durationSeconds !== undefined ? { durationSeconds: payload.durationSeconds } : {}),
                ...(payload.loadKg !== undefined ? { weightKg: payload.loadKg } : {}),
            };
        case 'sprint':
            return { distanceMeters: payload.meters, durationSeconds: payload.splitSeconds };
        case 'jump_attempt':
            return {
                ...(payload.heightInches !== undefined ? { heightInches: payload.heightInches } : {}),
                ...(payload.distanceMeters !== undefined ? { distanceMeters: payload.distanceMeters } : {}),
            };
        case 'checkoff':
            return { completed: payload.completed };
        case 'choice':
            return {};
    }
}

function exportSet(row: PerformedSetRow): ExportedPerformedSet {
    return {
        setNumber: row.setNumber,
        isWarmup: row.isWarmup,
        completedAt: row.completedAt,
        kind: row.payload.kind,
        ...payloadFields(row.payload),
        ...(row.exerciseRef ? { performedExercise: row.exerciseRef } : {}),
        ...(row.rest
            ? {
                rest: {
                    actualSeconds: row.rest.actualSeconds,
                    ...(row.rest.prescribedSeconds !== undefined ? { prescribedSeconds: row.rest.prescribedSeconds } : {}),
                    endReason: row.rest.endReason,
                },
            }
            : {}),
    };
}

function exportPrescription(target: PrescribedStepTarget): ExportedPrescription {
    return {
        sets: target.sets,
        ...(target.reps !== undefined ? { reps: target.reps } : {}),
        ...(target.seconds !== undefined ? { seconds: target.seconds } : {}),
        ...(target.meters !== undefined ? { meters: target.meters } : {}),
        ...(target.load ? { load: target.load } : {}),
        ...(target.effort?.rpe !== undefined ? { targetRpe: target.effort.rpe } : {}),
        ...(target.effort?.rir !== undefined ? { targetRir: target.effort.rir } : {}),
        ...(target.restSeconds !== undefined ? { restSeconds: target.restSeconds } : {}),
        ...(target.tempo ? { tempo: target.tempo } : {}),
        ...(target.notes ? { notes: target.notes } : {}),
    };
}

/** Projects a structured session step and its logged sets into the exported exercise summary. */
function exportExercise(step: StructuredStepDetail): ExportedExercise {
    const sets = step.sets.map(exportSet);
    const work = sets.filter(set => !set.isWarmup);
    const warmup = sets.filter(set => set.isWarmup);
    const warmupReps = warmup.reduce((sum, set) => sum + (set.reps ?? 0), 0);
    const totalDurationSeconds = work.reduce((sum, set) => sum + (set.durationSeconds ?? 0), 0);
    const totalDistanceMeters = work.reduce((sum, set) => sum + (set.distanceMeters ?? 0), 0);
    return {
        stepId: step.stepId,
        name: step.title,
        ...(step.plannedTitle ? { plannedName: step.plannedTitle } : {}),
        ...(step.exerciseRef ? { exercise: step.exerciseRef } : {}),
        ...(step.performedExerciseRef ? { performedExercise: step.performedExerciseRef } : {}),
        ...(step.unplanned ? { unplanned: true as const } : {}),
        optional: step.isOptional,
        prescribed: exportPrescription(step.prescribed),
        ...(step.choices && step.choices.length > 0 ? { choices: step.choices.map(choice => ({ ...choice })) } : {}),
        performed: {
            workSets: work.length,
            warmupSets: warmup.length,
            totalReps: work.reduce((sum, set) => sum + (set.reps ?? 0), 0),
            ...(warmupReps > 0 ? { warmupReps } : {}),
            tonnageKg: work.reduce((sum, set) => sum + (set.reps ?? 0) * (set.weightKg ?? 0), 0),
            ...(totalDurationSeconds > 0 ? { totalDurationSeconds } : {}),
            ...(totalDistanceMeters > 0 ? { totalDistanceMeters } : {}),
            sets,
        },
    };
}

function exportSession(execution: StructuredExecutionSummary): NonNullable<CompletedWorkoutExport['session']> {
    return {
        executionId: execution.executionId,
        state: execution.state,
        ...(execution.executedDefinition ? { executedDefinition: execution.executedDefinition } : {}),
        ...(execution.sessionRpe !== undefined ? { sessionRpe: execution.sessionRpe } : {}),
        ...(execution.completedFraction !== undefined ? { completedFraction: execution.completedFraction } : {}),
        ...(execution.unexpectedFatigue !== undefined ? { unexpectedFatigue: execution.unexpectedFatigue } : {}),
        ...(execution.note ? { note: execution.note } : {}),
    };
}

const WINDOW_ORDER: Record<SessionResponse['window'], number> = { immediate: 0, later_day: 1, next_morning: 2 };

function exportResponses(responses: readonly SessionResponse[]): ExportedSessionResponse[] {
    return [...responses]
        .sort((a, b) => WINDOW_ORDER[a.window] - WINDOW_ORDER[b.window] || a.createdAt.localeCompare(b.createdAt))
        .map(response => ({
            window: response.window,
            ...(response.sessionRpe !== undefined ? { sessionRpe: response.sessionRpe } : {}),
            ...(response.completedFraction !== undefined ? { completedFraction: response.completedFraction } : {}),
            ...(response.unexpectedFatigue !== undefined ? { unexpectedFatigue: response.unexpectedFatigue } : {}),
            ...(response.techniqueNote ? { techniqueNote: response.techniqueNote } : {}),
            ...(response.note ? { note: response.note } : {}),
        }));
}

function workoutTitle(view: CompletedWorkoutView): string {
    return view.structured?.title ?? view.garmin?.type.replaceAll('_', ' ') ?? 'Workout';
}

/** Builds a portable JSON export record for a completed workout occurrence. */
export function exportCompletedWorkoutToJson(
    view: CompletedWorkoutView,
    exportedAt: string,
    responses?: readonly SessionResponse[] | 'unavailable',
): CompletedWorkoutExport {
    const exercises = view.structured ? view.structured.steps.map(exportExercise) : [];
    const duration = resolveCompletedWorkoutDuration(view);
    const execution = view.structured?.execution;
    const allSets = exercises.flatMap(exercise => exercise.performed.sets);
    return {
        schemaVersion: COMPLETED_WORKOUT_EXPORT_SCHEMA,
        exportedAt,
        performedOccurrenceId: view.performedOccurrenceId,
        title: workoutTitle(view),
        ...(view.localDate ? { localDate: view.localDate } : {}),
        ...(view.modality ? { modality: view.modality } : {}),
        sources: { structured: view.sourceBadge.hasStructured, providers: [...view.sourceBadge.providers] },
        ...(duration ? { duration } : {}),
        ...(execution ? { session: exportSession(execution) } : {}),
        ...(view.structured
            ? (() => {
                const warmupReps = exercises.reduce((sum, exercise) => sum + (exercise.performed.warmupReps ?? 0), 0);
                const totalDurationSeconds = exercises.reduce((sum, exercise) => sum + (exercise.performed.totalDurationSeconds ?? 0), 0);
                const totalDistanceMeters = exercises.reduce((sum, exercise) => sum + (exercise.performed.totalDistanceMeters ?? 0), 0);
                return {
                    summary: {
                        exercises: exercises.filter(exercise => exercise.performed.sets.length > 0).length,
                        workSets: exercises.reduce((sum, exercise) => sum + exercise.performed.workSets, 0),
                        totalReps: exercises.reduce((sum, exercise) => sum + exercise.performed.totalReps, 0),
                        ...(warmupReps > 0 ? { warmupReps } : {}),
                        tonnageKg: exercises.reduce((sum, exercise) => sum + exercise.performed.tonnageKg, 0),
                        ...(totalDurationSeconds > 0 ? { totalDurationSeconds } : {}),
                        ...(totalDistanceMeters > 0 ? { totalDistanceMeters } : {}),
                        totalPerformedRestSeconds: allSets.reduce(
                            (sum, set) => sum + (set.rest && set.rest.endReason !== 'session_ended' ? set.rest.actualSeconds : 0),
                            0,
                        ),
                    },
                    performedRest: view.structured.performedRest,
                };
            })()
            : {}),
        exercises,
        ...(responses !== undefined ? { responses: responses === 'unavailable' ? responses : exportResponses(responses) } : {}),
        ...(view.garmin ? { providerActivity: view.garmin } : {}),
    };
}

export function formatCompletedWorkoutJson(
    view: CompletedWorkoutView,
    exportedAt: string,
    responses?: readonly SessionResponse[] | 'unavailable',
): string {
    return JSON.stringify(exportCompletedWorkoutToJson(view, exportedAt, responses), null, 2);
}
