/**
 * Issue #929 (ADR-0050): the season roadmap.
 *
 * A pure, deterministic classification of every upcoming (and recently completed) event
 * relative to the season's primary target. It is planning *context*, never execution
 * authority: exactly one event owns any calendar date, and the roadmap never creates a
 * second planner or sums per-event requirements. It answers "what role does each event
 * play" and "which events cannot all receive the requested preparation", nothing else.
 *
 * No IO, no `Date.now()`; the evaluation date is always injected.
 */

import type { EventPriority, UserEvent } from './models';
import { resolveEventTaper, type ResolvedTaper } from './taperPolicy';
import { DEFAULT_POST_EVENT_RECOVERY_DAYS } from './eventHorizonPolicy';
import { getDayDiff } from '../utils/localDate';

export const SEASON_ROADMAP_POLICY_VERSION = '2026-10-season-roadmap-v1';

/** A 4-star goal is the B+ "major benchmark" tier: the existing 1-5 star control already
 *  maps 3-4 stars to priority B, so B+ is derived from it rather than a new stored type. */
export const SEASON_B_PLUS_STAR_PRIORITY = 4;
/** Minimum gap between one peak-role event and the next peak's taper start. Reuses the
 *  policy-owned post-event recovery length rather than introducing a second recovery number. */
export const SEASON_PEAK_RECOVERY_GAP_DAYS = DEFAULT_POST_EVENT_RECOVERY_DAYS;
/** How long after a supporting event its outcome remains eligible to revalidate later
 *  development (consumed by developmentAuthority; kept here so the roadmap owns the window). */
export const SEASON_OUTCOME_LOOKBACK_DAYS = 28;

export type SeasonEventRole =
    /** The single macrocycle target: owns Base/Build/Specificity/Taper and development authority. */
    | 'primary_peak'
    /** A secondary A event or a B+ (4-star B) event: a mini-peak with a proportionate taper. */
    | 'benchmark_peak'
    /** B event: a performance checkpoint with the standard limited taper. */
    | 'benchmark'
    /** C event: race craft / train-through; replaces a key session, never tapers. */
    | 'train_through';

export type SeasonConflictKind =
    /** Two events share a planning date; one owner is chosen deterministically. */
    | 'same_day_authority'
    /** An event falls inside another peak-role event's taper window. */
    | 'inside_peak_taper'
    /** A peak-role event ends too close to the next peak's taper start to recover. */
    | 'insufficient_peak_recovery';

export type SeasonConflictSeverity = 'blocking' | 'advisory';

export interface SeasonConflict {
    kind: SeasonConflictKind;
    severity: SeasonConflictSeverity;
    /** The date the conflict is about (the contested date, or the later event's date). */
    date: string;
    /** Involved events; for same_day_authority the first id is the deterministic owner. */
    eventIds: string[];
    message: string;
}

export interface SeasonRoadmapEntry {
    eventId: string;
    title: string;
    /** The planning date (`timing.planningDate ?? date`). */
    date: string;
    priority: EventPriority;
    role: SeasonEventRole;
    /** Days from the evaluation date; negative for a recently completed event. */
    daysToEvent: number;
    status: 'upcoming' | 'completed' | 'dnf';
    taper: ResolvedTaper | null;
    /** False for an event that lost an exact-date tie to another event. */
    dateOwner: boolean;
}

export interface SeasonRoadmap {
    policyVersion: typeof SEASON_ROADMAP_POLICY_VERSION;
    asOfDate: string;
    primaryEventId: string | null;
    /** Upcoming entries in authority order, then recently completed events by date. */
    entries: SeasonRoadmapEntry[];
    conflicts: SeasonConflict[];
}

const PRIORITY_RANK: Record<EventPriority, number> = { A: 1, B: 2, C: 3 };

export function planningDateOf(event: UserEvent): string {
    return event.timing?.planningDate ?? event.date;
}

/** The engine's single total order for event authority: priority, proximity, planning date,
 *  then id (a determinism backstop, not a ranking signal). `evaluatePeriodizationPhase`
 *  sorts with this same function, so the two cannot drift. */
