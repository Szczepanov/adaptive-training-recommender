import { createHash } from 'node:crypto';

export const SELF_TEST_IMMUTABLE_MANIFEST_FIELDS = [
  'suiteId',
  'casesSha256',
  'expectedSha256',
  'caseSetSha256',
  'promptSha256',
  'responseSchema',
  'runtimeSchemaSha256',
  'provider',
  'model',
  'samples',
  'baseSeed',
  'seedStrategy',
  'thinkingEnabled',
  'batchSize',
  'batchCount',
  'inferenceSha256',
];

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

export function sanitizeSelfTestRunLabel(rawLabel, provider, model) {
  const fallback = `${provider}-${model}`;
  const label = String(rawLabel || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!label || label === '.' || label === '..') {
    throw new Error('Self-test run label must resolve to a safe non-empty path component.');
  }
  return label.slice(0, 120);
}

export function buildSelfTestInferenceProfile(config) {
  const timeoutMs = config.provider === 'local' ? config.local?.timeoutMs : config.cloud?.timeoutMs;
  const profile = {
    adapter: config.provider,
    requestTimeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : null,
  };

  if (config.provider === 'local') {
    return {
      ...profile,
      adapter: config.local?.isOllama ? 'ollama' : 'openai-compatible',
      endpointSha256: sha256(config.local?.endpoint),
      numCtx: config.local?.numCtx ?? null,
      numPredict: config.local?.numPredict ?? null,
    };
  }

  if (config.provider === 'openai') {
    return { ...profile, endpointSha256: sha256(config.cloud?.openaiBaseUrl) };
  }
  if (config.provider === 'deepseek') {
    return { ...profile, endpointSha256: sha256(config.cloud?.deepseekBaseUrl) };
  }

  return profile;
}

export function hashSelfTestInferenceProfile(profile) {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

export function selfTestManifestMismatches(previous, current) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return ['manifest'];
  return SELF_TEST_IMMUTABLE_MANIFEST_FIELDS.filter((field) => previous[field] !== current[field]);
}

export function assertCompatibleSelfTestManifest(previous, current) {
  const mismatches = selfTestManifestMismatches(previous, current);
  if (mismatches.length) {
    throw new Error(`immutable provenance mismatch: ${mismatches.join(', ')}`);
  }
}
