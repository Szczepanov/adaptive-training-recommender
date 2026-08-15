import type {
    DailyRecommendation,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
    TrainingIntentProfile,
    TrainingSettings,
    UserPreferences,
} from './models';
import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';

/** Everything the brief renders, already fetched. This module performs no I/O so the
 * output is a pure function of its input and can be asserted exactly in tests. */
export interface ContextBriefInput {
    asOfDate: string;
    windowDays: number;
    /** Trailing days used for the subjective baseline the window is compared against.
     * Must be >= windowDays; `checkins` is expected to cover this full range, not just
     * the window. Defaults to SUBJECTIVE_BASELINE_DAYS when omitted. */
    subjectiveBaselineDays?: number;
    /** Any order; the builder sorts. Ascending by date is conventional. */
    snapshots: readonly DailyRecoverySnapshot[];
    /** Covers `subjectiveBaselineDays`, not merely `windowDays` — the builder slices it. */
    checkins: readonly DailySubjectiveCheckin[];
    activities: readonly NormalizedGarminActivity[];
    recommendations: readonly DailyRecommendation[];
    trainingSettings: TrainingSettings | null;
    preferences: UserPreferences | null;
    intentProfile: TrainingIntentProfile | null;
}

/** Trailing days the subjective window average is compared against. Matches the 28-day
 * horizon the objective baselines already use, so the two halves of the brief describe
 * drift over the same period. */
export const SUBJECTIVE_BASELINE_DAYS = 28;

/**
 * Minimum recorded days before a subjective baseline is shown at all.
 *
 * Unlike wearable data, check-ins only exist for days the athlete filled one in, and the
 * missingness is not random -- check-ins are skipped disproportionately on disrupted
 * days, which are disproportionately bad ones. A baseline computed from a sparse record
 * is therefore biased optimistic by construction, which would make a genuine downward
 * trend read as normal. Below this count the brief states the gap instead of showing a
 * number that looks authoritative and is not.
 */
export const SUBJECTIVE_BASELINE_MIN_DAYS = 10;

/** Above this count the baseline stands on its own; below it, it is shown with an
 * explicit caveat rather than silently. */
const SUBJECTIVE_BASELINE_SPARSE_BELOW = 21;

const EQUIPMENT_LABEL: Record<string, string> = {
    free_weights: 'free weights',
    cable_machine: 'cable machine',
    treadmill: 'treadmill',
    indoor_bike: 'indoor bike',
    pullup_bar: 'pull-up bar',
};

const GUARDRAIL_LABEL: Record<string, string> = {
    avoid_high_impact: 'no high-impact work',
    avoid_heavy_lower_body: 'no heavy lower-body work',
    avoid_overhead_pressing: 'no overhead pressing',
    avoid_heavy_spinal_loading: 'no heavy spinal loading',
};

function mean(values: readonly (number | null | undefined)[]): number | null {
    const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (present.length === 0) return null;
    return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function round(value: number | null, places = 1): string {
    if (value === null) return '—';
    const factor = 10 ** places;
    return String(Math.round(value * factor) / factor);
}

function signed(value: number | null | undefined, places = 1): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value * 10 ** places) / 10 ** places;
    return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** Renders a metric as "current (7d avg, 28d avg) — Δ vs 7d, Δ vs 28d", collapsing to a
 * dash per component so a partially-synced day still produces a readable line. */
function metricLine(
    label: string,
    unit: string,
    current: number | null,
    avg7d: number | null,
    avg28d: number | null,
    deltaVs7d: number | null,
    deltaVs28d: number | null,
): string {
    const baselines = `7d ${round(avg7d)}, 28d ${round(avg28d)}`;
    const deltas = `${signed(deltaVs7d)} vs 7d, ${signed(deltaVs28d)} vs 28d`;
    return `- ${label}: ${round(current)} ${unit} (${baselines}) — ${deltas}`;
}

