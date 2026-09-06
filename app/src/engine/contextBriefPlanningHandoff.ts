import type {
    AuthoredPlanBlock,
    DailyRecommendation,
    DailyRecoverySnapshot,
    DailySubjectiveCheckin,
    ExternalPrescription,
    ExternalPrescriptionStep,
    FixedActivity,
    NormalizedGarminActivity,
    PlanningMode,
    TrainingSettings,
    UserGoal,
    UserPreferences,
} from './models';
import { EVENT_PRESETS, resolveDemandProfile } from './eventPresets';
import { addDaysToLocalDateString } from '../utils/localDate';
import { formatActivityType, round, signed, type BriefWindowPreset } from './contextBrief';

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
    prescription: ExternalPrescription;
}

export interface ContextBriefPlanningHandoffInput {
    asOfDate: string;
    snapshots: readonly DailyRecoverySnapshot[];
    checkins: readonly DailySubjectiveCheckin[];
    activities: readonly NormalizedGarminActivity[];
    recommendations: readonly DailyRecommendation[];
    trainingSettings: TrainingSettings | null;
    preferences: UserPreferences | null;
    /** Already-resolved by planningMode.ts (ADR-0017); this module renders it, it does not
     * derive it. Named distinctly from `TrainingIntentProfile.planningMode` so the
     * whole-app architecture guard (planningModeArchitecture.test.ts) can't mistake this
     * consumption for a re-derivation of the persisted field. */
    effectivePlanningMode: PlanningMode;
    externalFallback: boolean;
    /** True when `externalFallback` could not actually be confirmed today because today's
     * own external-plan read failed (occupancy or plan-state), so a null resolved session
     * reflects an unreadable day rather than a confirmed absence. */
    externalFallbackUncertain: boolean;
    eventStrategy: 'structured_plan' | 'demand_derived' | null;
    goals: readonly UserGoal[];
    upcomingFixedActivities: readonly FixedActivity[];
    upcomingPlanBlocks: readonly AuthoredPlanBlock[];
    upcomingExternalSessions: readonly UpcomingExternalPlanSession[];
    unavailableSources: readonly string[];
    preset?: BriefWindowPreset;
}

function latestByDate<T extends { date: string }>(items: readonly T[]): T | null {
    if (items.length === 0) return null;
    return [...items].sort((a, b) => b.date.localeCompare(a.date))[0];
}

