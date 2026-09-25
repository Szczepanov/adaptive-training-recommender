import type { NormalizedGarminActivity } from './models';
import {
    deriveDecoupling,
    deriveEfficiencyComparison,
    deriveIntervalRepetition,
    INTERVAL_COLLAPSE_RATIO,
    INTERVAL_FADE_PCT,
    type Decoupling,
    type EfficiencyComparison,
    type IntervalRepetition,
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
}

export interface KeySessionSummary {
    activity: NormalizedGarminActivity;
    intervals: IntervalRepetition;
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
    return [...windowActivities]
        .sort((a, b) => a.date.localeCompare(b.date) || a.activityId.localeCompare(b.activityId))
        .map(activity => ({
            activity,
            intervals: deriveIntervalRepetition(activity),
            decoupling: deriveDecoupling(activity),
            efficiency: deriveEfficiencyComparison(activity, context.history),
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

function intervalLines(feature: IntervalRepetition): string[] {
    if (feature.state !== 'available') return [];
    const minutes = feature.intervals.reduce((sum, item) => sum + item.durationSeconds, 0) / feature.intervals.length / 60;
    const lines = [
        `- Main set: ${feature.intervals.length} × ${fmt(minutes)} min @ ${feature.intervals.map(item => fmt(item.powerWatts)).join(' / ')} W`,
    ];
    if (feature.intervals.some(item => item.hrBpm !== undefined)) {
        lines.push(`- HR: ${feature.intervals.map(item => (item.hrBpm === undefined ? '—' : fmt(item.hrBpm))).join(' / ')} bpm`);
    }
    if (feature.hrNote) lines.push(`- HR note: ${feature.hrNote}`);
    lines.push(`- First→last work interval: ${signedPct(feature.firstToLastPct)} · spread ${fmt(feature.spreadPct, 1)}% of mean`);
    lines.push(`- Response: ${PATTERN_TEXT[feature.pattern].replace('{n}', String(feature.intervals.length))}`);
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
    return [`- Pw:HR decoupling (lap averages, first vs second half): ${fmt(feature.decouplingPct, 1)}%${note}`];
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
        `Derived from recorded laps, sets and check-ins; prior comparable sessions are searched only in activities fetched since ${context.historyStart}. `
        + 'Features with missing or incomparable evidence are omitted or marked insufficient, never estimated. These features have no recommendation authority.',
    ];
    for (const summary of summaries) {
        lines.push(
            '',
            headerLine(summary.activity),
            ...powerLine(summary.activity),
            ...intervalLines(summary.intervals),
            ...decouplingLines(summary.decoupling),
            ...efficiencyLines(summary.efficiency),
            ...strengthLines(summary.strength),
            ...nextDayLines(summary.nextDay),
        );
    }
    return lines.join('\n');
}
