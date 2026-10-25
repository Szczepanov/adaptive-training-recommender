import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Every case builds a throwaway git repository and runs the REAL drift-check script in it.
const script = fileURLToPath(new URL('./check-policy-drift.mjs', import.meta.url));

// Git hooks export GIT_DIR/GIT_WORK_TREE and friends; inherited by the temp-repo commands they
// would act on the real repository (a previous test corrupted the shared .git/config that way).
// GITHUB_EVENT_NAME would switch the script to its pull-request merge-parent mode.
const isolatedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    !key.toUpperCase().startsWith('GIT_') && key.toUpperCase() !== 'GITHUB_EVENT_NAME'),
);

const OLD = 'app/src/engine/subjectiveBaseline.ts';
const NEW = 'app/src/derived/baselines/subjectiveBaseline.ts';
const DECOY = 'app/src/derived/baselines/decoy.ts';
const ADR10 = 'docs/adr/0010-decision-provenance-and-audit-replay.md';
const LIST = 'app/scripts/decision-affecting-files.json';

const decisionList = (files, relocations = []) => JSON.stringify({
  description: 'test fixture',
  files: files.map((path) => ({ path })),
  prefixes: [{ path: 'app/src/workouts/catalog/' }],
  relocations,
}, null, 2);

const BASE_FILES = {
  'app/src/engine/policy.ts': "export const POLICY_VERSION = 'v1';\n",
  [LIST]: decisionList(['app/src/engine/rules.ts', 'app/src/engine/optimizer.ts', OLD]),
  [ADR10]: '# ADR-0010\n\nA behaviour-identical relocation does **not** bump `POLICY_VERSION`.\n',
  'app/src/engine/models.ts': 'export interface Baseline { value: number }\n',
  [OLD]: [
    "import type { Baseline } from './models';",
    'export const BASELINE_WINDOW = 28;',
    'export function baseline(v: number): Baseline { return { value: v / BASELINE_WINDOW }; }',
    '',
  ].join('\n'),
  'app/src/engine/rules.ts': [
    "import { baseline } from './subjectiveBaseline';",
    'export const rule = (v: number) => baseline(v).value > 0.4;',
    '',
  ].join('\n'),
  'app/src/engine/optimizer.ts': 'export const WEIGHT = 0.4;\n',
  [DECOY]: 'export function baseline(v: number) { return { value: v }; }\n',
};

