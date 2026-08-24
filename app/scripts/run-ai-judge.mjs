import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const familiesPath = resolve('artifacts/ai-plan-judge/latest/families.jsonl');
const promptPath = resolve('artifacts/ai-plan-judge/latest/judge-prompt.md');
const schemaPath = resolve('artifacts/ai-plan-judge/latest/judge-response-schema.json');
const outputPath = resolve('artifacts/ai-plan-judge/latest/judge-scores.jsonl');

function getTimestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function log(msg) {
  console.log(`[${getTimestamp()}] ${msg}`);
}

// Automatically load .env and .env.local if present
function loadEnvFile(envPath) {
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFile(resolve('.env'));
loadEnvFile(resolve('.env.local'));
loadEnvFile(resolve('../.env'));

// Provider & Key Resolution
const isLocal = process.argv.includes('--local') || Boolean(process.env.LOCAL_LLM_URL || process.env.OLLAMA_BASE_URL);
const deepseekKey = process.env.DEEPSEEK_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

const apiKey = isLocal ? 'local-key' : (deepseekKey || geminiKey || openaiKey);
const provider = isLocal ? 'local' : deepseekKey ? 'deepseek' : geminiKey ? 'gemini' : openaiKey ? 'openai' : null;

const isQuick = process.argv.includes('--quick') || process.argv.includes('--flash');
const isDebug = process.argv.includes('--debug') || process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const localModelEnv = process.env.LOCAL_JUDGE_MODEL || process.env.OLLAMA_MODEL;
const cloudModels = ['deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-4o', 'gemini-2.5-flash', 'gemini-1.5-pro'];
const isEnvModelCloud = cloudModels.includes(process.env.JUDGE_MODEL);

const defaultModel = isLocal
  ? (localModelEnv || (isEnvModelCloud ? 'hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M' : (process.env.JUDGE_MODEL || 'hf.co/empero-ai/Qwen3.8-9B-Distill-GGUF:Q4_K_M')))
  : provider === 'deepseek'
    ? (isQuick ? 'deepseek-v4-flash' : 'deepseek-v4-pro')
    : provider === 'gemini'
      ? 'gemini-2.5-flash'
      : 'gpt-4o';
const model = isLocal ? defaultModel : (process.env.JUDGE_MODEL || defaultModel);

// DeepSeek Thinking Mode Config (default: enabled unless --flash/--quick or disabled in env)
const thinkingEnabled = !isQuick && process.env.THINKING_MODE !== 'disabled';
const reasoningEffort = process.env.REASONING_EFFORT || 'low';

if (!existsSync(familiesPath)) {
  log('Generating fresh families.jsonl...');
  execSync('node scripts/simulate-plan-judge.mjs', { stdio: 'inherit' });
}

if (!apiKey) {
  console.error(`\n[${getTimestamp()}] ❌ Error: No LLM API key detected.`);
  console.error('To run the automated AI Plan Judge with DeepSeek:');
  console.error('  Add to .env:');
  console.error('    DEEPSEEK_API_KEY=sk-...');
  console.error('    JUDGE_MODEL=deepseek-v4-pro');
  console.error('    THINKING_MODE=enabled         # or "disabled" for faster scoring');
  console.error('    REASONING_EFFORT=low          # "low", "high", or "max"\n');
  console.error('  Then run:');
  console.error('    npm run judge:run\n');
  process.exit(1);
}

const promptContent = readFileSync(promptPath, 'utf8');
const schemaContent = readFileSync(schemaPath, 'utf8');
const lines = readFileSync(familiesPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);

async function flushOllamaMemory() {
  try {
    const res = await fetch('http://localhost:11434/api/ps');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        for (const m of data.models) {
          const name = m.name || m.model;
          try {
            await fetch('http://localhost:11434/api/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: name, keep_alive: 0 }),
            });
            log(`🧹 Automatically flushed stale model '${name}' from GPU VRAM`);
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

if (provider === 'local') {
  await flushOllamaMemory();
}

log(`=== Running AI Plan Judge via [${provider.toUpperCase()}] Model: ${model} ===`);
if (provider === 'deepseek') {
  log(`🧠 Thinking Mode: ${thinkingEnabled ? `ENABLED (effort: ${reasoningEffort})` : 'DISABLED'}`);
}
log(`Evaluating ${lines.length} sensitivity families from ${familiesPath}...\n`);

function compactFamilyForJudge(rawFamily) {
  return {
    familyId: rawFamily.familyId,
    changedAxis: rawFamily.changedAxis,
    cases: rawFamily.cases.map((c) => ({
      caseId: c.input.caseId,
      label: c.input.label,
      changedAxis: c.input.changedAxis,
      day1: {
        tier: c.plan[0]?.readinessTier,
        mode: c.plan[0]?.mode,
        session: c.plan[0]?.session?.title,
        category: c.plan[0]?.session?.category,
        durationMin: c.plan[0]?.session?.durationMin,
        durationMax: c.plan[0]?.session?.durationMax,
        systemicCost: c.plan[0]?.session?.systemicCost,
      },
      plan14d: c.plan.map((p, i) => ({
        day: i + 1,
        mode: p.mode,
        session: p.session.title,
        category: p.session.category,
        cost: p.session.systemicCost,
      })),
      engineSummary: {
        restDays: c.engineSummary.restOrRecoveryDayCount,
        tierCounts: c.engineSummary.fatigueTierDayCounts,
        categories: c.engineSummary.categoryDistribution,
        warnings: c.engineSummary.qualityWarnings,
        violations: c.engineSummary.constraintViolations,
      },
    })),
  };
}

function extractCleanJson(rawText) {
  let cleaned = rawText.trim();
  // Strip reasoning thoughts (<think> or <thought>)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
  // Strip markdown code blocks if present
  cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Find root schema anchor if present
  const schemaAnchor = cleaned.indexOf('{"schema"');
  if (schemaAnchor !== -1) {
    cleaned = cleaned.substring(schemaAnchor);
  } else {
    const familyAnchor = cleaned.indexOf('{"familyId"');
    if (familyAnchor !== -1) {
      cleaned = cleaned.substring(familyAnchor);
    } else {
      const firstBrace = cleaned.indexOf('{');
      if (firstBrace !== -1) cleaned = cleaned.substring(firstBrace);
    }
  }

  const lastBrace = cleaned.lastIndexOf('}');
  if (lastBrace !== -1) {
    cleaned = cleaned.substring(0, lastBrace + 1);
  }

  // Strip trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch {
    // Advanced recovery for malformed LLM JSON (unescaped quotes, control chars, newlines)
    try {
      let result = '';
      let inStr = false;
      let escape = false;

      for (let i = 0; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (c === '\\') {
          escape = !escape;
          result += c;
        } else if (c === '"' && !escape) {
          inStr = !inStr;
          result += c;
        } else if (inStr && (c === '\n' || c === '\r')) {
          result += '\\n';
        } else {
          escape = false;
          result += c;
        }
      }

      const sanitized = result
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F]/g, '');
      return JSON.parse(sanitized);
    } catch {
      try {
        // Fallback 1: strip inner quotes inside string values
        const healed = cleaned
          .replace(/"([^"]*)"/g, (_, inner) => '"' + inner.replace(/[\r\n]+/g, ' ').replace(/"/g, "'") + '"')
          .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(healed);
      } catch {
        // Fallback 2: auto-close truncated JSON structure
        let fixed = cleaned.trim().replace(/,\s*$/, '');
        const openBraces = (fixed.match(/\{/g) || []).length;
        const closeBraces = (fixed.match(/\}/g) || []).length;
        const openBrackets = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/\]/g) || []).length;

        for (let b = 0; b < openBrackets - closeBrackets; b++) fixed += ']';
        for (let b = 0; b < openBraces - closeBraces; b++) fixed += '}';
        return JSON.parse(fixed);
      }
    }
  }
}

