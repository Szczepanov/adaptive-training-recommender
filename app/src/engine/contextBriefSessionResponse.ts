import type { DailySubjectiveCheckin, NormalizedGarminActivity } from './models';
import type { TrainingResponseSessionEvidence } from '../training-occurrence/trainingResponseEvidence';
import type { Insufficient } from './contextBriefResponseFeatures';
import { addDaysToLocalDateString } from '../utils/localDate';

/* Issue #814: strength-progression and next-day response features for the context brief.
 * Pure and display-only (no recommendation authority). Strength output is emitted only when
 * every working set carries an exercise identity; next-day linkage is observational. */

export interface ExerciseTopSet {
    exercise: string;
    identitySource: 'Adaptive structured identity' | 'provider-recognized identity; confidence limited';
    workingSets: number;
    topWeightKg?: number;
    topReps?: number;
    prior?: { date: string; topWeightKg?: number; topReps?: number; comparison: 'like-for-like' | 'different reps' | 'different load type' | 'missing reps' };
}

export type StrengthProgression =
    | { state: 'available'; exercises: ExerciseTopSet[] }
    | Insufficient;

const UNIDENTIFIED = new Set(['', 'UNKNOWN']);

interface StrengthSet {
    identity: string;
    label: string;
    weightKg?: number;
    repetitionCount?: number;
    isWarmup?: boolean;
    loadType: 'external_load' | 'repetition_only';
}

function providerSets(activity: NormalizedGarminActivity): StrengthSet[] {
    return (activity.exerciseSets ?? [])
        .filter(set => !['REST', 'WARMUP'].includes((set.setType ?? 'ACTIVE').toUpperCase()))
        .map(set => {
            const label = set.exerciseName?.trim() ?? '';
            const identity = label.toUpperCase();
            return {
                identity, label,
                ...(set.weightKg !== undefined ? { weightKg: set.weightKg } : {}),
                ...(set.repetitionCount !== undefined ? { repetitionCount: set.repetitionCount } : {}),
                loadType: set.weightKg !== undefined && set.weightKg > 0 ? 'external_load' : 'repetition_only',
            };
        });
}

function structuredSets(evidence: NonNullable<TrainingResponseSessionEvidence['structured']>): StrengthSet[] {
    const sourceKey = JSON.stringify(evidence.sessionSource);
    return evidence.steps.flatMap(step => step.sets.map(set => {
        const exerciseRef = set.exerciseRef ?? step.exerciseRef;
        const identity = exerciseRef?.kind === 'catalog'
            ? `catalog:${exerciseRef.exerciseId}`
            : exerciseRef?.kind === 'unresolved_free_text' ? `step:${sourceKey}:${step.stepId}:free-text:${exerciseRef.name}`
            : `step:${sourceKey}:${step.stepId}`;
        const label = exerciseRef?.kind === 'catalog'
            ? exerciseRef.exerciseId
            : exerciseRef?.kind === 'unresolved_free_text' ? exerciseRef.name : step.title || step.stepId;
        return {
            identity,
            label,
            ...(set.payload.kind === 'repetition' && set.payload.weightKg !== undefined ? { weightKg: set.payload.weightKg } : {}),
            ...(set.payload.kind === 'repetition' ? { repetitionCount: set.payload.reps } : {}),
            ...(set.payload.kind === 'duration' && set.payload.loadKg !== undefined ? { weightKg: set.payload.loadKg } : {}),
            isWarmup: set.isWarmup,
            loadType: (set.payload.kind === 'repetition' && set.payload.weightKg !== undefined && set.payload.weightKg > 0)
                || (set.payload.kind === 'duration' && set.payload.loadKg !== undefined && set.payload.loadKg > 0)
                ? 'external_load' : 'repetition_only',
        };
    }));
}

/** Heaviest set, ties broken by more reps; unloaded sets rank by reps alone. */
function topSet(sets: readonly StrengthSet[]): (StrengthSet & { topWeightKg?: number; topReps?: number }) | null {
    const ranked = sets
        .filter(set => !set.isWarmup && (set.weightKg !== undefined || set.repetitionCount !== undefined))
        .sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0) || (b.repetitionCount ?? 0) - (a.repetitionCount ?? 0));
    if (ranked.length === 0) return null;
    const best = ranked[0];
    return {
        ...best,
        ...(best.weightKg !== undefined && best.weightKg > 0 ? { topWeightKg: best.weightKg } : {}),
        ...(best.repetitionCount !== undefined ? { topReps: best.repetitionCount } : {}),
    };
}

