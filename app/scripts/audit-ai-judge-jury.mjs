import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildReferenceAudit,
  loadSelfTestSummary,
  renderReferenceAuditMarkdown,
} from './ai-judge/juryAudit.mjs';
import { atomicWriteFile, atomicWriteJson } from './ai-judge/telemetry.mjs';

function repeatedArgs(argv, name) {
  const values = [];
  const flag = `--${name}`;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${flag} requires a path.`);
      values.push(argv[index + 1]);
      index += 1;
    } else if (argv[index].startsWith(`${flag}=`)) {
      values.push(argv[index].slice(flag.length + 1));
    }
  }
  return values;
}

const argv = process.argv.slice(2);
const runPaths = repeatedArgs(argv, 'run');
if (runPaths.length < 2) {
  console.error('Usage: node scripts/audit-ai-judge-jury.mjs --run <summary-or-directory> --run <summary-or-directory> [--run ...]');
  process.exit(2);
}

const loadedRuns = runPaths.map(loadSelfTestSummary);
const audit = buildReferenceAudit(loadedRuns);
const outputDir = resolve('artifacts/ai-plan-judge/reference-audit/latest');
mkdirSync(outputDir, { recursive: true });
const jsonPath = resolve(outputDir, 'reference-audit.json');
const markdownPath = resolve(outputDir, 'reference-audit.md');
atomicWriteJson(jsonPath, audit);
atomicWriteFile(markdownPath, renderReferenceAuditMarkdown(audit));
console.log(`Compared ${audit.runs.length} compatible evaluator runs.`);
console.log(`Reference audit: ${markdownPath}`);
