import { buildKnowledgeFreshnessReport } from '../src/knowledge/knowledgeFreshness.ts';
import { SPORTS_KNOWLEDGE_CLAIMS } from '../src/knowledge/sportsKnowledgeRegistry.ts';
import { getLocalDateString } from '../src/utils/localDate.ts';

// Freshness reporting never fails the build: staleness is visibility, not automatic
// scientific invalidation (SKR5, docs/plans/sports-knowledge-registry-follow-up.md).
// Structural metadata errors (e.g. a malformed reviewCadenceMonthsOverride) are caught by
// `npm run validate:knowledge`, which does fail the build.
const asOf = process.argv[2] ?? getLocalDateString();
const report = buildKnowledgeFreshnessReport(SPORTS_KNOWLEDGE_CLAIMS, asOf);
const { summary } = report;

console.log(`Knowledge freshness report as of ${report.asOf}: ${summary.total} claims.`);
console.log(`Status: ${summary.byFreshness.current} current, ${summary.byFreshness.due} due, ${summary.byFreshness.stale} stale.`);
console.log(`Cadence category: ${summary.byCategory.high_safety} high_safety, ${summary.byCategory.rapidly_evolving} rapidly_evolving, ${summary.byCategory.high_impact} high_impact, ${summary.byCategory.stable} stable.`);

const reviewNeeded = report.records.filter(record => record.claimStatus === 'active' && record.freshness !== 'current');

if (reviewNeeded.length > 0) {
    console.warn(`knowledge-freshness warning: ${reviewNeeded.length} active claim(s) are due or stale for review:`);
    for (const record of reviewNeeded) {
        console.warn(
            `  - ${record.claimId}: ${record.freshness}; category=${record.category}; owner=${record.owner}; cadence=${record.cadenceMonths}mo; due=${record.dueOn}; stale=${record.staleOn}`,
        );
    }
} else {
    console.log('No active claims are due or stale for review.');
}

const inconsistentMetadata = report.records.filter(
    record => record.claimStatus === 'active' && (record.reviewedInFuture || record.cadenceOverrideIgnored),
);

if (inconsistentMetadata.length > 0) {
    console.warn(`knowledge-freshness warning: ${inconsistentMetadata.length} active claim(s) have inconsistent review metadata:`);
    for (const record of inconsistentMetadata) {
        const issues = [
            record.reviewedInFuture ? `reviewedOn=${record.reviewedOn} is after asOf=${report.asOf}` : null,
            record.cadenceOverrideIgnored ? 'reviewCadenceMonthsOverride is looser than the risk-derived cadence and is ignored' : null,
        ].filter((issue): issue is string => issue !== null);
        console.warn(`  - ${record.claimId}: ${issues.join('; ')}`);
    }
}
