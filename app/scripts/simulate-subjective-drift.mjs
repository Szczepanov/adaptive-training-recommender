// Phase 9.6a mechanics/sensitivity report. This intentionally does NOT claim to be the
// final planner-level 9.6 gate; see report.scope/limitations and ADR-0020 D-SUBJCAL.
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

let report;
try {
  const { runSubjectiveDriftMechanicsComparison } = await server.ssrLoadModule('/src/engine/simulation/subjectiveDriftComparison.ts');
  report = runSubjectiveDriftMechanicsComparison();
} finally {
  await server.close();
}

const outputDir = resolve('artifacts/subjective-drift-reports/latest');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  '# Subjective-drift mechanics and sensitivity comparison',
  '',
  `- Scope: ${report.scope}`,
  `- Synthetic profiles: ${new Set(report.days.map((row) => row.profile)).size}`,
  `- Sensitivity configs: ${report.configs.length}`,
  `- Evaluated synthetic days per profile/config: ${report.totalDays - report.warmupDays}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((item) => `- ${item}`),
  '',
  '## Per-profile / configuration summary',
  '',
  ...report.summaries.map((item) => [
    `- ${item.profile} / ${item.configId}:`,
    `  baseline ${item.baselineAvailableDays}/${item.evaluatedDays}; changed modes ${item.changedModeDays};`,
    `  train→modify ${item.trainToModifyDays}; train→recover ${item.trainToRecoverDays}; modify→recover ${item.modifyToRecoverDays};`,
    `  recover share off ${(item.recoverShareOff * 100).toFixed(1)}% vs drift ${(item.recoverShareDrift * 100).toFixed(1)}%;`,
    `  mean contribution ${item.meanContribution.toFixed(3)}; max ${item.maxContribution.toFixed(3)}`,
  ].join(' ')),
].join('\n');

writeFileSync(resolve(outputDir, 'report.md'), `${lines}\n`);
console.log(`Subjective-drift ${report.scope} report written to ${outputDir}`);
