import { extractCleanJson } from '../validation.mjs';
import { createNormalizedResult, withProgress } from './base.mjs';

export async function callGemini({
  packetJson,
  schema: _schema,
  promptContent,
  schemaContent,
  config,
  attempt = 1,
  sampleIndex = 0,
  seed = null,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
  const userPrompt = `${promptContent}\n\nStrict Output Schema:\n${schemaContent}\n\nIMPORTANT: Root JSON MUST include both "caseScores" and "familyAssessment". Return JSON only.\n\nAnalyze this family JSON:\n${packetJson}`;

  const body = {
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      ...(seed != null ? { seed } : {}),
    },
  };

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  return withProgress(async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const completedAt = new Date().toISOString();
    const elapsedMs = Date.now() - startMs;

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Empty response received from Gemini.');

    const finishReason = candidate?.finishReason || 'STOP';
    if (finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini response truncated due to MAX_TOKENS limit.');
    }

    const value = extractCleanJson(rawText);

    return createNormalizedResult({
      value,
      rawContent: rawText,
      provider: 'gemini',
      model: config.model,
      requestStartedAt: startedAt,
      requestCompletedAt: completedAt,
      promptTokens: data.usageMetadata?.promptTokenCount ?? null,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      totalTokens: data.usageMetadata?.totalTokenCount ?? null,
      doneReason: finishReason,
      totalDurationMs: elapsedMs,
      thinkingEnabled: config.thinkingEnabled,
      seed,
      attempt,
      sampleIndex,
    });
  });
}
