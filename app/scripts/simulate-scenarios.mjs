// The engine/ module graph uses extensionless relative imports (Vite/bundler-style),
// unlike workouts/ (which uses explicit .ts extensions and can run under plain
// `node --experimental-strip-types`, see validate-workouts.ts). Native Node ESM
// resolution can't follow those extensionless imports, so this script loads the
// simulation module through Vite's own SSR module loader instead -- the same resolver
// `vitest`/`vite dev` already use successfully against this exact codebase, with zero
// new dependencies and no need to touch import statements across the engine/ tree.
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

function fmtDistribution(dist) {
  const entries = Object.entries(dist).filter(([, v]) => (v ?? 0) > 0);
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ') || '(none)';
}

function fmtAnchors(result) {
  if (result.anchorWeeks.every((w) => !w.eventSpecificAnchorDate && !w.qualityAnchorDate)) {
    return 'no anchors nominated any week';
  }
  const hits = result.anchorWeeks.filter((w) => w.eventSpecificAnchorHit).length;
  const nominated = result.anchorWeeks.filter((w) => w.eventSpecificAnchorDate).length;
  const fulfilled = result.anchorWeeks.filter((w) => w.eventSpecificAnchorFulfilled).length;
  return `event-specific anchor placement hit ${hits}/${nominated}; weekly event-specific fulfillment ${fulfilled}/${nominated}` + (result.anchorScopeNote ? ' (see scope note)' : '');
}

function fmtObjectiveCredits(credits) {
  const byObjective = new Map();
  for (const credit of credits) {
    const current = byObjective.get(credit.objectiveKey) ?? [];
    current.push(credit.templateTitle);
    byObjective.set(credit.objectiveKey, current);
  }
  return Array.from(byObjective.entries())
    .map(([key, templates]) => `${key}: ${templates.join(', ')}`)
    .join('; ') || '(none)';
}

/** ADR-0018 D-MISS: rendered straight from the shared allocation report, never rebuilt
 * from the selected recommendations, so the simulator, the UI and the JSON agree on the
 * same occurrence ids and statuses. */
function fmtRoleAllocation(result) {
  const outcomes = (result.allocationReports ?? []).flatMap((item) =>
    item.report.outcomes.map((outcome) => ({ weekIndex: item.weekIndex, ...outcome })));
  if (outcomes.length === 0) return 'no authored minimum roles in scope';
  const counts = outcomes.reduce((tally, outcome) => {
    tally[outcome.status] = (tally[outcome.status] ?? 0) + 1;
    return tally;
  }, {});
  const summary = Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(', ');
  const notable = outcomes
    .filter((outcome) => outcome.status !== 'fulfilled' || outcome.reservation.wasMoved)
    .map((outcome) => `w${outcome.weekIndex} ${outcome.occurrence.coverageKey}#${outcome.occurrence.ordinal}`
      + ` -> ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}${outcome.reservation.wasMoved ? ' [moved]' : ''}`);
  return notable.length === 0 ? summary : `${summary}; ${notable.join('; ')}`;
}

function scenarioSection(result) {
  const lines = [];
  lines.push(`### ${result.label}`);
  lines.push('');
  lines.push(result.description);
  lines.push('');
  lines.push(`- **Days simulated:** ${result.totalDays} (${result.weeksSimulated} weeks)`);
  lines.push(`- **Category distribution:** ${fmtDistribution(result.categoryDistribution)}`);
  lines.push(`- **Modality distribution:** ${fmtDistribution(result.modalityDistribution)}`);
  lines.push(`- **Rest/recovery days:** ${result.restOrRecoveryDayCount} (${result.restOrRecoveryDayPct}%)`);
  lines.push(`- **Fatigue tier days:** train ${result.fatigueTierDayCounts.train}, modify ${result.fatigueTierDayCounts.modify}, recover ${result.fatigueTierDayCounts.recover}`);
  lines.push(`- **Longest same-template streak:** ${result.maxConsecutiveSameTemplateStreakWithinCall} within a single week-strip call, ${result.maxConsecutiveSameTemplateStreakAcrossWeeks} across chained weeks`);
  lines.push(`- **Objective resolution:** ${result.objectiveResolution.map((o) => `${o.key} ${o.timesResolved}/${o.timesGenerated}`).join(', ') || '(none generated)'}`);
  lines.push(`- **Objective-credit sources:** ${fmtObjectiveCredits(result.objectiveCredits)}`);
  lines.push(`- **Optimizer diagnostics:** fragile top-two selections ${result.utilityDiagnostics.fragileSelectionCount}; lower-benefit choice selected ${result.utilityDiagnostics.lowerBenefitSelectionCount}; train-tier Rest/Mobility selections ${result.utilityDiagnostics.trainTierRestOrRecoveryCount}`);
  lines.push(`- **Anchor days:** ${fmtAnchors(result)}`);
  lines.push(`- **Required-role allocation (forecast only):** ${fmtRoleAllocation(result)}`);
  if (result.anchorScopeNote) lines.push(`  - *Scope note: ${result.anchorScopeNote}*`);
  lines.push(`- **Constraint violations:** ${result.constraintViolations.length === 0 ? 'none' : result.constraintViolations.join('; ')}`);
  lines.push(`- **Quality warnings:** ${result.qualityWarnings.length === 0 ? 'none' : result.qualityWarnings.join(' ')}`);
  lines.push('');
  return lines.join('\n');
}

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  appType: 'custom',
});

