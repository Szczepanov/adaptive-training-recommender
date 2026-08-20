import type {
    DailyRecommendation,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    FixedActivity,
    NormalizedGarminActivity,
    TrainingIntentProfile,
} from './models';
import { addDaysToLocalDateString } from '../utils/localDate';

export const UPCOMING_CONTEXT_DAYS = 7;
export const RECOVERY_TIMELINE_DAYS = 7;

export interface UpcomingExternalPlanSession {
    date: string;
    planId: string;
    planTitle: string;
    revision: number;
    sessionId: string;
    title: string;
    priority: 'key' | 'supporting' | 'optional';
    modality: string;
    intensity: string;
    durationMin: number;
    durationMax: number;
    flexibility: 'fixed' | 'preferred' | 'any_day';
    status: 'planned' | 'moved';
    moved: boolean;
    isEvent: boolean;
}

export interface ContextBriefPlanningHandoffInput {
    asOfDate: string;
    snapshots: readonly DailyRecoverySnapshot[];
    checkins: readonly DailySubjectiveCheckin[];
    activities: readonly NormalizedGarminActivity[];
    recommendations: readonly DailyRecommendation[];
    intentProfile: TrainingIntentProfile | null;
    upcomingFixedActivities: readonly FixedActivity[];
    upcomingExternalSessions: readonly UpcomingExternalPlanSession[];
    unavailableSources: readonly string[];
}

function latestByDate<T extends { date: string }>(items: readonly T[]): T | null {
    if (items.length === 0) return null;
    return [...items].sort((a, b) => b.date.localeCompare(a.date))[0];
}

function textNumber(value: number | null | undefined, suffix = ''): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '—';
}

function renderDataHandoff(input: ContextBriefPlanningHandoffInput): string {
    const latestSnapshot = latestByDate(input.snapshots);
    const latestCheckin = latestByDate(input.checkins);
    const currentCheckin = input.checkins.find(item => item.date === input.asOfDate) ?? null;
    const todayActivities = input.activities.filter(item => item.date === input.asOfDate);
    const todayRecommendation = [...input.recommendations]
        .filter(item => item.date === input.asOfDate)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;

    const lines: string[] = [
        '## 0. Planning handoff & data currency',
        '',
        '**Use this as context for the conversation, not as a standalone command.** Answer the user\'s actual question that accompanies or follows this brief; do not generate a new plan merely because the brief was pasted.',
        `- Planning date: ${input.asOfDate} (Europe/Warsaw calendar date).`,
        `- Planning mode: ${input.intentProfile?.planningMode ?? 'not configured'}.`,
    ];

    if (latestSnapshot) {
        const source = latestSnapshot.source;
        lines.push(`- Latest wearable snapshot: ${latestSnapshot.date}; Garmin sync timestamp ${source.garminSyncedAt}.`);
        const metricDates = source.metricDates;
        if (metricDates) {
            const freshness = [
                metricDates.sleep ? `sleep ${metricDates.sleep}` : null,
                metricDates.hrv ? `HRV ${metricDates.hrv}` : null,
                metricDates.restingHr ? `RHR ${metricDates.restingHr}` : null,
                metricDates.stress ? `stress ${metricDates.stress}` : null,
                metricDates.steps ? `steps ${metricDates.steps}` : null,
                metricDates.activitiesThrough ? `activities through ${metricDates.activitiesThrough}` : null,
            ].filter((item): item is string => item !== null);
            if (freshness.length > 0) lines.push(`- Wearable metric dates: ${freshness.join(' · ')}.`);
        }
        if (latestSnapshot.date < input.asOfDate) {
            lines.push(`> Wearable caution: no snapshot for ${input.asOfDate}; the newest wearable state is ${latestSnapshot.date}. Do not treat it as current-day readiness.`);
        }
    } else {
        lines.push('- Latest wearable snapshot: none available in the exported window.');
    }

    if (currentCheckin) {
        lines.push(`- Current-day check-in: ${currentCheckin.dataQuality.isComplete ? 'complete' : 'partial'} (${currentCheckin.submittedAt}).`);
    } else if (latestCheckin) {
        lines.push(`> Check-in caution: no check-in for ${input.asOfDate}; latest available is ${latestCheckin.date}. Do not assume subjective readiness, pain or availability are current.`);
    } else {
        lines.push('> Check-in caution: no subjective check-in is available in the exported window.');
    }

    if (todayActivities.length > 0) {
        const hard = todayActivities.filter(item => item.intensityTag === 'hard').length;
        lines.push(`- Recorded activity on planning date: ${todayActivities.length} session(s)${hard > 0 ? `, ${hard} tagged hard` : ''}.`);
    } else {
        lines.push('- No activity record is currently dated to the planning date. Same-day Garmin activity can lag until a post-session sync, so this is not proof that no training occurred.');
    }

    if (todayRecommendation) {
        lines.push(`- App recommendation for ${input.asOfDate}: ${todayRecommendation.mode} — ${todayRecommendation.templateTitle} (${todayRecommendation.modality}). Treat this as one planning input, not as authority over current symptoms or tissue response.`);
    }

    if (input.unavailableSources.length > 0) {
        lines.push('');
        lines.push(`> **DATA INCOMPLETE:** could not reliably read: ${input.unavailableSources.join('; ')}. Absence from the affected sections means "unknown", not "none". Do not fill those gaps with assumptions.`);
    }

    return lines.join('\n');
}

