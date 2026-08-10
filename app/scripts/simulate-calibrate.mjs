// Runs the bounded, synthetic scenario corpus through Vite's SSR resolver and writes
// compact decision traces plus descriptive trigger frequencies. This command never
// changes the committed semantic baseline and never reads athlete/Firebase data.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function formatCounts(counts) {
  const entries = Object.entries(counts).filter(([, value]) => value > 0);
  return entries.length === 0 ? 'none' : entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

let simulation;
let calibration;
try {
  const { runAllScenarios, buildCalibrationReport } = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  simulation = await runAllScenarios(undefined, gitCommit());
  calibration = buildCalibrationReport(simulation);
} finally {
  await server.close();
}

const outputDir = resolve('artifacts/calibration-reports/latest');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

writeFileSync(resolve(outputDir, 'report.json'), `${JSON.stringify({ simulation, calibration }, null, 2)}\n`);

const lines = [
  '# Recommendation engine calibration evidence report',
  '',
  `- Evidence type: **${calibration.evidenceType}**`,
  `- Commit: \`${simulation.commit}\``,
  `- Captured: ${simulation.capturedAt}`,
  `- Corpus: ${calibration.generatedFrom.scenarioCount} named cases / ${calibration.generatedFrom.totalDays} simulated days`,
  '',
  'This report is descriptive. It does not recommend threshold changes; synthetic fixtures',
  'exercise rule boundaries and regressions but cannot validate physiology.',
  '',
  '## Aggregate trigger frequency',
  '',
  `- Modes: ${formatCounts(calibration.aggregate.modeCounts)}`,
  `- Projected fatigue tiers: ${formatCounts(calibration.aggregate.fatigueTierCounts)}`,
  `- Hard-gate rejections: ${formatCounts(calibration.aggregate.rejectionCounts)}`,
  `- Recovery selections: ${calibration.aggregate.recoverySelections}`,
  `- Objectives (created/resolved/missed): ${calibration.aggregate.objectives.created}/${calibration.aggregate.objectives.resolved}/${calibration.aggregate.objectives.missed}`,
  `- Fragile top-two selections: ${calibration.aggregate.fragileTopTwoSelections}`,
  `- Fixed-activity activations: ${calibration.aggregate.fixedActivityActivations}`,
  `- Multi-event contributor transitions (added/dropped): ${calibration.aggregate.contributorTransitions.added}/${calibration.aggregate.contributorTransitions.dropped}`,
  '',
  '## By scenario',
  '',
  ...calibration.scenarios.flatMap((scenario) => [
    `### ${scenario.label}`,
    '',
    `- Tags: ${scenario.tags.join(', ') || 'none'}`,
    `- Modes: ${formatCounts(scenario.modeCounts)}`,
    `- Rejections: ${formatCounts(scenario.rejectionCounts)}`,
    `- Recovery selections: ${scenario.recoverySelections}; fragile top-two: ${scenario.fragileTopTwoSelections}`,
    `- Objectives (created/resolved/missed): ${scenario.objectives.created}/${scenario.objectives.resolved}/${scenario.objectives.missed}`,
    `- Fixed-activity activations: ${scenario.fixedActivityActivations}; contributor transitions (added/dropped): ${scenario.contributorTransitions.added}/${scenario.contributorTransitions.dropped}`,
    '',
  ]),
  'Regenerate with `npm run simulate:calibrate`. The JSON includes compact per-day traces',
  '(canonical ids, derived profile vectors, objective credit, gate codes, and optimizer scores only).',
].join('\n');
writeFileSync(resolve(outputDir, 'report.md'), `${lines}\n`);

console.log(`Calibrated ${calibration.generatedFrom.scenarioCount} synthetic scenarios. Report written to ${outputDir}`);
