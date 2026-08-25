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
});