export function compareEventAuthority(
    a: { event: UserEvent; daysToEvent: number; targetDate: string },
    b: { event: UserEvent; daysToEvent: number; targetDate: string },
): number {
    if (PRIORITY_RANK[a.event.priority] !== PRIORITY_RANK[b.event.priority]) {
        return PRIORITY_RANK[a.event.priority] - PRIORITY_RANK[b.event.priority];
    }
    if (a.daysToEvent !== b.daysToEvent) return a.daysToEvent - b.daysToEvent;
    if (a.targetDate !== b.targetDate) return a.targetDate < b.targetDate ? -1 : 1;
    return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
}

export function isBenchmarkPlus(event: Pick<UserEvent, 'priority' | 'starPriority'>): boolean {
    return event.priority === 'B' && event.starPriority !== undefined && event.starPriority >= SEASON_B_PLUS_STAR_PRIORITY;
}

function roleOf(event: UserEvent, isPrimary: boolean): SeasonEventRole {
    if (isPrimary) return 'primary_peak';
    if (event.priority === 'A' || isBenchmarkPlus(event)) return 'benchmark_peak';
    if (event.priority === 'B') return 'benchmark';
    return 'train_through';
}

function isPeakRole(role: SeasonEventRole): boolean {
    return role === 'primary_peak' || role === 'benchmark_peak';
}

function sameDayConflicts(upcoming: readonly SeasonRoadmapEntry[]): SeasonConflict[] {
    const byDate = new Map<string, SeasonRoadmapEntry[]>();
    for (const entry of upcoming) byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
    return [...byDate.entries()]
        .filter(([, entries]) => entries.length > 1)
        .map(([date, entries]) => ({
            kind: 'same_day_authority' as const,
            // The owner keeps the date. It is only advisory when every yielding event is a
            // train-through race; a yielding benchmark or peak loses a real objective.
            severity: entries.slice(1).every(entry => entry.role === 'train_through') ? 'advisory' as const : 'blocking' as const,
            date,
            eventIds: entries.map(entry => entry.eventId),
            message: `${entries.map(entry => entry.title).join(' and ')} share ${date}; ${entries[0].title} owns that date and the others yield.`,
        }));
}

function peakTaperConflicts(upcoming: readonly SeasonRoadmapEntry[]): SeasonConflict[] {
    const conflicts: SeasonConflict[] = [];
    for (const peak of upcoming.filter(entry => isPeakRole(entry.role) && entry.taper)) {
        for (const other of upcoming) {
            if (other.eventId === peak.eventId || other.date === peak.date) continue;
            if (other.date >= peak.taper!.startDate && other.date < peak.date) {
                conflicts.push({
                    kind: 'inside_peak_taper',
                    severity: other.role === 'train_through' ? 'advisory' : 'blocking',
                    date: other.date,
                    eventIds: [peak.eventId, other.eventId],
                    message: `${other.title} (${other.date}) falls inside ${peak.title}'s taper (${peak.taper!.startDate} to ${peak.date}); both cannot receive the requested preparation.`,
                });
            }
        }
    }
    return conflicts;
}

function peakRecoveryConflicts(upcoming: readonly SeasonRoadmapEntry[]): SeasonConflict[] {
    const peaks = upcoming.filter(entry => isPeakRole(entry.role)).sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId));
    const conflicts: SeasonConflict[] = [];
    for (let index = 1; index < peaks.length; index++) {
        const earlier = peaks[index - 1];
        const later = peaks[index];
        if (earlier.date === later.date) continue;
        // A peak with no resolved taper (e.g. an unauthored general target) is prepared up to its date.
        const boundary = later.taper?.startDate ?? later.date;
        const gap = getDayDiff(boundary, earlier.date);
        // A negative or zero gap is an inside_peak_taper conflict already; do not double-report.
        if (gap > 0 && gap < SEASON_PEAK_RECOVERY_GAP_DAYS) {
            conflicts.push({
                kind: 'insufficient_peak_recovery',
                severity: 'blocking',
                date: later.date,
                eventIds: [earlier.eventId, later.eventId],
                message: `Only ${gap} day(s) separate ${earlier.title} (${earlier.date}) from ${later.title}'s ${later.taper ? `taper start (${boundary})` : `date (${boundary})`}; ${SEASON_PEAK_RECOVERY_GAP_DAYS} are needed to recover between peaks.`,
            });
        }
    }
    return conflicts;
}

