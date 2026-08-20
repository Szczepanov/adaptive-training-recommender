import type {
    DailyRecommendation,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    NormalizedGarminActivity,
    TrainingIntentProfile,
    TrainingSettings,
    UserGoal,
    UserPreferences,
} from './models';
import { deriveEventPriority } from './periodization';
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
    goals?: readonly UserGoal[];
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

/** Coverage thresholds scale with the baseline period, because the service lengthens it
 * for long windows (`max(28, windowDays * 2)`). Fixed day counts would silently relax:
 * 21 recorded days is 75% of a 28-day baseline but only 38% of a 56-day one, and the
 * absolute rule would print the longer, thinner baseline with no caveat at all. Both
 * ratios are chosen to reproduce the documented 28-day behaviour exactly (10 and 21). */
const SUBJECTIVE_BASELINE_MIN_RATIO = 10 / SUBJECTIVE_BASELINE_DAYS;
const SUBJECTIVE_BASELINE_SPARSE_RATIO = 21 / SUBJECTIVE_BASELINE_DAYS;

function minimumRecordedDays(baselineDays: number): number {
    return Math.max(SUBJECTIVE_BASELINE_MIN_DAYS, Math.ceil(baselineDays * SUBJECTIVE_BASELINE_MIN_RATIO));
}

function sparseBelowDays(baselineDays: number): number {
    return Math.ceil(baselineDays * SUBJECTIVE_BASELINE_SPARSE_RATIO);
}

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

/** Observation-only robust baseline renderer. Keeping this separate from metricLine makes
 * the estimator semantics explicit in the exported text instead of letting an external AI
 * mistake median/MAD candidate statistics for the live mean/stdev engine inputs. */