function renderRecoveryTimeline(input: ContextBriefPlanningHandoffInput): string {
    const firstDate = addDaysToLocalDateString(input.asOfDate, -(RECOVERY_TIMELINE_DAYS - 1));
    const snapshots = new Map(input.snapshots.filter(item => item.date >= firstDate && item.date <= input.asOfDate).map(item => [item.date, item]));
    const checkins = new Map(input.checkins.filter(item => item.date >= firstDate && item.date <= input.asOfDate).map(item => [item.date, item]));
    const activitiesByDate = new Map<string, NormalizedGarminActivity[]>();
    for (const activity of input.activities.filter(item => item.date >= firstDate && item.date <= input.asOfDate)) {
        const sameDay = activitiesByDate.get(activity.date) ?? [];
        sameDay.push(activity);
        activitiesByDate.set(activity.date, sameDay);
    }

    if (snapshots.size === 0 && checkins.size === 0) return '';

    const lines = [
        '### Recent 7-day recovery timeline',
        '',
        'Calendar-day rows preserve direction and clustering that window averages can hide. “—” means not recorded.',
        '',
        '| Date | Sleep | HRV | RHR | Resp | BB | Stress | Ready | Fatigue | Sore | Training / flags |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ];

    for (let offset = 0; offset < RECOVERY_TIMELINE_DAYS; offset++) {
        const date = addDaysToLocalDateString(firstDate, offset);
        const snapshot = snapshots.get(date);
        const checkin = checkins.get(date);
        const activities = activitiesByDate.get(date) ?? [];
        const flags: string[] = [];
        if (activities.length > 0) {
            const hard = activities.filter(item => item.intensityTag === 'hard').length;
            flags.push(`${activities.length} activity${activities.length === 1 ? '' : 'ies'}${hard > 0 ? ` (${hard} hard)` : ''}`);
        }
        if (checkin?.alreadyTrainedToday && activities.length === 0) flags.push('reported trained');
        if (checkin?.painOrInjury) flags.push('pain/injury');
        if (checkin?.illnessSymptoms) flags.push('illness');
        if (checkin?.unusuallyLimitedTime) flags.push('limited time');

        lines.push(`| ${date} | ${textNumber(snapshot?.raw.sleepScore)} | ${textNumber(snapshot?.raw.hrvOvernightAvg)} | ${textNumber(snapshot?.raw.restingHr)} | ${textNumber(snapshot?.raw.respirationAvg)} | ${textNumber(snapshot?.raw.bodyBatteryWake)} | ${textNumber(snapshot?.raw.stress?.avg)} | ${textNumber(checkin?.readiness)} | ${textNumber(checkin?.fatigue)} | ${textNumber(checkin?.soreness)} | ${flags.join(', ') || '—'} |`);
    }

    return lines.join('\n');
}

function renderUpcoming(input: ContextBriefPlanningHandoffInput): string {
    const endDate = addDaysToLocalDateString(input.asOfDate, UPCOMING_CONTEXT_DAYS - 1);
    const fixed = input.upcomingFixedActivities
        .filter(item => !item.isCompleted && item.date >= input.asOfDate && item.date <= endDate)
        .map(item => ({
            date: item.date,
            source: 'Fixed activity',
            title: item.title,
            dose: `${item.durationMin} min`,
            authority: item.fixed ? 'fixed' : 'movable',
            notes: [
                item.startTime ? `start ${item.startTime}` : null,
                item.environment,
                item.availabilityOverride !== undefined ? `day budget ${item.availabilityOverride} min` : null,
                item.availabilityContextOverride?.environment ? `day environment ${item.availabilityContextOverride.environment}` : null,
            ].filter((value): value is string => value !== null).join(' · '),
        }));
    const external = input.upcomingExternalSessions
        .filter(item => item.date >= input.asOfDate && item.date <= endDate)
        .map(item => ({
            date: item.date,
            source: `Imported plan: ${item.planTitle}`,
            title: item.title,
            dose: `${item.durationMin}${item.durationMax !== item.durationMin ? `–${item.durationMax}` : ''} min · ${item.intensity}`,
            authority: `${item.priority} · ${item.flexibility}${item.moved ? ' · moved' : ''}${item.isEvent ? ' · EVENT' : ''}`,
            notes: `revision ${item.revision}`,
        }));
    const rows = [...fixed, ...external].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));

    const lines: string[] = [
        `## 7. Existing commitments / imported plan (${input.asOfDate} → ${endDate})`,
        '',
        'Preserve these when proposing days unless the user explicitly asks to move, replace or re-plan them.',
    ];

    if (rows.length === 0) {
        lines.push('');
        if (input.intentProfile?.planningMode === 'externally_planned') {
            lines.push('> Planning mode is `externally_planned`, but no active imported session was found in this 7-day horizon. Do not silently replace the plan; clarify whether the prior block ended, the next block starts later, or plan data is unavailable.');
        } else {
            lines.push('No fixed activity or imported-plan session is recorded in this 7-day horizon. This only describes app-held commitments; it does not prove the athlete has no calendar constraints outside the app.');
        }
        return lines.join('\n');
    }

    lines.push('', '| Date | Source | Session / commitment | Dose | Priority / flexibility | Notes |', '|---|---|---|---|---|---|');
    for (const row of rows) {
        lines.push(`| ${row.date} | ${row.source} | ${row.title} | ${row.dose} | ${row.authority} | ${row.notes || '—'} |`);
    }
    return lines.join('\n');
}

