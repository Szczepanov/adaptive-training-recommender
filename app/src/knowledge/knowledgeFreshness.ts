import type { KnowledgeClaim, KnowledgeStatus } from './sportsKnowledge.ts';

/**
 * SKR5 freshness governance (ADR-0033, docs/plans/sports-knowledge-registry-follow-up.md).
 *
 * This module never changes a claim's `status`, `evidenceCertainty` or `recommendationStrength`.
 * It only computes a deterministic review cadence and a due/stale reporting status from fields
 * already on the claim, so the registry never needs a mechanical per-claim data migration.
 */

export type ReviewCadenceCategory = 'high_safety' | 'rapidly_evolving' | 'high_impact' | 'stable';
export type KnowledgeFreshnessStatus = 'current' | 'due' | 'stale';

/** Months between reviews for each cadence category. High-safety/rapidly-evolving claims are reviewed most often; stable guideline definitions least often. */
export const REVIEW_CADENCE_MONTHS: Readonly<Record<ReviewCadenceCategory, number>> = {
    high_safety: 6,
    rapidly_evolving: 9,
    high_impact: 12,
    stable: 24,
};

/** Grace window after a claim becomes due before it is reported stale rather than merely due. */
export const DUE_GRACE_MONTHS = 2;

/** Default review owner for every claim that does not declare an explicit `owner` override. */
export const DEFAULT_KNOWLEDGE_OWNER = 'repository-maintainer';

/**
 * Deterministic, first-match-wins cadence classification.
 *
 * - `high_safety`: the claim can force or gate a high-safety decision (`safetyImpact === 'high'`).
 * - `rapidly_evolving`: emerging maturity or low/very-low certainty evidence is more likely to be
 *   revised by new literature.
 * - `high_impact`: the claim authorizes a strong recommendation, or has moderate safety impact,
 *   without already being high-safety or rapidly evolving.
 * - `stable`: everything else (established/foundational, non-strong, low/no safety impact).
 */
export function deriveReviewCadenceCategory(claim: KnowledgeClaim): ReviewCadenceCategory {
    if (claim.safetyImpact === 'high') return 'high_safety';
    if (claim.maturity === 'emerging' || claim.evidenceCertainty === 'low' || claim.evidenceCertainty === 'very_low') return 'rapidly_evolving';
    if (claim.recommendationStrength === 'strong' || claim.safetyImpact === 'moderate') return 'high_impact';
    return 'stable';
}

/**
 * Resolve the effective review cadence. Per-claim overrides may tighten review frequency but
 * never relax the risk-derived cadence; this keeps an override from silently downgrading
 * freshness governance for high-safety or rapidly evolving claims.
 */
export function reviewCadenceMonthsFor(claim: KnowledgeClaim): number {
    const derivedCadence = REVIEW_CADENCE_MONTHS[deriveReviewCadenceCategory(claim)];
    return claim.reviewCadenceMonthsOverride === undefined
        ? derivedCadence
        : Math.min(claim.reviewCadenceMonthsOverride, derivedCadence);
}

/** Resolve the effective review owner for a claim, honoring an explicit per-claim override. */
export function ownerForClaim(claim: KnowledgeClaim): string {
    return claim.owner?.trim() || DEFAULT_KNOWLEDGE_OWNER;
}

/** Add whole calendar months to an ISO `YYYY-MM-DD` date, clamping day-of-month overflow (e.g. Jan 31 + 1 month -> Feb 28/29). UTC-based; not a Warsaw-calendar-day helper. */
export function addCalendarMonths(isoDate: string, months: number): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const base = Date.UTC(year, month - 1, 1);
    const targetMonthStart = new Date(base);
    targetMonthStart.setUTCMonth(targetMonthStart.getUTCMonth() + months);
    const daysInTargetMonth = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
    const clampedDay = Math.min(day, daysInTargetMonth);
    const result = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), clampedDay));
    return result.toISOString().slice(0, 10);
}

