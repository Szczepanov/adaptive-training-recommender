import type { NormalizedGarminActivity } from './models';
import type { TrainingResponseSessionEvidence } from '../training-occurrence/trainingResponseEvidence';
import type { ResponseSessionIdentity } from './contextBriefComparability';
import {
    deriveDecoupling,
    deriveEfficiencyComparison,
    deriveIntervalRepetition,
    deriveSprintRepetition,
    INTERVAL_COLLAPSE_RATIO,
    INTERVAL_FADE_PCT,
    type Decoupling,
    type EfficiencyComparison,
    type IntervalRepetition,
    type SprintRepetition,
} from './contextBriefResponseFeatures';
import {
    deriveNextDayResponse,
    deriveStrengthProgression,
    type CheckinHistory,
    type CheckinReading,
    type ExerciseTopSet,
    type NextDayResponse,
    type StrengthProgression,
} from './contextBriefSessionResponse';

/* Issue #814: semantic key-session summaries for the context brief. Display-only; a
 * session is "key" when at least one response feature is eligible for it. */

export interface ResponseContext {
    /** Every activity fetched for the brief (a longer lookback than the render window);
     * prior comparable sessions are searched only here. */
    history: readonly NormalizedGarminActivity[];
    /** First date covered by `history`, stated in the output. */
    historyStart: string;
    /** `null` when check-in history could not be read. */
    checkins: CheckinHistory | null;
    asOfDate: string;
    /** Canonical occurrence/source projection; consumers migrate from activity-only input by work package. */
    evidence?: readonly TrainingResponseSessionEvidence[];
}

export interface KeySessionSummary {
    activity: NormalizedGarminActivity;
    intervals: IntervalRepetition;
    sprints: SprintRepetition;
    decoupling: Decoupling;
    efficiency: EfficiencyComparison;
    strength: StrengthProgression;
    nextDay: NextDayResponse;
}

function fmt(value: number, places = 0): string {
    const factor = 10 ** places;
    return String(Math.round(value * factor) / factor);
}

function signedPct(value: number): string {
    return `${value > 0 ? '+' : ''}${fmt(value, 1)}%`;
}

/** At least one feature produced a value. Only these sessions replace their compact
 * telemetry digest line; a key session without any value keeps its digest. */
export function hasAvailableFeature(summary: Omit<KeySessionSummary, 'nextDay'>): boolean {
    return summary.intervals.state === 'available'
        || summary.sprints.state === 'available'
        || summary.decoupling.state === 'available'
        || summary.efficiency.state === 'available'
        || summary.strength.state === 'available';
}

/** Key: a feature is available, or the session is steady-eligible but had no comparable
 * prior session (its rejection reasons are worth stating). */
function isKey(summary: Omit<KeySessionSummary, 'nextDay'>): boolean {
    return hasAvailableFeature(summary)
        || (summary.efficiency.state === 'insufficient_evidence' && summary.efficiency.kind === 'no_comparable');
}

export function deriveKeySessionSummaries(
    windowActivities: readonly NormalizedGarminActivity[],
    context: ResponseContext,
): KeySessionSummary[] {
    const identities = new Map<string, ResponseSessionIdentity>();
    for (const session of context.evidence ?? []) {
        for (const source of session.measuredSources) {
            if (source.provider.toLowerCase() !== 'garmin') continue;
            identities.set(source.activityId, {
                ...(session.performedOccurrenceId ? { performedOccurrenceId: session.performedOccurrenceId } : {}),
                ...(session.structured?.prescriptionHash ? { prescriptionHash: session.structured.prescriptionHash } : {}),
                sourceCompleteness: session.identity.level === 'provider_activity_only'
                    ? session.sourceCompleteness.providerActivities === 'available' ? 'provider_fallback' : 'unavailable'
                    : session.sourceCompleteness.providerActivities === 'ambiguous' ? 'ambiguous'
                    : session.sourceCompleteness.occurrenceRead === 'unavailable'
                        || session.sourceCompleteness.providerActivities === 'unavailable'
                        || session.sourceCompleteness.structuredExecution === 'unavailable'
                        ? 'unavailable'
                        : session.sourceCompleteness.providerActivities === 'partial' ? 'partial'
                            : session.identity.level === 'canonical_occurrence' ? 'canonical' : 'provider_fallback',
            });
        }
    }
    return [...windowActivities]
        .sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId))
        .map(activity => ({
            activity,
            intervals: deriveIntervalRepetition(activity),
            sprints: deriveSprintRepetition(activity),
            decoupling: deriveDecoupling(activity),
            efficiency: deriveEfficiencyComparison(activity, context.history, identities),
            strength: deriveStrengthProgression(activity, context.history),
        }))
        .filter(isKey)
        .map(summary => ({
            ...summary,
            nextDay: deriveNextDayResponse(summary.activity, context.checkins, context.history, context.asOfDate),
        }));
}

