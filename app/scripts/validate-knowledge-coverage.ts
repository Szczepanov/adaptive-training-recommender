import {
    ENGINE_KNOWLEDGE_COVERAGE,
    summarizeKnowledgeCoverage,
    validateKnowledgeCoverageInventory,
} from '../src/knowledge/knowledgeCoverage.ts';

const result = validateKnowledgeCoverageInventory();
const summary = summarizeKnowledgeCoverage();

for (const warning of result.warnings) {
    console.warn(`knowledge-coverage warning: ${warning}`);
}
for (const error of result.errors) {
    console.error(`knowledge-coverage error: ${error}`);
}

if (!result.valid) {
    process.exitCode = 1;
} else {
    console.log(`Validated ${ENGINE_KNOWLEDGE_COVERAGE.length} engine knowledge-coverage items.`);
    console.log(`Coverage: ${summary.byCoverage.covered} covered, ${summary.byCoverage.partial} partial, ${summary.byCoverage.uncovered} uncovered, ${summary.byCoverage.not_applicable} not applicable.`);
    console.log(`Research backlog: P0=${summary.byPriority.p0}, P1=${summary.byPriority.p1}, P2=${summary.byPriority.p2}, P3=${summary.byPriority.p3}.`);
    console.log(`Risk debt: ${summary.highImpactUncovered} high-impact uncovered; ${summary.highSafetyUncovered} high-safety uncovered.`);
}