function withinWindow(date: string, startDate: string, asOfDate: string): boolean {
    return date >= startDate && date <= asOfDate;
}

function renderConstraints(settings: TrainingSettings | null, preferences: UserPreferences | null, asOfDate: string): string[] {
    const lines: string[] = ['## 1. Constraints', '', 'A session that violates any of these cannot be executed.', ''];
    if (!settings) {
        lines.push('- Training settings unavailable. Do not assume any equipment or absence of injury.');
        return lines;
    }

    const owned = Object.entries(settings.equipment).filter(([, has]) => has).map(([key]) => EQUIPMENT_LABEL[key] ?? key);
    const absent = Object.entries(settings.equipment).filter(([, has]) => !has).map(([key]) => EQUIPMENT_LABEL[key] ?? key);
    lines.push(`- Equipment available: ${owned.length > 0 ? owned.join(', ') : 'none recorded'}`);
    if (absent.length > 0) lines.push(`- Equipment NOT available: ${absent.join(', ')}`);

    const guardrails = Object.entries(settings.guardrails).filter(([, on]) => on).map(([key]) => GUARDRAIL_LABEL[key] ?? key);
    if (guardrails.length > 0) lines.push(`- Safety limits: ${guardrails.join('; ')}`);

    // Same expiry rule as injuryPolicy.ts resolveEffectiveInjuryConstraints: an entry
    // past its review date is ignored, not deleted. Listing an expired injury here would
    // have the brief restrict a modality the engine itself no longer restricts.
    const injuries = (settings.injuries ?? []).filter(injury => !injury.reviewBy || injury.reviewBy >= asOfDate);
    if (injuries.length > 0) {
        lines.push('- Injuries:');
        for (const injury of injuries) {
            const parts = [`${injury.region ?? 'unspecified region'} — ${injury.severity}`];
            if (injury.restrictedModalities?.length) parts.push(`restricts ${injury.restrictedModalities.join(', ')}`);
            if (injury.reviewBy) parts.push(`review by ${injury.reviewBy}`);
            if (injury.note) parts.push(injury.note);
            lines.push(`  - ${parts.join(' · ')}`);
        }
    }

    const weekday = settings.defaults.weekdayMaxMinutes;
    const weekend = settings.defaults.weekendMaxMinutes;
    lines.push(`- Session time limit: ${weekday ?? '—'} min weekdays / ${weekend ?? '—'} min weekends`);
    lines.push(`- Default environment: ${settings.defaults.environment}`);

    if (preferences) {
        if (preferences.unavailableModalities?.length) {
            lines.push(`- Modalities unavailable (hard exclusion): ${preferences.unavailableModalities.join(', ')}`);
        }
        if (preferences.avoidedModalities.length > 0) lines.push(`- Modalities to avoid: ${preferences.avoidedModalities.join(', ')}`);
        if (preferences.preferredModalities.length > 0) lines.push(`- Preferred modalities: ${preferences.preferredModalities.join(', ')}`);
    }
    return lines;
}

