import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const baseRef = process.argv[2];

if (!baseRef) {
  console.log('No base ref supplied to check-policy-drift.mjs. Skipping policy drift check.');
  process.exit(0);
}

// Ignore zero-hash (initial commit or empty ref)
if (baseRef === '0000000000000000000000000000000000000000') {
  console.log('Base ref is empty zero-hash. Skipping policy drift check.');
  process.exit(0);
}

// npm invokes this script from app/, while CI/manual callers may invoke it from the repo
// root. Resolve the repository once, then pin every Git command there so pathspecs such as
// app/src mean the same thing regardless of the caller's working directory.
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: repoRoot });
}

function gitGrepFiles(pattern, paths = ['app/src']) {
  try {
    return git(['grep', '-El', pattern, '--', ...paths]).trim().split('\n').filter(Boolean);
  } catch (err) {
    // git grep exits 1 when the pattern has no matches; that is a valid empty result.
    if (err.status === 1) return [];
    throw err;
  }
}

/**
 * pull_request workflows normally check out GitHub's synthetic merge commit. The event's
 * base.sha can become stale if main advances between the event payload and checkout; diffing
 * that old SHA to HEAD then falsely attributes unrelated new-main files to the PR. On PR
 * runs, compare the current base parent to the merged tree itself. This captures exactly the
 * PR contribution *after* GitHub has merged it with current main, including any automatic
 * merge resolution. Push/manual runs retain the explicit baseRef behaviour below.
 */
function pullRequestMergeDiff() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') return null;
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length !== 3) return null;
    const [, currentBaseParent] = parents;
    return git(['diff', '--name-only', currentBaseParent, 'HEAD']);
  } catch (err) {
    console.warn(`Could not isolate pull-request merge parents; falling back to base ref: ${err.message}`);
    return null;
  }
}

let diffOutput = pullRequestMergeDiff() ?? '';
if (!diffOutput) {
  try {
    diffOutput = git(['diff', '--name-only', `${baseRef}...HEAD`]);
  } catch (err) {
    // If shallow checkout without base commit, attempt a single fetch for the base SHA.
    try {
      git(['fetch', '--depth=1', 'origin', baseRef]);
      diffOutput = git(['diff', '--name-only', `${baseRef}...HEAD`]);
    } catch (fetchErr) {
      console.warn(`Could not diff against base ref ${baseRef}: ${fetchErr.message}`);
      process.exit(0);
    }
  }
}

const changedFiles = diffOutput.trim().split('\n').filter(Boolean);

