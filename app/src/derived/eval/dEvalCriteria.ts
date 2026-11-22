import type { ReliabilityEstimate } from '../../observations/models.ts';
import { addDaysToLocalDateString } from '../../utils/localDate.ts';

/** Minimum qualifying block length in consecutive Warsaw calendar dates (OD1). */
export const DEVAL_MIN_BLOCK_DAYS = 28;
/** Weight assigned to a `partial` planned session in C1 adherence (OD2). */
export const DEVAL_PARTIAL_WEIGHT = 0.5;
/** Follow-up window in elapsed hours after any flagged hard session (OD3). */
export const DEVAL_ADVERSE_WINDOW_HOURS = 72;
/** Minimum eligible planned sessions for a valid C1 block or comparable baseline (OD4). */
export const DEVAL_MIN_ELIGIBLE_SESSIONS = 8;
/** Minimum determinable ratio `(planned - unknown) / planned` for baseline comparability (OD4). */
export const DEVAL_MIN_BASELINE_DETERMINABLE_RATIO = 0.9;
/** Maximum unknown ratio `unknown / planned` before a block's C1 result becomes inconclusive. */
export const DEVAL_MAX_BLOCK_UNKNOWN_RATIO = 0.1;
/** Absolute adherence threshold used when no comparable OD4 baseline exists (OD5). */
export const DEVAL_ABSOLUTE_ADHERENCE_FLOOR = 0.75;
/** Allowed adherence tolerance below a comparable baseline (OD7: 5 percentage points). */
export const DEVAL_ADHERENCE_TOLERANCE = 0.05;
/** Exclusive upper bound on blind flag-input block dates before C3 is inconclusive (OD8). */
export const DEVAL_MAX_BLIND_FLAG_DATES_EXCLUSIVE = 3;

export type DEvalCriterionStatus = 'pass' | 'fail' | 'inconclusive';
export type DEvalC2Status = DEvalCriterionStatus | 'pending';
export type DEvalOverallVerdict = 'GO' | 'NO_GO' | 'EXTEND' | 'PENDING';

export interface DEvalGoalBoundProtocol {
    readonly protocolId: string;
    readonly retestIntervalDays: number;
    readonly metricIds: readonly string[];
    readonly reliability: ReliabilityEstimate | null;
}

/**
 * Frozen goal-bound §3 protocol battery confirmed under OD10 (2026-11-22).
 * Fixed-load velocity protocols are deliberately excluded as non-goal-bound.
 */
export const DEVAL_GOAL_BOUND_PROTOCOLS: readonly DEvalGoalBoundProtocol[] = [
    {
        protocolId: 'strength-back-squat-1rm',
        retestIntervalDays: 180,
        metricIds: ['strength_1rm_kg'],
        reliability: {
            source: 'literature_reference',
            statistic: 'cv_pct',
            value: 4.2,
            reference: 'Grgic J et al., Sports Med Open 2020;6(1):31 (PMID 32681399, GRGIC-2020-1RM-RELIABILITY)',
            contextNote: 'Median CV 4.2% (pooled n = 1,595); personal repeatability supersedes when collected.',
        },
    },
    {
        protocolId: 'strength-bench-press-1rm',
        retestIntervalDays: 180,
        metricIds: ['strength_1rm_kg'],
        reliability: {
            source: 'literature_reference',
            statistic: 'cv_pct',
            value: 4.2,
            reference: 'Grgic J et al., Sports Med Open 2020;6(1):31 (PMID 32681399, GRGIC-2020-1RM-RELIABILITY)',
            contextNote: 'Median CV 4.2% (pooled n = 1,595); personal repeatability supersedes when collected.',
        },
    },
    {
        protocolId: 'field-standing-broad-jump',
        retestIntervalDays: 90,
        metricIds: ['standing_broad_jump_distance_cm'],
        reliability: {
            source: 'literature_reference',
            statistic: 'cv_pct',
            value: 3.8,
            reference: 'Washif JA et al., Biol Sport 2024;41(3):231-241 (PMID 38952920 / PMC 11167475)',
            contextNote: 'Table 2 standing long jump best-distance between-session CV 3.8% (matches max_valid reducer).',
        },
    },
    {
        protocolId: 'field-wall-touch-cmj',
        retestIntervalDays: 90,
        metricIds: ['wall_touch_cmj_height_cm'],
        reliability: {
            source: 'literature_reference',
            statistic: 'cv_pct',
            value: 4.6,
            reference: 'Markovic G et al., J Strength Cond Res 2004;18(3):551-555 (PMID 15320660)',
            contextNote: 'Upper bound of 2.4-4.6% within-subject CV across Sargent/CMJ jump tests (n = 93).',
        },
    },
    {
        protocolId: 'field-seated-medball-chest-throw-3kg',
        retestIntervalDays: 90,
        metricIds: ['seated_medball_throw_distance_m'],
        reliability: {
            source: 'literature_reference',
            statistic: 'cv_pct',
            value: 5.1,
            reference: 'Riemann BL et al., Int J Sports Phys Ther 2023;18(5):1166-1175 (PMID 37795324 / PMC 10547086)',
            contextNote: 'Table 3 SMBCPT between-session CV 5.1% (males) / 4.5% (females).',
        },
    },
    {
        protocolId: 'cycling-6s-seated-sprint',
        retestIntervalDays: 90,
        metricIds: ['cycling_sprint_1s_peak_power_w', 'cycling_sprint_5s_mean_power_w'],
        reliability: {
            source: 'literature_reference',
            statistic: 'cv_pct',
            value: 3.0,
            reference: 'Wehbe G et al., J Strength Cond Res 2015;29(7):2050-2055 (PMID 25559911)',
            contextNote: '6-s cycle peak power between-session CV 3.0% (90% CI 2.5-3.8%), applied to 1s peak & 5s mean power.',
        },
    },
] as const;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_OFFSET_TIMESTAMP_PATTERN =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/;

/** Validates a real `YYYY-MM-DD` calendar date via a Warsaw/calendar round trip. */
export function isLocalCalendarDate(value: unknown): value is string {
    return typeof value === 'string' && LOCAL_DATE_PATTERN.test(value) && addDaysToLocalDateString(value, 0) === value;
}

/**
 * Parses an ISO-8601 timestamp string requiring an explicit `Z` or numeric UTC offset into epoch ms.
 * The calendar date prefix must be a real date: `Date.parse` silently rolls impossible dates such
 * as `2026-02-30` forward, so they are rejected before parsing.
 */
export function parseUtcTimestampMs(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = UTC_OFFSET_TIMESTAMP_PATTERN.exec(value);
    if (!match || !isLocalCalendarDate(match[1])) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}
