import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupOllamaMemory, ollamaModelsEquivalent, preflightOllama } from '../runtime.mjs';

const localConfig = {
  provider: 'local',
  model: 'hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF',
  exclusiveOllama: true,
  local: {
    endpoint: 'http://localhost:11434/api/chat',
    isOllama: true,
  },
};

describe('AI judge Ollama runtime', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('treats a tagless model and its implicit latest tag as equivalent', () => {
    expect(ollamaModelsEquivalent('model', 'model:latest')).toBe(true);
    expect(ollamaModelsEquivalent('model:Q4_K_M', 'model:latest')).toBe(false);
  });

  it('records preflight provenance for an installed implicit latest tag', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{
          name: 'hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:latest',
          digest: 'abc123def4567890',
          size: 2_800 * 1024 * 1024,
          details: { quantization_level: 'Q4_K_M' },
        }],
      }),
    });
    const log = vi.fn();

    const result = await preflightOllama(localConfig, log);

    expect(result).toMatchObject({ model: localConfig.model, digest: 'abc123def4567890' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Found local Ollama model'));
  });

  it('does not unload the target model when Ollama reports its implicit latest tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:latest' }],
      }),
    });
    globalThis.fetch = fetchMock;

    await cleanupOllamaMemory(localConfig, vi.fn());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