const decisionAffectingFiles = [
  'app/src/engine/rules.ts',
  'app/src/engine/optimizer.ts',
  'app/src/engine/microcycle.ts',
  'app/src/engine/periodization.ts',
  'app/src/engine/fatigue.ts',
  'app/src/engine/planner.ts',
  'app/src/engine/dose.ts',
  // Completed evidence changes future objective state and fatigue replay. A selectable
  // estimator here is policy even though it sits upstream of the ranking modules.
  'app/src/engine/completedTraining.ts',
  'app/src/engine/garminTelemetryEvidence.ts',
  // adapters.ts maps the persisted check-in/goals/settings into the engine's SubjectiveInput
  // and UserContext -- painFlag, restrictedModalities and clinicalFlagActive all derive from
  // it before rules.ts ever runs, so a change here can alter a persisted decision exactly as
  // a change to rules.ts does, even though it sits upstream of the ranking modules.
  'app/src/engine/adapters.ts',
  // Structured injury composition creates hard modality/category/guardrail restrictions before
  // `rules.ts` evaluates the shared safety envelope. Guard it beside the adapter so an injury
  // mapping change cannot silently retain an old persisted policy identity.
  'app/src/engine/injuryPolicy.ts',
  // ADR-0019: adjudication decides what an externally-planned athlete is told to do, so a
  // change here alters a persisted decision exactly as a change to rules.ts does. The
  // profile derivation is included because the cost it produces feeds the ceilings.
  'app/src/engine/externalSession.ts',
  'app/src/engine/externalSessionProfiles.ts',
  // ADR-0020: once subjective drift is enabled, the baseline estimator is part of the
  // deciding function even though it lives outside rules.ts. Keep it guarded now so a
  // later estimator change cannot silently retain an old live policy identity.
  'app/src/engine/subjectiveBaseline.ts',
  // ADR-0023: authored session replacement and addition gates directly alter live recommendations.
  'app/src/engine/authoredSessionGates.ts',
  // PR #292/#295: the evergreen requirement/packing/coverage pipeline decides which
  // adaptations are required vs droppable and which concrete workouts satisfy them --
  // that is exactly a persisted-decision policy, even though it sits outside rules.ts.
  // Findings 4 and 8 both changed live recommendations by editing only these files, and
  // the drift gate did not previously notice because none of them were listed here.
  'app/src/engine/evergreenStrategy.ts',
  'app/src/engine/weeklyDosePacking.ts',
  'app/src/engine/coverage.ts',
  'app/src/engine/evergreenPlanning.ts',
  'app/src/engine/planSchedule.ts',
  // trainingIntent.ts/trainingHistorySnapshot.ts decide which history window feeds
  // athlete-state inference and fatigue/objective bookkeeping -- the established-history
  // fix changed live recommendations here without ever touching rules.ts.
  'app/src/engine/trainingIntent.ts',
  'app/src/engine/trainingHistorySnapshot.ts',
  // The legacy template catalog and the coverage-role-to-workout mapping decide which
  // concrete sessions can satisfy a required adaptation at all (the Walking and Running
  // coverage-floor fixes both lived here).
  'app/src/engine/templates.ts',
  'app/src/workouts/event-plan.ts',
  'app/src/workouts/prescription.ts',
];

const policyFile = 'app/src/engine/policy.ts';
const rulesFile = 'app/src/engine/rules.ts';
const adaptersFile = 'app/src/engine/adapters.ts';
const injuryPolicyFile = 'app/src/engine/injuryPolicy.ts';
const injuryLineageEquivalenceTestFile = 'app/src/engine/injuryPolicyLineageEquivalence.test.ts';
const injuryLineageAnalysisFile = 'docs/analysis/2026-09-01-evidence-pack-injury-pain.md';
const subjectiveBaselineFile = 'app/src/engine/subjectiveBaseline.ts';
const adr20File = 'docs/adr/0020-subjective-baselines-in-readiness-mode.md';
const completedTrainingFile = 'app/src/engine/completedTraining.ts';
const garminTelemetryEvidenceFile = 'app/src/engine/garminTelemetryEvidence.ts';
const adr22File = 'docs/adr/0022-zone-derived-completed-training-credit.md';
const sleepRecoveryEvidenceFile = 'app/src/engine/sleepRecoveryEvidence.ts';
const sleepRecoveryEvidenceTestFile = 'app/src/engine/sleepRecoveryEvidence.test.ts';
const sleepRecoveryPhase3Doc = 'docs/analysis/2026-08-29-sleep-decision-authority-phase-3-implementation.md';

const changedDecisionFiles = changedFiles.filter((f) => decisionAffectingFiles.includes(f));

/** Return the exact base commit whose tree should be compared with HEAD for this run. */
function executableComparisonBaseRef() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') return baseRef;
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length === 3) return parents[1];
  } catch (err) {
    console.warn(`Could not isolate pull-request base parent for syntax comparison: ${err.message}`);
  }
  return baseRef;
}

/** True only when a path exists in the selected comparison-base tree. */
function pathExistsAtRef(ref, path) {
  return git(['ls-tree', '--name-only', ref, '--', path]).trim() === path;
}

/**
 * Normalize TypeScript syntax while removing comments. The printer preserves identifiers,
 * literals, operators, types and statement structure, so a genuine source change cannot be
 * hidden as a comment-only edit; whitespace and comments are intentionally erased.
 */
function executableSyntaxSignature(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new Error(`TypeScript parse diagnostics: ${diagnostics.map(d => d.code).join(', ')}`);
  }
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return printer.printFile(sourceFile);
}