const PATTERN_TEXT = {
    repeatable: 'repeatable across the {n} protocol-length intervals',
    late_fade: `late fade (last work interval more than ${INTERVAL_FADE_PCT}% below the first)`,
    late_collapse: `late collapse (a second-half work interval below ${Math.round(INTERVAL_COLLAPSE_RATIO * 100)}% of the first)`,
} as const;

const MAX_RENDERED_REPS = 12;

function boundedValues(values: readonly string[]): string {
    if (values.length <= MAX_RENDERED_REPS) return values.join(' / ');
    const head = values.slice(0, 8);
    const tail = values.slice(-2);
    return `${head.join(' / ')} / … +${values.length - head.length - tail.length} / ${tail.join(' / ')}`;
}

function workDurationText(seconds: number): string {
    if (seconds < 60) return `${fmt(seconds)} s`;
    const minutes = seconds / 60;
    return Number.isInteger(minutes) ? `${fmt(minutes)} min` : `${fmt(minutes, 1)} min`;
}

function prescribedTargetText(target: { kind: string; value?: number; low?: number; high?: number }): string {
    if (target.kind === 'power_watts' && target.value !== undefined) return `${fmt(target.value)} W`;
    if (target.kind === 'power_range_watts') {
        const low = target.low === undefined ? '—' : fmt(target.low);
        const high = target.high === undefined ? '—' : fmt(target.high);
        return `${low}–${high} W`;
    }
    if (target.kind === 'power_zone' && target.value !== undefined) return `power zone ${fmt(target.value)}`;
    return target.value === undefined ? target.kind : `${target.kind} ${fmt(target.value)}`;
}

