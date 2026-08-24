import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const outputDir = resolve('artifacts/ai-plan-judge/latest');
const familiesPath = resolve(outputDir, 'families.jsonl');
const promptPath = resolve(outputDir, 'judge-prompt.md');
const schemaPath = resolve(outputDir, 'judge-response-schema.json');
const outputPath = resolve(outputDir, 'judge-scores.jsonl');
const manifestPath = resolve(outputDir, 'judge-run-manifest.json');
const requiredScores = [
  'safety_recovery_fit',
  'goal_event_fit',
  'sequencing',
  'periodization_taper',
  'preference_capacity_fit',
  'robustness',
  'overall',
];

function getTimestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function log(message) {
  console.log(`[${getTimestamp()}] ${message}`);
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve('.env'));
loadEnvFile(resolve('.env.local'));
loadEnvFile(resolve('../.env'));

const isLocal = process.argv.includes('--local') || Boolean(process.env.LOCAL_LLM_URL || process.env.OLLAMA_BASE_URL);
const deepseekKey = process.env.DEEPSEEK_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const provider = isLocal ? 'local' : deepseekKey ? 'deepseek' : geminiKey ? 'gemini' : openaiKey ? 'openai' : null;
const apiKey = isLocal ? 'local' : (deepseekKey || geminiKey || openaiKey);
const isQuick = process.argv.includes('--quick') || process.argv.includes('--flash');
const isResume = process.argv.includes('--resume');
const isFresh = (process.argv.includes('--fresh') || process.argv.includes('--force')) && !isResume;
const isDebug = process.argv.includes('--debug') || process.env.DEBUG === 'true' || process.env.DEBUG === '1';

if (!provider || !apiKey) {
  console.error(`\n[${getTimestamp()}] ❌ Error: no supported judge provider is configured.`);
  console.error('Set DEEPSEEK_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, OPENAI_API_KEY, or run with --local.');
  process.exit(1);
}

function getCliArg(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex !== -1 && exactIndex + 1 < process.argv.length && !process.argv[exactIndex + 1].startsWith('--')) {
    return process.argv[exactIndex + 1];
  }
  const prefix = `${name}=`;
  const prefixItem = process.argv.find((arg) => arg.startsWith(prefix));
  if (prefixItem) {
    return prefixItem.slice(prefix.length);
  }
  return null;
}

const cliModel = getCliArg('--model');
const localModelEnv = process.env.LOCAL_JUDGE_MODEL || process.env.OLLAMA_MODEL;
const knownCloudModels = new Set(['deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-4o', 'gemini-2.5-flash', 'gemini-1.5-pro']);
const configuredJudgeModel = process.env.JUDGE_MODEL;
const defaultLocalModel = isQuick
  ? 'hf.co/incoai/Muse-Glimmer-30B-DFlash2-GGUF'
  : 'hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M';
const defaultModel = isLocal
  ? (localModelEnv || (knownCloudModels.has(configuredJudgeModel) ? undefined : configuredJudgeModel) || defaultLocalModel)
  : provider === 'deepseek'
    ? (isQuick ? 'deepseek-v4-flash' : 'deepseek-v4-pro')
    : provider === 'gemini'
      ? 'gemini-2.5-flash'
      : 'gpt-4o';
const model = cliModel || (isLocal ? defaultModel : (configuredJudgeModel || defaultModel));
const thinkingEnabled = !isQuick && process.env.THINKING_MODE !== 'disabled';
const reasoningEffort = process.env.REASONING_EFFORT || 'low';

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const defaultTimeoutMs = isLocal ? 600_000 : 180_000;
const requestTimeoutMs = positiveInt(
  process.env.JUDGE_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS || process.env.LOCAL_TIMEOUT_MS,
  defaultTimeoutMs,
);
const localNumCtx = positiveInt(process.env.NUM_CTX || process.env.OLLAMA_NUM_CTX, 16384);
const localNumPredict = positiveInt(process.env.NUM_PREDICT || process.env.OLLAMA_NUM_PREDICT, 8192);
const rawLocalUrl = process.env.LOCAL_LLM_URL || process.env.OLLAMA_BASE_URL;
const localIsOllama = Boolean(process.env.OLLAMA_BASE_URL) || !rawLocalUrl || rawLocalUrl.includes('11434') || rawLocalUrl.includes('/api/chat');
function normalizeLocalEndpoint(rawUrl, ollama) {
  if (!rawUrl) return ollama ? 'http://localhost:11434/api/chat' : 'http://localhost:1234/v1/chat/completions';
  const trimmed = rawUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/api/chat') || trimmed.endsWith('/v1/chat/completions')) return trimmed;
  return `${trimmed}${ollama ? '/api/chat' : '/v1/chat/completions'}`;
}
const localEndpoint = normalizeLocalEndpoint(rawLocalUrl, localIsOllama);

