import { describe, expect, it } from 'vitest';
import {
    addCalendarMonths,
    buildKnowledgeFreshnessReport,
    computeClaimFreshness,
    DEFAULT_KNOWLEDGE_OWNER,
    deriveReviewCadenceCategory,
    DUE_GRACE_MONTHS,
    ownerForClaim,
    REVIEW_CADENCE_MONTHS,
    reviewCadenceMonthsFor,
} from './knowledgeFreshness';
import type { KnowledgeClaim } from './sportsKnowledge';
import { SPORTS_KNOWLEDGE_CLAIMS } from './sportsKnowledgeRegistry';

function baseClaim(overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
    return {
        id: 'test.claim',
        statement: 'Test statement.',
        claimType: 'heuristic',
        maturity: 'heuristic',
        status: 'active',
        evidenceCertainty: 'not_applicable',
        recommendationStrength: 'conditional',
        safetyImpact: 'low',
        applicability: { contexts: [], sports: [], populations: [], outcomes: [], horizon: 'both' },
        evidence: [{ sourceId: 'SOME-SOURCE', directness: 'direct' }],
        limitations: [],
        reviewedOn: '2026-01-15',
        version: 1,
        ...overrides,
    };
}

describe('deriveReviewCadenceCategory', () => {
    it('classifies high-safety claims regardless of other fields', () => {
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'high', maturity: 'established', evidenceCertainty: 'high' }))).toBe('high_safety');
    });

    it('classifies emerging maturity as rapidly evolving', () => {
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'low', maturity: 'emerging', evidenceCertainty: 'moderate' }))).toBe('rapidly_evolving');
    });

    it('classifies low/very-low certainty as rapidly evolving', () => {
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'low', maturity: 'supported', evidenceCertainty: 'low' }))).toBe('rapidly_evolving');
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'low', maturity: 'supported', evidenceCertainty: 'very_low' }))).toBe('rapidly_evolving');
    });

    it('classifies strong recommendations and moderate safety impact as high impact', () => {
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'low', maturity: 'established', evidenceCertainty: 'moderate', recommendationStrength: 'strong' }))).toBe('high_impact');
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'moderate', maturity: 'established', evidenceCertainty: 'moderate', recommendationStrength: 'conditional' }))).toBe('high_impact');
    });

    it('falls back to stable for everything else', () => {
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'low', maturity: 'established', evidenceCertainty: 'high', recommendationStrength: 'informational' }))).toBe('stable');
    });

    it('prioritizes high-safety over rapidly-evolving and high-impact signals', () => {
        expect(deriveReviewCadenceCategory(baseClaim({ safetyImpact: 'high', maturity: 'emerging', evidenceCertainty: 'very_low', recommendationStrength: 'strong' }))).toBe('high_safety');
    });
});

describe('reviewCadenceMonthsFor', () => {
    it('uses the derived category cadence by default', () => {
        expect(reviewCadenceMonthsFor(baseClaim({ safetyImpact: 'high' }))).toBe(REVIEW_CADENCE_MONTHS.high_safety);
        expect(reviewCadenceMonthsFor(baseClaim({ safetyImpact: 'low', maturity: 'established', evidenceCertainty: 'high', recommendationStrength: 'informational' }))).toBe(REVIEW_CADENCE_MONTHS.stable);
    });

    it('honors an explicit per-claim override', () => {
        expect(reviewCadenceMonthsFor(baseClaim({ safetyImpact: 'high', reviewCadenceMonthsOverride: 3 }))).toBe(3);
    });
});

describe('ownerForClaim', () => {
    it('defaults to the registry owner', () => {
        expect(ownerForClaim(baseClaim())).toBe(DEFAULT_KNOWLEDGE_OWNER);
    });

    it('honors an explicit per-claim owner override', () => {
        expect(ownerForClaim(baseClaim({ owner: 'sports-science-reviewer' }))).toBe('sports-science-reviewer');
    });

    it('treats a blank owner override as absent', () => {
        expect(ownerForClaim(baseClaim({ owner: '   ' }))).toBe(DEFAULT_KNOWLEDGE_OWNER);
    });
});

describe('addCalendarMonths', () => {
    it('adds whole months within a year', () => {
        expect(addCalendarMonths('2026-01-15', 6)).toBe('2026-07-15');
    });

    it('rolls over the year boundary', () => {
        expect(addCalendarMonths('2026-08-30', 6)).toBe('2027-02-28');
    });

    it('clamps day-of-month overflow into a shorter target month', () => {
        expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    });

    it('clamps into a leap-year February correctly', () => {
        expect(addCalendarMonths('2027-12-31', 2)).toBe('2028-02-29');
    });
});

describe('computeClaimFreshness', () => {
    const claim = baseClaim({ id: 'test.high_safety', safetyImpact: 'high', reviewedOn: '2026-01-15' });

    it('is current before the cadence elapses', () => {
        expect(computeClaimFreshness(claim, '2026-06-01').freshness).toBe('current');
    });

    it('is due once the cadence elapses but within the grace window', () => {
        const dueOn = addCalendarMonths(claim.reviewedOn, REVIEW_CADENCE_MONTHS.high_safety);
        expect(computeClaimFreshness(claim, dueOn).freshness).toBe('due');
    });

    it('is stale once the grace window elapses', () => {
        const staleOn = addCalendarMonths(addCalendarMonths(claim.reviewedOn, REVIEW_CADENCE_MONTHS.high_safety), DUE_GRACE_MONTHS);
        expect(computeClaimFreshness(claim, staleOn).freshness).toBe('stale');
    });

    it('never mutates or reports claim status, certainty or recommendation strength', () => {
        const record = computeClaimFreshness(claim, '2029-01-01');
        expect(record).not.toHaveProperty('status');
        expect(record).not.toHaveProperty('evidenceCertainty');
        expect(record).not.toHaveProperty('recommendationStrength');
        expect(claim.status).toBe('active');
    });
});

describe('buildKnowledgeFreshnessReport', () => {
    it('summarizes counts and only surfaces active claims in risk lists', () => {
        const claims: readonly KnowledgeClaim[] = [
            baseClaim({ id: 'a.stale.active', safetyImpact: 'high', reviewedOn: '2020-01-01', status: 'active' }),
            baseClaim({ id: 'b.stale.deprecated', safetyImpact: 'high', reviewedOn: '2020-01-01', status: 'deprecated' }),
            baseClaim({ id: 'c.current', safetyImpact: 'low', maturity: 'established', evidenceCertainty: 'high', recommendationStrength: 'informational', reviewedOn: '2026-01-01', status: 'active' }),
        ];
        const report = buildKnowledgeFreshnessReport(claims, '2026-06-01');
        expect(report.summary.total).toBe(3);
        expect(report.summary.staleActive).toEqual(['a.stale.active']);
        expect(report.summary.dueOrStaleHighSafetyActive).toEqual(['a.stale.active']);
        expect(report.summary.byFreshness.stale).toBe(2);
    });

    it('runs against the full canonical registry without throwing and classifies every claim', () => {
        const report = buildKnowledgeFreshnessReport(SPORTS_KNOWLEDGE_CLAIMS, '2026-09-18');
        expect(report.records).toHaveLength(SPORTS_KNOWLEDGE_CLAIMS.length);
        for (const record of report.records) {
            expect(['current', 'due', 'stale']).toContain(record.freshness);
            expect(record.owner.length).toBeGreaterThan(0);
        }
    });
});
