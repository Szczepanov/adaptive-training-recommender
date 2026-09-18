import { buildKnowledgeFreshnessReport } from '../src/knowledge/knowledgeFreshness.ts';
import { isIsoCalendarDate } from '../src/knowledge/sportsKnowledge.ts';
import { SPORTS_KNOWLEDGE_CLAIMS } from '../src/knowledge/sportsKnowledgeRegistry.ts';
import { getLocalDateString } from '../src/utils/localDate.ts';

// Freshness reporting never fails the build on due/stale claims: staleness is visibility, not
// automatic scientific invalidation (SKR5, docs/plans/sports-knowledge-registry-follow-up.md).
// Structural registry metadata errors (e.g. a malformed reviewCadenceMonthsOverride) are caught
// by `npm run validate:knowledge`, which does fail the build. An invalid CLI `asOf` argument is
// a usage error, not a staleness finding, so it fails fast here instead of silently producing a
// misleading report (e.g. "2026-9-30" would otherwise sort incorrectly against zero-padded
// ISO dates, and "2026-02-30" is not a real calendar date).
const asOfArg = process.argv[2];
if (asOfArg !== undefined && !isIsoCalendarDate(asOfArg)) {
    console.error(`knowledge-freshness error: "${asOfArg}" is not a valid YYYY-MM-DD calendar date.`);
    process.exit(1);
}
const asOf = asOfArg ?? getLocalDateString();
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