if ([familiesPath, promptPath, schemaPath].some((path) => !existsSync(path))) {
  log('Judge artifacts are incomplete; generating the deterministic corpus first...');
  execSync('npm run simulate:plan-judge', { stdio: 'inherit' });
}

for (const path of [familiesPath, promptPath, schemaPath]) {
  if (!existsSync(path)) throw new Error(`Missing AI plan judge artifact after generation: ${path}`);
}

const promptContent = readFileSync(promptPath, 'utf8');
const schemaContent = readFileSync(schemaPath, 'utf8');
const familyRows = readFileSync(familiesPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${familiesPath}:${index + 1} invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

const expectedByFamily = new Map();
for (const family of familyRows) {
  if (!family || typeof family !== 'object' || typeof family.familyId !== 'string' || !Array.isArray(family.cases)) {
    throw new Error('Malformed sensitivity family in families.jsonl.');
  }
  if (expectedByFamily.has(family.familyId)) throw new Error(`Duplicate familyId in judge corpus: ${family.familyId}`);
  const caseIds = family.cases.map((item) => item?.input?.caseId);
  if (caseIds.some((id) => typeof id !== 'string' || !id.trim())) throw new Error(`Family ${family.familyId} contains a missing caseId.`);
  if (new Set(caseIds).size !== caseIds.length) throw new Error(`Family ${family.familyId} contains duplicate caseIds.`);
  expectedByFamily.set(family.familyId, caseIds);
}

function compactFamilyForJudge(rawFamily) {
  return {
    familyId: rawFamily.familyId,
    changedAxis: rawFamily.changedAxis,
    cases: rawFamily.cases.map((item) => ({
      caseId: item.input.caseId,
      label: item.input.label,
      changedAxis: item.input.changedAxis,
      day1: {
        tier: item.plan[0]?.readinessTier,
        mode: item.plan[0]?.mode,
        session: item.plan[0]?.session?.title,
        category: item.plan[0]?.session?.category,
        durationMin: item.plan[0]?.session?.durationMin,
        durationMax: item.plan[0]?.session?.durationMax,
        systemicCost: item.plan[0]?.session?.systemicCost,
      },
      plan14d: item.plan.map((day, index) => ({
        day: index + 1,
        mode: day.mode,
        session: day.session.title,
        category: day.session.category,
        cost: day.session.systemicCost,
      })),
      engineSummary: {
        restDays: item.engineSummary.restOrRecoveryDayCount,
        tierCounts: item.engineSummary.fatigueTierDayCounts,
        categories: item.engineSummary.categoryDistribution,
        warnings: item.engineSummary.qualityWarnings,
        violations: item.engineSummary.constraintViolations,
      },
    })),
  };
}

function extractCleanJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) throw new Error('Judge returned an empty response.');
  let cleaned = rawText
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) throw new Error('Judge response did not contain a complete JSON object.');
  cleaned = cleaned.slice(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Judge response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function boundedNumber(value, min, max, field) {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized < min || normalized > max) {
    throw new Error(`${field} must be a finite number in [${min}, ${max}], got ${JSON.stringify(value)}`);
  }
  return normalized;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function stringArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
  return value.map((item, index) => nonEmptyString(item, `${field}[${index}]`));
}

