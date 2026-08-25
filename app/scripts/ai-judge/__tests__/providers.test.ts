import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callOllama } from '../providers/ollama.mjs';
import { callOpenAI } from '../providers/openai.mjs';
import { callProvider } from '../providers/index.mjs';

describe('AI Judge Provider Adapters', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const sampleConfig = {
    provider: 'local',
    model: 'qwen3.8-test',
    apiKey: 'local',
    thinkingEnabled: true,
    local: {
      endpoint: 'http://localhost:11434/api/chat',
      isOllama: true,
      numCtx: 16384,
      numPredict: 8192,
    },
    cloud: {
      deepseekBaseUrl: 'https://api.deepseek.com/chat/completions',
      openaiBaseUrl: 'https://api.openai.com/v1/chat/completions',
    },
  };

  it('parses Ollama response with structured JSON and telemetry', async () => {
    const mockJson = {
      message: {
        content: JSON.stringify({ schema: 'test', status: 'ok' }),
      },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 1200,
      eval_count: 350,
      total_duration: 5000000000, // 5s in ns -> 5000ms
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    });

    const res = await callOllama({
      packetJson: '{}',
      schema: {},
      promptContent: 'Evaluate',
      schemaContent: '{}',
      config: sampleConfig,
      attempt: 1,
      sampleIndex: 0,
      seed: 42,
    });

    expect(res.value).toEqual({ schema: 'test', status: 'ok' });
    expect(res.telemetry.promptTokens).toBe(1200);
    expect(res.telemetry.completionTokens).toBe(350);
    expect(res.telemetry.totalDurationMs).toBe(5000);
    expect(res.telemetry.doneReason).toBe('stop');
    expect(res.telemetry.thinkingEnabled).toBe(true);
  });

  it('fails if Ollama response was truncated by length', async () => {
    const mockJson = {
      message: {
        content: '{"schema": "test',
      },
      done: true,
      done_reason: 'length',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    });

    await expect(
      callOllama({
        packetJson: '{}',
        schema: {},
        promptContent: 'Evaluate',
        schemaContent: '{}',
        config: sampleConfig,
      })
    ).rejects.toThrow(/truncated due to length limit/);
  });

  it('dispatches to OpenAI provider for non-Ollama local endpoint', async () => {
    const mockJson = {
      choices: [
        {
          message: {
            content: JSON.stringify({ schema: 'test', model: 'openai' }),
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 800,
        completion_tokens: 200,
        total_tokens: 1000,
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    });

    const res = await callProvider({
      packetJson: '{}',
      schema: {},
      promptContent: 'Evaluate',
      schemaContent: '{}',
      config: {
        ...sampleConfig,
        local: {
          ...sampleConfig.local,
          endpoint: 'http://localhost:1234/v1/chat/completions',
          isOllama: false,
        },
      },
    });

    expect(res.value).toEqual({ schema: 'test', model: 'openai' });
    expect(res.telemetry.promptTokens).toBe(800);
    expect(res.telemetry.completionTokens).toBe(200);
  });

  it('calls OpenAI directly and parses response format', async () => {
    const mockJson = {
      choices: [
        {
          message: {
            content: JSON.stringify({ schema: 'test', status: 'direct_openai' }),
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 500,
        completion_tokens: 150,
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    });

    const res = await callOpenAI({
      packetJson: '{}',
      schema: {},
      promptContent: 'Evaluate',
      schemaContent: '{}',
      config: {
        ...sampleConfig,
        provider: 'openai',
        apiKey: 'test-key',
      },
      attempt: 1,
      sampleIndex: 0,
      seed: 42,
    });

    expect(res.value).toEqual({ schema: 'test', status: 'direct_openai' });
    expect(res.telemetry.promptTokens).toBe(500);
    expect(res.telemetry.completionTokens).toBe(150);
  });
});
