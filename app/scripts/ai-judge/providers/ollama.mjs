import { Agent } from 'undici';
import { extractCleanJson } from '../validation.mjs';
import {
  createNormalizedResult,
  describeStructuredOutputRequirements,
  resolveRequestTimeoutMs,
  withProgress,
} from './base.mjs';

const localDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

export function transformSchemaForOllama(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const cloned = JSON.parse(JSON.stringify(schema));

  if (
    cloned.properties?.caseScores?.items?.properties?.caseId?.enum &&
    Array.isArray(cloned.properties.caseScores.items.properties.caseId.enum)
  ) {
    const caseIds = cloned.properties.caseScores.items.properties.caseId.enum;
    const itemTemplate = cloned.properties.caseScores.items;
    delete cloned.properties.caseScores.items;
    cloned.properties.caseScores.prefixItems = caseIds.map((caseId) => {
      const item = JSON.parse(JSON.stringify(itemTemplate));
      item.properties.caseId = { const: caseId };
      return item;
    });
  }

  if (
    cloned.properties?.results?.items?.properties?.caseId?.enum &&
    Array.isArray(cloned.properties.results.items.properties.caseId.enum)
  ) {
    const caseIds = cloned.properties.results.items.properties.caseId.enum;
    const itemTemplate = cloned.properties.results.items;
    delete cloned.properties.results.items;
    cloned.properties.results.prefixItems = caseIds.map((caseId) => {
      const item = JSON.parse(JSON.stringify(itemTemplate));
      item.properties.caseId = { const: caseId };
      return item;
    });
  }

  return cloned;
}

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
  const outputRequirements = describeStructuredOutputRequirements(schema);
  const userPrompt = `${promptContent}\n\nStrict Output JSON Schema:\n${schemaContent}\n\nInput Evaluation Data:\n\`\`\`json\n${packetJson}\n\`\`\`\n\nIMPORTANT:\n- ${outputRequirements}\n- Every required score, confidence, rationale, and list field defined by the schema must be present.\n- Incomplete or guessed fields will be rejected and retried.`;

  const body = {
    model: config.model,
    messages: [{ role: 'user', content: userPrompt }],
    format: transformSchemaForOllama(schema),
    stream: false,
    options: {
      num_ctx: config.local.numCtx,
      num_predict: config.local.numPredict,
      temperature: 0.1,
      repeat_penalty: 1.1,
      ...(seed != null ? { seed: seed + (attempt - 1) * 7919 } : {}),
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
      dispatcher: localDispatcher,
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