/**
 * Classifies the season's events relative to its primary target.
 *
 * Eligibility mirrors `evaluatePeriodizationPhase`: scheduled events on or after `asOfDate`
 * are upcoming; completed/DNF events within `SEASON_OUTCOME_LOOKBACK_DAYS` are retained so
 * their outcome can revalidate later development. Cancelled, DNS, rescheduled and stale
 * (past, never completed) events are excluded. The primary target is the first upcoming event
 * in the engine's authority order, so it equals `PeriodizationResult.focusEvent` whenever the
 * focus is an upcoming scheduled event. During the 3-day post-event window a just-completed
 * event is the focus (Post-Event Recovery) while the roadmap's primary is the next upcoming one.
 */
export function resolveSeasonRoadmap(events: readonly UserEvent[], asOfDate: string): SeasonRoadmap {
    const dated = events.map(event => {
        const targetDate = planningDateOf(event);
        return { event, targetDate, daysToEvent: getDayDiff(targetDate, asOfDate) };
    });

    const upcomingSorted = dated
        .filter(({ event, daysToEvent }) => event.lifecycle === 'scheduled' && daysToEvent >= 0)
        .sort(compareEventAuthority);
    const primaryId = upcomingSorted[0]?.event.id ?? null;

    const ownerByDate = new Map<string, string>();
    for (const item of upcomingSorted) if (!ownerByDate.has(item.targetDate)) ownerByDate.set(item.targetDate, item.event.id);

    const toEntry = (item: typeof dated[number], status: SeasonRoadmapEntry['status']): SeasonRoadmapEntry => ({
        eventId: item.event.id,
        title: item.event.title,
        date: item.targetDate,
        priority: item.event.priority,
        role: roleOf(item.event, item.event.id === primaryId),
        daysToEvent: item.daysToEvent,
        status,
        taper: resolveEventTaper(item.event),
        dateOwner: status !== 'upcoming' || ownerByDate.get(item.targetDate) === item.event.id,
    });

    const upcoming = upcomingSorted.map(item => toEntry(item, 'upcoming'));
    const completed = dated
        .filter(({ event, daysToEvent }) => (event.lifecycle === 'completed' || event.lifecycle === 'DNF')
            && daysToEvent < 0 && daysToEvent >= -SEASON_OUTCOME_LOOKBACK_DAYS)
        .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.event.id.localeCompare(b.event.id))
        .map(item => toEntry(item, item.event.lifecycle === 'DNF' ? 'dnf' : 'completed'));

    const conflicts = [
        ...sameDayConflicts(upcoming),
        ...peakTaperConflicts(upcoming),
        ...peakRecoveryConflicts(upcoming),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.eventIds.join().localeCompare(b.eventIds.join()));

    return {
        policyVersion: SEASON_ROADMAP_POLICY_VERSION,
        asOfDate,
        primaryEventId: primaryId,
        entries: [...upcoming, ...completed],
        conflicts,
    };
}

/** Athlete-facing, deterministic lines naming each event's role. Used by the Context Brief. */
export function describeSeasonRoadmap(roadmap: {
    entries: ReadonlyArray<Pick<SeasonRoadmapEntry, 'title' | 'date' | 'role' | 'daysToEvent' | 'status' | 'dateOwner'>>;
    conflicts: readonly SeasonConflict[];
}): string[] {
    const roleText: Record<SeasonEventRole, string> = {
        primary_peak: 'primary season target (owns the macrocycle, taper and development)',
        benchmark_peak: 'major benchmark / mini-peak (proportionate taper, then back to the current block)',
        benchmark: 'benchmark (limited taper)',
        train_through: 'race craft / train-through (replaces a key session; no taper)',
    };
    return [
        ...roadmap.entries.map(entry => {
            const when = entry.status === 'upcoming'
                ? `in ${entry.daysToEvent} day(s)`
                : `${entry.status === 'dnf' ? 'DNF' : 'completed'} ${-entry.daysToEvent} day(s) ago`;
            return `- ${entry.title} (${entry.date}, ${when}): ${roleText[entry.role]}${entry.dateOwner ? '' : '; yields this date to another event'}.`;
        }),
        ...roadmap.conflicts.map(conflict => `- Season conflict (${conflict.severity}): ${conflict.message}`),
    ];
}
