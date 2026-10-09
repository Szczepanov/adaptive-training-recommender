import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { minifyRules } from './minify-firestore-rules.mjs';
import { buildRules, RULES_MODULES } from './build-firestore-rules.mjs';
import { normalizeRulesSource } from './check-firestore-rules-drift.mjs';
import { withMinifiedRulesConfig } from './deploy-firestore-rules.mjs';

const directories = [];
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rules-tooling-test-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Firestore rules minification and drift identity', () => {
  it('removes comments and preserves URL, regex, whitespace and escapes in strings', () => {
    const literal = String.raw`'https://host/a/*b*/  c' + "a\\b\"c//.*"`;
    expect(minifyRules(`// header\r\nreturn  ${literal}; /* trailer */`)).toBe(`return ${literal.replace(' + ', '+')};`);
  });

  it('preserves regex comment markers and escaped quotes of either kind', () => {
    const source = String.raw`value.matches('^https://host/.*$') && value == 'it\'s /*literal*/' && value != "a\"b"`;
    expect(minifyRules(source)).toContain("'^https://host/.*$'");
    expect(minifyRules(source)).toContain(String.raw`'it\'s /*literal*/'`);
    expect(minifyRules(source)).toContain(String.raw`"a\"b"`);
  });

  it('preserves token boundaries at comments and separated operators', () => {
    expect(minifyRules('foo/* comment */bar')).toBe('foo bar');
    expect(minifyRules('a & /*comment*/ & b')).not.toBe(minifyRules('a && b'));
    expect(minifyRules('a ! /*comment*/ = b')).not.toBe(minifyRules('a != b'));
    expect(minifyRules('a / /*comment*/ / b')).toBe('a/ /b');
    expect(minifyRules('1 /*comment*/ . 2')).not.toBe(minifyRules('1.2'));
    expect(minifyRules('match /{document=**}')).toContain('**');
    expect(minifyRules('/databases/$(database)/documents')).toContain('$(');
    expect(minifyRules('**')).not.toBe(minifyRules('* /*comment*/ *'));
  });

  it('keeps service names, match paths and interpolated paths compact for Rules grammar', () => {
    const source = "service cloud.firestore { match /databases/{database}/documents { allow read: if exists(/databases/$(database)/documents/users/$(request.auth.uid)); } }";
    expect(minifyRules(source)).toBe('service cloud.firestore{match/databases/{database}/documents{allow read:if exists(/databases/$(database)/documents/users/$(request.auth.uid));}}');
  });

  it('is deterministic, idempotent and insensitive to formatting around tokens', () => {
    const source = "match /users/{uid} { allow read: if request.auth!=null; }";
    const minified = minifyRules(source);
    expect(minifyRules(minified)).toBe(minified);
    expect(minifyRules(source.replaceAll(' ', '\r\n\t'))).toBe(minified);
    expect(minifyRules('a==b')).toBe(minifyRules('a == b'));
  });

  it.each(["'unterminated", '"unterminated', "'dangling\\", '/* unterminated', '*/', "'line\nbreak'", '\u0000', '@'])('rejects malformed lexical input %j', (source) => {
    expect(() => minifyRules(source)).toThrow();
  });

  it('uses identical normalization for drift and detects meaningful changes', () => {
    expect(normalizeRulesSource('// comment\nallow read: if true;')).toBe(normalizeRulesSource('allow read : if true ;'));
    for (const source of ['allow write: if true;', 'allow read: if false;', 'allow read: if "true";']) {
      expect(normalizeRulesSource(source)).not.toBe(normalizeRulesSource('allow read: if true;'));
    }
    expect(() => normalizeRulesSource(undefined)).toThrow();
  });
});

