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
import { mean, renderBodyComposition, renderObjective, round, signed } from './contextBriefRecovery';
import { SECTION_TITLE, type BriefPurpose, type BriefWindowPreset } from './contextBriefPurpose';

// Re-exported so existing importers keep one entry point for the brief.
export { round, signed } from './contextBriefRecovery';
export {
    briefPurposeFor,
    findSectionHeading,
    SECTION_TITLE,
    type BriefPurpose,
    type BriefWindowPreset,
} from './contextBriefPurpose';

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
    /** Pre-computed by the service layer (`contextBriefService.ts`), never fetched or
     * imported here: ADR-0039 D-BC-AUTH bars `engine/` from importing anthropometry at
     * all (enforced by `anthropometry/engineIsolation.test.ts`), so this is a plain,
     * already-summarized shape rather than raw `AnthropometryEntry[]`. */
    bodyComposition?: BodyCompositionBriefInput;
    /** Issue #811: what the export is for. Defaults to `diagnostic` — the complete,
     * legacy section order with every observation-only candidate — so a caller that does
     * not state a purpose never silently loses evidence. `planning` reorders sections by
     * decision authority and omits forensic/experimental detail. `morning` is rendered by
     * `buildMorningCoachBrief` instead; passed here it behaves like `planning`. */
    purpose?: BriefPurpose;
}

/** See the isolation note on `ContextBriefInput.bodyComposition` above: intentionally not
 * `AnthropometryMetricId`/`AnthropometryEntry` from `../anthropometry/models`. */