export interface ClaimFreshnessRecord {
    claimId: string;
    claimStatus: KnowledgeStatus;
    category: ReviewCadenceCategory;
    cadenceMonths: number;
    owner: string;
    reviewedOn: string;
    reviewedInFuture: boolean;
    cadenceOverrideIgnored: boolean;
    dueOn: string;
    staleOn: string;
    freshness: KnowledgeFreshnessStatus;
}

/** Compute one claim's freshness record as of `asOfIsoDate`. Pure: the caller supplies "today". */
export function computeClaimFreshness(claim: KnowledgeClaim, asOfIsoDate: string): ClaimFreshnessRecord {
    const category = deriveReviewCadenceCategory(claim);
    const derivedCadenceMonths = REVIEW_CADENCE_MONTHS[category];
    const cadenceMonths = reviewCadenceMonthsFor(claim);
    const reviewedInFuture = claim.reviewedOn > asOfIsoDate;
    const cadenceOverrideIgnored = claim.reviewCadenceMonthsOverride !== undefined
        && claim.reviewCadenceMonthsOverride > derivedCadenceMonths;
    const dueOn = addCalendarMonths(claim.reviewedOn, cadenceMonths);
    const staleOn = addCalendarMonths(dueOn, DUE_GRACE_MONTHS);
    const freshness: KnowledgeFreshnessStatus = asOfIsoDate < dueOn ? 'current' : asOfIsoDate < staleOn ? 'due' : 'stale';
    return {
        claimId: claim.id,
        claimStatus: claim.status,
        category,
        cadenceMonths,
        owner: ownerForClaim(claim),
        reviewedOn: claim.reviewedOn,
        reviewedInFuture,
        cadenceOverrideIgnored,
        dueOn,
        staleOn,
        freshness,
    };
}

export interface KnowledgeFreshnessSummary {
    total: number;
    byFreshness: Record<KnowledgeFreshnessStatus, number>;
    byCategory: Record<ReviewCadenceCategory, number>;
    dueActive: readonly string[];
    dueOrStaleHighSafetyActive: readonly string[];
    staleActive: readonly string[];
    inconsistentMetadataActive: readonly string[];
}

export interface KnowledgeFreshnessReport {
    asOf: string;
    records: readonly ClaimFreshnessRecord[];
    summary: KnowledgeFreshnessSummary;
}

/**
 * Build the freshness report for every claim, regardless of lifecycle status: a deprecated or
 * rejected claim's freshness is still informative for audit, but only `active` claims count
 * toward the risk-visibility summary (`dueActive`, `dueOrStaleHighSafetyActive`,
 * `staleActive`, `inconsistentMetadataActive`) since only active claims currently
 * authorize a recommendation.
 */
export function buildKnowledgeFreshnessReport(claims: readonly KnowledgeClaim[], asOfIsoDate: string): KnowledgeFreshnessReport {
    const records = claims.map(claim => computeClaimFreshness(claim, asOfIsoDate));

    const byFreshness: Record<KnowledgeFreshnessStatus, number> = { current: 0, due: 0, stale: 0 };
    const byCategory: Record<ReviewCadenceCategory, number> = { high_safety: 0, rapidly_evolving: 0, high_impact: 0, stable: 0 };
    const dueActive: string[] = [];
    const dueOrStaleHighSafetyActive: string[] = [];
    const staleActive: string[] = [];
    const inconsistentMetadataActive: string[] = [];

    for (const record of records) {
        byFreshness[record.freshness] += 1;
        byCategory[record.category] += 1;
        if (record.claimStatus !== 'active') continue;
        if (record.freshness === 'due') dueActive.push(record.claimId);
        if (record.category === 'high_safety' && record.freshness !== 'current') dueOrStaleHighSafetyActive.push(record.claimId);
        if (record.freshness === 'stale') staleActive.push(record.claimId);
        if (record.reviewedInFuture || record.cadenceOverrideIgnored) inconsistentMetadataActive.push(record.claimId);
    }

    return {
        asOf: asOfIsoDate,
        records,
        summary: {
            total: records.length,
            byFreshness,
            byCategory,
            dueActive,
            dueOrStaleHighSafetyActive,
            staleActive,
            inconsistentMetadataActive,
        },
    };
}