function renderObjective(snapshots: readonly DailyRecoverySnapshot[], windowDays: number): string[] {
    const lines: string[] = ['## 2. Objective recovery (wearable)', ''];
    if (snapshots.length === 0) {
        lines.push('No wearable data in this window.');
        return lines;
    }
    const latest = snapshots[snapshots.length - 1];
    const { raw, derived, dataQuality } = latest;

    lines.push(`Most recent reading — ${latest.date}:`);
    lines.push(metricLine('HRV (overnight avg)', 'ms', raw.hrvOvernightAvg, derived.hrv7dAvg, derived.hrv28dAvg, derived.deltas.hrvVs7d, derived.deltas.hrvVs28d));
    lines.push(metricLine('Resting HR', 'bpm', raw.restingHr, derived.restingHr7dAvg, derived.restingHr28dAvg, derived.deltas.restingHrVs7d, derived.deltas.restingHrVs28d));
    lines.push(metricLine('Sleep score', 'pts', raw.sleepScore, derived.sleepScore7dAvg, derived.sleepScore28dAvg, derived.deltas.sleepScoreVs7d, derived.deltas.sleepScoreVs28d));
    if (raw.bodyBatteryWake !== null) lines.push(`- Body battery on waking: ${raw.bodyBatteryWake}`);
    if (raw.hrvStatus) lines.push(`- HRV status (device): ${raw.hrvStatus}`);
    if (raw.trainingReadiness?.score != null) {
        lines.push(`- Device training readiness: ${raw.trainingReadiness.score}${raw.trainingReadiness.level ? ` (${raw.trainingReadiness.level})` : ''}`);
    }

    const status = raw.trainingStatus;
    if (status) {
        const statusParts: string[] = [];
        if (status.statusPhrase) statusParts.push(status.statusPhrase);
        if (status.acuteTrainingLoad != null) statusParts.push(`acute load ${status.acuteTrainingLoad}`);
        if (status.acwrStatus) statusParts.push(`acute:chronic ${status.acwrStatus}`);
        if (status.vo2MaxCycling != null) statusParts.push(`VO2max cycling ${status.vo2MaxCycling}`);
        if (status.vo2MaxRunning != null) statusParts.push(`VO2max running ${status.vo2MaxRunning}`);
        if (statusParts.length > 0) lines.push(`- Device training status: ${statusParts.join(' · ')}`);
    }

    lines.push('');
    lines.push(`Window averages (${snapshots.length} of ${windowDays} days have data):`);
    lines.push(`- HRV ${round(mean(snapshots.map(s => s.raw.hrvOvernightAvg)))} ms · resting HR ${round(mean(snapshots.map(s => s.raw.restingHr)))} bpm · sleep score ${round(mean(snapshots.map(s => s.raw.sleepScore)))}`);

    if (!dataQuality.baseline28dReady) {
        lines.push('');
        lines.push('> Caution: the 28-day baseline is not yet mature, so the "vs 28d" deltas above are computed from partial history and should be weighted lightly.');
    }
    return lines;
}

function renderTraining(activities: readonly NormalizedGarminActivity[], asOfDate: string, windowDays: number): string[] {
    const lines: string[] = ['## 3. Completed training (recorded by the wearable)', ''];
    if (activities.length === 0) {
        lines.push('No recorded sessions in this window.');
        return lines;
    }

    lines.push('| Date | Type | Min | Load | Aerobic TE | Anaerobic TE | Avg HR | Intensity |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const activity of activities) {
        lines.push(`| ${activity.date} | ${activity.type} | ${activity.durationMin ?? '—'} | ${activity.activityTrainingLoad ?? '—'} | ${activity.trainingEffectAerobic ?? '—'} | ${activity.trainingEffectAnaerobic ?? '—'} | ${activity.averageHr ?? '—'} | ${activity.intensityTag} |`);
    }

    const totalMinutes = activities.reduce((sum, activity) => sum + (activity.durationMin ?? 0), 0);
    const hardCount = activities.filter(activity => activity.intensityTag === 'hard').length;
    lines.push('');
    lines.push(`Totals: ${activities.length} sessions · ${totalMinutes} min · ${hardCount} tagged hard.`);

    // Rolling 7-day buckets ending on asOfDate, rather than ISO calendar weeks: the
    // athlete re-plans on an arbitrary weekday, so "the last 7 days" is the comparison
    // that matters and it needs no week-numbering convention to interpret. The final
    // bucket is clamped to the window start, so a window that is not a multiple of 7
    // cannot report unmeasured days as measured-and-empty.
    const windowStart = addDaysToLocalDateString(asOfDate, -(windowDays - 1));
    const bucketCount = Math.ceil(windowDays / 7);
    for (let bucket = 0; bucket < bucketCount; bucket++) {
        const bucketEnd = addDaysToLocalDateString(asOfDate, -7 * bucket);
        const rawStart = addDaysToLocalDateString(bucketEnd, -6);
        const bucketStart = rawStart < windowStart ? windowStart : rawStart;
        const inBucket = activities.filter(activity => withinWindow(activity.date, bucketStart, bucketEnd));
        const minutes = inBucket.reduce((sum, activity) => sum + (activity.durationMin ?? 0), 0);
        const hard = inBucket.filter(activity => activity.intensityTag === 'hard').length;
        const dayCount = getDayDiff(bucketEnd, bucketStart) + 1;
        const span = dayCount === 7 ? '' : ` (${dayCount} days)`;
        lines.push(`- ${bucketStart} → ${bucketEnd}${span}: ${inBucket.length} sessions · ${minutes} min · ${hard} hard`);
    }
    return lines;
}