export interface BodyCompositionBriefInput {
    bodyMass: {
        source: 'provider' | 'manual';
        latestKg: number | null;
        latestDate: string | null;
        current7dMeanKg: number | null;
        prior7dMeanKg: number | null;
        weekOverWeekKg: number | null;
        weekOverWeekPercent: number | null;
    } | null;
    circumferences: ReadonlyArray<{
        label: string;
        latestCm: number | null;
        latestDate: string | null;
        /** vs the previous recorded session for this exact metric/laterality/protocol, not a calendar window. */
        deltaCm: number | null;
        repeatabilityWarning: boolean;
    }>;
    bodyFatPct: {
        latestPct: number | null;
        latestDate: string | null;
        mean7dPct: number | null;
        /** Distinct recorded days feeding `mean7dPct`, out of 7. `mean7dPct` is null below
         * the 4-day coverage floor; carried through so the brief can say why rather than
         * rendering a bare "—" that reads the same as "no data at all". */
        recordedDays7d: number;
    } | null;
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

function withinWindow(date: string, startDate: string, asOfDate: string): boolean {
    return date >= startDate && date <= asOfDate;
}

/** Ascending list of the `days` calendar dates ending on and including `endDateInclusive`. */
function lastNDates(endDateInclusive: string, days: number): string[] {
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) dates.push(addDaysToLocalDateString(endDateInclusive, -i));
    return dates;
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

/** Issue #809: shows stimulus intensity and, when classified, domain and session cost
 * separately so an external reader never mistakes dose for intensity. */
export function formatIntensityCell(activity: NormalizedGarminActivity): string {
    const details = [
        activity.stimulusDomain && activity.stimulusDomain !== 'unknown' ? activity.stimulusDomain : null,
        activity.sessionCost && activity.sessionCost !== 'unknown' ? `cost ${activity.sessionCost.replace('_', ' ')}` : null,
    ].filter((detail): detail is string => detail !== null);
    return details.length > 0 ? `${activity.intensityTag} (${details.join(', ')})` : activity.intensityTag;
}

export function formatActivityType(typeKey: string): string {
    if (ACTIVITY_TYPE_LABELS[typeKey]) return ACTIVITY_TYPE_LABELS[typeKey];
    return typeKey.replace(/_/g, ' ');
}

function renderTraining(activities: readonly NormalizedGarminActivity[], asOfDate: string, windowDays: number, heading: string): string[] {
    const lines: string[] = [heading, ''];
    if (activities.length === 0) {
        lines.push('No recorded sessions in this window.');
        return lines;
    }

    lines.push('| Date | Type | Min | Load | Aerobic TE | Anaerobic TE | Avg HR | Intensity |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const activity of activities) {
        const typeLabel = formatActivityType(activity.type);
        lines.push(`| ${activity.date} | ${typeLabel} | ${activity.durationMin ?? '—'} | ${round(activity.activityTrainingLoad, 1)} | ${round(activity.trainingEffectAerobic, 1)} | ${round(activity.trainingEffectAnaerobic, 1)} | ${activity.averageHr ?? '—'} | ${formatIntensityCell(activity)} |`);
    }

    const totalMinutes = activities.reduce((sum, activity) => sum + (activity.durationMin ?? 0), 0);
    const hardCount = activities.filter(activity => activity.intensityTag === 'hard').length;
    const highCostCount = activities.filter(activity => activity.sessionCost === 'high' || activity.sessionCost === 'very_high').length;
    lines.push('');
    // Issue #809: "tagged hard" counts high-intensity stimulus only; costly aerobic sessions
    // are reported separately so dose is not read as intensity.
    const costSuffix = highCostCount > 0 ? ` · ${highCostCount} high session cost` : '';
    lines.push(`Totals: ${activities.length} sessions · ${totalMinutes} min · ${hardCount} tagged hard${costSuffix}.`);

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

/** Compares either the most recent short-window reading or the full window average against
 * the trailing baseline, gated on how many days the baseline actually rests on. Returns []
 * when the baseline is withheld. */
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

    // At two or three days the window is too short to establish a trend. Use the latest
    // actual check-in as the point reading instead of averaging it with yesterday: otherwise
    // the output can say "single reading" while silently diluting today's signal with D-1.
    // Label the concrete date rather than "Today" so a missing current-day check-in cannot
    // make yesterday's score look current.
    const isPointReading = windowDays <= 3;
    const pointCheckin = isPointReading ? windowCheckins[windowCheckins.length - 1] : null;
    const metricLines: string[] = [];
    const lines = [
        '',
        isPointReading
            ? `Most recent check-in (${pointCheckin!.date}) vs this athlete's own trailing ${baselineDays}-day baseline `
            + `(${recordedDays} of ${baselineDays} days recorded). This is a single reading, not a trend — `
            + 'one disrupted night can move it on its own:'
            : `Window average vs this athlete's own trailing ${baselineDays}-day baseline `
            + `(${recordedDays} of ${baselineDays} days recorded). The baseline period contains the window, `
            + 'so a sustained change shows up here at roughly half its true size — read the direction, not the magnitude:',
    ];
    for (const metric of SUBJECTIVE_METRICS) {
        const windowValue = pointCheckin ? metric.read(pointCheckin) : mean(windowCheckins.map(metric.read));
        const baselineAvg = mean(baselineCheckins.map(metric.read));
        if (windowValue === null || baselineAvg === null) continue;
        const delta = windowValue - baselineAvg;
        const direction = Math.abs(delta) < 0.05
            ? 'flat'
            : (delta > 0) === metric.higherIsBetter ? 'better than baseline' : 'worse than baseline';
        metricLines.push(`- ${metric.label}: ${round(windowValue)} vs ${round(baselineAvg)} (${signed(delta)}, ${direction})`);
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

/** Deliberately not imported from `../anthropometry/trends`: ADR-0039 D-BC-AUTH bars
 * `engine/` from importing anthropometry at all (enforced by
 * `anthropometry/engineIsolation.test.ts`), so this window math is a small local copy
 * rather than a reuse of that module's `computeHungerRetrospectiveSummary`. */
interface HungerWindowSummary {
    recordedDays7d: number;
    mean7d: number | null;
    recordedDays28d: number;
    mean28d: number | null;
    latestValue: number | null;
    latestDate: string | null;
}

function computeHungerWindow(
    checkins: readonly DailySubjectiveCheckin[],
    timing: 'morning_pre_breakfast' | 'other',
    dates7d: readonly string[],
    dates28d: readonly string[],
): HungerWindowSummary {
    const dates7dSet = new Set(dates7d);
    const dates28dSet = new Set(dates28d);
    const matching = checkins.filter((c): c is DailySubjectiveCheckin & { hunger1To10: number } =>
        c.hungerTiming === timing && typeof c.hunger1To10 === 'number');
    const in7d = matching.filter(c => dates7dSet.has(c.date));
    const in28d = matching.filter(c => dates28dSet.has(c.date));
    const sorted = [...matching].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    return {
        recordedDays7d: in7d.length,
        mean7d: mean(in7d.map(c => c.hunger1To10)),
        recordedDays28d: in28d.length,
        mean28d: mean(in28d.map(c => c.hunger1To10)),
        latestValue: latest?.hunger1To10 ?? null,
        latestDate: latest?.date ?? null,
    };
}

/** Ownership: ADR-0039 D-BC-HUNGER. Zero recommendation authority in the engine (see
 * docs/plans/body-composition-and-fueling-observations.md) — exported here for the same
 * reason the robust respiration/candidate baselines above are: an external planner can see
 * a fueling-adjacent trend without the brief implying it is an additional readiness input. */
function renderHungerRetrospective(
    morning: HungerWindowSummary,
    other: HungerWindowSummary,
    baselineDays: number,
): string[] {
    if (morning.recordedDays28d === 0 && other.recordedDays28d === 0) return [];
    const lines: string[] = [
        '',
        'Appetite (hunger 1–10, self-scored). Zero recommendation authority — exported for context '
        + 'only, not an independent readiness signal:',
    ];
    if (morning.recordedDays7d > 0 || morning.recordedDays28d > 0) {
        lines.push(
            `- Pre-breakfast timing (preferred series): latest ${round(morning.latestValue)}`
            + `${morning.latestDate ? ` (${morning.latestDate})` : ''} — 7d avg ${round(morning.mean7d)} `
            + `(${morning.recordedDays7d}/7 days), ${baselineDays}d avg ${round(morning.mean28d)} `
            + `(${morning.recordedDays28d}/${baselineDays} days)`,
        );
    }
    if (other.recordedDays7d > 0 || other.recordedDays28d > 0) {
        lines.push(
            `- Other timing: latest ${round(other.latestValue)}${other.latestDate ? ` (${other.latestDate})` : ''} `
            + `— 7d avg ${round(other.mean7d)} (${other.recordedDays7d}/7 days), ${baselineDays}d avg `
            + `${round(other.mean28d)} (${other.recordedDays28d}/${baselineDays} days)`,
        );
    }
    return lines;
}

function renderSubjective(
    checkins: readonly DailySubjectiveCheckin[],
    baselineCheckins: readonly DailySubjectiveCheckin[],
    windowDays: number,
    baselineDays: number,
    hunger: { morning: HungerWindowSummary; other: HungerWindowSummary },
    heading: string,
): string[] {
    const lines: string[] = [heading, ''];
    if (checkins.length === 0) {
        lines.push('No check-ins in this window.');
        // Hunger is computed from `baselineDays` history, not `checkins` (the visible
        // window) -- a hunger reading from 20 days ago can exist even when the last
        // `windowDays` are empty, and must not be swallowed by this early return.
        lines.push(...renderHungerRetrospective(hunger.morning, hunger.other, baselineDays));
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

    if (latest.physicalWork?.performed) {
        const pw = latest.physicalWork;
        const durationLabels: Record<string, string> = { short: '< 1 hr', medium: '1–3 hrs', extended: '3+ hrs' };
        const areaLabels: Record<string, string> = {
            grip_forearms: 'grip/forearms',
            upper_body: 'upper body',
            lower_back_spine: 'lower back/spine',
            legs_carrying: 'legs/carrying',
        };
        const parts: string[] = [];
        if (pw.duration) parts.push(durationLabels[pw.duration] ?? pw.duration);
        if (pw.intensity) parts.push(`${pw.intensity} effort`);
        if (pw.loadAreas && pw.loadAreas.length > 0) {
            parts.push(`strain: ${pw.loadAreas.map(a => areaLabels[a] ?? a).join(', ')}`);
        }
        const summary = parts.length > 0 ? parts.join(' · ') : 'reported';
        const noteStr = pw.notes && pw.notes.trim().length > 0 ? ` — "${pw.notes.trim()}"` : '';
        lines.push(`- Unlogged physical work (D-1): ${summary}${noteStr}`);
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
    lines.push(...renderHungerRetrospective(hunger.morning, hunger.other, baselineDays));
    lines.push('');
    lines.push('Flags:');
    const painDays = checkins.filter(c => c.painOrInjury).map(c => c.date);
    const illnessDays = checkins.filter(c => c.illnessSymptoms).map(c => c.date);
    const limitedDays = checkins.filter(c => c.unusuallyLimitedTime).map(c => c.date);
    const alreadyTrainedDays = checkins.filter(c => c.alreadyTrainedToday).map(c => c.date);
    const physicalWorkDays = checkins.filter(c => c.physicalWork?.performed).map(c => c.date);
    lines.push(`- Pain or injury flagged: ${painDays.length > 0 ? `${painDays.length} day(s) — ${painDays.join(', ')}` : 'none'}`);
    lines.push(`- Illness symptoms flagged: ${illnessDays.length > 0 ? `${illnessDays.length} day(s) — ${illnessDays.join(', ')}` : 'none'}`);
    if (limitedDays.length > 0) lines.push(`- Unusually limited time: ${limitedDays.length} day(s) — ${limitedDays.join(', ')}`);
    if (alreadyTrainedDays.length > 0) lines.push(`- Already trained today: ${alreadyTrainedDays.length} day(s) — ${alreadyTrainedDays.join(', ')}`);
    if (physicalWorkDays.length > 0) lines.push(`- Unlogged physical work: ${physicalWorkDays.length} day(s) — ${physicalWorkDays.join(', ')}`);

    const notes = checkins.filter(c => c.notes && c.notes.trim().length > 0);
    if (notes.length > 0) {
        lines.push('');
        lines.push('Notes:');
        for (const checkin of notes) lines.push(`- ${checkin.date}: ${checkin.notes!.trim()}`);
    }
    return lines;
}

function renderAdherence(recommendations: readonly DailyRecommendation[], heading: string): string[] {
    const lines: string[] = [heading, ''];
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

function renderGoalsAndIntent(goals: readonly UserGoal[] | undefined, profile: TrainingIntentProfile | null, asOfDate: string, heading: string): string[] {
    const activeGoals = (goals ?? []).filter(g => g.status === 'active');
    if (activeGoals.length === 0 && !profile) return [];
    const lines: string[] = [heading, ''];
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
    const sortByDateAsc = <T extends { date: string }>(items: readonly T[]): T[] =>
        [...items].sort((a, b) => a.date.localeCompare(b.date));
    const filterRange = <T extends { date: string }>(sortedItems: readonly T[], start: string, end: string): T[] =>
        sortedItems.filter(item => item.date >= start && item.date <= end);

    // Not clamped up to windowDays: a baseline equal to the window is meaningless, and
    // renderSubjectiveBaseline says so rather than printing all-flat deltas.
    const baselineDays = input.subjectiveBaselineDays ?? SUBJECTIVE_BASELINE_DAYS;
    const baselineStart = addDaysToLocalDateString(asOfDate, -(baselineDays - 1));

    const sortedCheckins = sortByDateAsc(input.checkins);
    const snapshots = filterRange(sortByDateAsc(input.snapshots), startDate, asOfDate);
    const checkins = filterRange(sortedCheckins, startDate, asOfDate);
    const baselineCheckins = filterRange(sortedCheckins, baselineStart, asOfDate);
    const activities = filterRange(sortByDateAsc(input.activities), startDate, asOfDate);
    const recommendations = filterRange(sortByDateAsc(input.recommendations), startDate, asOfDate);

    // Hunger rides on the same check-in doc `checkins`/`baselineCheckins` already fetch —
    // no separate source, no new I/O. Windows are computed relative to asOfDate rather than
    // reused from checkins/baselineCheckins so a day with no submission still counts as a
    // recorded-day denominator, matching computeHungerWindow's contract.
    const hunger7dDates = lastNDates(asOfDate, 7);
    const hunger28dDates = lastNDates(asOfDate, baselineDays);
    const hungerMorning = computeHungerWindow(sortedCheckins, 'morning_pre_breakfast', hunger7dDates, hunger28dDates);
    const hungerOther = computeHungerWindow(sortedCheckins, 'other', hunger7dDates, hunger28dDates);

    // A short retrospective window can legitimately have zero recorded sessions or
    // check-ins in range; without this note that reads as "this athlete does not train"
    // rather than "detail beyond this window was not requested". The recovery timeline
    // and subjective baseline sections below cover longer history regardless of windowDays.
    const scopeNote = windowDays < 7
        ? [`Retrospective detail (completed training, per-check-in flags) is scoped to the last ${windowDays} day(s). `
            + 'The recovery timeline and subjective baseline further below cover longer history and are not limited to this window.']
        : [];

    // Issue #811: planning order follows decision authority — constraints, current intent,
    // recovery evidence, completed load, execution. Diagnostic keeps the original
    // data-source order so existing forensic workflows read unchanged.
    const purpose = input.purpose ?? 'diagnostic';
    const planningOrder = purpose !== 'diagnostic';
    const n = (planning: number, diagnostic: number): number => (planningOrder ? planning : diagnostic);
    const constraints = renderConstraints(input.trainingSettings, input.preferences, asOfDate);
    const renderedIntent = renderGoalsAndIntent(
        input.goals, input.intentProfile, asOfDate,
        planningOrder ? `## 2. ${SECTION_TITLE.intentFirst}` : `## 6. ${SECTION_TITLE.intent}`,
    );
    // Planning numbers sections 1-6 contiguously, so section 2 is always present there and
    // states the absence rather than leaving a numbering gap.
    const intent = planningOrder && renderedIntent.length === 0
        ? [`## 2. ${SECTION_TITLE.intentFirst}`, '', 'No active goals or training intent profile recorded.']
        : renderedIntent;
    const objective = renderObjective(snapshots, windowDays, `## ${n(3, 2)}. ${SECTION_TITLE.objective}`, planningOrder);
    const bodyComposition = renderBodyComposition(input.bodyComposition, planningOrder);
    const training = renderTraining(activities, asOfDate, windowDays, `## ${n(5, 3)}. ${SECTION_TITLE.training}`);
    const subjective = renderSubjective(
        checkins, baselineCheckins, windowDays, baselineDays, { morning: hungerMorning, other: hungerOther },
        `## 4. ${SECTION_TITLE.subjective}`,
    );
    const adherence = renderAdherence(recommendations, `## ${n(6, 5)}. ${SECTION_TITLE.adherence}`);
    const body: string[][] = planningOrder
        ? [constraints, intent, objective, bodyComposition, subjective, training, adherence]
        : [constraints, objective, bodyComposition, training, subjective, adherence, intent];
    const purposeNote = planningOrder
        ? ['Export purpose: planning — sections are ordered by decision authority; forensic telemetry and '
            + 'experimental candidate baselines are summarized or omitted (request the diagnostic export for them).']
        : ['Export purpose: diagnostic — full forensic telemetry and observation-only candidate baselines. '
            + 'None of that detail has recommendation authority; it does not change what the app recommends.'];

    const sections: string[][] = [
        [
            '# Training context brief',
            '',
            `Window: ${startDate} → ${asOfDate} (${windowDays} days). All dates are Europe/Warsaw calendar dates.`,
            'Blank values ("—") mean not measured, not zero. This brief contains no raw device payloads.',
            ...purposeNote,
            ...scopeNote,
        ],
        ...body,
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

/** Retrospective detail window for the `daily` preset: today and D-1. `diagnostic` reuses
 * the `full` lookback: it changes what is expanded, not how far back data is fetched, so
 * choosing it can never widen a data read. */
export const DAILY_BRIEF_WINDOW_DAYS = 2;

export function briefWindowDaysFor(preset: BriefWindowPreset): number {
    return preset === 'daily' ? DAILY_BRIEF_WINDOW_DAYS : defaultBriefWindowDays();
}
