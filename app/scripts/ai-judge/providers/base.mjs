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
      seed,
      attempt,
      sampleIndex,
    },
  };
}
