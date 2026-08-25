import { extractCleanJson } from '../validation.mjs';
import { createNormalizedResult, resolveRequestTimeoutMs, withProgress } from './base.mjs';

export async function callOllama({
  packetJson,
  schema,
  promptContent,
  schemaContent,
  config,
  attempt = 1,
  sampleIndex = 0,
  seed = null,
}) {
  const userPrompt = `${promptContent}\n\nStrict Output JSON Schema:\n${schemaContent}\n\nInput Sensitivity Family Data:\n\`\`\`json\n${packetJson}\n\`\`\`\n\nIMPORTANT:\n- Root JSON MUST include BOTH "caseScores" and "familyAssessment".\n- Every required score, confidence, rationale, and list field must be present.\n- Output ONLY valid JSON; incomplete or guessed fields will be rejected and retried.`;

  const body = {
    model: config.model,
    messages: [{ role: 'user', content: userPrompt }],
    format: schema, // Pass real dynamic JSON Schema object to Ollama
    stream: false,
    options: {
      num_ctx: config.local.numCtx,
      num_predict: config.local.numPredict,
      temperature: 0.1,
      ...(seed != null ? { seed } : {}),
    },
    ...(config.thinkingEnabled ? { think: true } : { think: false }),
  };

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  return withProgress(async () => {
    const response = await fetch(config.local.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(resolveRequestTimeoutMs(config)),
    });

    const completedAt = new Date().toISOString();
    const elapsedMs = Date.now() - startMs;

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API (${config.local.endpoint}) failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const rawText = data.message?.content || data.response;
    if (!rawText) throw new Error('Empty response received from Ollama.');

    const doneReason = data.done_reason || (data.done ? 'stop' : 'unknown');
    if (doneReason === 'length') {
      throw new Error(`Ollama response truncated due to length limit (context: ${config.local.numCtx}, predict: ${config.local.numPredict}).`);
    }

    const value = extractCleanJson(rawText);

    return createNormalizedResult({
      value,
      rawContent: rawText,
      provider: 'local',
      model: config.model,
      requestStartedAt: startedAt,
      requestCompletedAt: completedAt,
      promptTokens: data.prompt_eval_count ?? null,
      completionTokens: data.eval_count ?? null,
      contextLength: config.local.numCtx,
      doneReason,
      totalDurationMs: data.total_duration ? Math.round(data.total_duration / 1e6) : elapsedMs,
      evalDurationMs: data.eval_duration ? Math.round(data.eval_duration / 1e6) : null,
      loadDurationMs: data.load_duration ? Math.round(data.load_duration / 1e6) : null,
      thinkingEnabled: config.thinkingEnabled,
      seed,
      attempt,
      sampleIndex,
    });
  });
}
