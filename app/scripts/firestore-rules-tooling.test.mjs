import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { minifyRules } from './minify-firestore-rules.mjs';
import { buildRules, RULES_MODULES } from './build-firestore-rules.mjs';
import { normalizeRulesSource, rulesApiRequest } from './check-firestore-rules-drift.mjs';
import { deployFirestoreRules } from './deploy-firestore-rules.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => 'synthetic-token') }));

const directories = [];
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rules-tooling-test-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Firestore rules minification and drift identity', () => {
  it('shortens helper declarations and calls without changing data keys or strings', () => {
    const source = "function longHelper(value) { return value.longHelper() == 'longHelper' && value.longHelper; } allow read: if longHelper(resource.data);";
    expect(minifyRules(source)).toBe("function _f0(_v0){return _v0.longHelper()=='longHelper'&&_v0.longHelper;}allow read:if _f0(resource.data);");
  });

  it('avoids capture by existing identifiers and is stable on already compact helpers', () => {
    const source = 'function first(value) { return second(value) && _f0 && _v0; } function second(value) { return value > 0; } allow read: if first(1);';
    const compact = minifyRules(source);
    expect(compact).toContain('function _f1(_v1)');
    expect(compact).toContain('function _f2(_v1)');
    expect(compact).toContain('return _f2(_v1)&&_f0&&_v0');
    expect(minifyRules(compact)).toBe(compact);
    expect(normalizeRulesSource(source)).toBe(normalizeRulesSource(compact));
  });

  it('preserves sibling helper scopes and reserved path names', () => {
    const source = 'match /_f0/{_f1} { function validator(v) { return v; } allow read: if validator(true); } match /other/{id} { function validator(v) { return !v; } allow read: if validator(false); }';
    const compact = minifyRules(source);
    expect(compact).toContain('match/_f0/{_f1}');
    expect(compact).toContain('function _f2(_v0){return _v0;}allow read:if _f2(true)');
    expect(compact).toContain('function _f3(_v0){return!_v0;}allow read:if _f3(false)');
    expect(minifyRules(compact)).toBe(compact);
  });

  it('resolves local builtin shadowing without renaming unrelated builtin calls', () => {
    const source = 'match /a/{id} { function exists(value) { return value; } allow read: if exists(true); } match /b/{id} { allow read: if exists(/databases/$(database)/documents/x) && getAfter(/databases/$(database)/documents/x).data.ok; }';
    const compact = minifyRules(source);
    expect(compact).toContain('function _f0(_v0){return _v0;}allow read:if _f0(true)');
    expect(compact).toContain('if exists(/databases/$(database)/documents/x)&&getAfter(');
    expect(minifyRules(compact)).toBe(compact);
  });

  it('binds forward calls and resolves a child helper independently of its parent', () => {
    const source = 'function check(value) { return valid(value); } function valid(value) { return value; } match /a/{id} { function valid(value) { return !value; } allow read: if check(true) && valid(false); }';
    const compact = minifyRules(source);
    expect(compact).toContain('function _f0(_v0){return _f1(_v0);}');
    expect(compact).toContain('allow read:if _f0(true)&&_f2(false)');
    expect(minifyRules(compact)).toBe(compact);
  });

  it('shortens local bindings while preserving static paths, interpolation and field keys', () => {
    const source = "function check(userId) { let record = get(/databases/$(database)/documents/users/userId); let value = get(/databases/$(database)/documents/users/$(userId)).data.userId; return {'userId': userId, 'value': value / record.data.value}; }";
    const compact = minifyRules(source);
    expect(compact).toContain('get(/databases/$(database)/documents/users/userId)');
    expect(compact).toContain('get(/databases/$(database)/documents/users/$(_v0)).data.userId');
    expect(compact).toContain("return{'userId':_v0,'value':_v2/_v1.data.value}");
    expect(minifyRules(compact)).toBe(compact);
  });

  it('preserves type names when a parameter has the same spelling', () => {
    const compact = minifyRules('function valid(list) { return list is list && list.size() > 0; }');
    expect(compact).toBe('function _f0(_v0){return _v0 is list&&_v0.size()>0;}');
    expect(minifyRules(compact)).toBe(compact);
  });

  it.each([
    'function same() { return true; } function same() { return false; }',
    'function bad(value, value) { return value; }',
    'function bad(value) { let value = true; return value; }',
  ])('rejects duplicate declarations instead of repairing invalid rules %j', (source) => {
    expect(() => minifyRules(source)).toThrow(/Duplicate/);
  });

  it.each(['function bad(null) { return null; }', 'function true() { return true; }'])('rejects reserved declaration names %j', (source) => {
    expect(() => minifyRules(source)).toThrow(/Reserved/);
  });

  it('keeps the repository upload artifact stable under repeated normalization', async () => {
    const source = await buildRules({ check: true });
    const compact = minifyRules(source);
    expect(minifyRules(compact)).toBe(compact);
    expect(normalizeRulesSource(compact)).toBe(normalizeRulesSource(source));
  });

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
  it('keeps collection validators out of the inherited documents scope', async () => {
    const source = await buildRules({ check: true });
    // Root helpers are compiled into every child match; new shared helpers need review.
    expect([...source.matchAll(/^    function (\w+)\(/gm)].map((match) => match[1]).sort()).toEqual([
      'assessmentTrialIdFor', 'hasOwnedUserId', 'hasValidAxisValue', 'hasValidEquipmentList',
      'hasValidExpectedCost', 'hasValidObservationDevice',
      'hasValidProtocolRef', 'hasValidSessionSource', 'isDateDocument', 'isFixedLoadProtocol',
      'isOwner', 'isRealCalendarDate', 'isValidActivityDate', 'isValidEquipmentItem',
      'keepsOwnership', 'outcomeMetricUnits', 'sameFixedLoadContext',
    ].sort());
  });

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

describe('Rules API deployment', () => {
  const project = 'synthetic-project';
  const rulesetName = `projects/${project}/rulesets/new-rules`;
  const releaseName = `projects/${project}/releases/cloud.firestore`;
  const source = '// readable\nallow read: if false;\n';
  function response(status, body = {}) {
    return new Response(JSON.stringify(body), { status });
  }
  function requests() {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('uploads minified source once and patches only the existing default release', async () => {
    const fetch = requests()
      .mockResolvedValueOnce(response(200, { name: rulesetName }))
      .mockResolvedValueOnce(response(200, { name: releaseName, rulesetName }));
    await deployFirestoreRules(project, source);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [createUrl, createOptions] = fetch.mock.calls[0];
    expect(createUrl).toBe(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`);
    expect(createOptions.method).toBe('POST');
    expect(createOptions.headers.Authorization).toBe('Bearer synthetic-token');
    expect(JSON.parse(createOptions.body)).toEqual({ source: { files: [{ name: 'firestore.rules', content: minifyRules(source) }] } });
    const [patchUrl, patchOptions] = fetch.mock.calls[1];
    expect(patchUrl).toBe(`https://firebaserules.googleapis.com/v1/${releaseName}`);
    expect(patchOptions.method).toBe('PATCH');
    expect(JSON.parse(patchOptions.body)).toEqual({ release: { name: releaseName, rulesetName }, updateMask: 'rulesetName' });
  });

  it('retries upload and activation independently without repeating successful compilation', async () => {
    const fetch = requests()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, { name: rulesetName }))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, { name: releaseName, rulesetName }));
    const assertion = expect(deployFirestoreRules(project, source)).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'POST', 'POST', 'PATCH', 'PATCH']);
    expect(fetch.mock.calls.slice(3).map(([, options]) => JSON.parse(options.body).release.rulesetName)).toEqual([rulesetName, rulesetName]);
  });

  it.each([400, 401, 403, 404, 409])('fails immediately on permanent HTTP %s without activating rules', async (status) => {
    const fetch = requests().mockResolvedValue(response(status));
    await expect(deployFirestoreRules(project, source)).rejects.toThrow(`Firebase Rules API ${status}`);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never falls back to release creation when PATCH fails', async () => {
    const fetch = requests()
      .mockResolvedValueOnce(response(200, { name: rulesetName }))
      .mockResolvedValueOnce(response(403));
    await expect(deployFirestoreRules(project, source)).rejects.toThrow('Firebase Rules API 403');
    expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'PATCH']);
  });

  it.each([true, false])('reconciles an exhausted activation error with release identity (matches=%s)', async (matches) => {
    const fetch = requests().mockResolvedValueOnce(response(200, { name: rulesetName }));
    for (let attempt = 0; attempt < 6; attempt += 1) fetch.mockResolvedValueOnce(response(503));
    fetch.mockResolvedValueOnce(response(200, { name: releaseName, rulesetName: matches ? rulesetName : 'projects/synthetic-project/rulesets/old' }));
    const deployed = deployFirestoreRules(project, source).then((value) => ({ value }), (error) => ({ error }));
    await vi.runAllTimersAsync();
    const result = await deployed;
    if (matches) expect(result.value).toMatchObject({ rulesetName });
    else expect(result.error.message).toContain('Firebase Rules API 503');
    expect(fetch.mock.calls.map(([, options]) => options.method ?? 'GET')).toEqual(['POST', ...Array(6).fill('PATCH'), 'GET']);
  });

  it('verifies an activation whose response was lost without creating another ruleset', async () => {
    const fetch = requests()
      .mockResolvedValueOnce(response(200, { name: rulesetName }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(200, { name: releaseName, rulesetName }));
    await expect(deployFirestoreRules(project, source)).resolves.toMatchObject({ rulesetName });
    expect(fetch.mock.calls.map(([, options]) => options.method ?? 'GET')).toEqual(['POST', 'PATCH', 'GET']);
  });

  it('does not activate an invalid or foreign ruleset response', async () => {
    const fetch = requests().mockResolvedValue(response(200, { name: 'projects/other/rulesets/id' }));
    await expect(deployFirestoreRules(project, source)).rejects.toThrow(/ruleset/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized source before making an API call', async () => {
    const fetch = requests();
    await expect(deployFirestoreRules(project, `allow read: if '${'a'.repeat(256 * 1024)}' == '';`)).rejects.toThrow(/256/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([429, 500, 502, 503, 504])('bounds HTTP %s retries with increasing delays and preserves the error', async (status) => {
    const fetch = requests().mockImplementation(() => Promise.resolve(response(status, { error: { message: 'synthetic failure' } })));
    const start = Date.now();
    const assertion = expect(rulesApiRequest('projects/synthetic/releases/cloud.firestore', 'token')).rejects.toThrow(`Firebase Rules API ${status}`);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(Date.now() - start).toBe(345_000);
    expect(console.warn.mock.calls.map(([message]) => message)).toEqual(expect.arrayContaining([
      expect.stringContaining('15s'), expect.stringContaining('30s'), expect.stringContaining('60s'), expect.stringContaining('120s'),
    ]));
  });
});