function textNumber(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

function compactText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function yesNoUnknown(value: boolean | undefined): string {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    return 'unknown';
}

function renderDataHandoff(input: ContextBriefPlanningHandoffInput): string {
    const latestSnapshot = latestByDate(input.snapshots);
    const latestCheckin = latestByDate(input.checkins);
    const currentCheckin = input.checkins.find(item => item.date === input.asOfDate) ?? null;
    const todayActivities = input.activities.filter(item => item.date === input.asOfDate);
    const todayRecommendation = [...input.recommendations]
        .filter(item => item.date === input.asOfDate)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;

    const modeDetail = input.externalFallback
        ? (input.externalFallbackUncertain
            ? `${input.effectivePlanningMode} (external-plan fallback today: UNCONFIRMED — today's external plan schedule could not be read, so this may reflect an unreadable session rather than a confirmed absence)`
            : `${input.effectivePlanningMode} (external-plan fallback today: no imported session is placed on this date)`)
        : input.eventStrategy
            ? `${input.effectivePlanningMode} (${input.eventStrategy.replace('_', ' ')})`
            : input.effectivePlanningMode;

    const lines: string[] = [
        '## 0. Planning handoff & data currency',
        '',
        '**Use this as context for the conversation, not as a standalone command.** Answer the user\'s actual question that accompanies or follows this brief; do not generate a new plan merely because the brief was pasted.',
        `- Planning date: ${input.asOfDate} (Europe/Warsaw calendar date).`,
        `- Effective planning mode today: ${modeDetail}.`,
    ];

    if (input.trainingSettings) {
        const capabilities = input.trainingSettings.capabilities;
        lines.push(
            `- Sensor capabilities: power meter ${yesNoUnknown(capabilities?.powerMeter)} · `
            + `heart-rate monitor ${yesNoUnknown(capabilities?.heartRateMonitor)} · `
            + `cadence data ${yesNoUnknown(capabilities?.cadenceData)}.`,
        );
    }
    if (input.preferences) {
        const margin = input.preferences.extraRecoveryMargin === undefined
            ? 'not set'
            : input.preferences.extraRecoveryMargin ? 'on' : 'off';
        lines.push(
            `- Planning preferences: recovery style ${input.preferences.preferredRecoveryStyle} · `
            + `preferred time ${input.preferences.preferredTimeOfDay} · `
            + `conservative bias ${input.preferences.conservativeBias ? 'on' : 'off'} · `
            + `extra recovery margin ${margin}.`,
        );
    }

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
        'Calendar-day rows preserve direction and clustering that window averages can hide. Steps are the completed D-1 total carried by that morning\'s snapshot. “—” means not recorded.',
        '',
        '| Date | Sleep | HRV | RHR | Resp | BB | Stress | Steps D-1 | Ready | Fatigue | Sore | Training / flags |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ];

    for (let offset = 0; offset < RECOVERY_TIMELINE_DAYS; offset++) {
        const date = addDaysToLocalDateString(firstDate, offset);
        const snapshot = snapshots.get(date);
        const checkin = checkins.get(date);
        const activities = activitiesByDate.get(date) ?? [];
        const flags: string[] = [];
        if (activities.length > 0) {
            const hard = activities.filter(item => item.intensityTag === 'hard').length;
            const activityLabel = activities.length === 1 ? 'activity' : 'activities';
            flags.push(`${activities.length} ${activityLabel}${hard > 0 ? ` (${hard} hard)` : ''}`);
        }
        if (checkin?.alreadyTrainedToday && activities.length === 0) flags.push('reported trained');
        if (checkin?.painOrInjury) flags.push('pain/injury');
        if (checkin?.illnessSymptoms) flags.push('illness');
        if (checkin?.unusuallyLimitedTime) flags.push('limited time');
        if (checkin?.physicalWork?.performed) {
            const intensity = checkin.physicalWork.intensity ? `${checkin.physicalWork.intensity} ` : '';
            flags.push(`${intensity}physical work`);
        }

        lines.push(`| ${date} | ${textNumber(snapshot?.raw.sleepScore)} | ${textNumber(snapshot?.raw.hrvOvernightAvg)} | ${textNumber(snapshot?.raw.restingHr)} | ${textNumber(snapshot?.raw.respirationAvg)} | ${textNumber(snapshot?.raw.bodyBatteryWake)} | ${textNumber(snapshot?.raw.stress?.avg)} | ${textNumber(snapshot?.raw.totalSteps)} | ${textNumber(checkin?.readiness)} | ${textNumber(checkin?.fatigue)} | ${textNumber(checkin?.soreness)} | ${flags.join(', ') || '—'} |`);
    }

    return lines.join('\n');
}

function renderGoalSpecifics(goals: readonly UserGoal[]): string {
    const lines: string[] = [];
    for (const goal of goals.filter(item => item.status === 'active')) {
        const details: string[] = [];
        if (goal.targetOutcome) details.push(`success: ${compactText(goal.targetOutcome)}`);
        if (goal.targetMetric && goal.targetValue !== null && goal.targetValue !== undefined) {
            details.push(`target: ${goal.targetMetric} ${goal.targetValue}${goal.targetUnit ? ` ${goal.targetUnit}` : ''}`);
        }
        if (goal.eventCategory) {
            const preset = EVENT_PRESETS[goal.eventCategory].find(item => item.id === goal.eventPreset)
                ?? EVENT_PRESETS[goal.eventCategory][0];
            const demand = resolveDemandProfile(goal.eventCategory, goal.eventPreset);
            details.push(`event: ${preset.label} (${goal.eventCategory}, preset ${preset.id})`);
            details.push(
                `demand 0–1: endurance ${demand.aerobicEndurance} · threshold ${demand.thresholdPower} · `
                + `VO2 ${demand.vo2MaxPower} · repeated surges ${demand.repeatedSurges} · sprint ${demand.sprintPower} · `
                + `fatigue resistance ${demand.fatigueResistance} · neuromuscular ${demand.neuromuscular}`,
            );
        }
        if (goal.timing) {
            const timing = goal.timing.confirmedDate
                ? `confirmed ${goal.timing.confirmedDate}`
                : `window ${goal.timing.earliestDate}–${goal.timing.latestDate}, planning date ${goal.timing.planningDate}`;
            details.push(`timing: ${timing}`);
        }
        if (goal.description) details.push(`description: ${compactText(goal.description)}`);
        if (details.length > 0) lines.push(`- **${goal.title}** — ${details.join(' · ')}`);
    }
    if (lines.length === 0) return '';
    return ['### Goal specifics relevant to planning', '', ...lines].join('\n');
}

function renderPrescriptionStep(step: ExternalPrescriptionStep): string {
    const dose: string[] = [];
    if (step.sets !== undefined) dose.push(`${step.sets} set${step.sets === 1 ? '' : 's'}`);
    if (step.repeat !== undefined) dose.push(`${step.repeat} rep${step.repeat === 1 ? '' : 's'}`);
    if (step.durationMin !== undefined) dose.push(`${step.durationMin} min`);
    if (step.durationSec !== undefined) dose.push(`${step.durationSec} s`);
    if (step.target) dose.push(step.target);
    if (step.recoveryMin !== undefined) dose.push(`${step.recoveryMin} min recovery`);
    if (step.recoverySec !== undefined) dose.push(`${step.recoverySec}s recovery`);
    if (step.setRecoveryMin !== undefined) dose.push(`${step.setRecoveryMin} min set recovery`);
    if (step.setRecoverySec !== undefined) dose.push(`${step.setRecoverySec}s set recovery`);
    if (step.notes) dose.push(compactText(step.notes));
    return dose.length > 0 ? `${step.name}: ${dose.join(' · ')}` : step.name;
}

function renderImportedPrescriptions(sessions: readonly UpcomingExternalPlanSession[]): string[] {
    if (sessions.length === 0) return [];
    const lines: string[] = ['', 'Imported-session prescription detail:'];
    for (const session of sessions) {
        lines.push(`- **${session.date} — ${session.title}:** ${compactText(session.prescription.summary)}`);
        for (const step of session.prescription.steps ?? []) {
            lines.push(`  - ${renderPrescriptionStep(step)}`);
        }
    }
    return lines;
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
    const travel = input.upcomingPlanBlocks
        .filter(item => item.endDate >= input.asOfDate && item.startDate <= endDate)
        .map(item => {
            const visibleStart = item.startDate < input.asOfDate ? input.asOfDate : item.startDate;
            const visibleEnd = item.endDate > endDate ? endDate : item.endDate;
            return {
                date: visibleStart === visibleEnd ? visibleStart : `${visibleStart}→${visibleEnd}`,
                source: 'Plan block',
                title: 'Travel',
                dose: `volume ×${item.volumeScale} · intensity ×${item.intensityScale}`,
                authority: 'authored overlay',
                notes: item.startDate === visibleStart && item.endDate === visibleEnd
                    ? 'travel block'
                    : `full block ${item.startDate}→${item.endDate}`,
            };
        });
    const visibleExternalSessions = input.upcomingExternalSessions
        .filter(item => item.date >= input.asOfDate && item.date <= endDate);
    const external = visibleExternalSessions.map(item => ({
        date: item.date,
        source: `Imported plan: ${item.planTitle}`,
        title: item.title,
        dose: `${item.durationMin}${item.durationMax !== item.durationMin ? `–${item.durationMax}` : ''} min · ${item.intensity}`,
        authority: `${item.priority} · ${item.flexibility}${item.moved ? ' · moved' : ''}${item.isEvent ? ' · EVENT' : ''}`,
        notes: `revision ${item.revision}`,
    }));
    const rows = [...fixed, ...travel, ...external].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));

    const lines: string[] = [
        `## 7. Existing commitments / imported plan (${input.asOfDate} → ${endDate})`,
        '',
        'Preserve these when proposing days unless the user explicitly asks to move, replace or re-plan them. Authored travel blocks scale the surrounding plan rather than representing an extra workout.',
    ];

    const fallbackUncertainNote = input.externalFallbackUncertain
        ? ' Today\'s external plan schedule could not be read, so this is unconfirmed — treat it as unreadable, not as a confirmed absence.'
        : '';
    if (input.externalFallback && external.length === 0) {
        lines.push('', `> External-plan fallback is active today and no imported session is visible in this 7-day horizon. Do not silently invent a replacement block; the imported block may have ended, start later, or be unavailable.${fallbackUncertainNote}`);
    } else if (input.externalFallback && external.length > 0) {
        lines.push('', `> External-plan fallback is active today because no imported session is placed today; imported sessions later in this horizon remain authoritative on their placed dates, subject to readiness/safety gating.${fallbackUncertainNote}`);
    }

    if (rows.length === 0) {
        lines.push('', 'No fixed activity, travel block or imported-plan session is recorded in this 7-day horizon. This only describes app-held commitments; it does not prove the athlete has no calendar constraints outside the app.');
        return lines.join('\n');
    }

    lines.push('', '| Date / range | Source | Session / commitment | Dose / scaling | Priority / flexibility | Notes |', '|---|---|---|---|---|---|');
    for (const row of rows) {
        lines.push(`| ${row.date} | ${row.source} | ${row.title} | ${row.dose} | ${row.authority} | ${row.notes || '—'} |`);
    }
    lines.push(...renderImportedPrescriptions(visibleExternalSessions));
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
        '- Respect fixed activities, travel scaling blocks and imported-plan sessions above. If a change is warranted, explain which constraint or new evidence justifies it.',
        '- Honor recorded sensor capabilities. If a sensor is unknown or unavailable, do not make the session depend solely on that sensor; provide an executable RPE/HR/feel alternative as appropriate.',
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

