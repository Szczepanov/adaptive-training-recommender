const DEFAULT_LOCAL_TIMEOUT_MS = 600_000;
const DEFAULT_CLOUD_TIMEOUT_MS = 180_000;

export function resolveRequestTimeoutMs(config) {
  const timeoutMs = config.provider === 'local' ? config.local?.timeoutMs : config.cloud?.timeoutMs;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
  return config.provider === 'local' ? DEFAULT_LOCAL_TIMEOUT_MS : DEFAULT_CLOUD_TIMEOUT_MS;
}

export function describeStructuredOutputRequirements(schema) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const rootRequirement = required.length > 0
    ? `Root JSON MUST include all required fields: ${required.map((field) => `"${field}"`).join(', ')}.`
    : 'Root JSON must match the supplied schema exactly.';

  let caseRequirement = '';
  if (schema?.properties?.caseScores?.items?.properties?.caseId?.enum && Array.isArray(schema.properties.caseScores.items.properties.caseId.enum)) {
    const caseIds = schema.properties.caseScores.items.properties.caseId.enum;
    caseRequirement = ` The "caseScores" array MUST contain exactly ${caseIds.length} item(s) corresponding to each case in order: [${caseIds.join(', ')}] with NO duplicates or omissions.`;
  }

  return `Return ONLY valid JSON matching the supplied schema. ${rootRequirement}${caseRequirement} Do not add prose outside the JSON object.`;
}

export async function withProgress(request) {
  const timer = setInterval(() => process.stdout.write('.'), 5000);
  try {
    return await request();
  } finally {
    clearInterval(timer);
  }
}

export function createNormalizedResult({
  value,
  rawContent = null,
  provider,
  model,
  requestStartedAt,
  requestCompletedAt,
  promptTokens = null,
  completionTokens = null,
  totalTokens = null,
  contextLength = null,
  doneReason = null,
  totalDurationMs = null,
  evalDurationMs = null,
  loadDurationMs = null,
  thinkingEnabled = false,
  schemaEnforced = true,
  seed = null,
  attempt = 1,
  sampleIndex = 0,
}) {
  return {
    value,
    rawContent,
    telemetry: {
      provider,
      model,
      requestStartedAt,
      requestCompletedAt,
      promptTokens,
      completionTokens,
      totalTokens: totalTokens ?? (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null),
      contextLength,
      doneReason,
      totalDurationMs,
      evalDurationMs,
      loadDurationMs,
      thinkingEnabled,
      schemaEnforced,
      seed,
      attempt,
      sampleIndex,
    },
  };
}
