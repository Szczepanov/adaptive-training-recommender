import { extractCleanJson } from '../validation.mjs';
import {
  createNormalizedResult,
  describeStructuredOutputRequirements,
  resolveRequestTimeoutMs,
  withProgress,
} from './base.mjs';

export async function callDeepSeek({
  packetJson,
  schema,
  promptContent,
  schemaContent,
  config,
  attempt = 1,
  sampleIndex = 0,
  seed = null,
}) {
  const endpoint = config.cloud.deepseekBaseUrl;
  const outputRequirements = describeStructuredOutputRequirements(schema);
  const systemContent = `${promptContent}\n\nStrict JSON Output Schema:\n${schemaContent}\nIMPORTANT: ${outputRequirements}`;
  const userContent = `Evaluate this input JSON and return the exact evaluation JSON object:\n${packetJson}`;

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    ...(config.thinkingEnabled
      ? { thinking: { type: 'enabled' }, reasoning_effort: config.reasoningEffort }
      : { response_format: { type: 'json_object' }, temperature: 0.1 }),
    ...(seed != null ? { seed } : {}),
  };

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  return withProgress(async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(resolveRequestTimeoutMs(config)),
    });

    const completedAt = new Date().toISOString();
    const elapsedMs = Date.now() - startMs;

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;
    const rawText = message?.content || message?.reasoning_content;
    if (!rawText) throw new Error('Empty response received from DeepSeek.');

    const doneReason = choice?.finish_reason || 'stop';
    if (doneReason === 'length') {
      throw new Error('DeepSeek response truncated due to length limit.');
    }

    const value = extractCleanJson(rawText);

    return createNormalizedResult({
      value,
      rawContent: rawText,
      provider: 'deepseek',
      model: config.model,
      requestStartedAt: startedAt,
      requestCompletedAt: completedAt,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
      doneReason,
      totalDurationMs: elapsedMs,
      thinkingEnabled: config.thinkingEnabled,
      seed,
      attempt,
      sampleIndex,
    });
  });
}
