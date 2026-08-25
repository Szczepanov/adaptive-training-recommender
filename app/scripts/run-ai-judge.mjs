import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

import { resolveJudgeConfig } from './ai-judge/config.mjs';
import { generateFamilyResponseSchema } from './ai-judge/schema.mjs';
import { compactFamilyForJudge, loadJudgeArtifacts } from './ai-judge/packets.mjs';
import { validateAndNormalizeJudgeRow, classifyError, isRetryableError } from './ai-judge/validation.mjs';
import { appendAttemptRecord, atomicWriteFile, atomicWriteJson, computeContextUtilization } from './ai-judge/telemetry.mjs';
import { preflightOllama, cleanupOllamaMemory } from './ai-judge/runtime.mjs';
import { callProvider } from './ai-judge/providers/index.mjs';
import { aggregateFamilySamples, deriveSampleSeed } from './ai-judge/aggregate.mjs';

function getTimestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function log(message) {
  console.log(`[${getTimestamp()}] ${message}`);
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const config = resolveJudgeConfig();
const outputDir = resolve('artifacts/ai-plan-judge/latest');
const familiesPath = resolve(outputDir, 'families.jsonl');
const promptPath = resolve(outputDir, 'judge-prompt.md');
const schemaPath = resolve(outputDir, 'judge-response-schema.json');
const scoresPath = resolve(outputDir, 'judge-scores.jsonl');
const samplesPath = resolve(outputDir, 'judge-samples.jsonl');
const attemptsPath = resolve(outputDir, 'judge-attempts.jsonl');
const stabilityPath = resolve(outputDir, 'judge-stability.json');
const manifestPath = resolve(outputDir, 'judge-run-manifest.json');

// Ensure artifacts exist or generate deterministic corpus
if ([familiesPath, promptPath, schemaPath].some((p) => !existsSync(p))) {
  log('Judge artifacts are incomplete; generating the deterministic corpus first...');
  execSync('npm run simulate:plan-judge', { stdio: 'inherit' });
}

const {
  promptContent,
  schemaContent,
  familyRows,
  expectedByFamily,
} = loadJudgeArtifacts(outputDir);

const runIdentity = {
  schema: 'adaptive-training-recommender/ai-plan-judge-run-manifest@1',
  familiesSha256: hashFile(familiesPath),
  promptSha256: hashFile(promptPath),
  responseSchemaSha256: hashFile(schemaPath),
  judgeModel: config.model,
  judgeProvider: config.provider,
  samples: config.samples,
  baseSeed: config.baseSeed,
  seedStrategy: config.seedStrategy,
  thinkingEnabled: config.thinkingEnabled,
};

function compatibleManifest(prev) {
  return prev
    && prev.schema === runIdentity.schema
    && prev.familiesSha256 === runIdentity.familiesSha256
    && prev.promptSha256 === runIdentity.promptSha256
    && prev.responseSchemaSha256 === runIdentity.responseSchemaSha256
    && prev.judgeModel === runIdentity.judgeModel
    && prev.judgeProvider === runIdentity.judgeProvider
    && (prev.samples ?? 1) === runIdentity.samples;
}

// Load existing samples if resuming
const cachedSamplesByFamily = new Map(); // familyId -> Array of validated sample objects
let previousManifest = null;

let reuseCache = false;

if (!config.isFresh && existsSync(samplesPath) && existsSync(manifestPath)) {
  try {
    previousManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (compatibleManifest(previousManifest)) {
      reuseCache = true;
      const sampleLines = readFileSync(samplesPath, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of sampleLines) {
        const item = JSON.parse(line);
        const expectedCaseIds = expectedByFamily.get(item.familyId);
        if (!expectedCaseIds) continue;
        const validated = validateAndNormalizeJudgeRow(item.result, item.familyId, expectedCaseIds);
        if (!cachedSamplesByFamily.has(item.familyId)) {
          cachedSamplesByFamily.set(item.familyId, []);
        }
        cachedSamplesByFamily.get(item.familyId).push({
          sampleIndex: item.sampleIndex,
          seed: item.seed,
          result: validated,
          telemetry: item.telemetry ?? null,
        });
      }
    } else {
      log('Existing judge cache ignored because corpus/prompt/schema/model/provider provenance does not match this run.');
    }
  } catch (error) {
    log(`Existing judge cache ignored because it is invalid: ${error instanceof Error ? error.message : String(error)}`);
    cachedSamplesByFamily.clear();
    reuseCache = false;
  }
}

// Initialize artifacts
const startedAt = compatibleManifest(previousManifest) && previousManifest.startedAt
  ? previousManifest.startedAt
  : new Date().toISOString();

atomicWriteJson(manifestPath, { ...runIdentity, startedAt });

if (config.isFresh || !reuseCache) {
  writeFileSync(scoresPath, '', 'utf8');
  writeFileSync(samplesPath, '', 'utf8');
  writeFileSync(attemptsPath, '', 'utf8');
}

// Runtime preflight & cleanup
await cleanupOllamaMemory(config, log);
const preflight = await preflightOllama(config, log);

log(`=== AI Plan Judge: ${config.provider.toUpperCase()} / ${config.model} ===`);
log(`🧠 Thinking mode: ${config.thinkingEnabled ? 'enabled' : 'disabled'}`);
log(`🎲 Samples: ${config.samples} (seed: ${config.baseSeed}, strategy: ${config.seedStrategy})`);
if (config.provider === 'local') {
  log(`🔧 Endpoint: ${config.local.endpoint}`);
  log(`🔧 num_ctx: ${config.local.numCtx} | num_predict: ${config.local.numPredict}`);
}
log(`🔒 Evidence mode: strict — missing scores/cases/assessment fields are rejected, never synthesized.`);
log(`♻️ Cache: ${config.isFresh ? 'disabled (--fresh)' : `${cachedSamplesByFamily.size} compatible family cache records available`}`);
log(`Evaluating ${familyRows.length} sensitivity families...\n`);

async function judgeFamilySampleWithRetry({
  family,
  familySchema,
  expectedCaseIds,
  sampleIndex,
  seed,
  retries = 3,
}) {
  const packet = compactFamilyForJudge(family);
  const packetJson = JSON.stringify(packet);
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await callProvider({
        packetJson,
        schema: familySchema,
        promptContent,
        schemaContent,
        config,
        attempt,
        sampleIndex,
        seed,
      });

      const validated = validateAndNormalizeJudgeRow(response.value, family.familyId, expectedCaseIds);

      appendAttemptRecord(attemptsPath, {
        familyId: family.familyId,
        sampleIndex,
        attempt,
        status: 'accepted',
        promptTokens: response.telemetry?.promptTokens,
        completionTokens: response.telemetry?.completionTokens,
        totalTokens: response.telemetry?.totalTokens,
        contextLength: response.telemetry?.contextLength,
        doneReason: response.telemetry?.doneReason,
        schemaEnforced: response.telemetry?.schemaEnforced,
        elapsedMs: response.telemetry?.totalDurationMs,
      });

      return {
        sampleIndex,
        seed,
        result: validated,
        telemetry: response.telemetry,
      };
    } catch (error) {
      lastError = error;
      const errorCategory = classifyError(error);

      appendAttemptRecord(attemptsPath, {
        familyId: family.familyId,
        sampleIndex,
        attempt,
        status: 'rejected',
        errorCategory,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      if (!isRetryableError(errorCategory) || attempt === retries) {
        break;
      }

      const delaySeconds = attempt * 3;
      process.stdout.write(
        `\n[${getTimestamp()}] ⚠️ ${family.familyId} (sample ${sampleIndex + 1}) attempt ${attempt} rejected [${errorCategory}]: ${error instanceof Error ? error.message : String(error)}. Retrying in ${delaySeconds}s...\n`
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delaySeconds * 1000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const evaluatedRows = [];
const allStabilities = [];
let totalPromptTokens = 0;
let totalCompletionTokens = 0;
let maxContextUtilization = 0;

for (let index = 0; index < familyRows.length; index += 1) {
  const family = familyRows[index];
  const expectedCaseIds = expectedByFamily.get(family.familyId);
  const familySchema = generateFamilyResponseSchema(family.familyId, expectedCaseIds);

  const familySamples = cachedSamplesByFamily.get(family.familyId) || [];
  const startMs = Date.now();

  process.stdout.write(
    `[${getTimestamp()}] [${index + 1}/${familyRows.length}] ${family.familyId} (${family.cases.length} cases, ${config.samples} sample(s))... `
  );

  try {
    for (let sampleIndex = familySamples.length; sampleIndex < config.samples; sampleIndex += 1) {
      const seed = deriveSampleSeed(config.baseSeed, family.familyId, sampleIndex, config.seedStrategy);
      const sample = await judgeFamilySampleWithRetry({
        family,
        familySchema,
        expectedCaseIds,
        sampleIndex,
        seed,
      });
      familySamples.push(sample);

      // Append raw sample to samples artifact
      const sampleLine = JSON.stringify({
        familyId: family.familyId,
        sampleIndex,
        seed,
        result: sample.result,
        telemetry: sample.telemetry,
      });
      writeFileSync(samplesPath, `${sampleLine}\n`, { flag: 'a', encoding: 'utf8' });

      if (sample.telemetry?.promptTokens) {
        totalPromptTokens += sample.telemetry.promptTokens;
        const util = computeContextUtilization(sample.telemetry.promptTokens, sample.telemetry.contextLength);
        if (util && util > maxContextUtilization) maxContextUtilization = util;
      }
      if (sample.telemetry?.completionTokens) {
        totalCompletionTokens += sample.telemetry.completionTokens;
      }
    }

    // Aggregate samples
    const { aggregateResult, stability } = aggregateFamilySamples(family.familyId, familySamples, expectedCaseIds);
    evaluatedRows.push(aggregateResult);
    allStabilities.push(stability);

    // Update judge-scores.jsonl
    const scoresContent = evaluatedRows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    atomicWriteFile(scoresPath, scoresContent);

    const elapsedSeconds = Math.round((Date.now() - startMs) / 1000);
    const spreadInfo = config.samples > 1 ? ` (MAD: ±${stability.familySensitivityMad})` : '';
    console.log(`✓ ${elapsedSeconds}s | sensitivity ${aggregateResult.familyAssessment.sensitivity_quality}/10${spreadInfo}`);

    if (config.isDebug) {
      console.log(JSON.stringify(aggregateResult, null, 2));
    }
  } catch (error) {
    console.error(`\n[${getTimestamp()}] ❌ Failed to judge family '${family.familyId}': ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Partial validated output is preserved at ${scoresPath}; rerun without --fresh to resume.`);
    process.exit(1);
  }
}

// Write stability summary artifact
const overallStability = {
  schema: 'adaptive-training-recommender/ai-plan-judge-stability@1',
  samples: config.samples,
  familiesCount: allStabilities.length,
  maxContextUtilization,
  totalPromptTokens,
  totalCompletionTokens,
  families: allStabilities,
};
atomicWriteJson(stabilityPath, overallStability);

// Update completed manifest
const completedManifest = {
  ...runIdentity,
  startedAt,
  completedAt: new Date().toISOString(),
  completedFamilies: evaluatedRows.length,
  runtime: {
    endpointType: config.provider,
    model: config.model,
    modelDigest: preflight?.digest ?? null,
    quantization: preflight?.details?.quantization_level ?? null,
    requestedNumCtx: config.local.numCtx,
    requestedNumPredict: config.local.numPredict,
    thinkingEnabled: config.thinkingEnabled,
    temperature: 0.1,
    maxContextUtilization,
  },
};
atomicWriteJson(manifestPath, completedManifest);

log(`\n✅ Strictly validated ${evaluatedRows.length}/${familyRows.length} family responses across ${config.samples} sample(s). Saved to ${scoresPath}`);
if (maxContextUtilization > 0.75) {
  log(`⚠️ High context utilization observed: ${(maxContextUtilization * 100).toFixed(1)}% of context window.`);
}

log('Running analysis summary...');
execSync('node scripts/analyze-plan-judge.mjs', {
  stdio: 'inherit',
  env: {
    ...process.env,
    JUDGE_MODEL: config.model,
    JUDGE_PROVIDER: config.provider,
    JUDGE_SAMPLES: String(config.samples),
  },
});