function setsByExercise(sets: readonly StrengthSet[]): Map<string, StrengthSet[]> {
    const grouped = new Map<string, StrengthSet[]>();
    for (const set of sets) {
        if (set.identity && !UNIDENTIFIED.has(set.identity.trim().toUpperCase())) {
            grouped.set(set.identity, [...(grouped.get(set.identity) ?? []), set]);
        }
    }
    return grouped;
}

function responseLocalDate(
    activity: NormalizedGarminActivity,
    evidenceByActivityId: ReadonlyMap<string, TrainingResponseSessionEvidence>,
): string {
    return evidenceByActivityId.get(activity.activityId)?.localDate || activity.date;
}

/** Top-set load/reps per identified exercise, against the most recent prior session in
 * `history` with the same exercise identity. No estimated 1RM: the canonical estimator
 * (`workouts/oneRepMax.ts`) needs near-failure effort evidence that device sets lack. */
export function deriveStrengthProgression(
    activity: NormalizedGarminActivity,
    history: readonly NormalizedGarminActivity[],
    evidenceByActivityId: ReadonlyMap<string, TrainingResponseSessionEvidence> = new Map(),
): StrengthProgression {
    const currentEvidence = evidenceByActivityId.get(activity.activityId);
    const structuredLinked = currentEvidence?.identity.sourceKinds.includes('structured_execution') ?? false;
    if (structuredLinked && !currentEvidence?.structured) {
        return { state: 'insufficient_evidence', reason: 'structured execution linked but unavailable; provider exercise identity not used' };
    }
    const sets = currentEvidence?.structured
        ? structuredSets(currentEvidence.structured).filter(set => !set.isWarmup)
        : providerSets(activity);
    if (sets.length === 0) return { state: 'insufficient_evidence', reason: 'no working sets recorded' };
    const unidentified = sets.filter(set => !set.identity || UNIDENTIFIED.has(set.identity.trim().toUpperCase())).length;
    if (unidentified > 0) {
        return { state: 'insufficient_evidence', reason: `${unidentified} of ${sets.length} working sets lack an exercise identity` };
    }
    const currentDate = responseLocalDate(activity, evidenceByActivityId);
    const priors = history
        .filter(item => item.activityId !== activity.activityId && responseLocalDate(item, evidenceByActivityId) < currentDate)
        .sort((a, b) =>
            responseLocalDate(b, evidenceByActivityId).localeCompare(responseLocalDate(a, evidenceByActivityId))
            || a.activityId.localeCompare(b.activityId));
    const exercises: ExerciseTopSet[] = [];
    for (const [identity, exerciseSets] of setsByExercise(sets)) {
        const top = topSet(exerciseSets);
        if (!top) continue;
        const priorSession = priors
            .map(prior => {
                const priorEvidence = evidenceByActivityId.get(prior.activityId);
                const priorStructuredLinked = priorEvidence?.identity.sourceKinds.includes('structured_execution') ?? false;
                const priorDate = responseLocalDate(prior, evidenceByActivityId);
                if (Boolean(currentEvidence?.structured) !== Boolean(priorEvidence?.structured)
                    || (priorStructuredLinked && !priorEvidence?.structured)) return { prior, priorDate, top: null };
                const priorSets = priorEvidence?.structured
                    ? structuredSets(priorEvidence.structured).filter(set => !set.isWarmup)
                    : providerSets(prior);
                return { prior, priorDate, top: topSet(setsByExercise(priorSets).get(identity) ?? []) };
            })
            .find(entry => entry.top !== null);
        exercises.push({
            exercise: top.label || identity,
            identitySource: currentEvidence?.structured
                ? 'Adaptive structured identity'
                : 'provider-recognized identity; confidence limited',
            workingSets: exerciseSets.length,
            ...(top.topWeightKg !== undefined ? { topWeightKg: top.topWeightKg } : {}),
            ...(top.topReps !== undefined ? { topReps: top.topReps } : {}),
            ...(priorSession?.top ? { prior: {
                date: priorSession.priorDate,
                ...(priorSession.top.topWeightKg !== undefined ? { topWeightKg: priorSession.top.topWeightKg } : {}),
                ...(priorSession.top.topReps !== undefined ? { topReps: priorSession.top.topReps } : {}),
                comparison: top.loadType !== priorSession.top.loadType ? 'different load type'
                    : top.topReps === undefined || priorSession.top.topReps === undefined ? 'missing reps'
                    : top.topReps !== priorSession.top.topReps ? 'different reps' : 'like-for-like',
            } } : {}),
        });
    }
    if (exercises.length === 0) return { state: 'insufficient_evidence', reason: 'no load or repetitions recorded' };
    return { state: 'available', exercises: exercises.sort((a, b) => a.exercise.localeCompare(b.exercise)) };
}

export interface CheckinReading {
    soreness: number | null;
    fatigue: number | null;
    painOrInjury: boolean;
}

