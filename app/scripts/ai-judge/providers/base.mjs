const DEFAULT_LOCAL_TIMEOUT_MS = 600_000;
const DEFAULT_CLOUD_TIMEOUT_MS = 180_000;

export function resolveRequestTimeoutMs(config) {
  const timeoutMs = config.provider === 'local' ? config.local?.timeoutMs : config.cloud?.timeoutMs;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
  return config.provider === 'local' ? DEFAULT_LOCAL_TIMEOUT_MS : DEFAULT_CLOUD_TIMEOUT_MS;
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