function intervalLines(feature: IntervalRepetition): string[] {
    if (feature.state !== 'available') return [];
    const durations = feature.intervals.map(item => item.durationSeconds);
    const firstDuration = durations[0];
    const sameDuration = durations.every(value => Math.abs(value - firstDuration) <= Math.max(1, firstDuration * 0.05));
    const setLabel = sameDuration
        ? `${feature.intervals.length} × ${workDurationText(firstDuration)}`
        : `${feature.intervals.length} semantic work intervals`;
    const lines = [
        `- Main set: ${setLabel} @ ${boundedValues(feature.intervals.map(item => fmt(item.powerWatts)))} W actual`,
    ];

    const targets = feature.intervals.map(item => item.prescribedTarget);
    if (targets.every(target => target !== undefined)) {
        const texts = targets.map(target => prescribedTargetText(target as NonNullable<typeof target>));
        const first = texts[0];
        lines.push(texts.every(text => text === first)
            ? `- Prescription: ${first} (kept separate from performed power)`
            : `- Prescription: ${boundedValues(texts)} (kept separate from performed power)`);
    }

    if (feature.intervals.some(item => item.hrBpm !== undefined)) {
        lines.push(`- HR: ${boundedValues(feature.intervals.map(item => (item.hrBpm === undefined ? '—' : fmt(item.hrBpm))))} bpm`);
    }
    if (feature.intervals.some(item => item.lastThirdHrBpm !== undefined)) {
        lines.push(`- HR final third: ${boundedValues(feature.intervals.map(item => item.lastThirdHrBpm === undefined ? '—' : fmt(item.lastThirdHrBpm)))} bpm`);
    }
    const withThirds = feature.intervals.filter(item =>
        item.firstThirdPowerWatts !== undefined
        && item.middleThirdPowerWatts !== undefined
        && item.lastThirdPowerWatts !== undefined);
    if (withThirds.length > 0) {
        lines.push(`- Within-rep power thirds: ${boundedValues(withThirds.map((item, index) =>
            `#${index + 1} ${fmt(item.firstThirdPowerWatts as number)}/${fmt(item.middleThirdPowerWatts as number)}/${fmt(item.lastThirdPowerWatts as number)} W`))}`);
    }
    if (feature.hrNote) lines.push(`- HR note: ${feature.hrNote}`);
    lines.push(`- First→last work interval: ${signedPct(feature.firstToLastPct)} · spread ${fmt(feature.spreadPct, 1)}% of mean`);
    lines.push(`- Response: ${PATTERN_TEXT[feature.pattern].replace('{n}', String(feature.intervals.length))}`);
    return lines;
}

function sprintLines(feature: SprintRepetition): string[] {
    if (feature.state !== 'available') return [];
    const firstDuration = feature.sprints[0].durationSeconds;
    const sameDuration = feature.sprints.every(item => Math.abs(item.durationSeconds - firstDuration) <= 1);
    const lines = [
        `- Sprints: ${feature.sprints.length} × ${sameDuration ? workDurationText(firstDuration) : 'short semantic efforts'} · mean performed power ${fmt(feature.meanPowerWatts)} W`,
    ];
    if (feature.sprints.every(item => item.peak5sPowerWatts !== undefined) && feature.meanPeak5sWatts !== undefined) {
        lines.push(`- Sprint peak 5 s: ${boundedValues(feature.sprints.map(item => fmt(item.peak5sPowerWatts as number)))} W · mean ${fmt(feature.meanPeak5sWatts)} W`);
    }
    if (sameDuration && Math.abs(firstDuration - 10) <= 1) {
        lines.push(`- Mean 10 s: ${boundedValues(feature.sprints.map(item => fmt(item.powerWatts)))} W`);
    }
    if (feature.sprints.some(item => item.maxCadenceRpm !== undefined)) {
        lines.push(`- Peak cadence: ${boundedValues(feature.sprints.map(item => item.maxCadenceRpm === undefined ? '—' : fmt(item.maxCadenceRpm)))} rpm`);
    }
    lines.push(`- Sprint fade: last vs best ${signedPct(feature.lastToBestPct)} · ${feature.pattern === 'late_fade' ? 'late fade' : 'repeatable'}`);
    return lines;
}

const PROVENANCE_TEXT = {
    same: 'power-zone (FTP) definitions identical',
    unknown: 'power-zone (FTP) definitions not reported for both sessions',
    changed: 'power-zone (FTP) definitions changed',
} as const;

function efficiencyLines(feature: EfficiencyComparison): string[] {
    if (feature.state === 'available') {
        return [
            `- Aerobic efficiency (NP ÷ avg HR): ${fmt(feature.efficiencyFactor, 2)} vs ${fmt(feature.priorEfficiencyFactor, 2)} on ${feature.priorDate} (${signedPct(feature.changePct)}) · comparison confidence ${feature.confidence} (${feature.basis}; ${PROVENANCE_TEXT[feature.thresholdProvenance]}; heat, terrain and fatigue not controlled)${feature.hrNote ? ` · ${feature.hrNote}` : ''}`,
        ];
    }
    if (feature.kind !== 'no_comparable') return [];
    const rejected = feature.rejected.slice(0, 3);
    const more = feature.rejected.length > rejected.length ? `; +${feature.rejected.length - rejected.length} more` : '';
    return [`- Aerobic efficiency: insufficient evidence — ${feature.reason}${rejected.length > 0 ? ` (rejected ${rejected.join('; ')}${more})` : ''}`];
}

function decouplingLines(feature: Decoupling): string[] {
    if (feature.state !== 'available') return [];
    const note = feature.hrNote ? ` · ${feature.hrNote}` : '';
    return [`- Pw:HR decoupling (first vs second half): ${fmt(feature.decouplingPct, 1)}%${note}`];
}

function topSetText(set: { topWeightKg?: number; topReps?: number }): string {
    if (set.topWeightKg !== undefined) return `${fmt(set.topWeightKg, 1)} kg${set.topReps !== undefined ? ` × ${set.topReps}` : ''}`;
    return set.topReps !== undefined ? `${set.topReps} reps` : 'no load/reps';
}

function strengthLines(feature: StrengthProgression): string[] {
    if (feature.state !== 'available') return [];
    return feature.exercises.map((exercise: ExerciseTopSet) => {
        const prior = exercise.prior ? ` (prior ${exercise.prior.date}: ${topSetText(exercise.prior)})` : ' (no prior session with this exercise in the fetched history)';
        return `- Strength ${exercise.exercise}: ${exercise.workingSets} working sets · top ${topSetText(exercise)}${prior}`;
    });
}

function readingText(label: 'soreness' | 'fatigue', next: CheckinReading, prior: CheckinReading | null): string {
    const value = next[label] === null ? 'not rated' : String(next[label]);
    const before = prior === null || prior[label] === null ? 'session-day morning not rated' : `session-day morning ${prior[label]}`;
    return `${label} ${value} (${before})`;
}

function nextDayLines(feature: NextDayResponse): string[] {
    if (feature.state !== 'available') return [`- Next morning: ${feature.reason}`];
    const parts = [readingText('soreness', feature.nextDay, feature.sessionDay), readingText('fatigue', feature.nextDay, feature.sessionDay)];
    if (feature.nextDay.painOrInjury) parts.push('pain/injury flagged');
    if (feature.otherActivitiesSameDay > 0) parts.push(`${feature.otherActivitiesSameDay} other recorded activit${feature.otherActivitiesSameDay === 1 ? 'y' : 'ies'} that day`);
    return [`- Next morning (observational, not proof the session caused it): ${parts.join(' · ')}`];
}

function headerLine(activity: NormalizedGarminActivity): string {
    const duration = activity.durationMin === null ? '' : ` — ${fmt(activity.durationMin)} min`;
    return `#### ${activity.date} — ${activity.type} — ${activity.intensityTag}${duration}`;
}

function powerLine(activity: NormalizedGarminActivity): string[] {
    const parts: string[] = [];
    if (activity.normalizedPower !== undefined) parts.push(`NP ${fmt(activity.normalizedPower)} W`);
    if (activity.intensityFactor !== undefined) parts.push(`IF ${fmt(activity.intensityFactor, 2)}`);
    if (activity.variabilityIndex !== undefined) parts.push(`VI ${fmt(activity.variabilityIndex, 2)}`);
    return parts.length > 0 ? [`- ${parts.join(' · ')}`] : [];
}

export function renderKeySessionSummaries(summaries: readonly KeySessionSummary[], context: ResponseContext): string {
    if (summaries.length === 0) return '';
    const lines = [
        '### Training-response features (derived, display-only)',
        '',
        `Derived from bounded semantic FIT-step/session telemetry when available, with legacy laps, sets and check-ins as fallbacks; prior comparable sessions are searched only in activities fetched since ${context.historyStart}. `
        + 'Features with missing or incomparable evidence are omitted or marked insufficient, never estimated. These features have no recommendation authority.',
    ];
    for (const summary of summaries) {
        lines.push(
            '',
            headerLine(summary.activity),
            ...powerLine(summary.activity),
            ...intervalLines(summary.intervals),
            ...sprintLines(summary.sprints),
            ...decouplingLines(summary.decoupling),
            ...efficiencyLines(summary.efficiency),
            ...strengthLines(summary.strength),
            ...nextDayLines(summary.nextDay),
        );
    }
    return lines.join('\n');
}
