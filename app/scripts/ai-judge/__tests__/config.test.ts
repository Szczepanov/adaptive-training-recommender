import { describe, expect, it } from 'vitest';
import { resolveJudgeConfig, positiveInt, normalizeLocalEndpoint } from '../config.mjs';

describe('AI Judge Config', () => {
  it('parses positive integers with fallback', () => {
    expect(positiveInt('10', 5)).toBe(10);
    expect(positiveInt('-1', 5)).toBe(5);
    expect(positiveInt('invalid', 5)).toBe(5);
    expect(positiveInt(undefined, 5)).toBe(5);
  });

  it('normalizes local endpoints correctly', () => {
    expect(normalizeLocalEndpoint('', true)).toBe('http://localhost:11434/api/chat');
    expect(normalizeLocalEndpoint('', false)).toBe('http://localhost:1234/v1/chat/completions');
    expect(normalizeLocalEndpoint('http://localhost:11434', true)).toBe('http://localhost:11434/api/chat');
    expect(normalizeLocalEndpoint('http://localhost:11434/api/chat', true)).toBe('http://localhost:11434/api/chat');
    expect(normalizeLocalEndpoint('http://127.0.0.1:8000', false)).toBe('http://127.0.0.1:8000/v1/chat/completions');
  });

  it('resolves explicit CLI provider over env variables', () => {
    const config = resolveJudgeConfig(['--provider', 'local', '--samples', '3'], {
      DEEPSEEK_API_KEY: 'test-deepseek-key',
    });
    expect(config.provider).toBe('local');
    expect(config.samples).toBe(3);
  });

  it('fails fast on ambiguous provider configuration when not specified', () => {
    expect(() =>
      resolveJudgeConfig([], {
        DEEPSEEK_API_KEY: 'test-deepseek',
        OPENAI_API_KEY: 'test-openai',
      })
    ).toThrow(/Ambiguous judge provider/);
  });

  it('resolves provider from explicit JUDGE_PROVIDER env', () => {
    const config = resolveJudgeConfig([], {
      JUDGE_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-deepseek',
    });
    expect(config.provider).toBe('deepseek');
    expect(config.apiKey).toBe('test-deepseek');
  });

  it('resolves default model and custom model override', () => {
    const config = resolveJudgeConfig(['--provider', 'local', '--model', 'custom-qwen-model'], {});
    expect(config.model).toBe('custom-qwen-model');
  });

  it('parses thinking mode flags', () => {
    const cfgOn = resolveJudgeConfig(['--provider', 'local', '--thinking', 'on'], {});
    expect(cfgOn.thinkingEnabled).toBe(true);

    const cfgOff = resolveJudgeConfig(['--provider', 'local', '--thinking', 'off'], {});
    expect(cfgOff.thinkingEnabled).toBe(false);
  });

  it('parses custom num-ctx and num-predict options', () => {
    const config = resolveJudgeConfig(['--provider', 'local', '--num-ctx', '32768', '--num-predict', '16384'], {});
    expect(config.local.numCtx).toBe(32768);
    expect(config.local.numPredict).toBe(16384);
  });

  it('defaults request timeouts to the documented local/cloud values', () => {
    const config = resolveJudgeConfig(['--provider', 'local'], {});
    expect(config.local.timeoutMs).toBe(600_000);
    expect(config.cloud.timeoutMs).toBe(180_000);
  });

  it('honors JUDGE_TIMEOUT_MS and provider-specific timeout overrides', () => {
    const local = resolveJudgeConfig(['--provider', 'local'], { LOCAL_TIMEOUT_MS: '12345' });
    expect(local.local.timeoutMs).toBe(12345);

    const cloud = resolveJudgeConfig(['--provider', 'deepseek'], {
      DEEPSEEK_API_KEY: 'test-deepseek',
      REQUEST_TIMEOUT_MS: '54321',
    });
    expect(cloud.cloud.timeoutMs).toBe(54321);
  });

  it('resolves distinct Gemini default models for quick and standard modes', () => {
    const quick = resolveJudgeConfig(['--provider', 'gemini', '--quick'], { GEMINI_API_KEY: 'test-gemini' });
    const standard = resolveJudgeConfig(['--provider', 'gemini'], { GEMINI_API_KEY: 'test-gemini' });
    expect(quick.model).not.toBe(standard.model);
  });

  it('derives localIsOllama from the URL actually selected, not merely OLLAMA_BASE_URL presence', () => {
    // LOCAL_LLM_URL takes precedence and points at an OpenAI-compatible server;
    // OLLAMA_BASE_URL being set elsewhere must not force the Ollama adapter.
    const config = resolveJudgeConfig(['--provider', 'local'], {
      LOCAL_LLM_URL: 'http://localhost:8080/v1/chat/completions',
      OLLAMA_BASE_URL: 'http://localhost:11434',
    });
    expect(config.local.isOllama).toBe(false);
    expect(config.local.endpoint).toBe('http://localhost:8080/v1/chat/completions');
  });

  it('still selects the Ollama adapter when OLLAMA_BASE_URL is the URL actually in use', () => {
    const config = resolveJudgeConfig(['--provider', 'local'], {
      OLLAMA_BASE_URL: 'http://localhost:11434',
    });
    expect(config.local.isOllama).toBe(true);
  });
});
