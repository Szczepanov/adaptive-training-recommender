import { describe, expect, it } from 'vitest';
import { resolveJudgeProvider } from '../baselinePromotionPolicy.mjs';

describe('baseline promotion judge provider policy', () => {
  it('accepts manual_external as the canonical provider', () => {
    expect(resolveJudgeProvider({
      provenanceProvider: 'manual_external',
      manifestProvider: 'manual_external',
    })).toBe('manual_external');
  });

  it('accepts a provider recorded by either provenance source', () => {
    expect(resolveJudgeProvider({ provenanceProvider: 'manual_external' })).toBe('manual_external');
    expect(resolveJudgeProvider({ manifestProvider: 'local' })).toBe('local');
  });

  it('rejects conflicting provider provenance', () => {
    expect(() => resolveJudgeProvider({
      provenanceProvider: 'manual_external',
      manifestProvider: 'local',
    })).toThrow(/provider mismatch/i);
  });
});
