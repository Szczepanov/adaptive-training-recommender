import fs from 'node:fs';

const path = 'scripts/finish-pr-297.mjs';
let text = fs.readFileSync(path, 'utf8');
const oldSnippet = `  text = replaceOnce(
    text,
\`        droppedContributorObjectives: intent.droppedContributorObjectives,\`,
\`        droppedContributorObjectives: result.droppedContributorObjectives,\`,
    'beam wrapper dynamic drops',
  );`;
const newSnippet = `  text = replaceOnce(
    text,
\`        microcycleObjectives: result.microcycleObjectives,
        droppedContributorObjectives: intent.droppedContributorObjectives,
        allocationReport: { outcomes: [] },\`,
\`        microcycleObjectives: result.microcycleObjectives,
        droppedContributorObjectives: result.droppedContributorObjectives,
        allocationReport: { outcomes: [] },\`,
    'beam wrapper dynamic drops',
  );`;
if (!text.includes(oldSnippet)) throw new Error('Expected beam-wrapper transformer snippet was not found');
text = text.replace(oldSnippet, newSnippet);
fs.writeFileSync(path, text);
await import('./finish-pr-297.mjs');
