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
const defaultModel = isLocal
  ? (process.env.JUDGE_MODEL || 'deepseek-r1:8b')
  : provider === 'deepseek'
    ? (isQuick ? 'deepseek-v4-flash' : 'deepseek-v4-pro')
    : provider === 'gemini'
      ? 'gemini-2.5-flash'
      : 'gpt-4o';
const model = process.env.JUDGE_MODEL || defaultModel;

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
  // Strip markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  // If text contains surrounding prose, extract the outer JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

async function callDeepSeek(familyJson, onProgress) {
  const endpoint = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: `${promptContent}\n\nStrict JSON Output Schema:\n${schemaContent}\nIMPORTANT: Your response must be ONLY valid JSON matching the schema. Do not output conversational text.`,
      },
      {
        role: 'user',
        content: `Analyze this family JSON and return the exact evaluation JSON object:\n${familyJson}`,
      },
    ],
    // When thinking mode is enabled:
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
  const userPrompt = `${promptContent}\n\nStrict Output Schema:\n${schemaContent}\n\nAnalyze this family JSON:\n${familyJson}`;

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
          { role: 'system', content: `${promptContent}\n\nStrict JSON Schema:\n${schemaContent}` },
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
  const endpoint = process.env.LOCAL_LLM_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1/chat/completions';
  const timer = setInterval(() => {
    if (onProgress) onProgress();
  }, 1000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer local',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${promptContent}\n\nStrict JSON Schema:\n${schemaContent}\nIMPORTANT: You must output ONLY a valid JSON object matching this schema. No markdown or conversational text.` },
          { role: 'user', content: `Analyze this family JSON:\n${familyJson}` },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local LLM (${endpoint}) failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('Empty response received from Local LLM');
    return extractCleanJson(rawText);
  } finally {
    clearInterval(timer);
  }
}

async function callWithRetry(familyJson, onProgress, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (provider === 'local') return await callLocal(familyJson, onProgress);
      if (provider === 'deepseek') return await callDeepSeek(familyJson, onProgress);
      if (provider === 'gemini') return await callGemini(familyJson, onProgress);
      return await callOpenAI(familyJson, onProgress);
    } catch (err) {
      if (attempt === retries) throw err;
      process.stdout.write(`\n[${getTimestamp()}] ⚠️ Attempt ${attempt} error: ${err.message}. Retrying in ${attempt * 3}s...\n`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

const evaluatedRows = [];

for (let i = 0; i < lines.length; i++) {
  const familyJson = lines[i];
  const familyObj = JSON.parse(familyJson);
  const startSec = Date.now();
  let elapsed = 0;

  process.stdout.write(`[${getTimestamp()}] [${i + 1}/${lines.length}] Evaluating family '${familyObj.familyId}' (${familyObj.cases.length} cases)... `);

  const onProgress = () => {
    elapsed = Math.round((Date.now() - startSec) / 1000);
    process.stdout.write(`\r[${getTimestamp()}] [${i + 1}/${lines.length}] Evaluating family '${familyObj.familyId}' (${familyObj.cases.length} cases)... [${elapsed}s elapsed] `);
  };

  try {
    const payloadToSend = JSON.stringify(compactFamilyForJudge(familyObj));
    const judged = await callWithRetry(payloadToSend, onProgress);
    const totalSec = Math.round((Date.now() - startSec) / 1000);
    evaluatedRows.push(JSON.stringify(judged));
    console.log(`\r[${getTimestamp()}] [${i + 1}/${lines.length}] Evaluating family '${familyObj.familyId}' (${familyObj.cases.length} cases)... ✓ (${totalSec}s | Sensitivity: ${judged.familyAssessment?.sensitivity_quality ?? 'N/A'}/10)`);
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