function renderMorningCoachInstructions(): string[] {
    return [
        '## 6. Morning Coach Instructions',
        '',
        '- Treat this brief as state/context for your ongoing morning conversation. Answer the athlete\'s actual question first.',
        '- Acknowledge today\'s recovery metrics, check-in scores, and yesterday\'s debrief (flagging any notable strain deltas, soreness, or fatigue from manual labor).',
        '- Review today\'s recommended session against how the athlete feels, their available time, and any sore areas. Confirm or suggest practical fine-tuning (e.g. cadence emphasis, intensity ceiling).',
        '- Provide concrete execution guidance (power/HR zones, warmup emphasis for reported aches).',
        '- Keep tomorrow\'s planned session in mind so today appropriately sets up the week.',
        '- Do NOT output a multi-day schedule table or redesign the training block unless explicitly asked. Focus on coaching today.',
    ];
}

/**
 * Renders an ultra-dense, closed-loop morning briefing designed specifically for an
 * ongoing chat with an external AI coach. Omits static repetitive boilerplate
 * (equipment inventories, candidate median/MAD baselines, 1-click plan import markdown
 * schemas) and emphasizes:
 * 1. Today's status, subjective check-in, and acute flags
 * 2. Overnight wearable recovery and recent 7-day timeline
 * 3. Yesterday's closed loop (planned vs completed training + unlogged physical work + adherence)
 * 4. Today's engine recommendation with full rationale and prescription steps
 * 5. Short-term 48–72h horizon
 * 6. Morning coach conversational instructions
 */
