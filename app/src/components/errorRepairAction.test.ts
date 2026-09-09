import { describe, expect, it } from 'vitest';
import type { DataStateSummary } from '../engine/dataState';
import {
  resolveDecisionCompositionRepairState,
  resolveDecisionSourceRepairState,
} from './errorRepairAction';

const available: DataStateSummary = { status: 'AVAILABLE', revision: 'rev-1' };
const invalid: DataStateSummary = {
  status: 'INVALID',
  issues: [{ code: 'schema', documentPath: 'users/u/doc' }],
};
const unavailable: DataStateSummary = {
  status: 'UNAVAILABLE',
  operation: 'read source',
  retryable: true,
};

describe('resolveDecisionSourceRepairState', () => {
  it('keeps repair actions for INVALID sources even when an earlier source is UNAVAILABLE', () => {
    const result = resolveDecisionSourceRepairState({
      activeGoals: unavailable,
      preferences: invalid,
      trainingSettings: available,
    });

    expect(result).toEqual({
      message: 'Decision inputs need attention: Coach Preferences is invalid; Goals is temporarily unavailable. Review the invalid input, then retry.',
      actions: [{ kind: 'navigate', screen: 'preferences', label: 'Review Coach Preferences' }],
    });
  });

  it('names every invalid source and returns each owning repair screen', () => {
    const result = resolveDecisionSourceRepairState({
      activeGoals: invalid,
      preferences: available,
      trainingSettings: invalid,
    });

    expect(result).toEqual({
      message: 'Decision inputs need repair: Goals and Training Setup are invalid. Review the invalid inputs, then retry.',
      actions: [
        { kind: 'navigate', screen: 'goals', label: 'Review Goals' },
        { kind: 'navigate', screen: 'constraints', label: 'Review Training Setup' },
      ],
    });
  });

  it('returns null when no blocking decision source failed', () => {
    expect(resolveDecisionSourceRepairState({
      activeGoals: available,
      preferences: { status: 'MISSING' },
      trainingSettings: available,
    })).toBeNull();
  });
});

describe('resolveDecisionCompositionRepairState', () => {
  it('routes invalid Training Settings to Training Setup', () => {
    expect(resolveDecisionCompositionRepairState(
      new Error('Training settings are invalid. Please review and save them again.'),
    )).toEqual({
      message: 'Training Setup is invalid. Review and save it again, then retry.',
      actions: [{ kind: 'navigate', screen: 'constraints', label: 'Review Training Setup' }],
    });
  });

  it('routes invalid schedule overlays to Plan', () => {
    expect(resolveDecisionCompositionRepairState(
      new Error('Schedule overlays are invalid. Please review or remove the affected schedule block.'),
    )).toEqual({
      message: 'Schedule overlays are invalid. Review or remove the affected schedule block in Plan, then retry.',
      actions: [{ kind: 'navigate', screen: 'plan', label: 'Review Plan' }],
    });
  });

  it('does not guess a repair surface for unknown exceptions', () => {
    expect(resolveDecisionCompositionRepairState(new Error('boom'))).toBeNull();
  });
});
