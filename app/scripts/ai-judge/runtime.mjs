export function ollamaModelsEquivalent(left, right) {
  const normalize = (model) => model?.endsWith(':latest') ? model.slice(0, -':latest'.length) : model;
  return normalize(left) === normalize(right);
}

export async function preflightOllama(config, log) {
  if (config.provider !== 'local' || !config.local.isOllama) return null;
  try {
    const endpointUrl = new URL(config.local.endpoint);
    const origin = `${endpointUrl.protocol}//${endpointUrl.host}`;

    // Inspect available tags
    const tagsRes = await fetch(`${origin}/api/tags`);
    if (tagsRes.ok) {
      const data = await tagsRes.json();
      const models = data.models ?? [];
      const match = models.find((m) =>
        ollamaModelsEquivalent(m.name, config.model) || ollamaModelsEquivalent(m.model, config.model)
      );
      if (match) {
        log(`✓ Found local Ollama model '${config.model}' (digest: ${match.digest?.slice(0, 12) ?? 'unknown'}, size: ${Math.round((match.size ?? 0) / 1024 / 1024)}MB)`);
        return {
          model: config.model,
          digest: match.digest,
          details: match.details,
        };
      }
      log(`⚠️ Local model '${config.model}' not listed in /api/tags, Ollama will attempt pulling or resolving dynamically.`);
    }
  } catch (error) {
    log(`⚠️ Could not reach Ollama preflight endpoint: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}

export async function cleanupOllamaMemory(config, log) {
  if (config.provider !== 'local' || !config.local.isOllama) return;
  if (!config.exclusiveOllama) return; // Default: preserve loaded models!

  try {
    const endpointUrl = new URL(config.local.endpoint);
    const origin = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const response = await fetch(`${origin}/api/ps`);
    if (!response.ok) return;
    const data = await response.json();

    for (const loaded of data.models ?? []) {
      const loadedModel = loaded.name || loaded.model;
      // Do not unload target model if it's already loaded!
      if (!loadedModel || ollamaModelsEquivalent(loadedModel, config.model)) continue;
      try {
        await fetch(`${origin}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: loadedModel, keep_alive: 0 }),
        });
        log(`🧹 Flushed non-target Ollama model '${loadedModel}' from memory (--exclusive-ollama)`);
      } catch {
        // Best-effort cleanup only.
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}
