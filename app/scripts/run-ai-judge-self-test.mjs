import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deriveSampleSeed } from './ai-judge/aggregate.mjs';
import { parseCliArg, positiveInt, resolveJudgeConfig } from './ai-judge/config.mjs';
import { callProvider } from './ai-judge/providers/index.mjs';
import { describeStructuredOutputRequirements } from './ai-judge/providers/base.mjs';
import { cleanupOllamaMemory, preflightOllama } from './ai-judge/runtime.mjs';
import {
  SELF_TEST_PROMPT,
  aggregateSelfTestSamples,
  buildSelfTestPacket,
  computeSelfTestMetrics,
  loadSelfTestFixtures,
  renderSelfTestMarkdown,
  validateSelfTestResponse,
} from './ai-judge/selfTest.mjs';
import {
  assertCompatibleSelfTestManifest,
  buildSelfTestInferenceProfile,
  hashSelfTestInferenceProfile,
  sanitizeSelfTestRunLabel,
} from './ai-judge/selfTestRunState.mjs';
import {
  SELF_TEST_RESPONSE_SCHEMA,
  SELF_TEST_SUMMARY_SCHEMA,
  generateSelfTestResponseSchema,
} from './ai-judge/selfTestSchema.mjs';
import { atomicWriteFile, atomicWriteJson, appendAttemptRecord } from './ai-judge/telemetry.mjs';
import { classifyError, isRetryableError } from './ai-judge/validation.mjs';

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function log(message) {
  console.log(`[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${message}`);
}