function validateAndNormalizeJudgeRow(value, familyId, expectedCaseIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Judge response for ${familyId} must be an object.`);
  if (value.schema !== 'adaptive-training-recommender/ai-plan-judge-response@1') {
    throw new Error(`${familyId}: unexpected or missing schema ${JSON.stringify(value.schema)}.`);
  }
  if (value.familyId !== familyId) {
    throw new Error(`${familyId}: response familyId must be exactly '${familyId}', got ${JSON.stringify(value.familyId)}.`);
  }
  if (!Array.isArray(value.caseScores)) throw new Error(`${familyId}.caseScores must be an array.`);

  const expectedSet = new Set(expectedCaseIds);
  const normalizedByCase = new Map();
  for (const item of value.caseScores) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${familyId}: malformed case score.`);
    const caseId = nonEmptyString(item.caseId, `${familyId}.caseScores.caseId`);
    if (!expectedSet.has(caseId)) throw new Error(`${familyId}: unexpected caseId '${caseId}'.`);
    if (normalizedByCase.has(caseId)) throw new Error(`${familyId}: duplicate caseId '${caseId}'.`);
    if (!item.scores || typeof item.scores !== 'object' || Array.isArray(item.scores)) throw new Error(`${caseId}.scores is required.`);
    const scores = Object.fromEntries(requiredScores.map((key) => [key, boundedNumber(item.scores[key], 0, 10, `${caseId}.scores.${key}`)]));
    normalizedByCase.set(caseId, {
      caseId,
      scores,
      confidence: boundedNumber(item.confidence, 0, 1, `${caseId}.confidence`),
      flags: stringArray(item.flags, `${caseId}.flags`),
      rationale: nonEmptyString(item.rationale, `${caseId}.rationale`),
      suggestedChanges: stringArray(item.suggestedChanges, `${caseId}.suggestedChanges`),
    });
  }

  const missingCases = expectedCaseIds.filter((caseId) => !normalizedByCase.has(caseId));
  if (missingCases.length) throw new Error(`${familyId}: missing case scores: ${missingCases.join(', ')}`);
  if (normalizedByCase.size !== expectedCaseIds.length) throw new Error(`${familyId}: case score cardinality mismatch.`);

  const assessment = value.familyAssessment;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) {
    throw new Error(`${familyId}.familyAssessment is required.`);
  }
  const validateCaseList = (field) => {
    const ids = stringArray(assessment[field], `${familyId}.familyAssessment.${field}`);
    for (const id of ids) if (!expectedSet.has(id)) throw new Error(`${familyId}.familyAssessment.${field} references unknown case '${id}'.`);
    if (new Set(ids).size !== ids.length) throw new Error(`${familyId}.familyAssessment.${field} contains duplicate caseIds.`);
    return ids;
  };

  return {
    schema: 'adaptive-training-recommender/ai-plan-judge-response@1',
    familyId,
    caseScores: expectedCaseIds.map((caseId) => normalizedByCase.get(caseId)),
    familyAssessment: {
      sensitivity_quality: boundedNumber(assessment.sensitivity_quality, 0, 10, `${familyId}.familyAssessment.sensitivity_quality`),
      overreactionCases: validateCaseList('overreactionCases'),
      underreactionCases: validateCaseList('underreactionCases'),
      goodSensitivityCases: validateCaseList('goodSensitivityCases'),
      rationale: nonEmptyString(assessment.rationale, `${familyId}.familyAssessment.rationale`),
      algorithmAdjustmentHypotheses: stringArray(assessment.algorithmAdjustmentHypotheses, `${familyId}.familyAssessment.algorithmAdjustmentHypotheses`),
    },
  };
}

async function flushOllamaMemory() {
  if (!localIsOllama) return;
  try {
    const endpointUrl = new URL(localEndpoint);
    const origin = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const response = await fetch(`${origin}/api/ps`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const data = await response.json();
    for (const loaded of data.models ?? []) {
      const loadedModel = loaded.name || loaded.model;
      if (!loadedModel) continue;
      try {
        await fetch(`${origin}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: loadedModel, keep_alive: 0 }),
          signal: AbortSignal.timeout(5000),
        });
        log(`🧹 Flushed stale Ollama model '${loadedModel}' from memory`);
      } catch {
        // Best-effort cleanup only.
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}

async function withProgress(request) {
  const timer = setInterval(() => process.stdout.write('.'), 5000);
  try {
    return await request();
  } finally {
    clearInterval(timer);
  }
}

async function callDeepSeek(familyJson) {
  const endpoint = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
  return withProgress(async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `${promptContent}\n\nStrict JSON Output Schema:\n${schemaContent}\nIMPORTANT: return ONLY valid JSON matching the schema. Root JSON MUST include both "caseScores" and "familyAssessment".`,
          },
          { role: 'user', content: `Analyze this family JSON and return the exact evaluation JSON object:\n${familyJson}` },
        ],
        ...(thinkingEnabled
          ? { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort }
          : { response_format: { type: 'json_object' }, temperature: 0.2 }),
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek API failed (${response.status}): ${await response.text()}`);
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const rawText = message?.content || message?.reasoning_content;
    if (!rawText) throw new Error('Empty response received from DeepSeek.');
    return extractCleanJson(rawText);
  });
}

async function callGemini(familyJson) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const userPrompt = `${promptContent}\n\nStrict Output Schema:\n${schemaContent}\n\nIMPORTANT: Root JSON MUST include both "caseScores" and "familyAssessment". Return JSON only.\n\nAnalyze this family JSON:\n${familyJson}`;
  return withProgress(async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
    if (!response.ok) throw new Error(`Gemini API failed (${response.status}): ${await response.text()}`);
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Empty response received from Gemini.');
    return extractCleanJson(rawText);
  });
}

