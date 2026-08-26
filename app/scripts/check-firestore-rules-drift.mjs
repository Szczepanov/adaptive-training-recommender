import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
export const appDirectory = path.resolve(scriptsDirectory, '..');
export const firestoreRulesPath = path.join(appDirectory, 'firestore.rules');

function valueForOption(args, option) {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

export function projectFromArgs(args = process.argv.slice(2)) {
  const project = valueForOption(args, '--project');
  if (!project || project.startsWith('--')) {
    throw new Error('Pass an explicit Firebase project with --project <project-id>.');
  }
  return project;
}

function accessToken() {
  const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  try {
    return execFileSync(
      gcloud,
      ['auth', 'application-default', 'print-access-token'],
      {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch {
    throw new Error(
      'Application Default Credentials are required. Run "gcloud auth application-default login" locally, then retry.',
    );
  }
}

async function rulesApiRequest(resourceName, token, options = {}) {
  const response = await fetch(
    `https://firebaserules.googleapis.com/v1/${resourceName}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firebase Rules API ${response.status}: ${body}`);
  }

  return response.json();
}

export function sha256(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export async function inspectDeployedFirestoreRules(project) {
  const token = accessToken();
  const release = await rulesApiRequest(
    `projects/${encodeURIComponent(project)}/releases/cloud.firestore`,
    token,
  );
  const ruleset = await rulesApiRequest(release.rulesetName, token);
  const files = ruleset.source?.files ?? [];
  const firestoreFile = files.find((file) => file.name === 'firestore.rules') ?? files[0];

  if (!firestoreFile?.content) {
    throw new Error(`The deployed ruleset ${release.rulesetName} does not contain readable source.`);
  }

  return {
    releaseName: release.name,
    rulesetName: release.rulesetName,
    source: firestoreFile.content,
  };
}

export function normalizeRulesSource(source) {
  return typeof source === 'string' ? source.replace(/\r\n/g, '\n') : '';
}

export async function compareLocalFirestoreRules(project) {
  const [localSourceRaw, deployed] = await Promise.all([
    readFile(firestoreRulesPath, 'utf8'),
    inspectDeployedFirestoreRules(project),
  ]);

  const localSource = normalizeRulesSource(localSourceRaw);
  const deployedSource = normalizeRulesSource(deployed.source);

  return {
    ...deployed,
    localHash: sha256(localSource),
    deployedHash: sha256(deployedSource),
    matches: localSource === deployedSource,
  };
}

export function printComparison(comparison) {
  console.log(`Release: ${comparison.releaseName}`);
  console.log(`Ruleset: ${comparison.rulesetName}`);
  console.log(`Local SHA-256: ${comparison.localHash}`);
  console.log(`Deployed SHA-256: ${comparison.deployedHash}`);
  console.log(comparison.matches ? 'Status: deployed rules match app/firestore.rules.' : 'Status: DRIFT DETECTED.');
}

async function main() {
  const args = process.argv.slice(2);
  const comparison = await compareLocalFirestoreRules(projectFromArgs(args));
  printComparison(comparison);

  if (!comparison.matches && !args.includes('--allow-drift')) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
