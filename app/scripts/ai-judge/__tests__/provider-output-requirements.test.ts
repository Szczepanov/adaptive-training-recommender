import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePairwiseResponseSchema } from '../pairwise.mjs';
import { describeStructuredOutputRequirements } from '../providers/base.mjs';
import { callOllama } from '../providers/ollama.mjs';

describe('provider structured-output instructions', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('derives root-field instructions from the active schema instead of hard-coding pointwise fields', () => {
    const schema = generatePairwiseResponseSchema('0-4');
    const instruction = describeStructuredOutputRequirements(schema);
    expect(instruction).toContain('"caseA"');
    expect(instruction).toContain('"actualDirection"');
    expect(instruction).not.toContain('caseScores');
    expect(instruction).not.toContain('familyAssessment');
  });

  it('sends pairwise-compatible instructions through the Ollama adapter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"ok":true}' },
        done: true,
        done_reason: 'stop',
      }),
    });
    globalThis.fetch = fetchMock;

    const schema = generatePairwiseResponseSchema('0-4');
    await callOllama({
      packetJson: '{}',
      schema,
      promptContent: 'Evaluate pairwise comparison.',
      schemaContent: JSON.stringify(schema),
      config: {
        provider: 'local',
        model: 'test-model',
        thinkingEnabled: false,
        local: {
          endpoint: 'http://localhost:11434/api/chat',
          numCtx: 4096,
          numPredict: 1024,
          timeoutMs: 1000,
        },
      },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = requestBody.messages[0].content;
    expect(prompt).toContain('"actualDirection"');
    expect(prompt).not.toContain('Root JSON MUST include BOTH "caseScores" and "familyAssessment"');
  });
});
