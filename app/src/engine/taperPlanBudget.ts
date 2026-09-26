import { addDaysToLocalDateString, getDayDiff } from '../utils/localDate';
import { resolveDemandProfile } from './eventPresets';
import type { SessionTemplate, UserEvent } from './models';
import { resolveEventTaper } from './taperPolicy';
import type { RecentHistoryEntry } from './optimizer';

/** Product-policy limits for an A-priority Olympic triathlon. The volume limit is the
 * conservative edge of the registered 41–60% pre-event reduction range. Frequency is
 * reduced modestly while retaining a touch of each race discipline when feasible. */
export const OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO = 0.59;
export const OLYMPIC_TRIATHLON_TAPER_MAX_FREQUENCY_RATIO = 0.85;
export const OLYMPIC_TRIATHLON_TAPER_REFERENCE_DAYS = 14;
export const OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SESSIONS = 3;
export const OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SPAN_DAYS = 7;
export const OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS = 7;
export const OLYMPIC_TRIATHLON_TAPER_PACING_BLOCKS = 2;
export const OLYMPIC_TRIATHLON_TAPER_FIRST_BLOCK_VOLUME_SHARE = 0.5;
export const OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE = 4;
export const OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_END_DAYS_TO_RACE = 2;
export const OLYMPIC_TRIATHLON_TAPER_LATE_CYCLING_MINUTES = 30;
export const OLYMPIC_TRIATHLON_TAPER_LATE_RUNNING_MINUTES = 25;
export const OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_MAX_MINUTES = 45;
export const OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_BENEFIT = 1.0;
export const OLYMPIC_TRIATHLON_TAPER_LATE_RUN_BENEFIT = 0.6;
export const OLYMPIC_TRIATHLON_TAPER_OPENER_BENEFIT = 1.0;

const RACE_MODALITIES: readonly SessionTemplate['modality'][] = ['Swimming', 'Cycling', 'Running'];
const olympicDemand = resolveDemandProfile('triathlon', 'olympic');

type HistoryEntry = RecentHistoryEntry | {
    date: string;
    templateId?: string;
    category?: SessionTemplate['category'];
    modality: SessionTemplate['modality'];
    systemicCost: number;
};
type DatedHistoryEntry = HistoryEntry & { date: string };

export interface OlympicTriathlonTaperBudget {
    asOfDate: string;
    startDate: string;
    raceDate: string;
    maxTrainingSessions: number;
    maxTrainingMinutes: number;
    usedTrainingSessions: number;
    usedTrainingMinutes: number;
    usedBlockSessions: number;
    usedBlockMinutes: number;
    usedModalities: ReadonlySet<string>;
    usedLateModalities: ReadonlySet<string>;
    usedRaceWeekModalities: ReadonlySet<string>;
    referenceTrainingSessions: number;
    referenceTrainingMinutes: number;
}

/** The persisted goal preset is resolved into its demand vector before it reaches the
 * optimizer. Exact preset identity is the narrowest available distance discriminator. */
export function isPriorityAOlympicTriathlon(event: UserEvent | null | undefined): boolean {
    if (event?.priority !== 'A' || event.category !== 'triathlon') return false;
    return (Object.keys(olympicDemand) as (keyof typeof olympicDemand)[])
        .every(axis => event.demandProfile[axis] === olympicDemand[axis]);
}

function isTraining(entry: HistoryEntry): boolean {
    return entry.category !== 'Rest' && entry.category !== 'Mobility/Recovery'
        && entry.modality !== 'None' && entry.modality !== 'Mobility';
}

