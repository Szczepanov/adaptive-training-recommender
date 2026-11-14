/**
 * Markdown session report for the Completed Workout card.
 *
 * Written for an external AI coach that reads it pasted into a chat. It renders the output of
 * `exportCompletedWorkoutToJson`, never the raw view, so the JSON and Markdown exports cannot
 * disagree. Absent data reads "not recorded" -- never a fabricated zero. Nothing user-identifying
 * is printed: the only identifier is the occurrence id on the final `ref:` line.
 *
 * Pure: the caller supplies the hydrated view, `exportedAt` and any responses.
 */
import type { ExerciseRef, RangeOrNumber, SessionLoad } from '../sessions/models';
import type { SessionResponse } from '../responses/models';
import type { CompletedWorkoutView } from './completedWorkoutView';
import {
    exportCompletedWorkoutToJson,
    type CompletedWorkoutExport,
    type ExportedExercise,
    type ExportedPerformedSet,
    type ExportedPrescription,
    type ExportedSessionResponse,
} from './completedWorkoutJsonExport';

const NOT_RECORDED = 'not recorded';

/** Free text is collapsed to one line so it cannot break the line-oriented layout. */
function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function range(value: RangeOrNumber): string {
    return typeof value === 'number' ? String(value) : `${value.min}–${value.max}`;
}

function loadText(load: SessionLoad): string {
    switch (load.kind) {
        case 'mass': return `${range(load.kg)} kg`;
        case 'bodyweight': return 'bodyweight';
        case 'band': return `${oneLine(load.bandColor)} band`;
        case 'percent_max': return `${load.percent}% max`;
        case 'percent_one_rm': return `${load.percent}% 1RM`;
        case 'relative_step': return `${load.percent}% of a prior step`;
        case 'descriptive': return oneLine(load.display ?? load.description ?? 'descriptive load');
        case 'unloaded': return 'unloaded';
    }
}

function exerciseRefLabel(ref: ExerciseRef): string {
    return ref.kind === 'catalog' ? ref.exerciseId : oneLine(ref.name);
}

/** `3×4–6 @ 120 kg, RPE 8, rest 180 s, tempo 3-1-1-0`; only parts present are printed. */
function prescriptionText(p: ExportedPrescription): string {
    const dose = p.reps !== undefined ? `${p.sets}×${range(p.reps)}`
        : p.seconds !== undefined ? `${p.sets}×${range(p.seconds)} s`
            : p.meters !== undefined ? `${p.sets}×${range(p.meters)} m`
                : `${p.sets} sets`;
    const parts = [p.load ? `${dose} @ ${loadText(p.load)}` : dose];
    if (p.targetRir !== undefined) parts.push(`RIR ${range(p.targetRir)}`);
    if (p.targetRpe !== undefined) parts.push(`RPE ${range(p.targetRpe)}`);
    if (p.restSeconds !== undefined) parts.push(`rest ${range(p.restSeconds)} s`);
    if (p.tempo) parts.push(`tempo ${oneLine(p.tempo)}`);
    return parts.join(', ');
}

function setBody(set: ExportedPerformedSet): string {
    const kg = set.weightKg !== undefined ? ` @ ${set.weightKg} kg` : '';
    switch (set.kind) {
        case 'repetition':
            return set.weightKg !== undefined ? `${set.reps ?? 0} @ ${set.weightKg} kg` : `${set.reps ?? 0} reps`;
        case 'duration':
            return `${set.durationSeconds ?? 0} s${kg}`;
        case 'distance':
        case 'sprint':
            return `${set.distanceMeters ?? 0} m${set.durationSeconds !== undefined ? ` in ${set.durationSeconds} s` : ''}${kg}`;
        case 'jump_attempt': {
            const height = set.heightInches !== undefined ? `${set.heightInches} in` : undefined;
            const distance = set.distanceMeters !== undefined ? `${set.distanceMeters} m` : undefined;
            return `jump ${[height, distance].filter(Boolean).join(' / ') || NOT_RECORDED}`;
        }
        case 'checkoff':
            return set.completed === false ? 'not done' : 'done';
        case 'choice':
            return 'choice';
    }
}

function effortText(set: ExportedPerformedSet): string {
    const effort = set.effort;
    if (!effort) return '';
    const parts: string[] = [];
    if (effort.rir !== undefined) parts.push(`RIR ${effort.rir}`);
    if (effort.rpe !== undefined) parts.push(`RPE ${effort.rpe}`);
    if (effort.velocityLossPercent !== undefined) parts.push(`velocity loss ${effort.velocityLossPercent}%`);
    if (effort.techniqueMet !== undefined) parts.push(effort.techniqueMet ? 'technique met' : 'technique not met');
    return parts.length > 0 ? `, ${parts.join(', ')}` : '';
}

function workSetLine(set: ExportedPerformedSet): string {
    // A trailing rest that ran until the session ended is not a rest the athlete took.
    const rest = set.rest && set.rest.endReason !== 'session_ended' ? ` · rest ${set.rest.actualSeconds} s` : '';
    const swap = set.performedExercise ? ` · performed as ${exerciseRefLabel(set.performedExercise)}` : '';
    return `${set.setNumber}: ${setBody(set)}${effortText(set)}${rest}${swap}`;
}

function exerciseHeading(exercise: ExportedExercise): string {
    const planned = prescriptionText(exercise.prescribed);
    if (exercise.unplanned) return `## Added: ${oneLine(exercise.name)} (unplanned)`;
    if (exercise.performed.sets.length === 0) {
        return `## Not performed: ${oneLine(exercise.plannedName ?? exercise.name)} (planned ${planned})`;
    }
    if (exercise.plannedName) {
        return `## ${oneLine(exercise.plannedName)} — swapped to ${oneLine(exercise.name)}`;
    }
    return `## ${oneLine(exercise.name)} — planned ${planned}`;
}