/** Return true only when every changed decision file is syntax-identical without comments. */
function isCommentOrWhitespaceOnlyDecisionChange() {
  if (changedDecisionFiles.length === 0) return false;
  const comparisonBase = executableComparisonBaseRef();
  return changedDecisionFiles.every((file) => {
    try {
      const baseSource = git(['show', `${comparisonBase}:${file}`]);
      const currentSource = readFileSync(join(repoRoot, file), 'utf8');
      return executableSyntaxSignature(baseSource, file) === executableSyntaxSignature(currentSource, file);
    } catch (err) {
      console.warn(`Could not prove comment-only policy change for ${file}: ${err.message}`);
      return false;
    }
  });
}

function extractPolicyVersion(source, label) {
  const match = source.match(/export const POLICY_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    console.error(`POLICY DRIFT ERROR: Could not read POLICY_VERSION from ${label}.`);
    process.exit(1);
  }
  return match[1];
}

let basePolicySource = '';
try {
  basePolicySource = git(['show', `${baseRef}:${policyFile}`]);
} catch (err) {
  console.error(`POLICY DRIFT ERROR: Could not read ${policyFile} from base ref ${baseRef}: ${err.message}`);
  process.exit(1);
}

const currentPolicySource = readFileSync(join(repoRoot, policyFile), 'utf8');
const basePolicyVersion = extractPolicyVersion(basePolicySource, `${baseRef}:${policyFile}`);
const currentPolicyVersion = extractPolicyVersion(currentPolicySource, policyFile);
const policyVersionChanged = basePolicyVersion !== currentPolicyVersion;

// Phase 9.7: compact, normalized subjective-drift telemetry/audit/replay scaffolding.
// None of these can change what mode a real decision selects -- they only add optional
// evidence fields gated behind the same 'off' default rules.ts already carries -- so a
// change limited to this set (alongside rules.ts/subjectiveBaseline.ts) stays inside the
// dormant exception below rather than forcing a version bump for evidence-only additions.
const subjectiveDriftEvidenceFiles = new Set([
  rulesFile,
  subjectiveBaselineFile,
  'app/src/engine/models.ts',
  'app/src/engine/provenance.ts',
  'app/src/engine/subjectiveDriftAudit.ts',
  'app/src/engine/replay.ts',
]);

/**
 * ADR-0020 explicitly requires a default-off implementation to keep the existing policy
 * identity because it cannot affect a persisted recommendation. This exception is narrow
 * and mechanical: changed decision files must be limited to the subjective-drift rules /
 * baseline implementation, no other production source may change except the named
 * evidence-only files in `subjectiveDriftEvidenceFiles` above, the evaluator must still
 * default the selector to 'off', and ADR-0020 must remain Accepted with its no-bump rule.
 * Any other production call-site change therefore falls back to the normal version-bump rule.
 */