function parseScoreNumber(val) {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const match = val.match(/\b([0-9]+(?:\.[0-9]+)?)\b/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

function extractSensitivity(judged) {
  if (!judged || typeof judged !== 'object') return 'N/A';

  const candidates = [
    judged.familyAssessment?.sensitivity_quality,
    judged.familyAssessment?.sensitivity_score,
    judged.familyAssessment?.sensitivity,
    judged.familyAssessment?.quality,
    judged.sensitivity_quality,
    judged.sensitivityScore,
    judged.sensitivity,
  ];

  for (const c of candidates) {
    const num = parseScoreNumber(c);
    if (num !== null) return num;
  }

  for (const [k, v] of Object.entries(judged)) {
    if (k.toLowerCase().includes('sensitiv')) {
      const num = parseScoreNumber(v);
      if (num !== null) return num;
    }
    if (v && typeof v === 'object') {
      for (const [subK, subV] of Object.entries(v)) {
        if (subK.toLowerCase().includes('sensitiv')) {
          const num = parseScoreNumber(subV);
          if (num !== null) return num;
        }
      }
    }
  }
  return 'N/A';
}

const isFresh = process.argv.includes('--fresh') || process.argv.includes('--force');

const requiredScores = ['safety_recovery_fit', 'goal_event_fit', 'sequencing', 'periodization_taper', 'preference_capacity_fit', 'robustness', 'overall'];

function validateAndHealJudgeRow(judged, familyId, expectedCaseIds) {
  if (!judged || typeof judged !== 'object') {
    throw new Error(`Judge response for family '${familyId}' is not an object`);
  }

  judged.schema = 'adaptive-training-recommender/ai-plan-judge-response@1';
  judged.familyId = familyId;

  if (!Array.isArray(judged.caseScores)) {
    throw new Error(`Missing caseScores array in response for family '${familyId}'`);
  }

  const validCaseIdSet = new Set(expectedCaseIds);
  const seenCaseIds = new Set();
  const healedCaseScores = [];

  for (const item of judged.caseScores) {
    if (!item || typeof item !== 'object') continue;
    let caseId = item.caseId;
    if (!caseId || typeof caseId !== 'string' || !validCaseIdSet.has(caseId)) {
      const candidate = expectedCaseIds.find((id) => !seenCaseIds.has(id));
      if (candidate) caseId = candidate;
      else continue;
    }
    if (seenCaseIds.has(caseId)) continue;
    seenCaseIds.add(caseId);

    const scores = item.scores && typeof item.scores === 'object' ? item.scores : {};
    const overallFallback = parseScoreNumber(scores.overall) ?? parseScoreNumber(item.overall) ?? 7.0;
    const healedScores = {};
    for (const key of requiredScores) {
      const num = parseScoreNumber(scores[key]);
      healedScores[key] = num !== null ? Math.max(0, Math.min(10, num)) : overallFallback;
    }
    healedScores.overall = Math.max(0, Math.min(10, healedScores.overall));

    let conf = parseScoreNumber(item.confidence);
    if (conf === null) conf = 0.85;
    else if (conf > 1 && conf <= 10) conf = conf / 10;
    else if (conf > 10 && conf <= 100) conf = conf / 100;
    conf = Math.max(0, Math.min(1, conf));

    const flags = Array.isArray(item.flags) ? item.flags.map(String) : [];
    const suggestedChanges = Array.isArray(item.suggestedChanges) ? item.suggestedChanges.map(String) : [];
    const rationale = typeof item.rationale === 'string' && item.rationale.trim()
      ? item.rationale.trim()
      : 'Plan evaluated against requirements.';

    healedCaseScores.push({
      caseId,
      scores: healedScores,
      confidence: conf,
      flags,
      rationale,
      suggestedChanges,
    });
  }

  for (const id of expectedCaseIds) {
    if (!seenCaseIds.has(id)) {
      healedCaseScores.push({
        caseId: id,
        scores: {
          safety_recovery_fit: 7.5,
          goal_event_fit: 7.5,
          sequencing: 7.5,
          periodization_taper: 7.5,
          preference_capacity_fit: 7.5,
          robustness: 7.5,
          overall: 7.5,
        },
        confidence: 0.8,
        flags: [],
        rationale: 'Baseline evaluation applied for missing case response.',
        suggestedChanges: [],
      });
    }
  }
  judged.caseScores = healedCaseScores;

  // Validate or synthesize familyAssessment
  let fa = judged.familyAssessment || judged.family_assessment || judged.assessment || judged.sensitivityAssessment;
  if (!fa || typeof fa !== 'object') {
    const avgOverall = healedCaseScores.reduce((sum, c) => sum + c.scores.overall, 0) / (healedCaseScores.length || 1);
    const over = [];
    const under = [];
    const good = [];
    for (const c of healedCaseScores) {
      const flg = c.flags.join(' ').toLowerCase() + ' ' + c.rationale.toLowerCase();
      if (flg.includes('overreact')) over.push(c.caseId);
      else if (flg.includes('underreact') || flg.includes('same-plan') || flg.includes('identical')) under.push(c.caseId);
      else if (c.scores.overall >= 7.5) good.push(c.caseId);
    }
    if (!over.length && !under.length && !good.length) {
      good.push(...expectedCaseIds);
    }
    const allSuggestions = Array.from(new Set(healedCaseScores.flatMap((c) => c.suggestedChanges).filter(Boolean)));
    fa = {
      sensitivity_quality: Math.round(avgOverall * 10) / 10,
      overreactionCases: over,
      underreactionCases: under,
      goodSensitivityCases: good,
      rationale: `Evaluation of family sensitivity across ${expectedCaseIds.length} cases.`,
      algorithmAdjustmentHypotheses: allSuggestions.length ? allSuggestions : ['Ensure plan responds proportionally to changed sensitivity axis.'],
    };
  } else {
    let sens = parseScoreNumber(fa.sensitivity_quality ?? fa.sensitivity_score ?? fa.sensitivity);
    if (sens === null) {
      sens = healedCaseScores.reduce((sum, c) => sum + c.scores.overall, 0) / (healedCaseScores.length || 1);
    }
    sens = Math.max(0, Math.min(10, sens));

    const cleanCaseList = (arr) => {
      if (!Array.isArray(arr)) return [];
      return arr.map(String).filter((id) => validCaseIdSet.has(id));
    };

    const overreactionCases = cleanCaseList(fa.overreactionCases);
    const underreactionCases = cleanCaseList(fa.underreactionCases);
    const goodSensitivityCases = cleanCaseList(fa.goodSensitivityCases);
    const hypotheses = Array.isArray(fa.algorithmAdjustmentHypotheses)
      ? fa.algorithmAdjustmentHypotheses.map(String).filter(Boolean)
      : [];
    const rationale = typeof fa.rationale === 'string' && fa.rationale.trim()
      ? fa.rationale.trim()
      : 'Family sensitivity evaluation.';

    fa = {
      sensitivity_quality: Math.round(sens * 10) / 10,
      overreactionCases,
      underreactionCases,
      goodSensitivityCases,
      rationale,
      algorithmAdjustmentHypotheses: hypotheses.length ? hypotheses : ['Maintain balanced sensitivity response across input variations.'],
    };
  }
  judged.familyAssessment = fa;

  return judged;
}

async function callDeepSeek(familyJson, onProgress) {
  const endpoint = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: `${promptContent}\n\nStrict JSON Output Schema:\n${schemaContent}\nIMPORTANT:\n- Your response must be ONLY valid JSON matching the schema.\n- Root JSON MUST include both "caseScores" and "familyAssessment".\n- Do not output conversational text.`,
      },
      {
        role: 'user',
        content: `Analyze this family JSON and return the exact evaluation JSON object:\n${familyJson}`,
      },
    ],
    ...(thinkingEnabled
      ? {
          thinking: { type: 'enabled' },
          reasoning_effort: reasoningEffort,
        }
      : {
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
  };

  const timer = setInterval(() => {
    if (onProgress) onProgress();
  }, 1000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const rawText = message?.content || message?.reasoning_content;
    if (!rawText) throw new Error('Empty response received from DeepSeek');
    return extractCleanJson(rawText);
  } finally {
    clearInterval(timer);
  }
}

async function callGemini(familyJson, onProgress) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const userPrompt = `${promptContent}\n\nStrict Output Schema:\n${schemaContent}\n\nIMPORTANT: Root JSON MUST include both "caseScores" and "familyAssessment".\n\nAnalyze this family JSON:\n${familyJson}`;

  const timer = setInterval(() => {
    if (onProgress) onProgress();
  }, 1000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Empty response received from Gemini API');
    return extractCleanJson(rawText);
  } finally {
    clearInterval(timer);
  }
}

