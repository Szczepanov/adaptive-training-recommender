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
import type { ResponseWindow, SessionResponse } from '../responses/models';
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
    /** The choice event in force when this set was performed; a later correction never moves it. */
    governingChoiceEntryId?: string;
    selectedOptionId?: string;
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
    /** True for a non-exercise step kept only for a recorded choice (`prescribed.sets` is 0). */
    choiceOnly?: true;
    optional: boolean;
    prescribed: ExportedPrescription;
    /** Authored choices the athlete resolved during the step, corrected ones included. */
    choices?: StepChoiceDetail[];
    /** `not_performed` only when the whole set log was read; `unknown` when it was not.
     * A failed checkoff is not performed evidence; a completed checkoff or a timed or
     * distance entry is. Absent for a choice-only step. */
    performedStatus?: ExercisePerformedStatus;
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

export type ExercisePerformedStatus = 'performed' | 'not_performed' | 'unknown';

/** How completely the structured set log was read. `unknown`: completeness cannot be shown --
 * the view predates the field, or this device's diary outbox holds failed (never saved) writes
 * or could not be read, so the stored log may be missing work. */
export type StructuredEntriesRead =
    | { status: 'complete' }
    | { status: 'partial'; invalidRecords: number }
    | { status: 'unknown'; reason: 'not_hydrated' }
    /** The set log read itself failed, so no step detail exists at all. */
    | { status: 'unknown'; reason: 'entries_unavailable' }
    | { status: 'unknown'; reason: 'diary_writes_failed'; failedWrites: number }
    | { status: 'unknown'; reason: 'diary_outbox_unreadable' };

/**
 * The result of reading a workout's post-session responses (#1261). `read` with
 * `invalidRecords > 0` is a partial read: some response documents could not be parsed.
 */
export type SessionResponseRead =
    | { status: 'read'; responses: readonly SessionResponse[]; invalidRecords: number }
    | { status: 'failed' };

/** Accepted response input. A bare array is a complete read; `'unavailable'` is a failed one. */
export type CompletedWorkoutResponsesInput = readonly SessionResponse[] | 'unavailable' | SessionResponseRead;

export type ResponseReadStatus =
    | { status: 'complete' }
    | { status: 'partial'; invalidRecords: number }
    | { status: 'failed' };

/** Per window: `not_recorded` only after a complete read; `unknown` when the read failed or was partial. */
export type ResponseWindowState = 'recorded' | 'not_recorded' | 'unknown';

/** A post-session response, projected to the facts an AI reader needs (no ids or check-in linkage). */
export interface ExportedSessionResponse {
    window: SessionResponse['window'];
    /** The Warsaw date the response was recorded for (later than the session for `next_morning`). */
    date: string;
    /** The source session's own date, kept separate from the response date. */
    sourceSessionDate: string;
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
    /** Present for a structured workout: whether every logged entry could be read. */
    structuredEntries?: StructuredEntriesRead;
    exercises: ExportedExercise[];
    /** Recorded choices that apply to no step. */
    sessionChoices?: StepChoiceDetail[];
    /** Omitted when responses were not requested; `unavailable` when they could not be read. */
    responses?: ExportedSessionResponse[] | 'unavailable';
    /** Present whenever `responses` is: complete, partial or failed. */
    responseRead?: ResponseReadStatus;
    /** Present whenever `responses` is: which windows have a recorded response. */
    responseWindows?: Record<ResponseWindow, ResponseWindowState>;
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
        ...(row.governingChoiceEntryId ? { governingChoiceEntryId: row.governingChoiceEntryId } : {}),
        ...(row.selectedOptionId ? { selectedOptionId: row.selectedOptionId } : {}),
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

/** A failed checkoff is the only logged work set that is not evidence of performance. */
function isPerformedEvidence(set: ExportedPerformedSet): boolean {
    return !set.isWarmup && !(set.kind === 'checkoff' && set.completed === false);
}

function performedStatusOf(sets: readonly ExportedPerformedSet[], entries: StructuredEntriesRead): ExercisePerformedStatus {
    if (sets.some(isPerformedEvidence)) return 'performed';
    return entries.status === 'complete' ? 'not_performed' : 'unknown';
}

export function structuredEntriesReadOf(view: CompletedWorkoutView): StructuredEntriesRead {
    if (!view.structured && view.sourceReads.structured.status === 'entries_unavailable') {
        return { status: 'unknown', reason: 'entries_unavailable' };
    }
    const invalid = view.structured?.entryInvalidRecords;
    if (invalid === undefined) return { status: 'unknown', reason: 'not_hydrated' };
    if (invalid > 0) return { status: 'partial', invalidRecords: invalid };
    // A rejected diary write never reached the stored log, so a clean read can still miss work.
    const outbox = view.sourceReads.outbox;
    if (outbox.status === 'unreadable') return { status: 'unknown', reason: 'diary_outbox_unreadable' };
    if (outbox.status === 'read' && outbox.failed > 0) {
        return { status: 'unknown', reason: 'diary_writes_failed', failedWrites: outbox.failed };
    }
    return { status: 'complete' };
}

/** Projects a structured session step and its logged sets into the exported exercise summary. */
function exportExercise(step: StructuredStepDetail, entries: StructuredEntriesRead): ExportedExercise {
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
        ...(step.choiceOnly ? { choiceOnly: true as const } : {}),
        optional: step.isOptional,
        prescribed: exportPrescription(step.prescribed),
        ...(step.choices && step.choices.length > 0 ? { choices: step.choices.map(choice => ({ ...choice })) } : {}),
        ...(step.choiceOnly ? {} : { performedStatus: performedStatusOf(sets, entries) }),
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
            date: response.date,
            sourceSessionDate: response.sourceSession.date,
            ...(response.sessionRpe !== undefined ? { sessionRpe: response.sessionRpe } : {}),
            ...(response.completedFraction !== undefined ? { completedFraction: response.completedFraction } : {}),
            ...(response.unexpectedFatigue !== undefined ? { unexpectedFatigue: response.unexpectedFatigue } : {}),
            ...(response.techniqueNote ? { techniqueNote: response.techniqueNote } : {}),
            ...(response.note ? { note: response.note } : {}),
        }));
}