describe('readable rules assembly', () => {
  async function modules(directory) {
    await mkdir(path.join(directory, 'rules'));
    for (const name of [...RULES_MODULES].reverse()) {
      await writeFile(path.join(directory, 'rules', name), `// ${name}\r\n`, 'utf8');
    }
  }

  it('sorts modules lexically, generates LF, and ignores CRLF output differences', async () => {
    const directory = await fixture();
    await modules(directory);
    await buildRules({ directory });
    const output = await readFile(path.join(directory, 'firestore.rules'), 'utf8');
    expect(output).toBe(RULES_MODULES.map((name) => `// ${name}\n`).join(''));
    await writeFile(path.join(directory, 'firestore.rules'), output.replaceAll('\n', '\r\n'));
    await expect(buildRules({ directory, check: true })).resolves.toBe(output);
  });

  it('check fails on missing/stale output without rewriting it', async () => {
    const directory = await fixture();
    await modules(directory);
    await expect(buildRules({ directory, check: true })).rejects.toThrow(/missing|stale/i);
    await writeFile(path.join(directory, 'firestore.rules'), 'stale');
    await expect(buildRules({ directory, check: true })).rejects.toThrow(/stale/i);
    expect(await readFile(path.join(directory, 'firestore.rules'), 'utf8')).toBe('stale');
  });

  it('fails when any required module or the module directory is absent', async () => {
    const directory = await fixture();
    await expect(buildRules({ directory })).rejects.toThrow(/modules|rules/i);
    await modules(directory);
    await rm(path.join(directory, 'rules', RULES_MODULES[2]));
    await expect(buildRules({ directory })).rejects.toThrow(/missing/i);
  });

  it('includes additional numerically named modules in lexical order', async () => {
    const directory = await fixture();
    await modules(directory);
    await writeFile(path.join(directory, 'rules', '98-extra.rules'), '// extra');
    await writeFile(path.join(directory, 'rules', 'README.md'), 'ignored');
    const output = await buildRules({ directory });
    expect(output).toContain('// extra\n// 99-footer.rules');
  });
});

describe('isolated minified deployment config', () => {
  it.each(['invalid-config', 'invalid-source'])('cleans preparation failures (%s) before invoking deploy', async (failure) => {
    const directory = await fixture();
    await writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ firestore: { rules: failure === 'invalid-config' ? 'other.rules' : 'firestore.rules' } }));
    await writeFile(path.join(directory, 'firestore.rules'), failure === 'invalid-source' ? '/* unterminated' : 'allow read: if true;');
    let deployed = false;
    await expect(withMinifiedRulesConfig(() => { deployed = true; }, directory)).rejects.toThrow();
    expect(deployed).toBe(false);
    expect((await readdir(directory)).sort()).toEqual(['firebase.json', 'firestore.rules']);
  });

  it.each([false, true])('preserves config references and tracked files, cleans after failure=%s', async (fail) => {
    const directory = await fixture();
    const config = { firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, hosting: { public: 'dist' } };
    const configSource = JSON.stringify(config);
    const source = '// readable\nallow read: if true;\n';
    await writeFile(path.join(directory, 'firebase.json'), configSource);
    await writeFile(path.join(directory, 'firestore.rules'), source);
    let configPath;
    let minifiedPath;
    const result = withMinifiedRulesConfig(async (temporaryConfigPath) => {
      configPath = temporaryConfigPath;
      expect(path.dirname(configPath)).toBe(directory);
      const temporary = JSON.parse(await readFile(configPath, 'utf8'));
      expect(temporary.hosting).toEqual(config.hosting);
      expect(temporary.firestore.indexes).toBe(config.firestore.indexes);
      minifiedPath = path.resolve(directory, temporary.firestore.rules);
      expect(await readFile(minifiedPath, 'utf8')).toBe(minifyRules(source));
      if (fail) throw new Error('deploy failed');
      return 'deployed';
    }, directory);
    if (fail) await expect(result).rejects.toThrow('deploy failed');
    else await expect(result).resolves.toBe('deployed');
    expect(await readFile(path.join(directory, 'firebase.json'), 'utf8')).toBe(configSource);
    expect(await readFile(path.join(directory, 'firestore.rules'), 'utf8')).toBe(source);
    await expect(readFile(configPath)).rejects.toThrow();
    await expect(readFile(minifiedPath)).rejects.toThrow();
    expect((await readdir(directory)).sort()).toEqual(['firebase.json', 'firestore.rules']);
  });
});
