/**
 * Strength spacing policy (PR 2 / ADR-0034 cutover).
 *
 * This module intentionally does not invent an evidence-derived "48 hour" rule. It compares
 * athlete-local calendar dates and applies the minimum local-day gap supplied by the existing
 * planner/workout policy. Canonical performed-training facts are sufficient to establish that
 * strength happened even when exact workout identity or resistance-training dose is unknown.
 *
 * Broad/full/lower-body strength exposure can suppress another broad/full/lower-body candidate
 * until the configured local-day gap is satisfied. Upper-body-only candidates remain the
 * recovery-safe exception on a later date; same-day duplicate strength recommendations are
 * rejected separately.
 */
import type { SessionTemplate } from './models';
import { getDayDiff } from '../utils/localDate';

export interface StrengthSpacingStatus {
    isRestricted: boolean;
    reasonCode?: 'RECENT_STRENGTH_SPACING_VIOLATION' | 'SAME_DAY_STRENGTH_VIOLATION';
    rationale?: string;
    lastStrengthLocalDate?: string;
    daysSinceLastStrength?: number;
    mostRecentOccurrenceId?: string;
}

export type CandidateStrengthClass = 'full_body' | 'lower_body' | 'upper_body' | 'none';
export type PriorStrengthClass = 'full_body' | 'lower_body' | 'upper_body' | 'general_strength' | 'none';

export function classifyCandidateStrength(candidate: SessionTemplate): CandidateStrengthClass {
    if (candidate.category === 'Full-body Strength') return 'full_body';
    if (candidate.category === 'Lower-body Strength') return 'lower_body';
    if (candidate.category === 'Upper-body Strength') return 'upper_body';
    // An uncategorized Strength candidate is not proven upper-body-only, so fail closed as
    // broad/full-body for spacing. This avoids another arbitrary cost threshold in this policy.
    if (candidate.modality === 'Strength') return 'full_body';
    return 'none';
}

export interface StrengthExposureLike {
    localDate?: string;
    date?: string;
    modality?: string;
    type?: string;
    category?: string;
    performedOccurrenceId?: string;
}

export function classifyPriorStrength(exp: StrengthExposureLike): PriorStrengthClass {
    const mod = (exp.modality ?? exp.type ?? '').toLowerCase();
    const cat = (exp.category ?? '').toLowerCase();
    const isStrength = mod.includes('strength') || mod.includes('weight') || mod.includes('lift') || cat.includes('strength');
    if (!isStrength) return 'none';

    if (cat === 'upper-body strength') return 'upper_body';
    if (cat === 'lower-body strength') return 'lower_body';
    if (cat === 'full-body strength') return 'full_body';

    return 'general_strength';
}

export interface StrengthSpacingOptions {
    /**
     * Minimum athlete-local calendar-day gap for broad/full/lower strength candidates.
     * The caller must supply this from planner/workout policy; this module owns no default.
     */
    minimumGapDays: number;
}

function normalizedMinimumGapDays(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.trunc(value));
}

export function evaluateStrengthSpacingStatus(
    exposures: readonly StrengthExposureLike[],
    targetDate: string,
    candidate: SessionTemplate,
    options: StrengthSpacingOptions,
): StrengthSpacingStatus {
    const candidateClass = classifyCandidateStrength(candidate);
    if (candidateClass === 'none') {
        return { isRestricted: false };
    }

    const strengthExposures = exposures
        .map(exp => {
            const date = exp.localDate ?? exp.date ?? '';
            const priorClass = classifyPriorStrength(exp);
            return {
                date,
                priorClass,
                performedOccurrenceId: exp.performedOccurrenceId,
                diffDays: date ? getDayDiff(targetDate, date) : Number.POSITIVE_INFINITY,
            };
        })
        .filter(exp => exp.priorClass !== 'none' && exp.diffDays >= 0)
        .sort((a, b) => a.diffDays - b.diffDays); // closest athlete-local date first

    if (strengthExposures.length === 0) {
        return { isRestricted: false };
    }

    const mostRecent = strengthExposures[0];

    if (mostRecent.diffDays === 0) {
        return {
            isRestricted: true,
            reasonCode: 'SAME_DAY_STRENGTH_VIOLATION',
            rationale: `Strength is already recorded on the target local date (${mostRecent.date}); the automatic recommender will not schedule a second strength session on that date.`,
            lastStrengthLocalDate: mostRecent.date,
            daysSinceLastStrength: 0,
            mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
        };
    }

    // Upper-body-only is the explicit later-date exception. Likewise, a proven upper-body-only
    // prior session does not by itself suppress a fresh full/lower-body candidate.
    if (candidateClass === 'upper_body' || mostRecent.priorClass === 'upper_body') {
        return {
            isRestricted: false,
            daysSinceLastStrength: mostRecent.diffDays,
            lastStrengthLocalDate: mostRecent.date,
            mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
        };
    }

    const minimumGapDays = normalizedMinimumGapDays(options.minimumGapDays);
    if (mostRecent.diffDays < minimumGapDays) {
        return {
            isRestricted: true,
            reasonCode: 'RECENT_STRENGTH_SPACING_VIOLATION',
            rationale: `Strength exposure completed on ${mostRecent.date}; this candidate requires a minimum ${minimumGapDays}-day athlete-local date gap under the planner spacing policy.`,
            lastStrengthLocalDate: mostRecent.date,
            daysSinceLastStrength: mostRecent.diffDays,
            mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
        };
    }

    return {
        isRestricted: false,
        daysSinceLastStrength: mostRecent.diffDays,
        lastStrengthLocalDate: mostRecent.date,
        mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
    };
}
