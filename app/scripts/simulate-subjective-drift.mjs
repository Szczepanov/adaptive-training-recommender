// Phase 9.6 subjective-drift evidence report. Combines three layers:
//  - 9.6a mechanics/sensitivity (evaluator only, cheap, run first);
//  - 9.6b planner-level off/drift comparison (real planner + hard gates, full corpus);
//  - 9.6b planner-level sensitivity sweep (real planner, the 9.6a sensitivity configs).
// Explicitly synthetic safety/regression evidence -- not real-world usefulness evidence,
// which requires Phase 9.0/9.8's prospective record (ADR-0020 D-SUBJCAL).
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

let mechanics;
let comparison;
let sensitivity;
try {
  const { runSubjectiveDriftMechanicsComparison } = await server.ssrLoadModule('/src/engine/simulation/subjectiveDriftComparison.ts');
  mechanics = runSubjectiveDriftMechanicsComparison();
  const { runSubjectiveDriftComparison, runSubjectiveDriftSensitivityComparison } = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  comparison = await runSubjectiveDriftComparison();
  sensitivity = await runSubjectiveDriftSensitivityComparison();
} finally {
  await server.close();
}

const outputDir = resolve('artifacts/subjective-drift-reports/latest');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'mechanics.json'), `${JSON.stringify(mechanics, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'sensitivity.json'), `${JSON.stringify(sensitivity, null, 2)}\n`);

const nonProfileScenarios = comparison.scenarios.filter((item) => !item.scenarioId.startsWith('subjective_'));
const nonProfileChanged = nonProfileScenarios.filter((item) => item.changedSelections !== 0);

const lines = [
  '# Subjective-drift evidence report (Phase 9.6)',
  '',
  '## Evidence framing',
  '',
  '- **Synthetic safety/regression evidence** (this report, all three sections below): can reject unsafe or pathological behaviour in the mechanism itself.',
  '- **Real-world usefulness evidence**: cannot be established here. It requires Phase 9.0\'s prospective shadow-block record and the 9.8 go/no-go, not synthetic fixtures.',
  '- Production remains `SubjectiveDriftPolicy = \'off\'` throughout; nothing in this report changes a live recommendation.',
  '',
  '## 1. Mechanics/sensitivity comparison (9.6a -- evaluator only)',
  '',
  `- Scope: ${mechanics.scope}`,
  `- Synthetic profiles: ${new Set(mechanics.days.map((row) => row.profile)).size}`,
  `- Sensitivity configs: ${mechanics.configs.length}`,
  `- Evaluated synthetic days per profile/config: ${mechanics.totalDays - mechanics.warmupDays}`,
  '',
  ...mechanics.limitations.map((item) => `- ${item}`),
  '',
  ...mechanics.summaries.map((item) => [
    `- ${item.profile} / ${item.configId}:`,
    `  baseline ${item.baselineAvailableDays}/${item.evaluatedDays}; changed modes ${item.changedModeDays};`,
    `  train→modify ${item.trainToModifyDays}; train→recover ${item.trainToRecoverDays}; modify→recover ${item.modifyToRecoverDays};`,
    `  recover share off ${(item.recoverShareOff * 100).toFixed(1)}% vs drift ${(item.recoverShareDrift * 100).toFixed(1)}%;`,
    `  mean contribution ${item.meanContribution.toFixed(3)}; max ${item.maxContribution.toFixed(3)}`,
  ].join(' ')),
  '',
  '## 2. Planner-level off/drift comparison (9.6b -- real planner + hard gates)',
  '',
  `- Baseline policy: ${comparison.baselinePolicy}; candidate policy: ${comparison.candidatePolicy}`,
  `- Baseline runtime: ${comparison.baselineRuntimeMs.toFixed(0)}ms; candidate runtime: ${comparison.candidateRuntimeMs.toFixed(0)}ms`,
  `- Non-subjective-profile scenarios with any diff (expected 0, the regression control): ${nonProfileChanged.length} of ${nonProfileScenarios.length}`,
  '',
  ...comparison.limitations.map((item) => `- ${item}`),
  '',
  '### Per-scenario deltas',
  '',
  ...comparison.scenarios.filter((item) => item.scenarioId.startsWith('subjective_')).map((item) => [
    `- ${item.scenarioId}: changed selections ${item.changedSelections};`,
    `  train→modify ${item.trainToModifyDays}, train→recover ${item.trainToRecoverDays}, modify→recover ${item.modifyToRecoverDays};`,
    `  recovery selection delta ${item.recoverySelectionDelta}, rest/recovery day delta ${item.restOrRecoveryDayDelta};`,
    `  objective miss delta ${item.objectiveMissDelta}, constraint violation delta ${item.constraintViolationDelta}`,
  ].join(' ')),
  '',
  `**Aggregate:** changed selections ${comparison.aggregate.changedSelections}; train→modify ${comparison.aggregate.trainToModifyDays}; `
    + `train→recover ${comparison.aggregate.trainToRecoverDays}; modify→recover ${comparison.aggregate.modifyToRecoverDays}; `
    + `constraint violation delta ${comparison.aggregate.constraintViolationDelta}.`,
  '',
  '## 3. Planner-level sensitivity sweep (9.6b)',
  '',
  ...sensitivity.results.map((item) => [
    `- ${item.profile} / ${item.configId}: changed selections ${item.changedSelections};`,
    `  train→modify ${item.trainToModifyDays}, train→recover ${item.trainToRecoverDays}, modify→recover ${item.modifyToRecoverDays};`,
    `  rest/recovery day delta ${item.restOrRecoveryDayDelta}, constraint violation delta ${item.constraintViolationDelta}`,
  ].join(' ')),
].join('\n');

writeFileSync(resolve(outputDir, 'report.md'), `${lines}\n`);
console.log(`Subjective-drift evidence report (mechanics + planner-level comparison + sensitivity) written to ${outputDir}`);