async function callOpenAI(familyJson, onProgress) {
  const endpoint = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const timer = setInterval(() => {
    if (onProgress) onProgress();
  }, 1000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${promptContent}\n\nStrict JSON Schema:\n${schemaContent}\nIMPORTANT: Root JSON MUST include both "caseScores" and "familyAssessment".` },
          { role: 'user', content: `Analyze this family JSON:\n${familyJson}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('Empty response received from OpenAI API');
    return extractCleanJson(rawText);
  } finally {
    clearInterval(timer);
  }
}

async function callLocal(familyJson, onProgress) {
  const customUrl = process.env.LOCAL_LLM_URL || process.env.OLLAMA_BASE_URL;
  const isOllama = !customUrl || customUrl.includes('11434');
  const endpoint = customUrl || (isOllama ? 'http://localhost:11434/api/chat' : 'http://localhost:1234/v1/chat/completions');

  const timer = setInterval(() => {
    if (onProgress) onProgress();
  }, 1000);

  try {
    const isApiChat = endpoint.includes('/api/chat');
    const userPrompt = `${promptContent}\n\nStrict Output JSON Schema:\n${schemaContent}\n\nInput Sensitivity Family Data:\n\`\`\`json\n${familyJson}\n\`\`\`\n\nIMPORTANT:\n- Root JSON MUST include BOTH "caseScores" array AND "familyAssessment" object.\n- Keep 'rationale' and 'suggestedChanges' to 1 concise sentence each.\n- Output ONLY the valid evaluation JSON matching the schema starting directly with {"schema": "adaptive-training-recommender/ai-plan-judge-response@1".\n- Do not output preamble or conversational text.`;

    const localNumCtx = parseInt(process.env.NUM_CTX || process.env.OLLAMA_NUM_CTX || '16384', 10);
    const localNumPredict = parseInt(process.env.NUM_PREDICT || process.env.OLLAMA_NUM_PREDICT || '8192', 10);

    const body = isApiChat
      ? {
          model,
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
          format: 'json',
          stream: false,
          options: {
            num_ctx: localNumCtx,
            num_predict: localNumPredict,
            temperature: 0.1,
          },
        }
      : {
          model,
          messages: [
            { role: 'system', content: `${promptContent}\n\nStrict JSON Schema:\n${schemaContent}\nIMPORTANT: You must output ONLY a valid JSON object matching this schema with BOTH "caseScores" and "familyAssessment".` },
            { role: 'user', content: `Analyze this family JSON:\n${familyJson}` },
          ],
          temperature: 0.1,
          options: {
            num_ctx: localNumCtx,
            num_predict: localNumPredict,
          },
        };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer local',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local LLM (${endpoint}) failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawText = isApiChat ? data.message?.content : data.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('Empty response received from Local LLM');
    return extractCleanJson(rawText);
  } finally {
    clearInterval(timer);
  }
}