const SUBJECTIVE_METRICS: ReadonlyArray<{
    label: string;
    read: (checkin: DailySubjectiveCheckin) => number | null;
    higherIsBetter: boolean;
}> = [
    { label: 'Readiness', read: c => c.readiness, higherIsBetter: true },
    { label: 'Sleep quality', read: c => c.sleepQuality, higherIsBetter: true },
    { label: 'Motivation', read: c => c.motivation, higherIsBetter: true },
    { label: 'Fatigue', read: c => c.fatigue, higherIsBetter: false },
    { label: 'Soreness', read: c => c.soreness, higherIsBetter: false },
    { label: 'Mental stress', read: c => c.mentalStress, higherIsBetter: false },
];

/** Compares the window average against the trailing baseline, gated on how many days the
 * baseline actually rests on. Returns [] when the baseline is withheld. */
function renderSubjectiveBaseline(
    windowCheckins: readonly DailySubjectiveCheckin[],
    baselineCheckins: readonly DailySubjectiveCheckin[],
    baselineDays: number,
    windowDays: number,
): string[] {
    // With no days outside the window there is nothing to compare against: every delta
    // would render as "flat" under a heading claiming a trailing-baseline comparison,
    // which is worse than saying nothing.
    if (baselineDays <= windowDays) {
        return [
            '',
            `> No subjective baseline: the ${windowDays}-day window is not shorter than the ${baselineDays}-day `
            + 'baseline period, so there is no prior history to compare it against.',
        ];
    }

    // Minimum-safety/partial check-ins intentionally leave readiness dimensions null.
    // Counting those documents would let safety-only submissions mature a baseline that
    // rests on little or no scored history. Only complete check-ins satisfy the coverage
    // floor; partial days still contribute their explicit safety flags elsewhere.
    const recordedDays = new Set(
        baselineCheckins.filter(checkin => checkin.dataQuality.isComplete).map(checkin => checkin.date),
    ).size;
    if (recordedDays < SUBJECTIVE_BASELINE_MIN_DAYS) {
        return [
            '',
            `> No ${baselineDays}-day subjective baseline: only ${recordedDays} of ${baselineDays} days recorded `
            + `(minimum ${SUBJECTIVE_BASELINE_MIN_DAYS}). Check-ins are skipped more often on disrupted days, so a `
            + 'sparse baseline reads optimistically — treat the window averages above as absolute values, not as a trend.',
        ];
    }

    const lines = [
        '',
        `Window average vs this athlete's own trailing ${baselineDays}-day baseline `
        + `(${recordedDays} of ${baselineDays} days recorded). The baseline period contains the window, `
        + 'so a sustained change shows up here at roughly half its true size — read the direction, not the magnitude:',
    ];
    for (const metric of SUBJECTIVE_METRICS) {
        const windowAvg = mean(windowCheckins.map(metric.read));
        const baselineAvg = mean(baselineCheckins.map(metric.read));
        if (windowAvg === null || baselineAvg === null) continue;
        const delta = windowAvg - baselineAvg;
        const direction = Math.abs(delta) < 0.05
            ? 'flat'
            : (delta > 0) === metric.higherIsBetter ? 'better than baseline' : 'worse than baseline';
        lines.push(`- ${metric.label}: ${round(windowAvg)} vs ${round(baselineAvg)} (${signed(delta)}, ${direction})`);
    }

    if (recordedDays < SUBJECTIVE_BASELINE_SPARSE_BELOW) {
        lines.push('');
        lines.push(
            `> The baseline above rests on ${recordedDays} of ${baselineDays} days. Missed check-ins cluster on `
            + 'disrupted days, so it is likely a little optimistic; weight these deltas accordingly.',
        );
    }
    return lines;
}