function candidateBaselineLine(
    label: string,
    unit: string,
    current: number | null | undefined,
    median7d: number | null | undefined,
    median28d: number | null | undefined,
    mad28d: number | null | undefined,
    deltaVs7dMedian: number | null | undefined,
    deltaVs28dMedian: number | null | undefined,
): string {
    const currentValue = typeof current === 'number' && Number.isFinite(current) ? current : null;
    const median7 = typeof median7d === 'number' && Number.isFinite(median7d) ? median7d : null;
    const median28 = typeof median28d === 'number' && Number.isFinite(median28d) ? median28d : null;
    const mad28 = typeof mad28d === 'number' && Number.isFinite(mad28d) ? mad28d : null;
    const baselines = `7d median ${round(median7)}, 28d median ${round(median28)}, 28d MAD ${round(mad28)}`;
    const deltas = `${signed(deltaVs7dMedian)} vs 7d median, ${signed(deltaVs28dMedian)} vs 28d median`;
    return `- ${label}: ${round(currentValue)} ${unit} (${baselines}) — ${deltas}`;
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
    const baselineVersion = derived.baselineComputationVersion ?? 0;

    lines.push(`Most recent reading — ${latest.date}:`);
    lines.push(metricLine('HRV (overnight avg)', 'ms', raw.hrvOvernightAvg, derived.hrv7dAvg, derived.hrv28dAvg, derived.deltas.hrvVs7d, derived.deltas.hrvVs28d));
    lines.push(metricLine('Resting HR', 'bpm', raw.restingHr, derived.restingHr7dAvg, derived.restingHr28dAvg, derived.deltas.restingHrVs7d, derived.deltas.restingHrVs28d));
    lines.push(metricLine('Sleep score', 'pts', raw.sleepScore, derived.sleepScore7dAvg, derived.sleepScore28dAvg, derived.deltas.sleepScoreVs7d, derived.deltas.sleepScoreVs28d));
    if (raw.totalSteps !== null) {
        lines.push(metricLine('Steps (yesterday D-1)', 'steps', raw.totalSteps, derived.steps7dAvg ?? null, derived.steps28dAvg ?? null, derived.deltas.stepsVs7d ?? null, derived.deltas.stepsVs28d ?? null));
    }
    if (baselineVersion >= 3) {
        lines.push(candidateBaselineLine(
            'Respiration robust baseline', 'br/min', raw.respirationAvg,
            derived.respiration7dAvg, derived.respiration28dAvg, derived.respiration28dMad,
            derived.deltas.respirationVs7d, derived.deltas.respirationVs28d,
        ));
    } else if (raw.respirationAvg !== null) {
        lines.push(`- Respiration: ${round(raw.respirationAvg)} br/min (legacy pre-v3 baseline fields use mean; robust median/MAD unavailable)`);
    }
    if (raw.bodyBatteryWake !== null) lines.push(`- Body battery on waking: ${raw.bodyBatteryWake}`);
    if (raw.stress?.avg != null || raw.stress?.max != null) {
        lines.push(`- Device stress: avg ${raw.stress?.avg ?? '—'} · max ${raw.stress?.max ?? '—'}`);
    }
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

    if (baselineVersion >= 3) {
        lines.push('');
        lines.push('> Respiration robust baseline is exported for context, but production respiration strain scoring is currently OFF by default. Do not treat it as an additional live readiness penalty.');
    }

    if (baselineVersion >= 4) {
        lines.push('');
        lines.push('Observation-only candidate baselines (not independent engine inputs):');
        lines.push('These median/MAD summaries are exported for inspection and future calibration. They do not replace the live mean/stdev paths and must not be stacked as extra strain votes.');
        lines.push(candidateBaselineLine(
            'Sleep score candidate', 'pts', raw.sleepScore,
            derived.sleepScore7dMedian, derived.sleepScore28dMedian, derived.sleepScore28dMad,
            derived.deltas.sleepScoreVs7dMedian, derived.deltas.sleepScoreVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Resting HR candidate', 'bpm', raw.restingHr,
            derived.restingHr7dMedian, derived.restingHr28dMedian, derived.restingHr28dMad,
            derived.deltas.restingHrVs7dMedian, derived.deltas.restingHrVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'HRV candidate', 'ms', raw.hrvOvernightAvg,
            derived.hrv7dMedian, derived.hrv28dMedian, derived.hrv28dMad,
            derived.deltas.hrvVs7dMedian, derived.deltas.hrvVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Steps candidate (yesterday D-1)', 'steps', raw.totalSteps,
            derived.steps7dMedian, derived.steps28dMedian, derived.steps28dMad,
            derived.deltas.stepsVs7dMedian, derived.deltas.stepsVs28dMedian,
        ));
    }

    if (baselineVersion >= 5) {
        lines.push(candidateBaselineLine(
            'Body Battery wake candidate', 'pts', raw.bodyBatteryWake,
            derived.bodyBatteryWake7dMedian, derived.bodyBatteryWake28dMedian, derived.bodyBatteryWake28dMad,
            derived.deltas.bodyBatteryWakeVs7dMedian, derived.deltas.bodyBatteryWakeVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Stress avg candidate', 'pts', raw.stress?.avg,
            derived.stressAvg7dMedian, derived.stressAvg28dMedian, derived.stressAvg28dMad,
            derived.deltas.stressAvgVs7dMedian, derived.deltas.stressAvgVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Stress max candidate', 'pts', raw.stress?.max,
            derived.stressMax7dMedian, derived.stressMax28dMedian, derived.stressMax28dMad,
            derived.deltas.stressMaxVs7dMedian, derived.deltas.stressMaxVs28dMedian,
        ));
        lines.push(candidateBaselineLine(
            'Training Readiness score candidate', 'pts', raw.trainingReadiness?.score,
            derived.trainingReadinessScore7dMedian, derived.trainingReadinessScore28dMedian, derived.trainingReadinessScore28dMad,
            derived.deltas.trainingReadinessScoreVs7dMedian, derived.deltas.trainingReadinessScoreVs28dMedian,
        ));
        lines.push('');
        lines.push('> Correlation caution: Body Battery, stress and Training Readiness overlap upstream with HRV, sleep, stress and load physiology. Treat them as correlated observations, not independent additive evidence.');
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

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
    road_biking: 'Road cycling',
    cycling: 'Cycling',
    virtual_ride: 'Virtual cycling',
    gravel_cycling: 'Gravel cycling',
    mountain_biking: 'Mountain biking',
    running: 'Running',
    trail_running: 'Trail running',
    treadmill_running: 'Treadmill',
    strength_training: 'Strength',
    cardio: 'Cardio',
    soccer: 'Soccer',
    swimming: 'Swimming',
    lap_swimming: 'Swimming',
    rowing: 'Rowing',
    indoor_rowing: 'Indoor rowing',
    walking: 'Walking',
    hiking: 'Hiking',
    yoga: 'Yoga',
    pilates: 'Pilates',
    mobility: 'Mobility',
};

function formatActivityType(typeKey: string): string {
    if (ACTIVITY_TYPE_LABELS[typeKey]) return ACTIVITY_TYPE_LABELS[typeKey];
    return typeKey.replace(/_/g, ' ');
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
        const typeLabel = formatActivityType(activity.type);
        lines.push(`| ${activity.date} | ${typeLabel} | ${activity.durationMin ?? '—'} | ${round(activity.activityTrainingLoad, 1)} | ${round(activity.trainingEffectAerobic, 1)} | ${round(activity.trainingEffectAnaerobic, 1)} | ${activity.averageHr ?? '—'} | ${activity.intensityTag} |`);
    }

    const totalMinutes = activities.reduce((sum, activity) => sum + (activity.durationMin ?? 0), 0);
    const hardCount = activities.filter(activity => activity.intensityTag === 'hard').length;
    lines.push('');
    lines.push(`Totals: ${activities.length} sessions · ${totalMinutes} min · ${hardCount} tagged hard.`);

    const modalityMinutes: Record<string, { sessions: number; minutes: number }> = {};
    for (const act of activities) {
        const label = formatActivityType(act.type);
        if (!modalityMinutes[label]) modalityMinutes[label] = { sessions: 0, minutes: 0 };
        modalityMinutes[label].sessions += 1;
        modalityMinutes[label].minutes += act.durationMin ?? 0;
    }
    const breakdown = Object.entries(modalityMinutes)
        .sort((a, b) => b[1].minutes - a[1].minutes)
        .map(([sport, stat]) => `${sport}: ${stat.sessions} session${stat.sessions === 1 ? '' : 's'} (${stat.minutes} min)`)
        .join(' · ');
    if (breakdown) {
        lines.push(`Discipline volume: ${breakdown}`);
    }

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
    const minimumDays = minimumRecordedDays(baselineDays);
    if (recordedDays < minimumDays) {
        return [
            '',
            `> No ${baselineDays}-day subjective baseline: only ${recordedDays} of ${baselineDays} days recorded `
            + `(minimum ${minimumDays}). Check-ins are skipped more often on disrupted days, so a `
            + 'sparse baseline reads optimistically — treat the window averages above as absolute values, not as a trend.',
        ];
    }

    const metricLines: string[] = [];
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
        metricLines.push(`- ${metric.label}: ${round(windowAvg)} vs ${round(baselineAvg)} (${signed(delta)}, ${direction})`);
    }

    // Every metric can be skipped when the window holds only safety-only partials, which
    // would otherwise leave the heading promising a comparison and nothing beneath it.
    if (metricLines.length === 0) {
        return [
            '',
            `> No subjective baseline comparison: the ${baselineDays}-day history has enough recorded days, `
            + 'but no metric is scored on both sides of the comparison.',
        ];
    }
    lines.push(...metricLines);

    if (recordedDays < sparseBelowDays(baselineDays)) {
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

    const latest = checkins[checkins.length - 1];

    lines.push('Higher is better for readiness, sleep quality and motivation; higher is worse for fatigue, soreness and mental stress.');
    lines.push('');
    lines.push(`Most recent check-in — ${latest.date}:`);
    lines.push(`- Readiness ${round(latest.readiness ?? null)} · fatigue ${round(latest.fatigue ?? null)} · soreness ${round(latest.soreness ?? null)}`);
    lines.push(`- Sleep quality ${round(latest.sleepQuality ?? null)} · motivation ${round(latest.motivation ?? null)} · mental stress ${round(latest.mentalStress ?? null)}`);

    const latestFlags: string[] = [];
    if (latest.painOrInjury) latestFlags.push('pain/injury flagged');
    if (latest.illnessSymptoms) latestFlags.push('illness symptoms flagged');
    if (latest.alreadyTrainedToday) latestFlags.push('already trained today');
    if (latest.unusuallyLimitedTime) latestFlags.push('unusually limited time');
    if (latest.availability?.timeAvailableMin != null) latestFlags.push(`${latest.availability.timeAvailableMin} min available`);
    if (latest.availability?.preferredModalityToday) latestFlags.push(`preferred modality: ${latest.availability.preferredModalityToday}`);
    if (latest.availability?.indoorOnly) latestFlags.push('indoor only');
    if (latestFlags.length > 0) {
        lines.push(`- Flags / availability: ${latestFlags.join(' · ')}`);
    }

    if (latest.tissueResponses) {
        const trEntries = Object.entries(latest.tissueResponses).filter(([, tr]) => tr != null);
        if (trEntries.length > 0) {
            const trSummaries = trEntries.map(([region, tr]) => {
                const parts = [`${region}: morning ${tr.morningState}`];
                if (tr.painDuringTraining) parts.push(`during ${tr.painDuringTraining}`);
                if (tr.afterTrainingState) parts.push(`after ${tr.afterTrainingState}`);
                if (tr.nextMorningReaction) parts.push(`next morning ${tr.nextMorningReaction}`);
                return parts.join(', ');
            });
            lines.push(`- Tissue response: ${trSummaries.join('; ')}`);
        }
    }

    lines.push('');
    lines.push(`Window averages (${checkins.length} of ${windowDays} days have data):`);
    lines.push(`- Readiness ${round(mean(checkins.map(c => c.readiness)))} · fatigue ${round(mean(checkins.map(c => c.fatigue)))} · soreness ${round(mean(checkins.map(c => c.soreness)))}`);
    lines.push(`- Sleep quality ${round(mean(checkins.map(c => c.sleepQuality)))} · motivation ${round(mean(checkins.map(c => c.motivation)))} · mental stress ${round(mean(checkins.map(c => c.mentalStress)))}`);
    lines.push(...renderSubjectiveBaseline(checkins, baselineCheckins, baselineDays, windowDays));
    lines.push('');
    lines.push('Flags:');
    const painDays = checkins.filter(c => c.painOrInjury).map(c => c.date);
    const illnessDays = checkins.filter(c => c.illnessSymptoms).map(c => c.date);
    const limitedDays = checkins.filter(c => c.unusuallyLimitedTime).map(c => c.date);
    const alreadyTrainedDays = checkins.filter(c => c.alreadyTrainedToday).map(c => c.date);
    lines.push(`- Pain or injury flagged: ${painDays.length > 0 ? `${painDays.length} day(s) — ${painDays.join(', ')}` : 'none'}`);
    lines.push(`- Illness symptoms flagged: ${illnessDays.length > 0 ? `${illnessDays.length} day(s) — ${illnessDays.join(', ')}` : 'none'}`);
    if (limitedDays.length > 0) lines.push(`- Unusually limited time: ${limitedDays.length} day(s) — ${limitedDays.join(', ')}`);
    if (alreadyTrainedDays.length > 0) lines.push(`- Already trained today: ${alreadyTrainedDays.length} day(s) — ${alreadyTrainedDays.join(', ')}`);

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
    const answered = recommendations.filter(r => r.adherence.followed !== null || r.adherence.skipped);
    const followed = recommendations.filter(r => r.adherence.followed === true);
    const different = recommendations.filter(r => r.adherence.followed === false && !r.adherence.skipped);
    const skipped = recommendations.filter(r => r.adherence.skipped);

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

function renderGoalsAndIntent(goals: readonly UserGoal[] | undefined, profile: TrainingIntentProfile | null, asOfDate: string): string[] {
    const activeGoals = (goals ?? []).filter(g => g.status === 'active');
    if (activeGoals.length === 0 && !profile) return [];
    const lines: string[] = ['## 6. Goals & training intent', ''];
    if (activeGoals.length > 0) {
        lines.push('Target events & goals:');
        for (const goal of activeGoals) {
            const priorityTag = `Priority ${deriveEventPriority(goal.priority)}`;
            const daysAway = goal.targetDate ? getDayDiff(goal.targetDate, asOfDate) : null;
            const countdown = daysAway !== null ? `${daysAway} days away (${goal.targetDate})` : 'Open-ended';
            const category = goal.category ? `Phase: ${goal.category}` : '';
            const eventType = goal.eventCategory ? `Type: ${goal.eventCategory.replace(/_/g, ' ')}` : '';
            const details = [priorityTag, countdown, eventType, category].filter(Boolean).join(' · ');
            lines.push(`- **${goal.title}**: ${details}`);
        }
        if (profile) lines.push('');
    }
    if (profile) {
        lines.push(`- Weekly session commitment: minimum ${profile.weeklyCommitment.minSessions}, typical ${profile.weeklyCommitment.targetSessions}, maximum ${profile.weeklyCommitment.maxSessions}`);
        lines.push(`- Priorities, in order: ${profile.priorities.join(' > ')}`);
    }
    return lines;
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
        renderGoalsAndIntent(input.goals, input.intentProfile, asOfDate),
        [
            '## Requested output',
            '',
            'Design the next training block using the above. Respect every constraint in section 1 —',
            'a session requiring absent equipment or violating a safety limit is unusable.',
            '',
            'Note that daily execution is adjusted separately against that morning\'s readiness, so',
            'plan the intended block rather than pre-emptively reducing it for anticipated fatigue.',
            '',
            '### Preferred output schema (compatible with 1-click plan import):',
            'Output the recommended schedule as a series of day blocks formatted exactly as follows:',
            '```markdown',
            '### Day YYYY-MM-DD: <Session Name>',
            '- Modality: <Cycling | Running | Strength | Mobility | Field | Cross Training>',
            '- Duration: <minutes> min',
            '- Intensity: <easy | moderate | hard>',
            '- Objectives: <zone2 aerobic | threshold quality | surge repeatability | vo2 max | strength maintenance | strength development | race specific endurance> (or omit if recovery)',
            '- Description: <Interval structure, target power/HR zones, or workout instructions>',
            '```',
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