function exerciseLines(exercise: ExportedExercise): string[] {
    const lines = [exerciseHeading(exercise)];
    const swappedWithSets = Boolean(exercise.plannedName) && !exercise.unplanned && exercise.performed.sets.length > 0;
    if (swappedWithSets) lines.push(`planned: ${prescriptionText(exercise.prescribed)}`);
    if (exercise.prescribed.notes) lines.push(`notes: ${oneLine(exercise.prescribed.notes)}`);
    for (const choice of exercise.choices ?? []) {
        const reason = choice.reason ? ` (reason: ${oneLine(choice.reason)})` : '';
        lines.push(`choice: ${oneLine(choice.optionLabel ?? choice.optionId)}${reason}`);
    }
    const warmups = exercise.performed.sets.filter(set => set.isWarmup);
    if (warmups.length > 0) lines.push(`warm-up: ${warmups.map(setBody).join(', ')}`);
    for (const set of exercise.performed.sets.filter(item => !item.isWarmup)) lines.push(workSetLine(set));
    return lines;
}

function headerLine(report: CompletedWorkoutExport): string {
    const date = report.localDate ?? 'date not recorded';
    const definition = report.session?.executedDefinition ?? 'definition unknown';
    const state = report.session?.state ?? 'state unknown';
    return `# Session: ${oneLine(report.title)} — ${date} (${definition}, ${state})`;
}

function summaryLine(report: CompletedWorkoutExport): string {
    const session = report.session;
    const duration = report.duration ? `duration: ${report.duration.minutes} min (${report.duration.source})` : `duration: ${NOT_RECORDED}`;
    const srpe = session?.sessionRpe !== undefined ? `sRPE ${session.sessionRpe}` : `sRPE: ${NOT_RECORDED}`;
    const completed = session?.completedFraction !== undefined
        ? `completed ${Math.round(session.completedFraction * 100)}%`
        : `completed: ${NOT_RECORDED}`;
    const fatigue = session?.unexpectedFatigue !== undefined
        ? `fatigue: ${session.unexpectedFatigue ? 'yes' : 'no'}`
        : `fatigue: ${NOT_RECORDED}`;
    return [duration, srpe, completed, fatigue].join(' · ');
}

const present = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function garminLine(activity: NonNullable<CompletedWorkoutExport['providerActivity']>): string {
    const parts: string[] = [];
    if (present(activity.durationMin)) parts.push(`${activity.durationMin} min`);
    if (present(activity.averageHr)) parts.push(`avg HR ${activity.averageHr}`);
    if (present(activity.maxHr)) parts.push(`max HR ${activity.maxHr}`);
    if (present(activity.activityTrainingLoad)) parts.push(`load ${activity.activityTrainingLoad}`);
    if (present(activity.trainingEffectAerobic) || present(activity.trainingEffectAnaerobic)) {
        const show = (value: number | null) => (present(value) ? String(value) : 'n/a');
        parts.push(`TE ${show(activity.trainingEffectAerobic)}/${show(activity.trainingEffectAnaerobic)}`);
    }
    return `Garmin: ${parts.length > 0 ? parts.join(' · ') : 'no metrics recorded'}`;
}

function responseLine(response: ExportedSessionResponse): string {
    const parts: string[] = [];
    if (response.sessionRpe !== undefined) parts.push(`sRPE ${response.sessionRpe}`);
    if (response.completedFraction !== undefined) parts.push(`completed ${Math.round(response.completedFraction * 100)}%`);
    if (response.unexpectedFatigue !== undefined) parts.push(`fatigue ${response.unexpectedFatigue ? 'yes' : 'no'}`);
    if (response.techniqueNote) parts.push(`technique: ${oneLine(response.techniqueNote)}`);
    if (response.note) parts.push(`note: ${oneLine(response.note)}`);
    return `- ${response.window}: ${parts.length > 0 ? parts.join(', ') : 'no values recorded'}`;
}

function responseLines(responses: CompletedWorkoutExport['responses']): string[] {
    if (responses === undefined) return [];
    if (responses === 'unavailable') return ['responses: unavailable'];
    if (responses.length === 0) return ['responses: none recorded'];
    return ['responses:', ...responses.map(responseLine)];
}

function missingLine(report: CompletedWorkoutExport): string | undefined {
    const missing: string[] = [];
    if (!report.duration) missing.push('duration');
    if (report.performedRest && report.performedRest !== 'recorded') missing.push(`performed rest (${report.performedRest})`);
    return missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined;
}

/** Renders a completed workout as a Markdown session report for an external AI coach. */
export function formatCompletedWorkoutMarkdown(
    view: CompletedWorkoutView,
    exportedAt: string,
    responses?: readonly SessionResponse[] | 'unavailable',
): string {
    const report = exportCompletedWorkoutToJson(view, exportedAt, responses);
    const lines = [headerLine(report), summaryLine(report)];
    if (report.session?.note) lines.push(`note: ${oneLine(report.session.note)}`);
    for (const exercise of report.exercises) lines.push('', ...exerciseLines(exercise));
    if (report.providerActivity || report.exercises.length === 0) lines.push('');
    if (report.providerActivity) lines.push(garminLine(report.providerActivity));
    if (report.exercises.length === 0) lines.push('structured log: none (provider recording only)');
    const responseBlock = responseLines(report.responses);
    if (responseBlock.length > 0) lines.push('', ...responseBlock);
    const missing = missingLine(report);
    if (missing) lines.push('', missing);
    lines.push('', `ref: ${report.performedOccurrenceId}`);
    return `${lines.join('\n')}\n`;
}