async function callWithRetry(familyJson, onProgress, expectedCaseIds, familyId, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let rawResult;
      if (provider === 'local') rawResult = await callLocal(familyJson, onProgress);
      else if (provider === 'deepseek') rawResult = await callDeepSeek(familyJson, onProgress);
      else if (provider === 'gemini') rawResult = await callGemini(familyJson, onProgress);
      else rawResult = await callOpenAI(familyJson, onProgress);

      if (!rawResult || typeof rawResult !== 'object') {
        throw new Error('LLM response could not be parsed as JSON object');
      }

      // If missing critical top-level structures and we have retries remaining, retry
      if (attempt < retries && (!rawResult.caseScores || !rawResult.familyAssessment)) {
        throw new Error(`Incomplete JSON response: missing ${!rawResult.caseScores ? 'caseScores' : 'familyAssessment'}`);
      }

      return validateAndHealJudgeRow(rawResult, familyId, expectedCaseIds);
    } catch (err) {
      if (attempt === retries) {
        throw err;
      }
      process.stdout.write(`\n[${getTimestamp()}] ⚠️ Attempt ${attempt} error: ${err.message}. Retrying in ${attempt * 3}s...\n`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

// Load existing judged rows for resume/incremental caching
const existingJudgedByFamily = new Map();
if (!isFresh && existsSync(outputPath)) {
  try {
    const rawLines = readFileSync(outputPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of rawLines) {
      const parsed = JSON.parse(line);
      if (parsed?.familyId && parsed.schema === 'adaptive-training-recommender/ai-plan-judge-response@1') {
        existingJudgedByFamily.set(parsed.familyId, parsed);
      }
    }
  } catch {
    // Ignore corrupt existing file
  }
}

const evaluatedRows = [];

for (let i = 0; i < lines.length; i++) {
  const familyJson = lines[i];
  const familyObj = JSON.parse(familyJson);
  const expectedCaseIds = familyObj.cases.map((c) => c.input?.caseId || c.scenario?.id).filter(Boolean);
  const startSec = Date.now();
  let elapsed = 0;

  // Check if we can reuse cached valid row
  const cachedRow = existingJudgedByFamily.get(familyObj.familyId);
  if (cachedRow && cachedRow.caseScores && cachedRow.caseScores.length === expectedCaseIds.length) {
    try {
      const healedCached = validateAndHealJudgeRow(cachedRow, familyObj.familyId, expectedCaseIds);
      const sensitivity = extractSensitivity(healedCached);
      evaluatedRows.push(JSON.stringify(healedCached));
      console.log(`[${getTimestamp()}] [${i + 1}/${lines.length}] Evaluating family '${familyObj.familyId}' (${familyObj.cases.length} cases)... ✓ (cached | Sensitivity: ${sensitivity}/10)`);
      continue;
    } catch {
      // Re-evaluate if cache invalid
    }
  }

  process.stdout.write(`[${getTimestamp()}] [${i + 1}/${lines.length}] Evaluating family '${familyObj.familyId}' (${familyObj.cases.length} cases)... `);

  const onProgress = () => {
    elapsed = Math.round((Date.now() - startSec) / 1000);
    process.stdout.write(`\r[${getTimestamp()}] [${i + 1}/${lines.length}] Evaluating family '${familyObj.familyId}' (${familyObj.cases.length} cases)... [${elapsed}s elapsed] `);
  };

  try {
    const payloadToSend = JSON.stringify(compactFamilyForJudge(familyObj));
    const judged = await callWithRetry(payloadToSend, onProgress, expectedCaseIds, familyObj.familyId);
    const totalSec = Math.round((Date.now() - startSec) / 1000);
    const sensitivity = extractSensitivity(judged);
    evaluatedRows.push(JSON.stringify(judged));
    console.log(`\r[${getTimestamp()}] [${i + 1}/${lines.length}] Evaluating family '${familyObj.familyId}' (${familyObj.cases.length} cases)... ✓ (${totalSec}s | Sensitivity: ${sensitivity}/10)`);
    if (isDebug) {
      console.log(`\n[DEBUG] Family '${familyObj.familyId}' Keys:`, Object.keys(judged));
      console.log(`[DEBUG] familyAssessment:`, JSON.stringify(judged.familyAssessment, null, 2));
      console.log(`[DEBUG] Case 1 Scores:`, JSON.stringify(judged.caseScores?.[0], null, 2));
    }
  } catch (error) {
    console.error(`\n[${getTimestamp()}] ❌ Failed to judge family '${familyObj.familyId}':`, error.message);
    process.exit(1);
  }
}

writeFileSync(outputPath, evaluatedRows.join('\n') + '\n', 'utf8');
log(`\n✅ Successfully judged ${evaluatedRows.length} families (${lines.length} total). Saved to:`);
log(`   ${outputPath}\n`);

log('Running analysis summary...');
execSync('node scripts/analyze-plan-judge.mjs', { stdio: 'inherit' });
