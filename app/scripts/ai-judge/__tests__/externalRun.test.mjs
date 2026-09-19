import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_RESPONSE_BYTES,
  buildExternalPackage,
  importExternalRun,
  readJsonObject,
} from '../externalRun.mjs';
import { generateFamilyResponseSchema } from '../schema.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryRoots = [];

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'external-judge-test-'));
  temporaryRoots.push(root);
  return root;
}

function responseFor(familyId, caseIds) {
  return {
    schema: 'adaptive-training-recommender/ai-plan-judge-response@1',
    familyId,
    caseScores: caseIds.map((caseId) => ({
      caseId,
      scores: {
        safety_recovery_fit: 8,
        goal_event_fit: 8,
        sequencing: 8,
        periodization_taper: 8,
        preference_capacity_fit: 8,
        robustness: 8,
        overall: 8,
      },
      confidence: 0.8,
      flags: [],
      rationale: 'The plan respects the stated evidence and constraints.',
      suggestedChanges: [],
    })),
    familyAssessment: {
      sensitivity_quality: 8,
      overreactionCases: [],
      underreactionCases: [],
      goodSensitivityCases: caseIds,
      rationale: 'The family response is proportionate across the changed axis.',
      algorithmAdjustmentHypotheses: ['Keep the response proportional to the changed evidence.'],
    },
  };
}

function sourceFixture(root, suite) {
  const source = join(root, `${suite}-source`);
  mkdirSync(source, { recursive: true });
  const family = {
    familyId: `${suite}_family`,
    changedAxis: 'recovery',
    comparisonInstruction: 'Compare the cases.',
    cases: [
      {
        input: { caseId: `${suite}_case_a`, label: 'A', readiness: { objective: { sleep_score: 80 } } },
        plan: [{ date: '2026-09-19', session: { title: 'Easy aerobic', category: 'endurance', systemicCost: 0.2 } }],
      },
      {
        input: { caseId: `${suite}_case_b`, label: 'B', readiness: { objective: { sleep_score: 60 } } },
        plan: [{ date: '2026-09-19', session: { title: 'Recovery', category: 'recovery', systemicCost: 0.1 } }],
      },
    ],
  };
  writeFileSync(join(source, 'families.jsonl'), `${JSON.stringify(family)}\n`);
  writeFileSync(join(source, 'judge-prompt.md'), `# ${suite} prompt\n`);
  writeFileSync(join(source, 'corpus.json'), JSON.stringify({ schema: `${suite}-corpus@1`, commit: 'fixture-commit' }));
  if (suite === 'plan') {
    writeFileSync(join(source, 'judge-response-schema.json'), JSON.stringify({ schema: 'response@1' }));
  }
  return source;
}

