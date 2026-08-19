import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

let diffOutput = '';
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
];

const policyFile = 'app/src/engine/policy.ts';
const rulesFile = 'app/src/engine/rules.ts';
const subjectiveBaselineFile = 'app/src/engine/subjectiveBaseline.ts';
const adr20File = 'docs/adr/0020-subjective-baselines-in-readiness-mode.md';
const completedTrainingFile = 'app/src/engine/completedTraining.ts';
const garminTelemetryEvidenceFile = 'app/src/engine/garminTelemetryEvidence.ts';
const adr22File = 'docs/adr/0022-zone-derived-completed-training-credit.md';
const repoRoot = git(['rev-parse', '--show-toplevel']).trim();

const changedDecisionFiles = changedFiles.filter((f) => decisionAffectingFiles.includes(f));

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

if (changedDecisionFiles.length > 0 && !policyVersionChanged) {
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