function prescribedMinutes(entry: HistoryEntry): number | null {
    const recent = entry as RecentHistoryEntry;
    const minutes = recent.source === 'projected'
        ? recent.durationMax ?? recent.durationMin
        : recent.durationMin;
    return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/** Returns null when there is insufficient observed pre-taper dose to justify a numeric
 * cap. Projected history inside the taper is counted with its upper prescription bound;
 * completed history uses delivered minutes. No catalog-duration guess is substituted. */
export function resolveOlympicTriathlonTaperBudget(
    event: UserEvent | null | undefined,
    targetDate: string,
    history: readonly HistoryEntry[],
    widerCompletedHistory?: readonly HistoryEntry[],
): OlympicTriathlonTaperBudget | null {
    if (!isPriorityAOlympicTriathlon(event)) return null;
    const taper = resolveEventTaper(event!);
    if (!taper || taper.durationDays !== OLYMPIC_TRIATHLON_TAPER_REFERENCE_DAYS
        || targetDate < taper.startDate || targetDate > taper.endDate) return null;

    const referenceStart = addDaysToLocalDateString(taper.startDate, -OLYMPIC_TRIATHLON_TAPER_REFERENCE_DAYS);
    // Operational history is intentionally short. The separate wider channel contains
    // completed exposures only; current forecast assignments remain in `history`.
    const budgetHistory = widerCompletedHistory ? [...widerCompletedHistory] : [...history];
    if (widerCompletedHistory) {
        const seenOccurrences = new Set(budgetHistory.map(entry => (entry as RecentHistoryEntry).occurrenceKey).filter(Boolean));
        for (const entry of history) {
            if ((entry as RecentHistoryEntry).source !== 'projected') continue;
            const occurrenceKey = (entry as RecentHistoryEntry).occurrenceKey;
            if (occurrenceKey && seenOccurrences.has(occurrenceKey)) continue;
            budgetHistory.push(entry);
            if (occurrenceKey) seenOccurrences.add(occurrenceKey);
        }
    }
    const datedHistory = budgetHistory.filter((entry): entry is DatedHistoryEntry => typeof entry.date === 'string');
    const reference = datedHistory.filter(entry => entry.date >= referenceStart && entry.date < taper.startDate
        && RACE_MODALITIES.some(modality => modality === entry.modality) && isTraining(entry));
    const measuredReference = reference.filter(entry => prescribedMinutes(entry) !== null);
    // A thin or unmeasured feed cannot establish this athlete's pre-taper load. In that
    // case the ordinary taper/readiness rules continue to decide each candidate.
    const referenceDates = measuredReference.map(entry => entry.date).sort();
    if (measuredReference.length < OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SESSIONS
        || measuredReference.length !== reference.length
        || getDayDiff(referenceDates[referenceDates.length - 1], referenceDates[0]) < OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SPAN_DAYS) return null;

    const referenceTrainingMinutes = measuredReference.reduce((sum, entry) => sum + prescribedMinutes(entry)!, 0);
    const maxTrainingSessions = Math.max(OLYMPIC_TRIATHLON_TAPER_MIN_REFERENCE_SESSIONS,
        Math.floor(measuredReference.length * OLYMPIC_TRIATHLON_TAPER_MAX_FREQUENCY_RATIO));
    const maxTrainingMinutes = referenceTrainingMinutes * OLYMPIC_TRIATHLON_TAPER_MAX_VOLUME_RATIO;
    const used = datedHistory.filter(entry => entry.date >= taper.startDate && entry.date < targetDate && isTraining(entry));
    if (used.some(entry => prescribedMinutes(entry) === null)) return null;
    const blockStart = getDayDiff(targetDate, taper.startDate) < OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS
        ? taper.startDate : addDaysToLocalDateString(taper.startDate, OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS);
    const usedInBlock = used.filter(entry => entry.date >= blockStart);
    const raceDate = event!.timing?.planningDate ?? event!.date;
    const lateWindowStart = addDaysToLocalDateString(raceDate, -OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE);
    const usedLate = used.filter(entry => entry.date >= lateWindowStart);
    const raceWeekStart = addDaysToLocalDateString(raceDate, -OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS);
    const usedRaceWeek = used.filter(entry => entry.date >= raceWeekStart);
    return {
        asOfDate: targetDate,
        startDate: taper.startDate,
        raceDate,
        maxTrainingSessions,
        maxTrainingMinutes,
        usedTrainingSessions: used.length,
        usedTrainingMinutes: used.reduce((sum, entry) => sum + (prescribedMinutes(entry) ?? 0), 0),
        usedBlockSessions: usedInBlock.length,
        usedBlockMinutes: usedInBlock.reduce((sum, entry) => sum + (prescribedMinutes(entry) ?? 0), 0),
        usedModalities: new Set(used.map(entry => entry.modality).filter((modality): modality is string => modality !== undefined)),
        usedLateModalities: new Set(usedLate.map(entry => entry.modality).filter((modality): modality is string => modality !== undefined)),
        usedRaceWeekModalities: new Set(usedRaceWeek.map(entry => entry.modality).filter((modality): modality is string => modality !== undefined)),
        referenceTrainingSessions: measuredReference.length,
        referenceTrainingMinutes,
    };
}

/** Soft ranking only: unavailable or unsafe candidates are still excluded by the
 * ordinary gates. These nudges preserve a race-week swim and a short cycling opener
 * without assigning either to a fixed calendar date. */
export function olympicTriathlonTaperBenefitBoost(
    template: SessionTemplate,
    budget: OlympicTriathlonTaperBudget | null,
): number {
    if (!budget) return 0;
    const daysToRace = getDayDiff(budget.raceDate, budget.asOfDate);
    if (daysToRace >= OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE + 1
        && daysToRace <= OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS
        && template.modality === 'Swimming'
        && !budget.usedRaceWeekModalities.has('Swimming')) return OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_BENEFIT;
    if (daysToRace === OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE
        && template.modality === 'Running'
        && !budget.usedLateModalities.has('Running')) return OLYMPIC_TRIATHLON_TAPER_LATE_RUN_BENEFIT;
    if (daysToRace >= OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_END_DAYS_TO_RACE
        && daysToRace <= OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE - 1
        && template.id === 'end_pre_race_openers_01'
        && !budget.usedLateModalities.has('Cycling')) return OLYMPIC_TRIATHLON_TAPER_OPENER_BENEFIT;
    return 0;
}

const lateTouchMinutes = (modality: string): number => modality === 'Cycling'
    ? OLYMPIC_TRIATHLON_TAPER_LATE_CYCLING_MINUTES
    : OLYMPIC_TRIATHLON_TAPER_LATE_RUNNING_MINUTES;

/** Maximum upper prescription bound for this candidate after reserving the available
 * late bike/run touches. The reserve is spent only in the final D-4..D-2 window, so
 * earlier work cannot exhaust the athlete's plan before race-specific maintenance. */
export function olympicTriathlonTaperCandidateCap(
    template: SessionTemplate,
    budget: OlympicTriathlonTaperBudget | null,
): number | null {
    if (!budget || template.category === 'Rest' || template.category === 'Mobility/Recovery') return null;
    const daysToRace = getDayDiff(budget.raceDate, budget.asOfDate);
    const inFirstBlock = getDayDiff(budget.asOfDate, budget.startDate) < OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS;
    const blockSessionCap = Math.ceil(budget.maxTrainingSessions / OLYMPIC_TRIATHLON_TAPER_PACING_BLOCKS);
    if (budget.usedTrainingSessions >= budget.maxTrainingSessions
        || (inFirstBlock && budget.usedBlockSessions >= blockSessionCap)) return 0;

    let cap = budget.maxTrainingMinutes - budget.usedTrainingMinutes;
    if (inFirstBlock) {
        cap = Math.min(cap, budget.maxTrainingMinutes * OLYMPIC_TRIATHLON_TAPER_FIRST_BLOCK_VOLUME_SHARE - budget.usedBlockMinutes);
    }
    const missingLate = (['Cycling', 'Running'] as const).filter(modality => !budget.usedLateModalities.has(modality));
    const remainingSlots = budget.maxTrainingSessions - budget.usedTrainingSessions;
    if (daysToRace > OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE
        && daysToRace <= OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS) {
        if (remainingSlots <= missingLate.length) return 0;
        cap -= missingLate.reduce((sum, modality) => sum + lateTouchMinutes(modality), 0);
    } else if (daysToRace >= OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_END_DAYS_TO_RACE
        && daysToRace <= OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE) {
        if (missingLate.length >= remainingSlots && !missingLate.includes(template.modality as 'Cycling' | 'Running')) return 0;
        cap -= missingLate.filter(modality => modality !== template.modality)
            .reduce((sum, modality) => sum + lateTouchMinutes(modality), 0);
    }
    if (daysToRace <= OLYMPIC_TRIATHLON_TAPER_PACING_BLOCK_DAYS && template.modality === 'Swimming') {
        cap = Math.min(cap, OLYMPIC_TRIATHLON_TAPER_RACE_WEEK_SWIM_MAX_MINUTES);
    }
    if (daysToRace >= OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_END_DAYS_TO_RACE
        && daysToRace <= OLYMPIC_TRIATHLON_TAPER_LATE_TOUCH_START_DAYS_TO_RACE) {
        if (template.modality === 'Cycling') cap = Math.min(cap, OLYMPIC_TRIATHLON_TAPER_LATE_CYCLING_MINUTES);
        if (template.modality === 'Running') cap = Math.min(cap, OLYMPIC_TRIATHLON_TAPER_LATE_RUNNING_MINUTES);
    }
    return Math.max(0, Math.floor(cap + 1e-9));
}

/** A candidate cannot spend more of the athlete's taper than their own pre-taper load
 * permits. The seven-day pacing limit leaves room for race-discipline touches later in
 * the taper instead of allowing the first week to consume the entire allowance. */
export function olympicTriathlonTaperExclusion(
    template: SessionTemplate,
    budget: OlympicTriathlonTaperBudget | null,
    effectiveDurationMax: number,
): string | null {
    if (!budget || template.category === 'Rest' || template.category === 'Mobility/Recovery') return null;
    const candidateCap = olympicTriathlonTaperCandidateCap(template, budget);
    if (candidateCap !== null && effectiveDurationMax > candidateCap) {
        return 'OLYMPIC_TRIATHLON_TAPER_PLAN_BUDGET';
    }

    const missingModalities = RACE_MODALITIES.filter(modality => !budget.usedModalities.has(modality));
    const remainingSlots = budget.maxTrainingSessions - budget.usedTrainingSessions;
    if (missingModalities.length >= remainingSlots && !missingModalities.includes(template.modality)) {
        return 'OLYMPIC_TRIATHLON_TAPER_MODALITY_RESERVATION';
    }
    return null;
}
