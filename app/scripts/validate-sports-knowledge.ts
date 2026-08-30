import {
    SPORTS_KNOWLEDGE_CLAIMS,
    SPORTS_KNOWLEDGE_SOURCES,
    validateCanonicalSportsKnowledgeRegistry,
} from '../src/knowledge/sportsKnowledgeRegistry.ts';

const result = validateCanonicalSportsKnowledgeRegistry();

for (const warning of result.warnings) {
    console.warn(`sports-knowledge warning: ${warning}`);
}
for (const error of result.errors) {
    console.error(`sports-knowledge error: ${error}`);
}

if (!result.valid) {
    process.exitCode = 1;
} else {
    console.log(`Validated ${SPORTS_KNOWLEDGE_CLAIMS.length} knowledge claims and ${SPORTS_KNOWLEDGE_SOURCES.length} sources.`);
}
