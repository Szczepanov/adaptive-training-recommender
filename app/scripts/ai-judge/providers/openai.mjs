import { extractCleanJson } from '../validation.mjs';
import { createNormalizedResult, resolveRequestTimeoutMs, withProgress } from './base.mjs';

export async function callOpenAI({
  packetJson,
  schema,
  promptContent,
  schemaContent,
  config,
  attempt = 1,
  sampleIndex = 0,
  seed = null,
}) {
  const isLocalOpenAI = config.provider === 'local';
  const endpoint = isLocalOpenAI ? config.local.endpoint : config.cloud.openaiBaseUrl;
  const apiKey = isLocalOpenAI ? 'local' : config.apiKey;

  const systemContent = `${promptContent}\n\nStrict JSON Schema:\n${schemaContent}\nIMPORTANT: Root JSON MUST include both "caseScores" and "familyAssessment". Return JSON only.`;
  const userContent = `Analyze this family JSON:\n${packetJson}`;

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
    ...(seed != null ? { seed } : {}),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ai_plan_judge_response',
        strict: true,
        schema,
      },
    },
  };

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  return withProgress(async () => {
    const timeoutMs = resolveRequestTimeoutMs(config);
    let response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Fallback if provider doesn't support json_schema
    let schemaEnforced = true;
    if (!response.ok && response.status === 400) {
      const strictError = await response.text();
      process.stdout.write(`\n⚠️ strict json_schema rejected by ${endpoint} (400): ${strictError.slice(0, 400)}\n`);
      schemaEnforced = false;
      const fallbackBody = {
        ...body,
        response_format: { type: 'json_object' },
      };
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(fallbackBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    }

    const completedAt = new Date().toISOString();
    const elapsedMs = Date.now() - startMs;

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API (${endpoint}) failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const rawText = choice?.message?.content;
    if (!rawText) throw new Error('Empty response received from OpenAI-compatible provider.');

    const doneReason = choice?.finish_reason || 'stop';
    if (doneReason === 'length') {
      throw new Error('OpenAI response truncated due to max tokens/length limit.');
    }

    const value = extractCleanJson(rawText);

    return createNormalizedResult({
      value,
      rawContent: rawText,
      provider: config.provider,
      model: config.model,
      requestStartedAt: startedAt,
      requestCompletedAt: completedAt,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
      contextLength: isLocalOpenAI ? config.local.numCtx : null,
      doneReason,
      totalDurationMs: elapsedMs,
      thinkingEnabled: config.thinkingEnabled,
      schemaEnforced,
      seed,
      attempt,
      sampleIndex,
    });
  });
}
