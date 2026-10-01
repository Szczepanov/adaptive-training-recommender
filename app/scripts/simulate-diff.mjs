import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const repoRoot = resolve('..');

function git(args, cwd = repoRoot) {
  return execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
}

function safeGitCommit(ref = 'HEAD') {
  try {
    return git(['rev-parse', ref]);
  } catch {
    return 'unknown';
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const hasFlag = (flag) => args.includes(flag);

const baselineArg = getArg('--baseline') || resolve('../docs/analysis/simulation-baseline.json');
const baseArg = getArg('--base') || getArg('--base-sha') || process.env.BASE_SHA || process.env.VERIFY_BASE || null;
const prHeadArg = getArg('--head') || getArg('--head-sha') || getArg('--pr-head') || process.env.PR_HEAD_SHA || process.env.HEAD_SHA || null;
const mergeArg = getArg('--merge') || getArg('--merge-sha') || process.env.MERGE_SHA || null;
const baseReportArg = getArg('--base-report');
const currentReportArg = getArg('--current-report');
const baselineOnly = hasFlag('--baseline-only') || hasFlag('--no-base');

if (!existsSync(baselineArg)) {
  console.error(`Baseline file not found at ${baselineArg}. Create it only after review with npm run simulate:update-baseline -- --reviewed.`);
  process.exit(1);
}

let baselineContent;
let baseline;
try {
  baselineContent = readFileSync(baselineArg, 'utf8');
  baseline = JSON.parse(baselineContent);
} catch (error) {
  console.error(`Baseline file at ${baselineArg} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!baseline || !Array.isArray(baseline.scenarios)) {
  console.error(`Baseline file at ${baselineArg} does not contain a scenarios array.`);
  process.exit(1);
}

// Spin up Vite server in app to load simulation engine modules
const appServer = await createServer({
  configFile: false,
  root: resolve('.'),
  logLevel: 'warn',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
});

let diffModule;
try {
  diffModule = await appServer.ssrLoadModule('/src/engine/simulation/simulationDiff.ts');
} catch (err) {
  console.error(`Failed to load simulationDiff module: ${err instanceof Error ? err.message : String(err)}`);
  await appServer.close();
  process.exit(1);
}

const {
  computeBaselineHash,
  computeCorpusHash,
  diffSimulationReports,
  formatSimulationDiffReport,
  normalizeSimulationReport,
} = diffModule;

// Load or generate current simulation report
let current;
if (currentReportArg && existsSync(currentReportArg)) {
  try {
    current = JSON.parse(readFileSync(currentReportArg, 'utf8'));
  } catch (err) {
    console.error(`Could not read current report from ${currentReportArg}: ${err.message}`);
  }
}

if (!current) {
  const latestReportPath = resolve('artifacts/simulation-reports/latest/report.json');
  const headSha = safeGitCommit('HEAD');
  if (existsSync(latestReportPath)) {
    try {
      const cached = JSON.parse(readFileSync(latestReportPath, 'utf8'));
      if (cached && Array.isArray(cached.scenarios) && (cached.commit === headSha || cached.commit === 'current')) {
        current = cached;
      }
    } catch {
      // Regenerate if cached report cannot be parsed
    }
  }

  if (!current) {
    try {
      const { runAllScenarios } = await appServer.ssrLoadModule('/src/engine/simulation/analyze.ts');
      current = await runAllScenarios(undefined, headSha);
    } catch (err) {
      console.error(`Failed to run current scenarios: ${err instanceof Error ? err.message : String(err)}`);
      await appServer.close();
      process.exit(1);
    }
  }
}

let policyVersion = current.policyVersion || 'unknown';
try {
  const policyModule = await appServer.ssrLoadModule('/src/engine/policy.ts');
  if (policyModule?.POLICY_VERSION) {
    policyVersion = policyModule.POLICY_VERSION;
  }
} catch {
  // fallback to report policyVersion
}

// Close app server once current simulation is loaded
await appServer.close();

// Resolve base SHA if possible and not explicitly disabled
let resolvedBaseSha = null;
if (!baselineOnly) {
  if (baseArg && baseArg !== '0000000000000000000000000000000000000000') {
    resolvedBaseSha = baseArg;
  } else {
    // Attempt to auto-detect base when on a feature branch locally
    try {
      const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
      if (currentBranch && currentBranch !== 'main' && currentBranch !== 'HEAD') {
        const mergeBase = git(['merge-base', 'origin/main', 'HEAD']);
        const headSha = safeGitCommit('HEAD');
        if (mergeBase && mergeBase !== headSha) {
          resolvedBaseSha = mergeBase;
        }
      }
    } catch {
      // Git failure or shallow checkout - base detection skipped
    }
  }
}

// Load or generate base simulation report
let baseReport = null;
if (baseReportArg && existsSync(baseReportArg)) {
  try {
    baseReport = JSON.parse(readFileSync(baseReportArg, 'utf8'));
  } catch (err) {
    console.warn(`Could not read base report from ${baseReportArg}: ${err.message}`);
  }
} else if (resolvedBaseSha) {
  const baseReportPath = resolve(`artifacts/simulation-reports/base/report.json`);
  if (existsSync(baseReportPath)) {
    try {
      const cached = JSON.parse(readFileSync(baseReportPath, 'utf8'));
      if (cached && cached.commit === resolvedBaseSha) {
        baseReport = cached;
      }
    } catch {
      // Regenerate
    }
  }

  if (!baseReport) {
    let tmpWorktree = null;
    try {
      // Ensure commit is present locally if shallow clone
      try {
        git(['cat-file', '-e', resolvedBaseSha]);
      } catch {
        try {
          git(['fetch', '--depth=1', 'origin', resolvedBaseSha]);
        } catch {
          // ignore fetch error, worktree add will fail if commit is missing
        }
      }

      tmpWorktree = mkdtempSync(join(tmpdir(), 'atr-sim-base-'));
      git(['worktree', 'add', '--detach', tmpWorktree, resolvedBaseSha]);

      const baseServer = await createServer({
        configFile: false,
        root: resolve(tmpWorktree, 'app'),
        logLevel: 'warn',
        server: { middlewareMode: true },
        optimizeDeps: { noDiscovery: true },
        appType: 'custom',
      });

      try {
        const { runAllScenarios } = await baseServer.ssrLoadModule('/src/engine/simulation/analyze.ts');
        baseReport = await runAllScenarios(undefined, resolvedBaseSha);
      } finally {
        await baseServer.close();
      }

      // Persist base report
      const baseOutDir = resolve('artifacts/simulation-reports/base');
      if (!existsSync(baseOutDir)) mkdirSync(baseOutDir, { recursive: true });
      writeFileSync(resolve(baseOutDir, 'report.json'), `${JSON.stringify(baseReport, null, 2)}\n`);
    } catch (err) {
      console.warn(`Could not generate simulation artifact for base ref ${resolvedBaseSha}: ${err.message}`);
      baseReport = null;
    } finally {
      if (tmpWorktree) {
        try {
          git(['worktree', 'remove', '--force', tmpWorktree]);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
}

// Compute diffs
let prDiff = null;
let baselineDrift = null;

if (baseReport) {
  const normBase = normalizeSimulationReport(baseReport);
  const normCurrent = normalizeSimulationReport(current);
  const normBaseline = normalizeSimulationReport(baseline);

  prDiff = diffSimulationReports(normBase, normCurrent);
  baselineDrift = diffSimulationReports(normBaseline, normBase);
} else {
  const normCurrent = normalizeSimulationReport(current);
  const normBaseline = normalizeSimulationReport(baseline);
  baselineDrift = diffSimulationReports(normBaseline, normCurrent);
}

// Provenance
const headSha = safeGitCommit('HEAD');
const provenance = {
  baseSha: resolvedBaseSha,
  prHeadSha: prHeadArg || (resolvedBaseSha ? headSha : null),
  mergeSha: mergeArg || headSha,
  baselineIdentity: computeBaselineHash(baselineContent),
  policyVersion,
  scenarioCount: current.scenarios ? current.scenarios.length : 0,
  corpusHash: current.scenarios ? computeCorpusHash(current.scenarios) : null,
};

const output = formatSimulationDiffReport({
  prDiff,
  baselineDrift,
  provenance,
});

console.log(output);

// Save diff report artifact
try {
  const diffArtifactDir = resolve('artifacts/simulation-reports');
  if (!existsSync(diffArtifactDir)) mkdirSync(diffArtifactDir, { recursive: true });
  writeFileSync(resolve(diffArtifactDir, 'simulation-diff.txt'), output);
} catch {
  // ignore artifact write failure
}
