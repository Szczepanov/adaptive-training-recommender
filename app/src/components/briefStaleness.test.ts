import { describe, expect, it } from 'vitest';
import { isBriefStale, type BriefStalenessInput } from './briefStaleness';

const current: BriefStalenessInput = {
  brief: { asOfDate: '2026-11-15', preset: 'daily' },
  briefDate: '2026-11-15',
  briefPreset: 'daily',
  builtVariant: { fullContext: false, chat: 'coach' },
  fullContext: false,
  chat: 'coach',
  checkpointPending: false,
  builtCapabilityKey: 'null',
  capabilityKey: 'null',
};

describe('isBriefStale', () => {
  it('is false for a brief built for the current date, preset, chat and toggle', () => {
    expect(isBriefStale(current)).toBe(false);
  });

  it('is false when no brief exists', () => {
    expect(isBriefStale({ ...current, brief: null })).toBe(false);
  });

  it('is stale when the brief date moved forward with everything else unchanged', () => {
    expect(isBriefStale({ ...current, briefDate: '2026-11-16' })).toBe(true);
  });

  it('is stale while a capability-maintenance change rebuilds the brief (#1260 review)', () => {
    expect(isBriefStale({ ...current, capabilityKey: '{"due":1}' })).toBe(true);
  });

  it('is stale when the date is not known yet', () => {
    expect(isBriefStale({ ...current, briefDate: undefined })).toBe(true);
  });

  it.each([
    ['preset', { briefPreset: 'full' as const }],
    ['chat', { chat: 'other' }],
    ['full-context toggle', { fullContext: true }],
    ['pending checkpoint', { checkpointPending: true }],
  ])('is stale when the %s changed', (_label, change) => {
    expect(isBriefStale({ ...current, ...change })).toBe(true);
  });
});
