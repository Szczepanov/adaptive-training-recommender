import { describe, expect, it } from 'vitest';

import {
  assertCompatibleSelfTestManifest,
  buildSelfTestInferenceProfile,
  hashSelfTestInferenceProfile,
  sanitizeSelfTestRunLabel,
  selfTestManifestMismatches,
} from '../selfTestRunState.mjs';

function localConfig(overrides = {}) {
  return {
    provider: 'local',
    thinkingEnabled: true,
    local: {
      endpoint: 'http://localhost:11434/api/chat',
      isOllama: true,
      numCtx: 32768,
      numPredict: 16384,
      timeoutMs: 600000,
      ...(overrides.local ?? {}),
    },
    cloud: { timeoutMs: 180000 },
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    suiteId: 'suite',
    casesSha256: 'cases',
    expectedSha256: 'expected',
    caseSetSha256: 'case-set',
    promptSha256: 'prompt',
    responseSchema: 'response',
    runtimeSchemaSha256: 'runtime-schema',
    provider: 'local',
    model: 'model',
    samples: 3,
    baseSeed: 42,
    seedStrategy: 'derived',
    thinkingEnabled: true,
    batchSize: 6,
    batchCount: 4,
    inferenceSha256: 'inference',
    ...overrides,
  };
}

describe('AI judge self-test run state', () => {
  it('rejects path-traversal run labels while sanitizing ordinary labels', () => {
    expect(() => sanitizeSelfTestRunLabel('..', 'local', 'model')).toThrow(/safe non-empty path component/);
    expect(() => sanitizeSelfTestRunLabel('.', 'local', 'model')).toThrow(/safe non-empty path component/);
    expect(sanitizeSelfTestRunLabel('Local Qwen / Q4', 'local', 'model')).toBe('local-qwen-q4');
  });

  it('binds local inference settings without persisting the raw endpoint', () => {
    const profile = buildSelfTestInferenceProfile(localConfig());
    expect(profile).toMatchObject({
      adapter: 'ollama',
      numCtx: 32768,
      numPredict: 16384,
      requestTimeoutMs: 600000,
    });
    expect(profile.endpointSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(profile)).not.toContain('localhost:11434');
  });

  it('changes inference identity when context or endpoint changes', () => {
    const base = buildSelfTestInferenceProfile(localConfig());
    const changedContext = buildSelfTestInferenceProfile(localConfig({ local: { numCtx: 16384 } }));
    const changedEndpoint = buildSelfTestInferenceProfile(localConfig({ local: { endpoint: 'http://localhost:11435/api/chat' } }));
    expect(hashSelfTestInferenceProfile(changedContext)).not.toBe(hashSelfTestInferenceProfile(base));
    expect(hashSelfTestInferenceProfile(changedEndpoint)).not.toBe(hashSelfTestInferenceProfile(base));
  });

  it('fails closed when any immutable run-provenance field changes', () => {
    const previous = manifest();
    const current = manifest({ inferenceSha256: 'different-runtime' });
    expect(selfTestManifestMismatches(previous, current)).toEqual(['inferenceSha256']);
    expect(() => assertCompatibleSelfTestManifest(previous, current)).toThrow(/immutable provenance mismatch: inferenceSha256/);
    expect(() => assertCompatibleSelfTestManifest(previous, previous)).not.toThrow();
  });
});