function responseDirFor(packageDir) {
  const responses = join(packageDir, 'responses');
  mkdirSync(responses, { recursive: true });
  return responses;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('manual external judge run packages', () => {
  it('rejects malformed JSON, arrays, and oversized response files', () => {
    const root = tempRoot();
    const malformed = join(root, 'malformed.json');
    writeFileSync(malformed, '{');
    expect(() => readJsonObject(malformed)).toThrow(/valid JSON/);

    const array = join(root, 'array.json');
    writeFileSync(array, '[]');
    expect(() => readJsonObject(array)).toThrow(/regular JSON object/);

    const oversized = join(root, 'oversized.json');
    writeFileSync(oversized, 'x'.repeat(MAX_RESPONSE_BYTES + 1));
    expect(() => readJsonObject(oversized)).toThrow(/size limit/);
  });

  it('exports blinded packets, per-family schemas, prompt, and provenance hashes', () => {
    const root = tempRoot();
    const source = sourceFixture(root, 'plan');
    const packageDir = join(root, 'package');
    const manifest = buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: packageDir });

    expect(manifest.suite).toBe('plan');
    expect(manifest.packetVersion).toBe('v2');
    expect(manifest.privacy.containsCredentials).toBe(false);
    expect(manifest.privacy.containsRawHealthPayloads).toBe(false);
    expect(manifest.hashes.corpusSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.provenance.sourceArtifactDir).toBe('external-source');
    expect(manifest.contractArtifacts.map((artifact) => artifact.packagePath)).toEqual(expect.arrayContaining(['local-provenance/families.jsonl', 'local-provenance/corpus.json', 'prompt.md', 'local-provenance/judge-response-schema.json']));
    expect(readFileSync(join(packageDir, 'prompt.md'), 'utf8')).toContain('# plan prompt');
    expect(existsSync(join(packageDir, 'families.jsonl'))).toBe(false);
    expect(existsSync(join(packageDir, 'corpus.json'))).toBe(false);
    expect(readFileSync(join(packageDir, 'local-provenance', 'families.jsonl'), 'utf8')).toContain('plan_family');
    expect(readFileSync(join(packageDir, 'local-provenance', 'corpus.json'), 'utf8')).toContain('fixture-commit');
    const packetContent = readFileSync(join(packageDir, 'packets', 'plan_family.json'), 'utf8');
    expect(packetContent).toContain('packetSchema');
    expect(packetContent).not.toMatch(/engineSummary|constraintViolations|qualityWarnings|utility/);
    expect(readFileSync(join(packageDir, 'schemas', 'plan_family.json'), 'utf8')).toContain('caseScores');
    expect(manifest.families[0].responsePath).toMatch(/^responses\/plan_family-[a-f0-9]{64}\.json$/);
    expect(readFileSync(join(packageDir, 'upload', 'manifest.json'), 'utf8')).toContain(manifest.families[0].packetSha256);
    expect(readFileSync(join(packageDir, 'upload', 'prompt.md'), 'utf8')).toContain('# plan prompt');
    expect(existsSync(join(packageDir, 'upload', 'packets', 'plan_family.json'))).toBe(true);
    expect(existsSync(join(packageDir, 'upload', 'schemas', 'plan_family.json'))).toBe(true);
    expect(existsSync(join(packageDir, 'upload', 'responses'))).toBe(false);
    expect(existsSync(join(packageDir, 'upload', 'local-provenance'))).toBe(false);
  });

  it('re-exports a clean upload view and drops only stale response JSON', () => {
    const root = tempRoot();
    const source = sourceFixture(root, 'plan');
    const packageDir = join(root, 'package');
    const first = buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: packageDir });
    const currentResponse = join(packageDir, first.families[0].responsePath);
    writeFileSync(currentResponse, JSON.stringify(responseFor(first.families[0].familyId, first.families[0].caseIds)));
    writeFileSync(join(packageDir, 'responses', 'stale.json'), '{}');
    writeFileSync(join(packageDir, 'packets', 'stale.json'), '{}');
    writeFileSync(join(packageDir, 'schemas', 'stale.json'), '{}');
    writeFileSync(join(packageDir, 'upload', 'stale.txt'), 'stale');

    const second = buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: packageDir });

    expect(second.families[0].responsePath).toBe(first.families[0].responsePath);
    expect(existsSync(currentResponse)).toBe(true);
    expect(existsSync(join(packageDir, 'responses', 'stale.json'))).toBe(false);
    expect(existsSync(join(packageDir, 'packets', 'stale.json'))).toBe(false);
    expect(existsSync(join(packageDir, 'schemas', 'stale.json'))).toBe(false);
    expect(existsSync(join(packageDir, 'upload', 'stale.txt'))).toBe(false);
  });

  it('rejects package contract/hash mismatches before importing responses', () => {
    const root = tempRoot();
    const source = sourceFixture(root, 'plan');
    const packageDir = join(root, 'package');
    buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: packageDir });
    writeFileSync(join(packageDir, 'packets', 'plan_family.json'), '{}');

    expect(() => importExternalRun({ packageDir, outputDir: join(root, 'output'), model: 'external-test-model' }))
      .toThrow(/hash mismatch/);
  });

  it('rejects missing, stale, and unknown response filenames', () => {
    const root = tempRoot();
    const source = sourceFixture(root, 'plan');
    const packageDir = join(root, 'package');
    const manifest = buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: packageDir });
    const responses = responseDirFor(packageDir);
    const family = manifest.families[0];
    const valid = responseFor(family.familyId, family.caseIds);

    expect(() => importExternalRun({ packageDir, responsesDir: responses, outputDir: join(root, 'missing') }))
      .toThrow(/Missing response/);

    writeFileSync(join(responses, 'one.json'), JSON.stringify(valid));
    expect(() => importExternalRun({ packageDir, responsesDir: responses, outputDir: join(root, 'stale') }))
      .toThrow(/Unknown or stale response filename/);

    rmSync(join(responses, 'one.json'));
    writeFileSync(join(responses, 'unknown.json'), JSON.stringify(responseFor('not-in-package', family.caseIds)));
    expect(() => importExternalRun({ packageDir, responsesDir: responses, outputDir: join(root, 'unknown') }))
      .toThrow(/Unknown or stale response filename/);
  });

  it.each(['plan', 'persona'])('imports a valid %s response and preserves manual provenance', (suite) => {
    const root = tempRoot();
    const source = sourceFixture(root, suite);
    const packageDir = join(root, 'package');
    const manifest = buildExternalPackage({ suite, sourceDir: source, outputDir: packageDir });
    responseDirFor(packageDir);
    for (const family of manifest.families) {
      writeFileSync(join(packageDir, family.responsePath), JSON.stringify(responseFor(family.familyId, family.caseIds)));
    }

    const outputDir = join(root, 'output');
    const result = importExternalRun({
      packageDir,
      responsesDir: join(packageDir, 'responses'),
      outputDir,
      model: 'chatgpt-external-manual-label',
    });

    expect(result.manifest.judgeProvider).toBe('manual_external');
    expect(result.manifest.judgeModel).toBe('chatgpt-external-manual-label');
    expect(result.manifest.externalResponses[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(outputDir, 'judge-scores.jsonl'), 'utf8')).toContain(manifest.families[0].familyId);
    expect(readFileSync(join(outputDir, 'judge-samples.jsonl'), 'utf8')).toContain('sampleIndex');
    expect(readFileSync(join(outputDir, 'judge-stability.json'), 'utf8')).toContain(manifest.families[0].familyId);
    expect(readFileSync(join(outputDir, 'families.jsonl'), 'utf8')).toContain(manifest.families[0].familyId);
    expect(readFileSync(join(outputDir, 'corpus.json'), 'utf8')).toContain('fixture-commit');
    expect(readFileSync(join(outputDir, 'judge-prompt.md'), 'utf8')).toContain(`# ${suite} prompt`);
    const summary = JSON.parse(readFileSync(join(outputDir, 'judge-summary.json'), 'utf8'));
    expect(summary.provenance).toEqual(expect.objectContaining({
      corpusCommit: 'fixture-commit',
      corpusSchema: `${suite}-corpus@1`,
      corpusSha256: createHash('sha256').update(readFileSync(join(outputDir, 'corpus.json'))).digest('hex'),
      familiesSha256: createHash('sha256').update(readFileSync(join(outputDir, 'families.jsonl'))).digest('hex'),
      promptSha256: createHash('sha256').update(readFileSync(join(outputDir, 'judge-prompt.md'))).digest('hex'),
      responseSchemaSha256: suite === 'plan'
        ? createHash('sha256').update(readFileSync(join(outputDir, 'judge-response-schema.json'))).digest('hex')
        : expect.any(String),
      judgeScoresSha256: createHash('sha256').update(readFileSync(join(outputDir, 'judge-scores.jsonl'))).digest('hex'),
      judgeModel: 'chatgpt-external-manual-label',
      judgeProvider: 'manual_external',
      analyzedAt: expect.any(String),
    }));
    if (suite === 'plan') expect(readFileSync(join(outputDir, 'judge-response-schema.json'), 'utf8')).toContain('response@1');
  });

  it('validates local-provenance hashes and rejects lexical traversal', () => {
    const root = tempRoot();
    const source = sourceFixture(root, 'plan');
    const packageDir = join(root, 'package');
    buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: packageDir });
    writeFileSync(join(packageDir, 'local-provenance', 'families.jsonl'), 'tampered\n');
    expect(() => importExternalRun({ packageDir, outputDir: join(root, 'output') })).toThrow(/Manifest hash mismatch|Contract artifact hash mismatch/);

    const secondPackage = join(root, 'second-package');
    buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: secondPackage });
    const manifestPath = join(secondPackage, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.families[0].packetPath = 'packets/../../outside.json';
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => importExternalRun({ packageDir: secondPackage, outputDir: join(root, 'output-traversal') })).toThrow(/packet\/schema paths|escapes package directory/);
  });

  it('rejects package packet symlink escapes when the platform permits symlinks', () => {
    const root = tempRoot();
    const source = sourceFixture(root, 'plan');
    const packageDir = join(root, 'package');
    const manifest = buildExternalPackage({ suite: 'plan', sourceDir: source, outputDir: packageDir });
    const packetPath = join(packageDir, manifest.families[0].packetPath);
    const outside = join(root, 'outside.json');
    writeFileSync(outside, readFileSync(packetPath));
    rmSync(packetPath);
    try {
      symlinkSync(outside, packetPath, 'file');
    } catch {
      return;
    }
    expect(() => importExternalRun({ packageDir, outputDir: join(root, 'output') })).toThrow(/symlink|outside package/);
  });
});