async function callOpenAI(familyJson) {
  const endpoint = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  return withProgress(async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${promptContent}\n\nStrict JSON Schema:\n${schemaContent}\nIMPORTANT: Root JSON MUST include both "caseScores" and "familyAssessment". Return JSON only.` },
          { role: 'user', content: `Analyze this family JSON:\n${familyJson}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI API failed (${response.status}): ${await response.text()}`);
    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('Empty response received from OpenAI.');
    return extractCleanJson(rawText);
  });
}

async function callLocal(familyJson) {
  const isOllamaChat = localEndpoint.endsWith('/api/chat');
  const userPrompt = `${promptContent}\n\nStrict Output JSON Schema:\n${schemaContent}\n\nInput Sensitivity Family Data:\n\`\`\`json\n${familyJson}\n\`\`\`\n\nIMPORTANT:\n- Root JSON MUST include BOTH "caseScores" and "familyAssessment".\n- Every required score, confidence, rationale, and list field must be present.\n- Output ONLY valid JSON; incomplete or guessed fields will be rejected and retried.`;
  const body = isOllamaChat
    ? {
        model,
        messages: [{ role: 'user', content: userPrompt }],
        format: 'json',
        stream: false,
        options: { num_ctx: localNumCtx, num_predict: localNumPredict, temperature: 0.1 },
      }
    : {
        model,
        messages: [
          { role: 'system', content: `${promptContent}\n\nStrict JSON Schema:\n${schemaContent}\nIMPORTANT: output ONLY a complete valid JSON object matching the schema.` },
          { role: 'user', content: `Analyze this family JSON:\n${familyJson}` },
        ],
        temperature: 0.1,
        max_tokens: localNumPredict,
        response_format: { type: 'json_object' },
      };

  return withProgress(async () => {
    const response = await fetch(localEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Local LLM (${localEndpoint}) failed (${response.status}): ${await response.text()}`);
    const data = await response.json();
    const rawText = isOllamaChat ? data.message?.content : data.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('Empty response received from local LLM.');
    return extractCleanJson(rawText);
  });
}

async function callProvider(familyJson) {
  if (provider === 'local') return callLocal(familyJson);
  if (provider === 'deepseek') return callDeepSeek(familyJson);
  if (provider === 'gemini') return callGemini(familyJson);
  return callOpenAI(familyJson);
}

async function callWithRetry(familyJson, familyId, expectedCaseIds, retries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const rawResult = await callProvider(familyJson);
      return validateAndNormalizeJudgeRow(rawResult, familyId, expectedCaseIds);
    } catch (error) {
      lastError = error;
      const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError' || String(error).toLowerCase().includes('timeout') || String(error).toLowerCase().includes('aborted');
      const errorMsg = isTimeout
        ? `Request timed out after ${Math.round(requestTimeoutMs / 1000)}s`
        : (error instanceof Error ? error.message : String(error));
      if (attempt === retries) {
        lastError = new Error(errorMsg);
        break;
      }
      const delaySeconds = attempt * 3;
      process.stdout.write(`\n[${getTimestamp()}] ⚠️ ${familyId} attempt ${attempt} rejected: ${errorMsg}. Retrying in ${delaySeconds}s...\n`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delaySeconds * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const runIdentity = {
  schema: 'adaptive-training-recommender/ai-plan-judge-run-manifest@1',
  familiesSha256: hashFile(familiesPath),
  promptSha256: hashFile(promptPath),
  responseSchemaSha256: hashFile(schemaPath),
  judgeModel: model,
  judgeProvider: provider,
};

function compatibleManifest(value) {
  return value
    && value.schema === runIdentity.schema
    && value.familiesSha256 === runIdentity.familiesSha256
    && value.promptSha256 === runIdentity.promptSha256
    && value.responseSchemaSha256 === runIdentity.responseSchemaSha256
    && value.judgeModel === runIdentity.judgeModel
    && value.judgeProvider === runIdentity.judgeProvider;
}

const cachedByFamily = new Map();
let previousManifest = null;
if (!isFresh && existsSync(outputPath) && existsSync(manifestPath)) {
  try {
    previousManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (compatibleManifest(previousManifest)) {
      for (const line of readFileSync(outputPath, 'utf8').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        const parsed = JSON.parse(line);
        const expectedCaseIds = expectedByFamily.get(parsed.familyId);
        if (!expectedCaseIds) continue;
        const validated = validateAndNormalizeJudgeRow(parsed, parsed.familyId, expectedCaseIds);
        cachedByFamily.set(parsed.familyId, validated);
      }
    } else {
      log('Existing judge cache ignored because corpus/prompt/schema/model/provider provenance does not match this run.');
    }
  } catch (error) {
    log(`Existing judge cache ignored because it is invalid: ${error instanceof Error ? error.message : String(error)}`);
    cachedByFamily.clear();
  }
}

const startedAt = compatibleManifest(previousManifest) && previousManifest.startedAt ? previousManifest.startedAt : new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify({ ...runIdentity, startedAt }, null, 2)}\n`);
if (isFresh) writeFileSync(outputPath, '', 'utf8');

if (provider === 'local') await flushOllamaMemory();
log(`=== AI Plan Judge: ${provider.toUpperCase()} / ${model} ===`);
if (provider === 'deepseek') log(`🧠 Thinking mode: ${thinkingEnabled ? `enabled (${reasoningEffort})` : 'disabled'}`);
if (provider === 'local') {
  log(`🔧 Endpoint: ${localEndpoint}`);
  log(`🔧 num_ctx: ${localNumCtx} | num_predict: ${localNumPredict}`);
}
log(`⏱️ Request timeout: ${Math.round(requestTimeoutMs / 1000)}s`);
log(`🔒 Evidence mode: strict — missing scores/cases/assessment fields are rejected, never synthesized.`);
log(`♻️ Cache: ${isFresh ? 'disabled (--fresh)' : `${cachedByFamily.size} compatible family result(s) reusable (resuming)`}`);
log(`Evaluating ${familyRows.length} sensitivity families...\n`);

const evaluatedRows = [];
for (let index = 0; index < familyRows.length; index += 1) {
  const family = familyRows[index];
  const expectedCaseIds = expectedByFamily.get(family.familyId);
  const cached = cachedByFamily.get(family.familyId);
  if (cached) {
    evaluatedRows.push(JSON.stringify(cached));
    writeFileSync(outputPath, `${evaluatedRows.join('\n')}\n`, 'utf8');
    log(`[${index + 1}/${familyRows.length}] ${family.familyId}: ✓ cached`);
    continue;
  }

  const started = Date.now();
  process.stdout.write(`[${getTimestamp()}] [${index + 1}/${familyRows.length}] ${family.familyId} (${family.cases.length} cases)... `);
  try {
    const judged = await callWithRetry(JSON.stringify(compactFamilyForJudge(family)), family.familyId, expectedCaseIds);
    evaluatedRows.push(JSON.stringify(judged));
    writeFileSync(outputPath, `${evaluatedRows.join('\n')}\n`, 'utf8');
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    console.log(`✓ ${elapsedSeconds}s | sensitivity ${judged.familyAssessment.sensitivity_quality}/10`);
    if (isDebug) console.log(JSON.stringify(judged, null, 2));
  } catch (error) {
    console.error(`\n[${getTimestamp()}] ❌ Failed to judge family '${family.familyId}': ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Partial validated output is preserved at ${outputPath}; rerun with \`npm run judge:local:resume\` or without --fresh to resume only if the manifest still matches.`);
    process.exit(1);
  }
}

writeFileSync(manifestPath, `${JSON.stringify({ ...runIdentity, startedAt, completedAt: new Date().toISOString(), completedFamilies: evaluatedRows.length }, null, 2)}\n`);
log(`\n✅ Strictly validated ${evaluatedRows.length}/${familyRows.length} family responses. Saved to ${outputPath}`);
log('Running analysis summary...');
execSync('node scripts/analyze-plan-judge.mjs', {
  stdio: 'inherit',
  env: { ...process.env, JUDGE_MODEL: model, JUDGE_PROVIDER: provider },
});
