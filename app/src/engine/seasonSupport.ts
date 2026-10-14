/**
 * Issue #929 (ADR-0050, D3/D5): how supporting season events change load, and the compact
 * trace persisted with a recommendation.
 *
 * Pure. A supporting event (B, B+, secondary A) applies a bounded volume reduction while it
 * is inside its own resolved taper and a short bounded recovery after it is completed. The
 * result is a *minimum* with the primary phase's dose -- never stacked -- and it is ignored
 * whenever the primary target itself is tapering or recovering, so a nearer supporting event
 * can neither flatten the surrounding block nor derail the primary trajectory. C events
 * (`train_through`) apply neither.
 */

import type { ObjectiveKey } from './models';
import type { PeriodizationResult, PhaseWeights } from './periodization';
import {
    SEASON_ROADMAP_POLICY_VERSION,
    type SeasonConflict,
    type SeasonRoadmap,
    type SeasonRoadmapEntry,
} from './seasonRoadmap';

/** Largest volume reduction a supporting event's own taper can reach. The primary taper
 *  falls linearly to 0.6 (a 0.4 reduction); supporting events stay well short of that so a
 *  B/B+ race never becomes a multi-week pseudo-taper. Uncalibrated product choices. */
export const SUPPORTING_TAPER_MAX_VOLUME_REDUCTION = { benchmark_peak: 0.25, benchmark: 0.15 } as const;
/** Recovery after a completed or DNF supporting event: bounded days at a flat scale. */
export const SUPPORTING_RECOVERY_POLICY = {
    benchmark_peak: { days: 2, scale: 0.6 },
    benchmark: { days: 1, scale: 0.8 },
} as const;
/** A C race this many days ahead (or fewer) reserves one quality slot. Matches the D-3
 *  boundary after which the pre-event restrictions apply to A/B events. */
export const TRAIN_THROUGH_REPLACEMENT_LEAD_DAYS = 3;
/** Quality objective keys a train-through race can stand in for, in replacement order. */
export const TRAIN_THROUGH_QUALITY_KEYS: readonly ObjectiveKey[] = [
    'threshold_quality', 'vo2_max', 'surge_repeatability', 'race_specific_endurance',
];

type SupportingRole = keyof typeof SUPPORTING_TAPER_MAX_VOLUME_REDUCTION;

export interface SupportingEventScale {
    eventId: string;
    eventTitle: string;
    role: SupportingRole;
    kind: 'taper' | 'recovery';
    volumeScale: number;
    intensityScale: number;
}

function isSupportingRole(role: SeasonRoadmapEntry['role']): role is SupportingRole {
    return role === 'benchmark_peak' || role === 'benchmark';
}

/** The strongest supporting-event dose limit for the roadmap's evaluation date, or null. */
export function resolveSupportingEventScale(
    roadmap: SeasonRoadmap,
    primaryPhaseName: PhaseWeights['phaseName'],
): SupportingEventScale | null {
    if (primaryPhaseName === 'Peak/Taper' || primaryPhaseName === 'Post-Event Recovery') return null;
    const candidates: SupportingEventScale[] = [];
    for (const entry of roadmap.entries) {
        if (!isSupportingRole(entry.role) || entry.eventId === roadmap.primaryEventId) continue;
        if (entry.status === 'upcoming') {
            const taper = entry.taper;
            if (!taper || roadmap.asOfDate < taper.startDate || entry.daysToEvent < 0) continue;
            const progress = taper.durationDays > 0
                ? Math.min(1, Math.max(0, 1 - entry.daysToEvent / taper.durationDays))
                : 1;
            candidates.push({
                eventId: entry.eventId, eventTitle: entry.title, role: entry.role, kind: 'taper',
                volumeScale: 1 - SUPPORTING_TAPER_MAX_VOLUME_REDUCTION[entry.role] * progress,
                intensityScale: 1,
            });
        } else {
            const policy = SUPPORTING_RECOVERY_POLICY[entry.role];
            const daysSince = -entry.daysToEvent;
            if (daysSince < 1 || daysSince > policy.days) continue;
            candidates.push({
                eventId: entry.eventId, eventTitle: entry.title, role: entry.role, kind: 'recovery',
                volumeScale: policy.scale, intensityScale: policy.scale,
            });
        }
    }
    // Strongest limit wins; roadmap order breaks ties (sort is stable).
    return candidates.sort((a, b) => a.volumeScale - b.volumeScale || a.intensityScale - b.intensityScale)[0] ?? null;
}

/** Applies a supporting scale as a minimum -- the one place a phase is narrowed. */
export function applySupportingEventScale(phase: PhaseWeights, scale: SupportingEventScale | null): PhaseWeights {
    if (!scale) return phase;
    return {
        ...phase,
        volumeScale: Math.min(phase.volumeScale, scale.volumeScale),
        intensityScale: Math.min(phase.intensityScale, scale.intensityScale),
        supportingEventScale: scale,
    };
}