function isAcceptedDormantSubjectiveDriftChange() {
  const dormantDecisionFiles = new Set([rulesFile, subjectiveBaselineFile]);
  if (changedDecisionFiles.length === 0 || !changedDecisionFiles.every((file) => dormantDecisionFiles.has(file))) {
    return false;
  }

  const changedProductionSources = changedFiles.filter((file) =>
    file.startsWith('app/src/')
    && !subjectiveDriftEvidenceFiles.has(file)
    && !file.endsWith('.test.ts')
    && !file.includes('/simulation/')
  );
  if (changedProductionSources.length > 0) return false;

  const rulesSource = readFileSync(join(repoRoot, rulesFile), 'utf8');
  const defaultsOff = /subjectiveDriftPolicy:\s*SubjectiveDriftPolicy\s*=\s*['"]off['"]/.test(rulesSource);
  if (!defaultsOff) return false;

  const adr20 = readFileSync(join(repoRoot, adr20File), 'utf8');
  const accepted = /\*\*Status:\*\*\s*Accepted/.test(adr20);
  const explicitlyNoBump = /default-off implementation does \*\*not\*\* bump `POLICY_VERSION`/.test(adr20);
  return accepted && explicitlyNoBump;
}

/** ADR-0022 uses the same policy identity rule as ADR-0020: a candidate that no
 * production caller can select must retain the current live policy version. The grep is
 * deliberately mechanical; adding the candidate literal to any other app source makes
 * this exception fail and requires the normal version bump. */
function isAcceptedDormantGarminZoneCreditChange() {
  const dormantDecisionFiles = new Set([completedTrainingFile, garminTelemetryEvidenceFile]);
  if (changedDecisionFiles.length === 0 || !changedDecisionFiles.every((file) => dormantDecisionFiles.has(file))) {
    return false;
  }

  const completedTrainingSource = readFileSync(join(repoRoot, completedTrainingFile), 'utf8');
  const defaultsToTrainingEffect = /garminStimulusPolicy\s*=\s*options\.garminStimulusPolicy\s*\?\?\s*['"]training_effect['"]/.test(completedTrainingSource);
  if (!defaultsToTrainingEffect) return false;

  let selectorReferences;
  try {
    selectorReferences = git(['grep', '-l', 'power_zones_direct_share_v1', '--', 'app/src'])
      .trim().split('\n').filter(Boolean);
  } catch (err) {
    // `git grep -l` exits 1 (throwing here) when the pattern has zero matches, which is a
    // legitimate outcome, not an error -- treat it as "no references found" rather than
    // letting a genuine no-match case crash the whole drift check.
    if (err.status === 1) {
      selectorReferences = [];
    } else {
      throw err;
    }
  }
  const allowedReferences = new Set([
    completedTrainingFile,
    garminTelemetryEvidenceFile,
    'app/src/engine/garminTelemetryComparison.ts',
    'app/src/engine/garminTelemetryEvidence.test.ts',
  ]);
  if (selectorReferences.some(file => !allowedReferences.has(file))) return false;

  const adr22 = readFileSync(join(repoRoot, adr22File), 'utf8');
  const accepted = /\*\*Status:\*\*\s*Accepted/.test(adr22);
  const explicitlyNoBump = /default-off implementation does not bump `POLICY_VERSION`/.test(adr22);
  return accepted && explicitlyNoBump;
}

function rejectDormantSleep(reason) {
  console.warn(`Dormant sleep-evidence policy exception rejected: ${reason}`);
  return false;
}

/**
 * Phase 3 sleep recovery evidence is intentionally observation-only. adapters.ts has to
 * expose the precomputed v6 fields to DailyReadiness, but that wiring must not mint a new
 * live policy identity while no production decision path can consume it. This exception is
 * fail-closed and mechanical: only the adapter/model/evaluator production sources may be
 * involved, every sleep-evidence field reference must remain inside that small boundary,
 * and the evaluator itself may have no production caller. The implementation note also has
 * to keep the no-bump contract explicit. Any later rules/planner/fatigue consumer makes one
 * of these checks fail and restores the normal POLICY_VERSION requirement automatically.
 */
function isAcceptedDormantSleepRecoveryEvidenceChange() {
  if (changedDecisionFiles.length === 0 || !changedDecisionFiles.every((file) => file === adaptersFile)) {
    return rejectDormantSleep(`decision files were: ${changedDecisionFiles.join(', ') || '(none)'}`);
  }

  const allowedProductionSources = new Set([
    adaptersFile,
    'app/src/engine/models.ts',
    sleepRecoveryEvidenceFile,
  ]);
  const changedProductionSources = changedFiles.filter((file) =>
    file.startsWith('app/src/')
    && !allowedProductionSources.has(file)
    && !file.endsWith('.test.ts')
    && !file.includes('/simulation/')
  );
  if (changedProductionSources.length > 0) {
    return rejectDormantSleep(`unexpected production sources changed: ${changedProductionSources.join(', ')}`);
  }

  const evaluatorReferences = gitGrepFiles('evaluateSleepRecoveryEvidence');
  const allowedEvaluatorReferences = new Set([
    sleepRecoveryEvidenceFile,
    sleepRecoveryEvidenceTestFile,
  ]);
  const unexpectedEvaluatorReferences = evaluatorReferences.filter(file => !allowedEvaluatorReferences.has(file));
  if (evaluatorReferences.length === 0) return rejectDormantSleep('evaluator symbol has no repository references');
  if (unexpectedEvaluatorReferences.length > 0) {
    return rejectDormantSleep(`evaluator has unexpected references: ${unexpectedEvaluatorReferences.join(', ')}`);
  }

  const fieldReferences = gitGrepFiles(
    'sleep_duration_(delta|accumulated_)|bedtime_deviation_|wake_time_deviation_|sleep_midpoint_deviation_',
  );
  const allowedFieldReferences = new Set([
    adaptersFile,
    'app/src/engine/adapters.test.ts',
    'app/src/engine/models.ts',
    sleepRecoveryEvidenceFile,
    sleepRecoveryEvidenceTestFile,
  ]);
  const unexpectedFieldReferences = fieldReferences.filter(file => !allowedFieldReferences.has(file));
  if (fieldReferences.length === 0) return rejectDormantSleep('sleep-evidence fields have no repository references');
  if (unexpectedFieldReferences.length > 0) {
    return rejectDormantSleep(`sleep-evidence fields have unexpected references: ${unexpectedFieldReferences.join(', ')}`);
  }

  const phase3Doc = readFileSync(join(repoRoot, sleepRecoveryPhase3Doc), 'utf8');
  const explicitlyShadow = /## Genuinely shadow/.test(phase3Doc);
  const explicitlyNoBump = /`POLICY_VERSION` intentionally remains unchanged/.test(phase3Doc);
  if (!explicitlyShadow || !explicitlyNoBump) {
    return rejectDormantSleep(`implementation note contract missing (shadow=${explicitlyShadow}, no-bump=${explicitlyNoBump})`);
  }
  return true;
}

/**
 * SEP-B adds compact, runtime-only evidence lineage to the existing injury composition path.
 * This is deliberately a one-shot migration exception, not a reusable provenance label: it
 * permits only the two policy owners plus their trace carrier/registry files, requires the
 * frozen pre-SEP-B behavior oracle to be part of the change, rejects a trace consumer anywhere
 * outside the adapter -> lineage boundary, and is accepted only while the oracle and appraisal
 * files are absent from the comparison-base tree. Once SEP-B lands, any later executable change
 * to these decision owners must use the normal POLICY_VERSION path.
 */
function isAcceptedBehaviorIdenticalInjuryLineageChange() {
  const allowedDecisionFiles = new Set([adaptersFile, injuryPolicyFile]);
  if (changedDecisionFiles.length === 0 || !changedDecisionFiles.every(file => allowedDecisionFiles.has(file))) {
    return false;
  }
  if (!changedDecisionFiles.includes(adaptersFile) || !changedDecisionFiles.includes(injuryPolicyFile)) {
    return false;
  }

  const comparisonBase = executableComparisonBaseRef();
  try {
    if (pathExistsAtRef(comparisonBase, injuryLineageEquivalenceTestFile)
        || pathExistsAtRef(comparisonBase, injuryLineageAnalysisFile)) {
      return false;
    }
  } catch (err) {
    console.warn(`Could not prove SEP-B lineage artifacts are new at ${comparisonBase}: ${err.message}`);
    return false;
  }

  const allowedProductionSources = new Set([
    adaptersFile,
    injuryPolicyFile,
    'app/src/engine/models.ts',
    'app/src/engine/knowledgeLineage.ts',
    'app/src/knowledge/injuryPainKnowledge.ts',
    'app/src/knowledge/sportsKnowledgeRegistry.ts',
    'app/src/knowledge/knowledgeCoverage.ts',
  ]);
  const changedProductionSources = changedFiles.filter(file =>
    file.startsWith('app/src/')
    && !file.endsWith('.test.ts')
    && !file.includes('/simulation/')
    && !allowedProductionSources.has(file),
  );
  if (changedProductionSources.length > 0) return false;
  if (!changedFiles.includes(injuryLineageEquivalenceTestFile) || !changedFiles.includes(injuryLineageAnalysisFile)) return false;

  const traceReferences = gitGrepFiles('resolveInjuryPolicy|injuryPolicyTrace|resolveClinicalEnvelopeSources');
  const allowedTraceReferences = new Set([
    adaptersFile,
    'app/src/engine/adapters.test.ts',
    injuryPolicyFile,
    'app/src/engine/injuryPolicy.test.ts',
    injuryLineageEquivalenceTestFile,
    'app/src/engine/models.ts',
    'app/src/engine/knowledgeLineage.ts',
    'app/src/engine/knowledgeLineage.test.ts',
  ]);
  if (traceReferences.length === 0 || traceReferences.some(file => !allowedTraceReferences.has(file))) return false;

  const equivalenceTest = readFileSync(join(repoRoot, injuryLineageEquivalenceTestFile), 'utf8');
  const hasFrozenOracle = /Frozen pre-SEP-B oracle/.test(equivalenceTest)
    && /legacyResolveInjuryRestrictions/.test(equivalenceTest)
    && /legacyResolveEffectiveInjuryConstraints/.test(equivalenceTest);
  if (!hasFrozenOracle) return false;

  const analysis = readFileSync(join(repoRoot, injuryLineageAnalysisFile), 'utf8');
  return /behavior-identical/i.test(analysis)
    && /POLICY_VERSION remains unchanged/.test(analysis)
    && /Any future change to restriction thresholds/.test(analysis);
}

if (changedDecisionFiles.length > 0 && !policyVersionChanged) {
  if (isCommentOrWhitespaceOnlyDecisionChange()) {
    console.log(
      'POLICY DRIFT CHECK PASSED: decision-affecting files changed only in comments/whitespace; '
      + `normalized executable TypeScript syntax is identical and POLICY_VERSION correctly remains ${currentPolicyVersion}.`
    );
    process.exit(0);
  }
  if (isAcceptedDormantSubjectiveDriftChange()) {
    console.log(
      'POLICY DRIFT CHECK PASSED: ADR-0020 dormant subjective-drift implementation is default-off; '
      + `POLICY_VERSION correctly remains ${currentPolicyVersion}.`
    );
    process.exit(0);
  }
  if (isAcceptedDormantGarminZoneCreditChange()) {
    console.log(
      'POLICY DRIFT CHECK PASSED: ADR-0022 Garmin zone-credit candidate is default-off and has no production caller; '
      + `POLICY_VERSION correctly remains ${currentPolicyVersion}.`
    );
    process.exit(0);
  }
  if (isAcceptedDormantSleepRecoveryEvidenceChange()) {
    console.log(
      'POLICY DRIFT CHECK PASSED: Phase 3 sleep recovery evidence has no production decision caller; '
      + `POLICY_VERSION correctly remains ${currentPolicyVersion}.`
    );
    process.exit(0);
  }
  if (isAcceptedBehaviorIdenticalInjuryLineageChange()) {
    console.log(
      'POLICY DRIFT CHECK PASSED: SEP-B injury lineage is behavior-identical; '
      + `POLICY_VERSION correctly remains ${currentPolicyVersion} after the one-shot frozen-oracle contract.`
    );
    process.exit(0);
  }

  console.error('POLICY DRIFT ERROR: The following decision-affecting engine files were modified:');
  changedDecisionFiles.forEach((f) => console.error(`  - ${f}`));
  console.error(`However, POLICY_VERSION is unchanged at ${currentPolicyVersion}.`);
  console.error('Whenever live recommendation logic can change, POLICY_VERSION must be incremented.');
  process.exit(1);
}

if (changedDecisionFiles.length > 0 && policyVersionChanged) {
  console.log(
    `POLICY DRIFT CHECK PASSED: ${changedDecisionFiles.length} engine file(s) modified and `
    + `POLICY_VERSION changed from ${basePolicyVersion} to ${currentPolicyVersion}.`
  );
} else if (policyVersionChanged) {
  console.warn(
    `POLICY DRIFT WARNING: POLICY_VERSION changed from ${basePolicyVersion} to ${currentPolicyVersion}, `
    + 'but no currently-listed decision-affecting engine file changed.'
  );
} else {
  console.log('POLICY DRIFT CHECK PASSED: No decision-affecting engine files were modified.');
}