let report;
try {
  const { runAllScenarios } = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  report = await runAllScenarios(undefined, gitCommit());
} finally {
  await server.close();
}

const outputDir = resolve('artifacts/simulation-reports/latest');
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

writeFileSync(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

// Aggregate Bounds Gate (Task 0.1)
// Assert properties that must hold across planner changes.
const totalSimulatedDays = report.scenarios.reduce((sum, s) => sum + s.totalDays, 0);
const totalRestDays = report.scenarios.reduce((sum, s) => sum + s.restOrRecoveryDayCount, 0);
const overallRestPct = totalSimulatedDays > 0 ? (totalRestDays / totalSimulatedDays) * 100 : 0;

const unresolvedObjectivesMap = new Map();
report.scenarios.forEach((s) => {
  s.objectiveResolution.forEach((o) => {
    const cur = unresolvedObjectivesMap.get(o.key) ?? { gen: 0, res: 0 };
    cur.gen += o.timesGenerated;
    cur.res += o.timesResolved;
    unresolvedObjectivesMap.set(o.key, cur);
  });
});
const objectivesNeverResolvedCount = Array.from(unresolvedObjectivesMap.values())
  .filter((o) => o.gen > 0 && o.res === 0).length;

const aggregateViolations = [];
const violationCount = report.scenarios.reduce((sum, s) => sum + s.constraintViolations.length, 0);
if (violationCount > 0) {
  aggregateViolations.push(`${violationCount} hard constraint violation(s) found across scenarios`);
}
if (overallRestPct < 5.0 || overallRestPct > 40.5) {
  aggregateViolations.push(`Overall rest/recovery day share ${overallRestPct.toFixed(1)}% outside allowed [5%, 40.5%] bound`);
}
if (objectivesNeverResolvedCount > 1) {
  aggregateViolations.push(`${objectivesNeverResolvedCount} generated objective(s) were never resolved in any scenario (max allowed: 1)`);
}

const md = [
  '# Recommendation engine scenario simulation report',
  '',
  `- Commit: \`${report.commit}\``,
  `- Captured: ${report.capturedAt}`,
  `- Scenarios: ${report.scenarios.length}`,
  `- Total constraint violations across all scenarios: ${violationCount}${violationCount === 0 ? ' (clean)' : ' -- SEE BELOW, this should always be 0'}`,
  `- Preference sensitivity: ${report.preferenceSensitivity.map((result) => result.summary).join(' ') || '(no matched comparisons)'}`,
  `- Readiness sensitivity: ${report.readinessSensitivity.map((result) => result.summary).join(' ') || '(no matched comparisons)'}`,
  '',
  'Regenerate with `npm run simulate:scenarios`. Scenario definitions live in',
  '`src/engine/simulation/scenarios.ts` -- the same list `src/engine/scenarios.test.ts`',
  'asserts against, so this report and the pass/fail test suite never drift apart.',
  '',
  'The committed semantic baseline is intentionally NOT updated by this command.',
  'Use `npm run simulate:update-baseline -- --reviewed` only after reviewing the semantic diff.',
  '',
  '---',
  '',
  ...report.scenarios.map(scenarioSection),
].join('\n');
writeFileSync(resolve(outputDir, 'report.md'), md);

console.log(`Simulated ${report.scenarios.length} scenarios. Report written to ${outputDir}`);
console.log('Committed simulation baseline left unchanged.');

if (aggregateViolations.length > 0) {
  console.error('Aggregate bounds gate FAILED:');
  aggregateViolations.forEach((v) => console.error(`  - ${v}`));
  process.exitCode = 1;
}
