import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const seed = process.env.BLIND_AB_SEED?.trim() || randomBytes(16).toString('hex');
const swapCandidates = Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 2), 16) % 2 === 1;

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const blindModule = await server.ssrLoadModule('/src/engine/simulation/blindComparison.ts');
  const scenariosModule = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');

  console.log(`Running blinded A/B policy comparison across ${scenariosModule.SCENARIOS.length} scenarios...`);
  const report = await blindModule.runBlindAbComparison('off', 'drift', scenariosModule.SCENARIOS, { swapCandidates });
  const { unblindingKey, ...blindedReport } = report;

  const outputDir = resolve('artifacts/simulation-reports/blind-ab/latest');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  writeFileSync(resolve(outputDir, 'blind-ab.json'), `${JSON.stringify(blindedReport, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'unblinding-key.json'), `${JSON.stringify({
    schema: 'adaptive-training-recommender/blind-ab-unblinding@1',
    generatedAt: report.timestamp,
    seed,
    candidateAlpha: unblindingKey.candidateAlpha,
    candidateBeta: unblindingKey.candidateBeta,
  }, null, 2)}\n`);

  const denominator = report.totalScenarios || 1;
  const lines = [
    '# Blind A/B Policy Evaluation Report',
    '',
    `- Timestamp: ${report.timestamp}`,
    `- Total Scenarios Evaluated: ${report.totalScenarios}`,
    `- Differentiating Scenarios: ${report.differentiatingScenariosCount} (${((report.differentiatingScenariosCount / denominator) * 100).toFixed(1)}%)`,
    `- Mean Composite Distance: ${(report.meanCompositeDistance * 100).toFixed(2)}%`,
    `- Mean Mode Hamming Distance: ${(report.meanModeHammingDistance * 100).toFixed(2)}%`,
    `- Mean Session Edit Distance: ${(report.meanSessionEditDistance * 100).toFixed(2)}%`,
    '',
    '> Review this report before opening `unblinding-key.json`. Set `BLIND_AB_SEED` to reproduce the same Alpha/Beta assignment.',
    '',
    '## Differentiating Scenarios',
    '',
    ...report.scenarioComparisons
      .filter((comparison) => comparison.hasDifference)
      .map((comparison) => [
        `### ${comparison.scenarioLabel} (\`${comparison.scenarioId}\`)`,
        `- **Plan Distance**: Composite ${(comparison.distance.compositeDistance * 100).toFixed(1)}% | Mode Hamming: ${(comparison.distance.modeHammingDistance * 100).toFixed(1)}% | Session Edit: ${(comparison.distance.sessionEditDistance * 100).toFixed(1)}%`,
        `- **Candidate Alpha**: Rest/Recovery Days: ${comparison.candidateAlphaSummary.restOrRecoveryDays}, Modes: ${JSON.stringify(comparison.candidateAlphaSummary.modeCounts)}`,
        `- **Candidate Beta**: Rest/Recovery Days: ${comparison.candidateBetaSummary.restOrRecoveryDays}, Modes: ${JSON.stringify(comparison.candidateBetaSummary.modeCounts)}`,
        '',
      ].join('\n')),
  ];

  writeFileSync(resolve(outputDir, 'report.md'), `${lines.join('\n')}\n`);
  console.log(`Blinded report written to ${outputDir}. Review report.md before opening unblinding-key.json.`);
} finally {
  await server.close();
}
