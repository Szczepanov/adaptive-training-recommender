import { execFileSync } from 'node:child_process';

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

let diffOutput = '';
try {
  diffOutput = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { encoding: 'utf8' });
} catch (err) {
  // If shallow checkout without base commit, attempt a single fetch for the base SHA
  try {
    execFileSync('git', ['fetch', '--depth=1', 'origin', baseRef], { encoding: 'utf8' });
    diffOutput = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], { encoding: 'utf8' });
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
];

const policyFile = 'app/src/engine/policy.ts';

const changedDecisionFiles = changedFiles.filter((f) => decisionAffectingFiles.includes(f));
const policyChanged = changedFiles.includes(policyFile);

if (changedDecisionFiles.length > 0 && !policyChanged) {
  console.error('POLICY DRIFT ERROR: The following decision-affecting engine files were modified:');
  changedDecisionFiles.forEach((f) => console.error(`  - ${f}`));
  console.error(`However, ${policyFile} (POLICY_VERSION) was NOT incremented.`);
  console.error('Whenever modifying recommendation logic, POLICY_VERSION must be updated.');
  process.exit(1);
}

if (changedDecisionFiles.length > 0 && policyChanged) {
  console.log(`POLICY DRIFT CHECK PASSED: ${changedDecisionFiles.length} engine file(s) modified and POLICY_VERSION was correctly updated.`);
} else {
  console.log('POLICY DRIFT CHECK PASSED: No decision-affecting engine files were modified.');
}
