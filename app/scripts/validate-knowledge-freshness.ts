import { buildKnowledgeFreshnessReport } from '../src/knowledge/knowledgeFreshness.ts';
import { SPORTS_KNOWLEDGE_CLAIMS } from '../src/knowledge/sportsKnowledgeRegistry.ts';

// Freshness reporting never fails the build: staleness is visibility, not automatic
// scientific invalidation (SKR5, docs/plans/sports-knowledge-registry-follow-up.md).
// Structural metadata errors (e.g. a malformed reviewCadenceMonthsOverride) are caught by
// `npm run validate:knowledge`, which does fail the build.
const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const report = buildKnowledgeFreshnessReport(SPORTS_KNOWLEDGE_CLAIMS, asOf);
const { summary } = report;

console.log(`Knowledge freshness report as of ${report.asOf}: ${summary.total} claims.`);
console.log(`Status: ${summary.byFreshness.current} current, ${summary.byFreshness.due} due, ${summary.byFreshness.stale} stale.`);
console.log(`Cadence category: ${summary.byCategory.high_safety} high_safety, ${summary.byCategory.rapidly_evolving} rapidly_evolving, ${summary.byCategory.high_impact} high_impact, ${summary.byCategory.stable} stable.`);

if (summary.dueOrStaleHighSafetyActive.length > 0) {
    console.warn(`knowledge-freshness warning: ${summary.dueOrStaleHighSafetyActive.length} active high-safety claim(s) are due or stale for review:`);
    for (const claimId of summary.dueOrStaleHighSafetyActive) console.warn(`  - ${claimId}`);
}

const staleOnly = summary.staleActive.filter(claimId => !summary.dueOrStaleHighSafetyActive.includes(claimId));
if (staleOnly.length > 0) {
    console.warn(`knowledge-freshness warning: ${staleOnly.length} additional active claim(s) are stale for review:`);
    for (const claimId of staleOnly) console.warn(`  - ${claimId}`);
}

if (summary.staleActive.length === 0 && summary.dueOrStaleHighSafetyActive.length === 0) {
    console.log('No active claims are due or stale for review.');
}
