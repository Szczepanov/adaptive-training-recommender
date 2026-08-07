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
  return `event-specific anchor hit ${hits}/${nominated} nominated weeks` + (result.anchorScopeNote ? ' (see scope note)' : '');
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
  lines.push(`- **Anchor days:** ${fmtAnchors(result)}`);
  if (result.anchorScopeNote) lines.push(`  - *Scope note: ${result.anchorScopeNote}*`);
  lines.push(`- **Constraint violations:** ${result.constraintViolations.length === 0 ? 'none' : result.constraintViolations.join('; ')}`);
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

const violationCount = report.scenarios.reduce((sum, s) => sum + s.constraintViolations.length, 0);
const md = [
  '# Recommendation engine scenario simulation report',
  '',
  `- Commit: \`${report.commit}\``,
  `- Captured: ${report.capturedAt}`,
  `- Scenarios: ${report.scenarios.length}`,
  `- Total constraint violations across all scenarios: ${violationCount}${violationCount === 0 ? ' (clean)' : ' -- SEE BELOW, this should always be 0'}`,
  '',
  'Regenerate with `npm run simulate:scenarios`. Scenario definitions live in',
  '`src/engine/simulation/scenarios.ts` -- the same list `src/engine/scenarios.test.ts`',
  'asserts against, so this report and the pass/fail test suite never drift apart.',
  '',
  '---',
  '',
  ...report.scenarios.map(scenarioSection),
].join('\n');
writeFileSync(resolve(outputDir, 'report.md'), md);

console.log(`Simulated ${report.scenarios.length} scenarios. Report written to ${outputDir}`);
if (violationCount > 0) {
  console.error(`${violationCount} constraint violation(s) found -- see report.md`);
  process.exitCode = 1;
}