function normalizeResponseRead(input: CompletedWorkoutResponsesInput): SessionResponseRead {
    if (input === 'unavailable') return { status: 'failed' };
    if ('status' in input) return input;
    return { status: 'read', responses: input, invalidRecords: 0 };
}

/** `responses`, `responseRead` and `responseWindows` together, so a failed or partial read
 * never looks like a complete read that found nothing. */
function exportResponseFields(
    input: CompletedWorkoutResponsesInput,
): Pick<CompletedWorkoutExport, 'responses' | 'responseRead' | 'responseWindows'> {
    const read = normalizeResponseRead(input);
    if (read.status === 'failed') {
        return {
            responses: 'unavailable',
            responseRead: { status: 'failed' },
            responseWindows: { immediate: 'unknown', later_day: 'unknown', next_morning: 'unknown' },
        };
    }
    const recorded = new Set(read.responses.map(response => response.window));
    const absent: ResponseWindowState = read.invalidRecords > 0 ? 'unknown' : 'not_recorded';
    const stateOf = (window: ResponseWindow): ResponseWindowState => (recorded.has(window) ? 'recorded' : absent);
    return {
        responses: exportResponses(read.responses),
        responseRead: read.invalidRecords > 0 ? { status: 'partial', invalidRecords: read.invalidRecords } : { status: 'complete' },
        responseWindows: {
            immediate: stateOf('immediate'),
            later_day: stateOf('later_day'),
            next_morning: stateOf('next_morning'),
        },
    };
}

function workoutTitle(view: CompletedWorkoutView): string {
    return view.structured?.title ?? view.garmin?.type.replaceAll('_', ' ') ?? 'Workout';
}

/** Builds a portable JSON export record for a completed workout occurrence. */
export function exportCompletedWorkoutToJson(
    view: CompletedWorkoutView,
    exportedAt: string,
    responses?: CompletedWorkoutResponsesInput,
): CompletedWorkoutExport {
    const entries = structuredEntriesReadOf(view);
    const exercises = view.structured ? view.structured.steps.map(step => exportExercise(step, entries)) : [];
    const sessionChoices = view.structured?.sessionChoices ?? [];
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
        ...(view.structured || entries.status === 'unknown' && entries.reason === 'entries_unavailable'
            ? { structuredEntries: entries }
            : {}),
        exercises,
        ...(sessionChoices.length > 0 ? { sessionChoices: sessionChoices.map(choice => ({ ...choice })) } : {}),
        ...(responses !== undefined ? exportResponseFields(responses) : {}),
        ...(view.garmin ? { providerActivity: view.garmin } : {}),
    };
}

export function formatCompletedWorkoutJson(
    view: CompletedWorkoutView,
    exportedAt: string,
    responses?: CompletedWorkoutResponsesInput,
): string {
    return JSON.stringify(exportCompletedWorkoutToJson(view, exportedAt, responses), null, 2);
}
