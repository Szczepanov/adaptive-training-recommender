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

try {
  const blindModule = await server.ssrLoadModule('/src/engine/simulation/blindComparison.ts');
  const scenariosModule = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');

  console.log('Running Blind A/B Comparison: Subjective Drift OFF vs DRIFT across', scenariosModule.SCENARIOS.length, 'scenarios...');
  const report = await blindModule.runBlindAbComparison('off', 'drift', scenariosModule.SCENARIOS);

  const outputDir = resolve('artifacts/simulation-reports/blind-ab/latest');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  writeFileSync(resolve(outputDir, 'blind-ab.json'), `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '# Blind A/B Policy Evaluation Report: Subjective Drift OFF vs DRIFT',
    '',
    `- Timestamp: ${report.timestamp}`,
    `- Total Scenarios Evaluated: ${report.totalScenarios}`,
    `- Differentiating Scenarios: ${report.differentiatingScenariosCount} (${((report.differentiatingScenariosCount / report.totalScenarios) * 100).toFixed(1)}%)`,
    `- Mean Composite Distance: ${(report.meanCompositeDistance * 100).toFixed(2)}%`,
    `- Mean Mode Hamming Distance: ${(report.meanModeHammingDistance * 100).toFixed(2)}%`,
    `- Mean Session Edit Distance: ${(report.meanSessionEditDistance * 100).toFixed(2)}%`,
    '',
    '## Differentiating Scenarios Breakdown',
    '',
    ...report.scenarioComparisons
      .filter((c) => c.hasDifference)
      .map((c) => [
        `### ${c.scenarioLabel} (\`${c.scenarioId}\`)`,
        `- **Plan Distance**: Composite ${(c.distance.compositeDistance * 100).toFixed(1)}% | Mode Hamming: ${(c.distance.modeHammingDistance * 100).toFixed(1)}% | Session Edit: ${(c.distance.sessionEditDistance * 100).toFixed(1)}%`,
        `- **Candidate Alpha**: Rest/Rec Days: ${c.candidateAlphaSummary.restOrRecoveryDays}, Modes: ${JSON.stringify(c.candidateAlphaSummary.modeCounts)}`,
        `- **Candidate Beta**: Rest/Rec Days: ${c.candidateBetaSummary.restOrRecoveryDays}, Modes: ${JSON.stringify(c.candidateBetaSummary.modeCounts)}`,
        '',
      ].join('\n')),
    '## Unblinding Key',
    '',
    `- **Candidate Alpha**: ${report.unblindingKey.candidateAlpha}`,
    `- **Candidate Beta**: ${report.unblindingKey.candidateBeta}`,
  ];

  writeFileSync(resolve(outputDir, 'report.md'), `${lines.join('\n')}\n`);
  console.log(`Blind A/B report successfully generated at ${outputDir}`);
} finally {
  await server.close();
}