// --- Persisted trace (ADR-0050 D5) ---

const TRACE_MAX_ENTRIES = 32;
const TRACE_MAX_CONFLICTS = 64;
const TRACE_MAX_TEXT = 400;

export type SeasonTraceEntry = Pick<SeasonRoadmapEntry, 'eventId' | 'title' | 'date' | 'role' | 'daysToEvent' | 'status' | 'dateOwner'>;

export interface SeasonTrace {
    policyVersion: typeof SEASON_ROADMAP_POLICY_VERSION;
    primaryEventId: string | null;
    entries: SeasonTraceEntry[];
    conflicts: SeasonConflict[];
    supportingScale: SupportingEventScale | null;
}

const clip = (text: string): string => text.slice(0, TRACE_MAX_TEXT);

/** Compact season trace for the audit, or undefined when the roadmap adds nothing beyond a
 *  single event (the overwhelmingly common case), so those audits stay byte-identical. */
export function seasonTrace(periodization: Pick<PeriodizationResult, 'seasonRoadmap' | 'phase'>): SeasonTrace | undefined {
    const roadmap = periodization.seasonRoadmap;
    const scale = periodization.phase.supportingEventScale ?? null;
    if (!roadmap || (roadmap.entries.length < 2 && roadmap.conflicts.length === 0 && !scale)) return undefined;
    return {
        policyVersion: roadmap.policyVersion,
        primaryEventId: roadmap.primaryEventId,
        entries: roadmap.entries.slice(0, TRACE_MAX_ENTRIES).map(({ eventId, title, date, role, daysToEvent, status, dateOwner }) =>
            ({ eventId, title: clip(title), date, role, daysToEvent, status, dateOwner })),
        conflicts: roadmap.conflicts.slice(0, TRACE_MAX_CONFLICTS).map(conflict =>
            ({ ...conflict, eventIds: [...conflict.eventIds], message: clip(conflict.message) })),
        supportingScale: scale ? { ...scale, eventTitle: clip(scale.eventTitle) } : null,
    };
}

const hasExactKeys = (value: object, keys: readonly string[]): boolean =>
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isDate = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isText = (value: unknown): boolean => typeof value === 'string' && value.length <= TRACE_MAX_TEXT;
const ROLES = ['primary_peak', 'benchmark_peak', 'benchmark', 'train_through'];

export function isValidSeasonTrace(value: unknown): value is SeasonTrace {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const trace = value as SeasonTrace;
    if (!hasExactKeys(trace, ['policyVersion', 'primaryEventId', 'entries', 'conflicts', 'supportingScale'])) return false;
    if (typeof trace.policyVersion !== 'string' || trace.policyVersion.length > 80) return false;
    if (trace.primaryEventId !== null && !isText(trace.primaryEventId)) return false;
    if (!Array.isArray(trace.entries) || trace.entries.length > TRACE_MAX_ENTRIES
        || !Array.isArray(trace.conflicts) || trace.conflicts.length > TRACE_MAX_CONFLICTS) return false;
    const entriesValid = trace.entries.every(entry => entry && typeof entry === 'object'
        && hasExactKeys(entry, ['eventId', 'title', 'date', 'role', 'daysToEvent', 'status', 'dateOwner'])
        && isText(entry.eventId) && isText(entry.title) && isDate(entry.date) && ROLES.includes(entry.role)
        && Number.isInteger(entry.daysToEvent) && ['upcoming', 'completed', 'dnf'].includes(entry.status)
        && typeof entry.dateOwner === 'boolean');
    const conflictsValid = trace.conflicts.every(conflict => conflict && typeof conflict === 'object'
        && hasExactKeys(conflict, ['kind', 'severity', 'date', 'eventIds', 'message'])
        && ['same_day_authority', 'inside_peak_taper', 'insufficient_peak_recovery'].includes(conflict.kind)
        && ['blocking', 'advisory'].includes(conflict.severity) && isDate(conflict.date)
        && Array.isArray(conflict.eventIds) && conflict.eventIds.length <= 8 && conflict.eventIds.every(isText)
        && isText(conflict.message));
    const scale = trace.supportingScale;
    const scaleValid = scale === null || (typeof scale === 'object'
        && hasExactKeys(scale, ['eventId', 'eventTitle', 'role', 'kind', 'volumeScale', 'intensityScale'])
        && isText(scale.eventId) && isText(scale.eventTitle) && ['benchmark_peak', 'benchmark'].includes(scale.role)
        && ['taper', 'recovery'].includes(scale.kind)
        && [scale.volumeScale, scale.intensityScale].every(item => typeof item === 'number' && item > 0 && item <= 1));
    return entriesValid && conflictsValid && scaleValid;
}