export function buildMorningCoachBrief(input: ContextBriefPlanningHandoffInput): string {
    const targetDate = input.asOfDate;
    const yesterdayDate = addDaysToLocalDateString(targetDate, -1);

    const todaySnapshot = input.snapshots.find(s => s.date === targetDate);
    const latestSnapshot = latestByDate(input.snapshots);
    const activeSnapshot = todaySnapshot ?? latestSnapshot;

    const todayCheckin = input.checkins.find(c => c.date === targetDate);
    const yesterdayCheckin = input.checkins.find(c => c.date === yesterdayDate);
    const yesterdayActivities = input.activities.filter(a => a.date === yesterdayDate);
    const todayRecommendation = [...input.recommendations]
        .filter(r => r.date === targetDate)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    const yesterdayRecommendation = [...input.recommendations]
        .filter(r => r.date === yesterdayDate)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;

    const settings = input.trainingSettings;

    const lines: string[] = [
        '# Morning Training & Readiness Brief',
        '',
        `Date: ${targetDate} (Europe/Warsaw) · Mode: Daily Morning Coach Handoff`,
        'Context: This brief is shared daily in an ongoing chat. Focus on today\'s session, yesterday\'s debrief, and acute adaptations.',
    ];

    if (input.unavailableSources.length > 0) {
        lines.push('', `> **DATA INCOMPLETE:** could not reliably read: ${input.unavailableSources.join('; ')}. Absence from affected sections means "unknown", not "none".`);
    }

    // 1. Today's Status & Check-in
    lines.push('', '## 1. Today\'s Status & Check-in', '');
    if (todayCheckin) {
        lines.push(
            `- Subjective scores (1–10): Readiness ${textNumber(todayCheckin.readiness)} · `
            + `Fatigue ${textNumber(todayCheckin.fatigue)} · Soreness ${textNumber(todayCheckin.soreness)} · `
            + `Sleep quality ${textNumber(todayCheckin.sleepQuality)} · Motivation ${textNumber(todayCheckin.motivation)} · `
            + `Mental stress ${textNumber(todayCheckin.mentalStress)}`,
        );

        const timeAvail = todayCheckin.availability?.timeAvailableMin
            ?? (settings?.defaults.weekdayMaxMinutes ?? '—');
        const env = todayCheckin.availability?.indoorOnly
            ? 'indoor only'
            : (settings?.defaults.environment ?? 'either');
        const prefMod = todayCheckin.availability?.preferredModalityToday
            ? ` · preferred modality: ${todayCheckin.availability.preferredModalityToday}`
            : '';
        lines.push(`- Time & environment: ${timeAvail} min available · ${env}${prefMod}`);

        const flags: string[] = [];
        if (todayCheckin.painOrInjury) flags.push('pain/injury flagged');
        if (todayCheckin.illnessSymptoms) flags.push('illness symptoms flagged');
        if (todayCheckin.alreadyTrainedToday) flags.push('already trained today');
        if (todayCheckin.unusuallyLimitedTime) flags.push('unusually limited time');
        lines.push(`- Flags: ${flags.length > 0 ? flags.join(' · ') : 'no acute flags'}`);

        if (todayCheckin.tissueResponses) {
            const trEntries = Object.entries(todayCheckin.tissueResponses).filter(([, tr]) => tr != null);
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

        if (todayCheckin.physicalWork?.performed) {
            const pw = todayCheckin.physicalWork;
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
            const noteStr = pw.notes && pw.notes.trim().length > 0 ? ` — "${pw.notes.trim()}"` : '';
            lines.push(`- Unlogged physical work (yesterday D-1): ${parts.join(' · ')}${noteStr}`);
        } else {
            lines.push('- Unlogged physical work (yesterday D-1): none reported');
        }

        if (todayCheckin.notes && todayCheckin.notes.trim().length > 0) {
            lines.push(`- Check-in notes: "${todayCheckin.notes.trim()}"`);
        }
    } else {
        lines.push(`> Check-in caution: No subjective check-in submitted for ${targetDate} yet. Subjective readiness, soreness, and availability are unrecorded.`);
    }

    // 2. Overnight Recovery (Wearable)
    lines.push('', '## 2. Overnight Recovery (Wearable)', '');
    if (activeSnapshot) {
        const raw = activeSnapshot.raw;
        const der = activeSnapshot.derived;
        lines.push(`Most recent reading — ${activeSnapshot.date} (Garmin synced at ${activeSnapshot.source.garminSyncedAt}):`);
        lines.push(`- HRV (overnight avg): ${textNumber(raw.hrvOvernightAvg)} ms (7d avg ${round(der.hrv7dAvg)}, 28d avg ${round(der.hrv28dAvg)}) — ${signed(der.deltas.hrvVs7d)} vs 7d, ${signed(der.deltas.hrvVs28d)} vs 28d`);
        lines.push(`- Resting HR: ${textNumber(raw.restingHr)} bpm (7d avg ${round(der.restingHr7dAvg)}, 28d avg ${round(der.restingHr28dAvg)}) — ${signed(der.deltas.restingHrVs7d)} vs 7d, ${signed(der.deltas.restingHrVs28d)} vs 28d`);
        lines.push(`- Sleep score: ${textNumber(raw.sleepScore)} pts (7d avg ${round(der.sleepScore7dAvg)}, 28d avg ${round(der.sleepScore28dAvg)}) — ${signed(der.deltas.sleepScoreVs7d)} vs 7d, ${signed(der.deltas.sleepScoreVs28d)} vs 28d`);
        if (raw.sleepDurationSec != null) {
            const sleepHours = Math.floor(raw.sleepDurationSec / 3600);
            const sleepMins = Math.round((raw.sleepDurationSec % 3600) / 60);
            lines.push(`- Sleep duration: ${sleepHours}h ${sleepMins}m`);
        }
        if (raw.bodyBatteryWake != null) {
            lines.push(`- Body battery on waking: ${raw.bodyBatteryWake}`);
        }
        if (raw.stress?.avg != null) {
            lines.push(`- Device stress: avg ${raw.stress.avg}${raw.stress.max != null ? ` · max ${raw.stress.max}` : ''}`);
        }
        if (raw.totalSteps != null) {
            lines.push(`- Steps yesterday (D-1): ${raw.totalSteps.toLocaleString()} (7d avg ${der.steps7dAvg ? Math.round(der.steps7dAvg).toLocaleString() : '—'})`);
        }

        const timeline = renderRecoveryTimeline(input);
        if (timeline) {
            lines.push('', timeline);
        }
    } else {
        lines.push('> Wearable caution: No wearable data in this window.');
    }

    // 3. Yesterday's Closed-Loop Debrief
    lines.push('', `## 3. Yesterday's Closed-Loop Debrief (${yesterdayDate})`, '');
    if (yesterdayRecommendation) {
        lines.push(`- Prescribed: ${yesterdayRecommendation.templateTitle} (${yesterdayRecommendation.modality} · ${yesterdayRecommendation.mode})`);
    } else {
        lines.push('- Prescribed: No app recommendation recorded for yesterday.');
    }

    if (yesterdayActivities.length > 0) {
        for (const act of yesterdayActivities) {
            const typeLabel = formatActivityType(act.type);
            const loadStr = act.activityTrainingLoad != null ? ` · Load ${round(act.activityTrainingLoad, 1)}` : '';
            const teStr = act.trainingEffectAerobic != null ? ` · Aerobic TE ${round(act.trainingEffectAerobic, 1)}` : '';
            const hrStr = act.averageHr != null ? ` · Avg HR ${act.averageHr} bpm` : '';
            lines.push(`- Recorded training: ${typeLabel} · ${act.durationMin ?? '—'} min${loadStr}${teStr}${hrStr} · ${act.intensityTag}`);
            const pSum: string[] = [];
            if (act.normalizedPower != null) pSum.push(`normalized power ${Math.round(act.normalizedPower)} W`);
            if (act.intensityFactor != null) pSum.push(`IF ${round(act.intensityFactor, 2)}`);
            if (pSum.length > 0) lines.push(`  - Power summary: ${pSum.join(' · ')}`);
        }
    } else {
        lines.push('- Recorded training: No recorded sessions in this window.');
    }

    const pwSource = todayCheckin?.physicalWork?.performed
        ? todayCheckin.physicalWork
        : (yesterdayCheckin?.physicalWork?.performed ? yesterdayCheckin.physicalWork : null);
    if (pwSource) {
        const durationLabels: Record<string, string> = { short: '< 1 hr', medium: '1–3 hrs', extended: '3+ hrs' };
        const areaLabels: Record<string, string> = {
            grip_forearms: 'grip/forearms',
            upper_body: 'upper body',
            lower_back_spine: 'lower back/spine',
            legs_carrying: 'legs/carrying',
        };
        const parts: string[] = [];
        if (pwSource.duration) parts.push(durationLabels[pwSource.duration] ?? pwSource.duration);
        if (pwSource.intensity) parts.push(`${pwSource.intensity} effort`);
        if (pwSource.loadAreas && pwSource.loadAreas.length > 0) {
            parts.push(`strain: ${pwSource.loadAreas.map(a => areaLabels[a] ?? a).join(', ')}`);
        }
        const noteStr = pwSource.notes && pwSource.notes.trim().length > 0 ? ` — "${pwSource.notes.trim()}"` : '';
        lines.push(`- Manual physical work: ${parts.join(' · ')}${noteStr}`);
    } else {
        lines.push('- Manual physical work: none reported');
    }

    if (yesterdayRecommendation?.adherence) {
        const adh = yesterdayRecommendation.adherence;
        const adhNote = adh.notes && adh.notes.trim().length > 0 ? ` — "${adh.notes.trim()}"` : '';
        if (adh.followed === true) lines.push(`- Adherence: Followed as prescribed${adhNote}`);
        else if (adh.skipped === true) lines.push(`- Adherence: Skipped entirely${adhNote}`);
        else if (adh.followed === false) {
            const act = adh.actualModality ?? 'other';
            const dur = adh.actualDurationMin ? ` for ${adh.actualDurationMin} min` : '';
            lines.push(`- Adherence: Did ${act}${dur} instead${adhNote}`);
        } else {
            lines.push('- Adherence: Not answered yet.');
        }
    } else {
        lines.push('- Adherence: Not answered yet.');
    }

    if (activeSnapshot) {
        const der = activeSnapshot.derived;
        lines.push(`- Overnight reaction: HRV ${signed(der.deltas.hrvVs7d)} ms vs 7d avg · Resting HR ${signed(der.deltas.restingHrVs7d)} bpm vs 7d avg · Sleep score ${signed(der.deltas.sleepScoreVs7d)} pts vs 7d avg.`);
    }

    // 4. Today's App Recommendation & Engine Stance
    lines.push('', '## 4. Today\'s App Recommendation & Engine Stance', '');
    if (todayRecommendation) {
        lines.push(`- Mode: ${todayRecommendation.mode.toUpperCase()}`);
        lines.push(`- Recommended workout: ${todayRecommendation.templateTitle} (${todayRecommendation.modality} · ${todayRecommendation.category})`);
        lines.push(`- Engine rationale: "${todayRecommendation.rationale}"`);

        if (todayRecommendation.adjustment) {
            const adj = todayRecommendation.adjustment;
            const parts: string[] = [];
            if (adj.direction) parts.push(`${adj.direction} (tier ${adj.tier})`);
            if (adj.adjustedDoseLabel) parts.push(adj.adjustedDoseLabel);
            if (adj.athleteReason) parts.push(`reason: ${adj.athleteReason.replace(/_/g, ' ')}`);
            if (adj.rationale) parts.push(`"${adj.rationale}"`);
            lines.push(`- Session adjustment: ${parts.join(' · ') || 'Adjusted'}`);
        }

        if (todayRecommendation.prescription?.displayBlocks?.length) {
            lines.push('- Prescription steps:');
            for (const block of todayRecommendation.prescription.displayBlocks) {
                lines.push(`  - ${block.name}:`);
                for (const step of block.steps) {
                    const parts = [step.dose];
                    if (step.targets?.length) parts.push(`targets: ${step.targets.join(', ')}`);
                    if (step.cues?.length) parts.push(`cues: ${step.cues.join('; ')}`);
                    lines.push(`    - ${step.name}: ${parts.join(' · ')}`);
                }
            }
        }

        if (settings) {
            const guardrails = Object.entries(settings.guardrails)
                .filter(([, on]) => on)
                .map(([k]) => k.replace(/_/g, ' '));
            if (guardrails.length > 0) lines.push(`- Active safety limits: ${guardrails.join('; ')}`);
            const injuries = (settings.injuries ?? [])
                .filter(i => !i.reviewBy || i.reviewBy >= targetDate);
            if (injuries.length > 0) {
                const injLines = injuries.map(i => `${i.region} (${i.severity}${i.restrictedModalities?.length ? `, restricts ${i.restrictedModalities.join(', ')}` : ''})`);
                lines.push(`- Active injuries: ${injLines.join('; ')}`);
            }
        }
    } else {
        lines.push('No recommendation recorded for today yet (check-in may be pending or sync in progress).');
    }

    // 5. Short-Term Horizon (Next 48–72h)
    lines.push('', '## 5. Short-Term Horizon (Next 48–72h)', '');
    const lookaheadDates = [
        addDaysToLocalDateString(targetDate, 1),
        addDaysToLocalDateString(targetDate, 2),
        addDaysToLocalDateString(targetDate, 3),
    ];
    const fixed = input.upcomingFixedActivities.filter(a => !a.isCompleted && lookaheadDates.includes(a.date));
    const blocks = input.upcomingPlanBlocks.filter(b => b.startDate <= lookaheadDates[2] && b.endDate >= lookaheadDates[0]);
    const external = input.upcomingExternalSessions.filter(s => lookaheadDates.includes(s.date));

    const events: Array<{ date: string; summary: string }> = [];
    for (const f of fixed) {
        events.push({ date: f.date, summary: `Fixed activity: ${f.title} (${f.durationMin} min · ${f.fixed ? 'fixed' : 'movable'})` });
    }
    for (const b of blocks) {
        events.push({ date: `${b.startDate}→${b.endDate}`, summary: `Travel block: volume ×${b.volumeScale} · intensity ×${b.intensityScale}` });
    }
    for (const e of external) {
        events.push({ date: e.date, summary: `Imported session: ${e.title} (${e.modality} · ${e.durationMin} min · priority: ${e.priority.toUpperCase()})` });
    }
    if (events.length > 0) {
        events.sort((a, b) => a.date.localeCompare(b.date));
        for (const ev of events) {
            lines.push(`- ${ev.date}: ${ev.summary}`);
        }
    } else {
        lines.push('No fixed activities, travel blocks, or imported sessions in the next 72 hours.');
    }

    // 6. Morning Coach Instructions
    lines.push('', ...renderMorningCoachInstructions());

    return lines.join('\n');
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
    if (input.preset === 'daily') {
        return buildMorningCoachBrief(input);
    }

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

    const goalSpecifics = renderGoalSpecifics(input.goals);
    const goalDetail = goalSpecifics ? `\n\n${goalSpecifics}` : '';
    return `${withTimeline.trimEnd()}${goalDetail}\n\n${renderUpcoming(input)}\n\n${renderUseInstructions()}\n`;
}