const directories = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function git(repo, ...args) {
  return execFileSync('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.autocrlf=false', '-c', `core.hooksPath=${join(repo, '.no-hooks')}`, ...args,
  ], { cwd: repo, env: isolatedEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(repo, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(repo, path);
    if (content === null) {
      rmSync(target);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function commit(repo, files = {}) {
  write(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'change');
  return git(repo, 'rev-parse', 'HEAD');
}

/** A fresh repo holding BASE_FILES; returns its path and the base commit. */
function baseRepo(extra = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'policy-drift-'));
  directories.push(repo);
  git(repo, '-c', 'init.defaultBranch=main', 'init', '-q');
  // `extra` adds or replaces base files; a null value leaves that file out of the base.
  const files = Object.fromEntries(
    Object.entries({ ...BASE_FILES, ...extra }).filter(([, content]) => content !== null),
  );
  return { repo, base: commit(repo, files) };
}

function runDrift(repo, base) {
  const result = spawnSync(process.execPath, [script, base], { cwd: repo, env: isolatedEnv, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/**
 * Apply the canonical subjectiveBaseline relocation with `git mv`: the moved file's sibling
 * import is adjusted, rules.ts is repointed, and the JSON lists the new path plus a relocation
 * entry. Overrides replace any of those pieces to build the rejecting variants.
 */
function relocate(repo, overrides = {}, oldContent = BASE_FILES[OLD]) {
  mkdirSync(join(repo, dirname(NEW)), { recursive: true });
  git(repo, 'mv', OLD, NEW);
  const moved = oldContent.replace("'./models'", "'../../engine/models'");
  return commit(repo, {
    [NEW]: moved,
    'app/src/engine/rules.ts': BASE_FILES['app/src/engine/rules.ts']
      .replace("'./subjectiveBaseline'", "'../derived/baselines/subjectiveBaseline'"),
    [LIST]: decisionList(
      ['app/src/engine/rules.ts', 'app/src/engine/optimizer.ts', NEW],
      [{ from: OLD, to: NEW, reason: 'ADR-0052 Phase 1' }],
    ),
    ...overrides,
  });
}

describe('check-policy-drift ordinary changes', () => {
  it('fails a literal edit to a listed file without a POLICY_VERSION bump', () => {
    const { repo, base } = baseRepo();
    commit(repo, { 'app/src/engine/optimizer.ts': 'export const WEIGHT = 0.5;\n' });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain('POLICY DRIFT ERROR');
    expect(output).toContain('app/src/engine/optimizer.ts');
  });

  it('passes the same edit with a POLICY_VERSION bump', () => {
    const { repo, base } = baseRepo();
    commit(repo, {
      'app/src/engine/optimizer.ts': 'export const WEIGHT = 0.5;\n',
      'app/src/engine/policy.ts': "export const POLICY_VERSION = 'v2';\n",
    });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(0);
    expect(output).toContain('POLICY_VERSION changed from v1 to v2');
  });

  it('keeps passing a comment-only edit', () => {
    const { repo, base } = baseRepo();
    commit(repo, { 'app/src/engine/optimizer.ts': '// Tuned weight.\nexport const WEIGHT = 0.4; // same\n' });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(0);
    expect(output).toContain('changed only in comments/whitespace');
  });
});

describe('check-policy-drift rename and delisting blind spots', () => {
  it('fails a git mv of a listed file whose list entry was not updated', () => {
    const { repo, base } = baseRepo();
    mkdirSync(join(repo, dirname(NEW)), { recursive: true });
    git(repo, 'mv', OLD, NEW);
    commit(repo);
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain(`  - ${OLD}`);
  });

  it('fails deleting a listed file and delisting it in the same change', () => {
    const { repo, base } = baseRepo();
    commit(repo, {
      [OLD]: null,
      [LIST]: decisionList(['app/src/engine/rules.ts', 'app/src/engine/optimizer.ts']),
    });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain(`  - ${OLD}`);
  });
});

describe('check-policy-drift behaviour-identical relocation exception', () => {
  it('passes a pure relocation with the list, relocation entry and importer updated', () => {
    const { repo, base } = baseRepo();
    relocate(repo);
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(0);
    expect(output).toContain('decision-affecting files were only relocated');
  });

  it('passes when the moved file\'s sibling import is re-spelled with a .ts extension', () => {
    const { repo, base } = baseRepo();
    relocate(repo, { [NEW]: BASE_FILES[OLD].replace("'./models'", "'../../engine/models.ts'") });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(0);
    expect(output).toContain('decision-affecting files were only relocated');
  });

  it('fails when the moved file\'s sibling import is left unadjusted', () => {
    const { repo, base } = baseRepo();
    relocate(repo, { [NEW]: BASE_FILES[OLD] });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain(`unresolvable relative specifier './models' in ${NEW}`);
  });

  it('fails a relocation that also changes one literal in the moved file', () => {
    const { repo, base } = baseRepo();
    relocate(repo, {
      [NEW]: BASE_FILES[OLD].replace("'./models'", "'../../engine/models'").replace('= 28', '= 29'),
    });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain(`${NEW} differs from ${OLD}`);
  });

  it('fails when the importer is repointed at a different existing module', () => {
    const { repo, base } = baseRepo();
    relocate(repo, {
      'app/src/engine/rules.ts': BASE_FILES['app/src/engine/rules.ts']
        .replace("'./subjectiveBaseline'", "'../derived/baselines/decoy'"),
    });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain('app/src/engine/rules.ts changed beyond import-specifier normalisation');
  });

  it('fails a relocation that delists the moved decision file', () => {
    const { repo, base } = baseRepo();
    relocate(repo, {
      [LIST]: decisionList(
        ['app/src/engine/rules.ts', 'app/src/engine/optimizer.ts'],
        [{ from: OLD, to: NEW, reason: 'ADR-0052 Phase 1' }],
      ),
    });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain(`${NEW} is not on the head decision list`);
  });

  it('fails a relocation alongside an added unrelated production file', () => {
    const { repo, base } = baseRepo();
    relocate(repo, { 'app/src/engine/newThing.ts': 'export const NEW_THING = 1;\n' });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain('app/src/engine/newThing.ts was added or deleted outside a relocation entry');
  });

  it('ignores a stale relocation entry, so an ordinary listed edit still fails', () => {
    const { repo, base } = baseRepo();
    commit(repo, {
      'app/src/engine/optimizer.ts': 'export const WEIGHT = 0.5;\n',
      [LIST]: decisionList(
        ['app/src/engine/rules.ts', 'app/src/engine/optimizer.ts', OLD],
        [{ from: 'app/src/engine/alreadyMoved.ts', to: DECOY, reason: 'landed earlier' }],
      ),
    });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain('  - app/src/engine/optimizer.ts');
    // No active entry means the exception is silently not applicable, not a noisy rejection.
    expect(output).not.toContain('relocation exception rejected');
  });

  it('fails a relocation when ADR-0010 no longer states the no-bump rule', () => {
    const { repo, base } = baseRepo();
    relocate(repo, { [ADR10]: '# ADR-0010\n' });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(1);
    expect(output).toContain('no longer states the no-bump rule');
    expect(readFileSync(join(repo, ADR10), 'utf8')).not.toContain('relocation');
  });
});

const relocationEntry = [{ from: OLD, to: NEW, reason: 'ADR-0052 Phase 1' }];
const headFiles = ['app/src/engine/rules.ts', 'app/src/engine/optimizer.ts', NEW];

/** Run one relocation against a base with `extra` files and expect a rejection naming `reason`. */
function expectRelocationRejected({ extra = {}, overrides = {}, oldContent, reason }) {
  const { repo, base } = baseRepo(oldContent === undefined ? extra : { ...extra, [OLD]: oldContent });
  relocate(repo, overrides, oldContent);
  const { status, output } = runDrift(repo, base);
  expect(status).toBe(1);
  expect(output).toContain('relocation exception rejected');
  expect(output).toContain(reason);
}

describe('check-policy-drift relocation endpoint ambiguity', () => {
  it('fails when the new path could capture an unchanged importer of an existing directory index', () => {
    expectRelocationRejected({
      extra: {
        'app/src/derived/baselines/subjectiveBaseline/index.ts': 'export const X = 1;\n',
        'app/src/engine/optimizer.ts':
          "import { X } from '../derived/baselines/subjectiveBaseline';\nexport const WEIGHT = 0.4 + X;\n",
      },
      reason: `${NEW} could capture an unchanged importer of app/src/derived/baselines/subjectiveBaseline/index.ts`,
    });
  });

  it('fails when the new .ts path sits next to a pre-existing .tsx spelling', () => {
    expectRelocationRejected({
      extra: { 'app/src/derived/baselines/subjectiveBaseline.tsx': 'export const X = 1;\n' },
      reason: `${NEW} could capture an unchanged importer of app/src/derived/baselines/subjectiveBaseline.tsx`,
    });
  });

  it('fails when the new path sits next to a folder with no index file', () => {
    expectRelocationRejected({
      extra: { 'app/src/derived/baselines/subjectiveBaseline/package.json': '{ "main": "impl.ts" }\n' },
      reason: `${NEW} could capture an unchanged importer of app/src/derived/baselines/subjectiveBaseline/`,
    });
  });

  it('fails when another spelling of the old path remains at head', () => {
    expectRelocationRejected({
      extra: { 'app/src/engine/subjectiveBaseline.js': 'export const X = 1;\n' },
      reason: `an unchanged importer of ${OLD} could resolve to app/src/engine/subjectiveBaseline.js`,
    });
  });
});

describe('check-policy-drift relocation entry shape', () => {
  it('fails duplicate relocation endpoints', () => {
    expectRelocationRejected({
      overrides: { [LIST]: decisionList(headFiles, [...relocationEntry, { from: OLD, to: DECOY }]) },
      reason: 'two relocation entries share a `from` or a `to`',
    });
  });

  it('fails a malformed relocations value', () => {
    expectRelocationRejected({
      overrides: { [LIST]: decisionList(headFiles, {}) },
      reason: '`relocations` must be an array',
    });
  });

  it('fails when the old path still exists at head', () => {
    expectRelocationRejected({
      overrides: { [OLD]: BASE_FILES[OLD] },
      reason: `${OLD} still exists at head`,
    });
  });

  it('fails when the new path already exists at the base', () => {
    expectRelocationRejected({
      overrides: { [LIST]: decisionList(headFiles, [{ from: OLD, to: DECOY }]) },
      reason: `${DECOY} already exists at the comparison base`,
    });
  });

  it('fails when the base has no readable decision list', () => {
    expectRelocationRejected({
      extra: { [LIST]: null },
      reason: 'the comparison base has no readable decision list',
    });
  });
});

describe('check-policy-drift relocation specifier normalisation', () => {
  const barrel = 'app/src/engine/barrel.ts';
  const barrelSource = [
    "import './subjectiveBaseline';",
    "export * from './subjectiveBaseline';",
    "import type * as Sb from './subjectiveBaseline';",
    'export type Window = typeof Sb.BASELINE_WINDOW;',
    "export type Loaded = typeof import('./subjectiveBaseline');",
    "export const load = () => import('./subjectiveBaseline');",
    "declare module './subjectiveBaseline' { interface Augmented { extra: number } }",
    '',
  ].join('\n');
  const repointedBarrel = barrelSource
    .replaceAll("'./subjectiveBaseline'", "'../derived/baselines/subjectiveBaseline'");

  it('passes export *, side-effect, import type, import() type and dynamic import() repointed correctly', () => {
    const { repo, base } = baseRepo({ [barrel]: barrelSource });
    relocate(repo, { [barrel]: repointedBarrel });
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(0);
    expect(output).toContain('decision-affecting files were only relocated');
  });

  it('fails when one of those specifiers is repointed at a different module', () => {
    expectRelocationRejected({
      extra: { [barrel]: barrelSource },
      overrides: {
        [barrel]: repointedBarrel.replace(
          "() => import('../derived/baselines/subjectiveBaseline')", "() => import('../derived/baselines/decoy')",
        ),
      },
      reason: `${barrel} changed beyond import-specifier normalisation`,
    });
  });

  it('fails a moved file with a non-literal import()', () => {
    expectRelocationRejected({
      oldContent: `${BASE_FILES[OLD]}export const lazy = (p: string) => import(p);\n`,
      reason: 'non-literal import()/require()',
    });
  });

  it('fails a moved file that uses import.meta.url', () => {
    expectRelocationRejected({
      oldContent: `${BASE_FILES[OLD]}export const here = import.meta.url;\n`,
      reason: 'file-relative import.meta.url',
    });
  });

  it('fails a moved file that uses import.meta.resolve', () => {
    expectRelocationRejected({
      oldContent: `${BASE_FILES[OLD]}export const data = import.meta.resolve('./data.json');\n`,
      reason: 'file-relative import.meta.resolve',
    });
  });

  it('fails a moved file that reads import.meta indirectly', () => {
    expectRelocationRejected({
      oldContent: `${BASE_FILES[OLD]}export const meta = import.meta;\n`,
      reason: 'file-relative import.meta in',
    });
  });

  it('fails a moved file that builds a new URL(...)', () => {
    expectRelocationRejected({
      oldContent: `${BASE_FILES[OLD]}export const asset = new URL('./a.png', 'file:///');\n`,
      reason: 'file-relative new URL(...)',
    });
  });

  it('still passes a moved file that reads import.meta.env', () => {
    const oldContent = `${BASE_FILES[OLD]}export const mode = import.meta.env.MODE;\n`;
    const { repo, base } = baseRepo({ [OLD]: oldContent });
    relocate(repo, {}, oldContent);
    const { status, output } = runDrift(repo, base);
    expect(status).toBe(0);
    expect(output).toContain('decision-affecting files were only relocated');
  });
});