function renderSubjective(
    checkins: readonly DailySubjectiveCheckin[],
    baselineCheckins: readonly DailySubjectiveCheckin[],
    windowDays: number,
    baselineDays: number,
): string[] {
    const lines: string[] = ['## 4. Subjective reports (self-scored each morning, 1–10)', ''];
    if (checkins.length === 0) {
        lines.push('No check-ins in this window.');
        return lines;
    }

    lines.push('Higher is better for readiness, sleep quality and motivation; higher is worse for fatigue, soreness and mental stress.');
    lines.push('');
    lines.push(`Averages across ${checkins.length} of ${windowDays} days:`);
    lines.push(`- Readiness ${round(mean(checkins.map(c => c.readiness)))} · fatigue ${round(mean(checkins.map(c => c.fatigue)))} · soreness ${round(mean(checkins.map(c => c.soreness)))}`);
    lines.push(`- Sleep quality ${round(mean(checkins.map(c => c.sleepQuality)))} · motivation ${round(mean(checkins.map(c => c.motivation)))} · mental stress ${round(mean(checkins.map(c => c.mentalStress)))}`);
    lines.push(...renderSubjectiveBaseline(checkins, baselineCheckins, baselineDays, windowDays));
    lines.push('');
    lines.push('Flags:');

    const painDays = checkins.filter(c => c.painOrInjury).map(c => c.date);
    const illnessDays = checkins.filter(c => c.illnessSymptoms).map(c => c.date);
    const limitedDays = checkins.filter(c => c.unusuallyLimitedTime).map(c => c.date);
    lines.push(`- Pain or injury flagged: ${painDays.length > 0 ? `${painDays.length} day(s) — ${painDays.join(', ')}` : 'none'}`);
    lines.push(`- Illness symptoms flagged: ${illnessDays.length > 0 ? `${illnessDays.length} day(s) — ${illnessDays.join(', ')}` : 'none'}`);
    if (limitedDays.length > 0) lines.push(`- Unusually limited time: ${limitedDays.length} day(s) — ${limitedDays.join(', ')}`);

    const notes = checkins.filter(c => c.notes && c.notes.trim().length > 0);
    if (notes.length > 0) {
        lines.push('');
        lines.push('Notes:');
        for (const checkin of notes) lines.push(`- ${checkin.date}: ${checkin.notes!.trim()}`);
    }
    return lines;
}

function renderAdherence(recommendations: readonly DailyRecommendation[]): string[] {
    const lines: string[] = ['## 5. Plan adherence', ''];
    if (recommendations.length === 0) {
        lines.push('No recommendations recorded in this window.');
        return lines;
    }

    const answered = recommendations.filter(rec => rec.adherence.respondedAt !== null);
    const followed = answered.filter(rec => rec.adherence.followed === true);
    const skipped = answered.filter(rec => rec.adherence.skipped);
    const different = answered.filter(rec => rec.adherence.followed === false && !rec.adherence.skipped);

    lines.push(`${recommendations.length} recommendations · ${answered.length} answered · ${recommendations.length - answered.length} unanswered.`);
    lines.push(`- Followed as prescribed: ${followed.length}`);
    lines.push(`- Did something different: ${different.length}`);
    lines.push(`- Skipped entirely: ${skipped.length}`);

    if (different.length > 0 || skipped.length > 0) {
        lines.push('');
        lines.push('Deviations:');
        for (const rec of [...different, ...skipped].sort((a, b) => a.date.localeCompare(b.date))) {
            const what = rec.adherence.skipped
                ? 'skipped'
                : `did ${rec.adherence.actualModality ?? 'something else'}${rec.adherence.actualDurationMin ? ` for ${rec.adherence.actualDurationMin} min` : ''}`;
            const note = rec.adherence.notes ? ` — "${rec.adherence.notes.trim()}"` : '';
            lines.push(`- ${rec.date}: prescribed ${rec.templateTitle} (${rec.mode}), ${what}${note}`);
        }
    }
    return lines;
}

