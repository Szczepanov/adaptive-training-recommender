// Simulation-only policy experiment. Production callers never receive the additive
// selector; this compares it with the real planner, hard gates, and scenario corpus.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

let comparison;
try {
  const { runFatigueFusionComparison } = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  comparison = await runFatigueFusionComparison();
} finally {
  await server.close();
}

const outputDir = resolve('artifacts/fatigue-fusion-reports/latest');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'report.json'), `${JSON.stringify(comparison, null, 2)}\n`);

const lines = [
  '# Fatigue-fusion simulation comparison',
  '',
  `- Baseline: ${comparison.baselinePolicy} (production policy)`,
  `- Candidate: ${comparison.candidatePolicy} (simulation-only)`,
  `- Runtime: baseline ${comparison.baselineRuntimeMs.toFixed(1)} ms; candidate ${comparison.candidateRuntimeMs.toFixed(1)} ms`,
  '',
  'The candidate is descriptive evidence only. It is not available to production callers,',
  'and a change requires a safety/objective rationale plus ADR and policy-version review.',
  '',
  '## Aggregate',
  '',
  ...Object.entries(comparison.aggregate).map(([key, value]) => `- ${key}: ${value}`),
  '',
  '## Per scenario',
  '',
  ...comparison.scenarios.map((scenario) => `- ${scenario.scenarioId}: selections ${scenario.changedSelections}; increased peak-fatigue days ${scenario.increasedPeakFatigueDays}; recovery delta ${scenario.recoverySelectionDelta}; objective-miss delta ${scenario.objectiveMissDelta}; constraint-violation delta ${scenario.constraintViolationDelta}`),
].join('\n');
writeFileSync(resolve(outputDir, 'report.md'), `${lines}\n`);
console.log(`Compared fatigue fusion policies across ${comparison.scenarios.length} scenarios. Report written to ${outputDir}`);