function renderUseInstructions(): string {
    return [
        '## 8. How to use this handoff',
        '',
        '- Treat the brief as **state/context**, not as a request to automatically create a plan. Answer the user\'s actual question first.',
        '- For **today**, current illness/pain/tissue response and current-day availability outrank favorable wearable metrics. A green wearable day does not justify overriding a local warning signal.',
        '- For **future days**, preserve the intended purpose and hard/easy spacing of key sessions. Do not pre-emptively downgrade a future quality day merely because the preceding planned work may create normal fatigue; reassess that day when current data exists.',
        '- Favorable recovery metrics may support proceeding with the intended dose, but are not a reason by themselves to add volume or intensity beyond the plan.',
        '- Treat respiration robust statistics and the observation-only median/MAD fields as context for pattern recognition, not independent additive penalties.',
        '- Respect fixed activities and imported-plan sessions above. If a change is warranted, explain which constraint or new evidence justifies it.',
        '- Prefer dated/current records when information conflicts. Explicitly call out missing or stale data instead of assuming normality.',
        '',
        '### If the user asks for an importable schedule',
        '',
        'Use this exact day-block format so it remains compatible with 1-click plan import:',
        '```markdown',
        '### Day YYYY-MM-DD: <Session Name>',
        '- Modality: <Cycling | Running | Strength | Mobility | Field | Cross Training>',
        '- Duration: <minutes> min',
        '- Intensity: <easy | moderate | hard>',
        '- Objectives: <zone2 aerobic | threshold quality | surge repeatability | vo2 max | strength maintenance | strength development | race specific endurance> (or omit if recovery)',
        '- Description: <Interval structure, target power/HR zones, or workout instructions>',
        '```',
    ].join('\n');
}

/**
 * Adds the planning-specific information a fresh external AI chat needs without changing
 * the baseline/recovery renderer itself. This is deliberately a post-processing layer:
 * the existing brief remains the source of retrospective metrics, while this module adds
 * data currency, day-level trend, future commitments and a safer handoff contract.
 */
export function enhanceContextBriefForPlanning(
    baseBrief: string,
    input: ContextBriefPlanningHandoffInput,
): string {
    const requestedOutputMarker = '\n## Requested output';
    const requestedIndex = baseBrief.indexOf(requestedOutputMarker);
    const retrospective = requestedIndex >= 0 ? baseBrief.slice(0, requestedIndex) : baseBrief;

    const constraintMarker = '\n## 1. Constraints';
    const constraintIndex = retrospective.indexOf(constraintMarker);
    const withHandoff = constraintIndex >= 0
        ? `${retrospective.slice(0, constraintIndex)}\n\n${renderDataHandoff(input)}${retrospective.slice(constraintIndex)}`
        : `${renderDataHandoff(input)}\n\n${retrospective}`;

    const timeline = renderRecoveryTimeline(input);
    const trainingMarker = '\n## 3. Completed training';
    const trainingIndex = withHandoff.indexOf(trainingMarker);
    const withTimeline = timeline && trainingIndex >= 0
        ? `${withHandoff.slice(0, trainingIndex)}\n\n${timeline}${withHandoff.slice(trainingIndex)}`
        : timeline ? `${withHandoff}\n\n${timeline}` : withHandoff;

    return `${withTimeline.trimEnd()}\n\n${renderUpcoming(input)}\n\n${renderUseInstructions()}\n`;
}