function renderIntent(profile: TrainingIntentProfile | null): string[] {
    if (!profile) return [];
    return [
        '## 6. Stated training intent',
        '',
        `- Weekly session commitment: minimum ${profile.weeklyCommitment.minSessions}, typical ${profile.weeklyCommitment.targetSessions}, maximum ${profile.weeklyCommitment.maxSessions}`,
        `- Priorities, in order: ${profile.priorities.join(' > ')}`,
    ];
}

/**
 * Renders a compact, paste-ready summary of the athlete's recent training and recovery
 * for an external planner. Deliberately excludes identifiers, raw wearable payloads, and
 * anything not needed to design the next block.
 */
export function buildContextBrief(input: ContextBriefInput): string {
    const { asOfDate, windowDays } = input;
    const startDate = addDaysToLocalDateString(asOfDate, -(windowDays - 1));
    const inWindow = <T extends { date: string }>(items: readonly T[]): T[] =>
        items.filter(item => withinWindow(item.date, startDate, asOfDate))
            .sort((a, b) => a.date.localeCompare(b.date));

    // Not clamped up to windowDays: a baseline equal to the window is meaningless, and
    // renderSubjectiveBaseline says so rather than printing all-flat deltas.
    const baselineDays = input.subjectiveBaselineDays ?? SUBJECTIVE_BASELINE_DAYS;
    const baselineStart = addDaysToLocalDateString(asOfDate, -(baselineDays - 1));

    const snapshots = inWindow(input.snapshots);
    const checkins = inWindow(input.checkins);
    const baselineCheckins = input.checkins
        .filter(checkin => withinWindow(checkin.date, baselineStart, asOfDate))
        .sort((a, b) => a.date.localeCompare(b.date));
    const activities = inWindow(input.activities);
    const recommendations = inWindow(input.recommendations);

    const sections: string[][] = [
        [
            '# Training context brief',
            '',
            `Window: ${startDate} → ${asOfDate} (${windowDays} days). All dates are Europe/Warsaw calendar dates.`,
            'Blank values ("—") mean not measured, not zero. This brief contains no raw device payloads.',
        ],
        renderConstraints(input.trainingSettings, input.preferences, asOfDate),
        renderObjective(snapshots, windowDays),
        renderTraining(activities, asOfDate, windowDays),
        renderSubjective(checkins, baselineCheckins, windowDays, baselineDays),
        renderAdherence(recommendations),
        renderIntent(input.intentProfile),
        [
            '## Requested output',
            '',
            'Design the next training block using the above. Respect every constraint in section 1 —',
            'a session requiring absent equipment or violating a safety limit is unusable.',
            '',
            'Note that daily execution is adjusted separately against that morning\'s readiness, so',
            'plan the intended block rather than pre-emptively reducing it for anticipated fatigue.',
        ],
    ];

    return sections.filter(section => section.length > 0).map(section => section.join('\n')).join('\n\n');
}

/** Convenience for callers that want the default two-week lookback. */
export function defaultBriefWindowDays(): number {
    return 14;
}

/** Exported for the service layer so the fetch range and the render range cannot drift. */
export function briefWindowStart(asOfDate: string, windowDays: number): string {
    return addDaysToLocalDateString(asOfDate, -(windowDays - 1));
}
