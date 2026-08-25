import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callOllama } from '../providers/ollama.mjs';
import { callOpenAI } from '../providers/openai.mjs';
import { callDeepSeek } from '../providers/deepseek.mjs';
import { callGemini, sanitizeSchemaForGemini } from '../providers/gemini.mjs';
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
      timeoutMs: 600_000,
    },
    cloud: {
      timeoutMs: 180_000,
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
    expect(res.telemetry.schemaEnforced).toBe(true);
  });

  it('retries OpenAI with json_object and reports schemaEnforced=false on a strict-schema 400', async () => {
    const mockJson = {
      choices: [
        {
          message: {
            content: JSON.stringify({ schema: 'test', status: 'fallback' }),
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'unsupported keyword: const' })
      .mockResolvedValueOnce({ ok: true, json: async () => mockJson });
    globalThis.fetch = fetchMock;

    const res = await callOpenAI({
      packetJson: '{}',
      schema: { type: 'object', properties: { schema: { const: 'test' } } },
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.response_format.type).toBe('json_schema');
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.response_format).toEqual({ type: 'json_object' });
    expect(res.value).toEqual({ schema: 'test', status: 'fallback' });
    expect(res.telemetry.schemaEnforced).toBe(false);
  });

  it('parses DeepSeek response and preserves seed/format passthrough', async () => {
    const mockJson = {
      choices: [
        {
          message: { content: JSON.stringify({ schema: 'test', status: 'deepseek' }) },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
    };

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => mockJson });
    globalThis.fetch = fetchMock;

    const res = await callDeepSeek({
      packetJson: '{}',
      schema: {},
      promptContent: 'Evaluate',
      schemaContent: '{}',
      config: { ...sampleConfig, provider: 'deepseek', apiKey: 'test-deepseek-key', thinkingEnabled: false },
      attempt: 1,
      sampleIndex: 0,
      seed: 7,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.seed).toBe(7);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(res.value).toEqual({ schema: 'test', status: 'deepseek' });
    expect(res.telemetry.totalTokens).toBe(400);
  });

  it('parses Gemini response and sends a sanitized native responseSchema', async () => {
    const mockJson = {
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify({ schema: 'test', status: 'gemini' }) }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 200, totalTokenCount: 1100 },
    };

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => mockJson });
    globalThis.fetch = fetchMock;

    const res = await callGemini({
      packetJson: '{}',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { familyId: { type: 'string', const: 'family-a', minLength: 1 } },
      },
      promptContent: 'Evaluate',
      schemaContent: '{}',
      config: { ...sampleConfig, provider: 'gemini', apiKey: 'test-gemini-key' },
      attempt: 1,
      sampleIndex: 0,
      seed: 3,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.responseSchema).toEqual({
      type: 'object',
      properties: { familyId: { type: 'string', enum: ['family-a'] } },
    });
    expect(res.value).toEqual({ schema: 'test', status: 'gemini' });
    expect(res.telemetry.totalTokens).toBe(1100);
  });

  it('sanitizeSchemaForGemini strips const/additionalProperties/minLength and converts const to enum', () => {
    const sanitized = sanitizeSchemaForGemini({
      type: 'object',
      additionalProperties: false,
      properties: {
        schema: { type: 'string', const: 'v1' },
        rationale: { type: 'string', minLength: 1 },
      },
    });

    expect(sanitized).toEqual({
      type: 'object',
      properties: {
        schema: { type: 'string', enum: ['v1'] },
        rationale: { type: 'string' },
      },
    });
  });
});