export type NextDayResponse =
    | {
        state: 'available';
        sessionDay: CheckinReading | null;
        nextDay: CheckinReading;
        otherActivitiesSameDay: number;
        tissueResponses: Array<{ region: string; reaction?: string; linkedToSession: boolean }>;
    }
    | Insufficient;

function reading(checkin: DailySubjectiveCheckin): CheckinReading {
    return { soreness: checkin.soreness, fatigue: checkin.fatigue, painOrInjury: checkin.painOrInjury };
}

/** Check-ins as read for the brief: `unreadableDates` are dates whose stored record failed
 * validation and was dropped — unreadable, which is not the same as "not recorded". */
export interface CheckinHistory {
    records: readonly DailySubjectiveCheckin[];
    unreadableDates: readonly string[];
    /** Invalid records whose date itself could not be read; any of them may be the one. */
    undatedUnreadable?: number;
}

/** Observational link from a session to the following morning's check-in. `checkins`
 * `null` means the check-in history could not be read, which is not the same as "none". */
export function deriveNextDayResponse(
    activity: NormalizedGarminActivity,
    checkins: CheckinHistory | null,
    sameWindowActivities: readonly NormalizedGarminActivity[],
    asOfDate: string,
    evidence?: readonly TrainingResponseSessionEvidence[],
): NextDayResponse {
    if (checkins === null) return { state: 'insufficient_evidence', reason: 'check-in history unavailable' };
    const sessionEvidence = evidence?.find(item => item.measuredSources.some(source =>
        source.provider.toLowerCase() === 'garmin' && source.activityId === activity.activityId));
    const sessionDate = sessionEvidence?.localDate || activity.date;
    const nextDate = addDaysToLocalDateString(sessionDate, 1);
    if (nextDate > asOfDate) return { state: 'insufficient_evidence', reason: 'next morning not yet reached' };
    const next = checkins.records.find(checkin => checkin.date === nextDate);
    if (!next) {
        if (checkins.unreadableDates.includes(nextDate)) {
            return { state: 'insufficient_evidence', reason: 'next-morning check-in unreadable (invalid stored record)' };
        }
        return (checkins.undatedUnreadable ?? 0) > 0
            ? { state: 'insufficient_evidence', reason: 'next-morning check-in possibly unreadable (an invalid stored record has no readable date)' }
            : { state: 'insufficient_evidence', reason: 'no next-morning check-in recorded' };
    }
    const sessionDay = checkins.records.find(checkin => checkin.date === sessionDate);
    const sameDayEvidence = evidence?.filter(item => item.localDate === sessionDate) ?? [];
    const evidenceSessionIds = new Set(sameDayEvidence.flatMap(item => item.performedOccurrenceId
        ? [`occurrence:${item.performedOccurrenceId}`]
        : item.measuredSources.filter(source => source.provider.toLowerCase() === 'garmin').map(source => `activity:${source.activityId}`)));
    const currentSessionId = sessionEvidence?.performedOccurrenceId
        ? `occurrence:${sessionEvidence.performedOccurrenceId}`
        : sessionEvidence ? `activity:${activity.activityId}` : undefined;
    const otherActivitiesSameDay = evidenceSessionIds.size > 0
        ? Math.max(0, evidenceSessionIds.size - (currentSessionId && evidenceSessionIds.has(currentSessionId) ? 1 : 0))
        : sameWindowActivities.filter(item => item.date === sessionDate && item.activityId !== activity.activityId).length;
    const currentExecutionId = sessionEvidence?.structured?.executionId;
    const knownExecutionIds = new Set((evidence ?? []).flatMap(item =>
        item.structured?.executionId ? [item.structured.executionId] : []));
    const tissueResponses = Object.entries(next.tissueResponses ?? {})
        .filter(([, response]) => response.nextMorningReaction || response.sourceSessionRef)
        .flatMap(([region, response]) => {
            const sourceRef = response.sourceSessionRef;
            // An exact ref to another known execution belongs to that session's summary, not this one.
            if (sourceRef?.kind === 'execution'
                && sourceRef.id !== currentExecutionId
                && knownExecutionIds.has(sourceRef.id)) {
                return [];
            }
            return [{
                region,
                ...(response.nextMorningReaction ? { reaction: response.nextMorningReaction } : {}),
                linkedToSession: sourceRef?.kind === 'execution' && sourceRef.id === currentExecutionId,
            }];
        })
        .sort((a, b) => Number(b.linkedToSession) - Number(a.linkedToSession))
        .slice(0, 3);
    return {
        state: 'available',
        sessionDay: sessionDay ? reading(sessionDay) : null,
        nextDay: reading(next),
        otherActivitiesSameDay,
        tissueResponses,
    };
}
