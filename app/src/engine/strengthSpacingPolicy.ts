/**
 * Strength spacing policy (PR 2 / ADR-0034 cutover).
 *
 * Implements the domain rule that a completed strength exposure (app or provider/Garmin)
 * requires recovery spacing before another full-body or heavy strength session can be scheduled.
 *
 * Consecutive full-body resistance training days violate physiological recovery and adaptation.
 * Upper-body / trunk / mobility variants remain admissible if recovery-safe.
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
    if (candidate.modality === 'Strength') {
        const lowerCost = candidate.costProfile?.lowerBody ?? 0;
        if (lowerCost >= 0.4) return 'full_body';
        return 'upper_body';
    }
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
    /** Explicit policy override permitting consecutive strength (e.g. specialized microcycles) */
    allowConsecutiveFullBody?: boolean;
}

export function evaluateStrengthSpacingStatus(
    exposures: readonly StrengthExposureLike[],
    targetDate: string,
    candidate: SessionTemplate,
    options: StrengthSpacingOptions = {},
): StrengthSpacingStatus {
    const candidateClass = classifyCandidateStrength(candidate);
    if (candidateClass === 'none') {
        return { isRestricted: false };
    }

    // Find all past or same-day strength exposures
    const strengthExposures = exposures
        .map(exp => {
            const date = exp.localDate ?? exp.date ?? '';
            const priorClass = classifyPriorStrength(exp);
            return {
                date,
                priorClass,
                exposure: exp,
                performedOccurrenceId: exp.performedOccurrenceId,
                diffDays: date ? getDayDiff(targetDate, date) : Number.POSITIVE_INFINITY,
            };
        })
        .filter(exp => exp.priorClass !== 'none' && exp.diffDays >= 0)
        .sort((a, b) => a.diffDays - b.diffDays); // closest in time first

    if (strengthExposures.length === 0) {
        return { isRestricted: false };
    }

    const mostRecent = strengthExposures[0];

    // Same day (diffDays === 0)
    if (mostRecent.diffDays === 0) {
        return {
            isRestricted: true,
            reasonCode: 'SAME_DAY_STRENGTH_VIOLATION',
            rationale: `Another strength session is already recorded for today (${mostRecent.date}). Multiple strength sessions on the same calendar date are restricted.`,
            lastStrengthLocalDate: mostRecent.date,
            daysSinceLastStrength: 0,
            mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
        };
    }

    // Previous day (diffDays === 1)
    if (mostRecent.diffDays === 1) {
        if (options.allowConsecutiveFullBody) {
            return {
                isRestricted: false,
                daysSinceLastStrength: 1,
                lastStrengthLocalDate: mostRecent.date,
                mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
            };
        }

        const priorClass = mostRecent.priorClass;

        // If prior was full-body, lower-body, or general strength:
        // Consecutive full-body or lower-body loading is restricted (requires 48h spacing)
        if (priorClass === 'full_body' || priorClass === 'lower_body' || priorClass === 'general_strength') {
            if (candidateClass === 'full_body' || candidateClass === 'lower_body') {
                return {
                    isRestricted: true,
                    reasonCode: 'RECENT_STRENGTH_SPACING_VIOLATION',
                    rationale: `Strength exposure completed on ${mostRecent.date}. Consecutive-day full-body or lower-body strength training is restricted for neuromuscular and tissue recovery (requires 48h spacing).`,
                    lastStrengthLocalDate: mostRecent.date,
                    daysSinceLastStrength: 1,
                    mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
                };
            }
        }

        // If prior was strictly upper-body, consecutive upper-body loading is restricted
        if (priorClass === 'upper_body' && candidateClass === 'upper_body') {
            return {
                isRestricted: true,
                reasonCode: 'RECENT_STRENGTH_SPACING_VIOLATION',
                rationale: `Upper-body strength session completed on ${mostRecent.date}. Consecutive-day upper-body loading is restricted for recovery.`,
                lastStrengthLocalDate: mostRecent.date,
                daysSinceLastStrength: 1,
                mostRecentOccurrenceId: mostRecent.performedOccurrenceId,
            };
        }

        // Upper-body strength after general/full-body, or full-body after upper-body, is allowable
        return {
            isRestricted: false,
            daysSinceLastStrength: 1,
            lastStrengthLocalDate: mostRecent.date,
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