function optionalNonNegativeNumber(rawValue, field) {
  if (rawValue == null || rawValue === '') return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number.`);
  return value;
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 10000;
}

const argv = process.argv.slice(2);
const config = resolveJudgeConfig(argv);
const batchSize = positiveInt(parseCliArg(argv, 'batch-size') || process.env.JUDGE_SELF_TEST_BATCH_SIZE, 6);
const runLabel = sanitizeSelfTestRunLabel(
  parseCliArg(argv, 'run-label') || process.env.JUDGE_SELF_TEST_RUN_LABEL,
  config.provider,
  config.model
);
const inputCostPerMillion = optionalNonNegativeNumber(
  parseCliArg(argv, 'input-cost-per-million') || process.env.JUDGE_INPUT_COST_PER_MILLION,
  'input-cost-per-million'
);
const outputCostPerMillion = optionalNonNegativeNumber(
  parseCliArg(argv, 'output-cost-per-million') || process.env.JUDGE_OUTPUT_COST_PER_MILLION,
  'output-cost-per-million'
);
if ((inputCostPerMillion == null) !== (outputCostPerMillion == null)) {
  throw new Error('Provide both --input-cost-per-million and --output-cost-per-million, or neither.');
}
const fixtures = loadSelfTestFixtures();
const outputDir = resolve('artifacts/ai-plan-judge/self-test', runLabel);
mkdirSync(outputDir, { recursive: true });

const manifestPath = resolve(outputDir, 'self-test-manifest.json');
const attemptsPath = resolve(outputDir, 'self-test-attempts.jsonl');
const samplesPath = resolve(outputDir, 'self-test-samples.jsonl');
const summaryPath = resolve(outputDir, 'self-test-summary.json');
const summaryMarkdownPath = resolve(outputDir, 'self-test-summary.md');

const batches = [];
for (let index = 0; index < fixtures.cases.length; index += batchSize) {
  const cases = fixtures.cases.slice(index, index + batchSize);
  const schema = generateSelfTestResponseSchema(fixtures.suiteId, cases);
  batches.push({ batchIndex: batches.length, cases, schema });
}

const preflight = await preflightOllama(config, log);
const inference = buildSelfTestInferenceProfile(config);
const runIdentity = {
  schema: 'adaptive-training-recommender/ai-judge-self-test-manifest@1',
  suiteId: fixtures.suiteId,
  casesSha256: fixtures.casesSha256,
  expectedSha256: fixtures.expectedSha256,
  caseSetSha256: fixtures.caseSetSha256,
  promptSha256: hash([
    SELF_TEST_PROMPT,
    ...batches.map((batch) => describeStructuredOutputRequirements(batch.schema)),
  ].join('\n')),
  responseSchema: SELF_TEST_RESPONSE_SCHEMA,
  runtimeSchemaSha256: hash(batches.map((batch) => batch.schema)),
  provider: config.provider,
  model: config.model,
  modelDigest: preflight?.digest ?? null,
  quantization: preflight?.details?.quantization_level ?? null,
  samples: config.samples,
  baseSeed: config.baseSeed,
  seedStrategy: config.seedStrategy,
  thinkingEnabled: config.thinkingEnabled,
  batchSize,
  batchCount: batches.length,
  inferenceSha256: hashSelfTestInferenceProfile(inference),
  inference,
};

let previousManifest = null;
const cached = new Map();
const existingArtifacts = [manifestPath, attemptsPath, samplesPath, summaryPath, summaryMarkdownPath].some(existsSync);
const manifestExists = existsSync(manifestPath);
const samplesExist = existsSync(samplesPath);
let resumedCompatibleRun = false;

if (!config.isFresh && existingArtifacts) {
  if (!manifestExists || !samplesExist) {
    throw new Error(
      `Cannot resume self-test run '${runLabel}': existing artifacts are incomplete. `
      + 'Use --fresh to intentionally replace this run label, or choose a new --run-label.'
    );
  }

  try {
    previousManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assertCompatibleSelfTestManifest(previousManifest, runIdentity);
    const rows = readFileSync(samplesPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of rows) {
      const row = JSON.parse(line);
      const batch = batches[row.batchIndex];
      if (!batch || !Number.isInteger(row.sampleIndex)) throw new Error('Sample row references an unknown batch/sample.');
      if (row.sampleIndex < 0 || row.sampleIndex >= config.samples) throw new Error('Sample row references an out-of-range sample index.');
      const result = validateSelfTestResponse(row.result, fixtures.suiteId, batch.cases);
      const key = `${row.sampleIndex}:${row.batchIndex}`;
      if (cached.has(key)) throw new Error(`Duplicate accepted self-test sample '${key}'.`);
      cached.set(key, { ...row, result });
    }
    resumedCompatibleRun = true;
    log(`Loaded ${cached.size} compatible accepted batch sample(s) for resume.`);
  } catch (error) {
    cached.clear();
    throw new Error(
      `Cannot resume self-test run '${runLabel}': ${error instanceof Error ? error.message : String(error)}. `
      + 'Use --fresh to intentionally replace this run label, or choose a new --run-label.'
    );
  }
}

if (config.isFresh || !existingArtifacts) {
  writeFileSync(attemptsPath, '', 'utf8');
  writeFileSync(samplesPath, '', 'utf8');
  cached.clear();
  for (const staleSummaryPath of [summaryPath, summaryMarkdownPath]) {
    if (existsSync(staleSummaryPath)) unlinkSync(staleSummaryPath);
  }
}

const startedAt = resumedCompatibleRun && previousManifest?.startedAt
  ? previousManifest.startedAt
  : new Date().toISOString();
atomicWriteJson(manifestPath, { ...runIdentity, runLabel, startedAt });

await cleanupOllamaMemory(config, log);
log(`AI judge self-test: ${config.provider}/${config.model}`);
log(`${fixtures.cases.length} controls in ${batches.length} batch(es), ${config.samples} sample(s), run label '${runLabel}'.`);
log('No pass/fail gate is applied; results are calibration evidence only.');

async function evaluateBatchWithRetry(batch, sampleIndex, seed, retries = 3) {
  const packet = {
    packetSchema: 'adaptive-training-recommender/ai-judge-self-test-batch@1',
    suiteId: fixtures.suiteId,
    evidenceReferenceRule: 'For each result, JSON Pointers are relative to that individual case object. Start with /inputContext, /plans, /comparison, or /focusPlanId; never use /cases/N. plans is an array: use a numeric index such as /plans/0/facts, never a planId in place of the index.',
    cases: batch.cases.map(buildSelfTestPacket),
  };
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const attemptStarted = Date.now();
    try {
      const response = await callProvider({
        packetJson: JSON.stringify(packet),
        schema: batch.schema,
        promptContent: SELF_TEST_PROMPT,
        schemaContent: JSON.stringify(batch.schema, null, 2),
        config,
        attempt,
        sampleIndex,
        seed,
      });
      const result = validateSelfTestResponse(response.value, fixtures.suiteId, batch.cases);
      appendAttemptRecord(attemptsPath, {
        sampleIndex,
        batchIndex: batch.batchIndex,
        attempt,
        status: 'accepted',
        seed,
        elapsedMs: Date.now() - attemptStarted,
        promptTokens: response.telemetry?.promptTokens ?? null,
        completionTokens: response.telemetry?.completionTokens ?? null,
        totalTokens: response.telemetry?.totalTokens ?? null,
        contextLength: response.telemetry?.contextLength ?? null,
        schemaEnforced: response.telemetry?.schemaEnforced ?? null,
        doneReason: response.telemetry?.doneReason ?? null,
      });
      return { result, telemetry: response.telemetry ?? null };
    } catch (error) {
      lastError = error;
      const category = classifyError(error);
      appendAttemptRecord(attemptsPath, {
        sampleIndex,
        batchIndex: batch.batchIndex,
        attempt,
        status: 'rejected',
        seed,
        errorCategory: category,
        errorMessage: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - attemptStarted,
      });
      if (!isRetryableError(category) || attempt === retries) break;
      const delayMs = attempt * 3000;
      log(`Batch ${batch.batchIndex + 1}, sample ${sampleIndex + 1} rejected [${category}]; retrying in ${delayMs / 1000}s.`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const runStartedMs = Date.now();
for (let sampleIndex = 0; sampleIndex < config.samples; sampleIndex += 1) {
  for (const batch of batches) {
    const key = `${sampleIndex}:${batch.batchIndex}`;
    if (cached.has(key)) continue;
    const seed = deriveSampleSeed(config.baseSeed, `self-test-batch-${batch.batchIndex}`, sampleIndex, config.seedStrategy);
    process.stdout.write(`[sample ${sampleIndex + 1}/${config.samples}] batch ${batch.batchIndex + 1}/${batches.length}... `);
    try {
      const evaluated = await evaluateBatchWithRetry(batch, sampleIndex, seed);
      const row = {
        sampleIndex,
        batchIndex: batch.batchIndex,
        seed,
        result: evaluated.result,
        telemetry: evaluated.telemetry,
      };
      appendFileSync(samplesPath, `${JSON.stringify(row)}\n`, 'utf8');
      cached.set(key, row);
      console.log('accepted');
    } catch (error) {
      console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`Validated partial evidence is preserved at ${samplesPath}; rerun with --resume.`);
      process.exit(1);
    }
  }
}

const sampleResponses = [];
for (let sampleIndex = 0; sampleIndex < config.samples; sampleIndex += 1) {
  const resultsByCase = new Map();
  for (const batch of batches) {
    const row = cached.get(`${sampleIndex}:${batch.batchIndex}`);
    if (!row) throw new Error(`Missing completed batch ${batch.batchIndex} for sample ${sampleIndex}.`);
    for (const result of row.result.results) resultsByCase.set(result.caseId, result);
  }
  sampleResponses.push({
    sampleIndex,
    result: {
      schema: SELF_TEST_RESPONSE_SCHEMA,
      suiteId: fixtures.suiteId,
      results: fixtures.cases.map((fixture) => resultsByCase.get(fixture.caseId)),
    },
  });
}

const aggregateResults = aggregateSelfTestSamples(sampleResponses, fixtures.cases);
const metrics = computeSelfTestMetrics(sampleResponses, fixtures.cases, fixtures.expected);
const telemetryRows = [...cached.values()].map((row) => row.telemetry).filter(Boolean);
const schemaKnownRows = telemetryRows.filter((item) => typeof item.schemaEnforced === 'boolean');
const schemaEnforcedResponses = schemaKnownRows.filter((item) => item.schemaEnforced).length;
const schemaFallbackResponses = schemaKnownRows.length - schemaEnforcedResponses;
const acceptedInferenceMs = telemetryRows.reduce((sum, item) => sum + (item.totalDurationMs ?? 0), 0);
const telemetry = {
  promptTokens: telemetryRows.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0),
  completionTokens: telemetryRows.reduce((sum, item) => sum + (item.completionTokens ?? 0), 0),
  totalTokens: telemetryRows.reduce((sum, item) => sum + (item.totalTokens ?? ((item.promptTokens ?? 0) + (item.completionTokens ?? 0))), 0),
  wallClockMs: Date.now() - runStartedMs,
  acceptedInferenceMs,
  schemaEnforcedResponses,
  schemaFallbackResponses,
  schemaEnforcementRate: rate(schemaEnforcedResponses, schemaKnownRows.length),
  estimatedCostUsd: inputCostPerMillion == null
    ? null
    : Math.round((
      (telemetryRows.reduce((sum, item) => sum + (item.promptTokens ?? 0), 0) * inputCostPerMillion / 1_000_000)
      + (telemetryRows.reduce((sum, item) => sum + (item.completionTokens ?? 0), 0) * outputCostPerMillion / 1_000_000)
    ) * 1_000_000) / 1_000_000,
};
const completedAt = new Date().toISOString();
const summary = {
  schema: SELF_TEST_SUMMARY_SCHEMA,
  runLabel,
  provenance: {
    suiteId: fixtures.suiteId,
    casesSha256: fixtures.casesSha256,
    expectedSha256: fixtures.expectedSha256,
    caseSetSha256: fixtures.caseSetSha256,
    promptSha256: runIdentity.promptSha256,
    responseSchema: SELF_TEST_RESPONSE_SCHEMA,
    runtimeSchemaSha256: runIdentity.runtimeSchemaSha256,
    provider: config.provider,
    model: config.model,
    modelDigest: runIdentity.modelDigest,
    quantization: runIdentity.quantization,
    samples: config.samples,
    baseSeed: config.baseSeed,
    seedStrategy: config.seedStrategy,
    thinkingEnabled: config.thinkingEnabled,
    batchSize,
    inferenceSha256: runIdentity.inferenceSha256,
    inference,
    pricing: inputCostPerMillion == null ? null : { inputCostPerMillion, outputCostPerMillion },
  },
  startedAt,
  completedAt,
  telemetry,
  metrics,
  aggregateResults,
};
atomicWriteJson(summaryPath, summary);
atomicWriteFile(summaryMarkdownPath, renderSelfTestMarkdown(summary));
atomicWriteJson(manifestPath, {
  ...runIdentity,
  runLabel,
  startedAt,
  completedAt,
  completedBatchSamples: cached.size,
  runtime: summary.provenance,
  telemetry,
});
log(`Self-test complete: ${metrics.counts.fullPasses}/${metrics.counts.predictions} full control predictions passed.`);
log(`Summary: ${summaryPath}`);
