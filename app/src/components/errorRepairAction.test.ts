import { describe, expect, it } from 'vitest';
import type { DataStateSummary } from '../engine/dataState';
import { TrainingHistorySourceError } from '../engine/trainingHistorySnapshot';
import { DashboardRequiredSourceError } from './dashboardLoadBoundary';
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

  it('explains canonical performed-training failures without treating missing history as empty', () => {
    expect(resolveDecisionCompositionRepairState(
      new DashboardRequiredSourceError('performed-training-facts', new Error('permission denied')),
    )).toEqual({
      message: "Performed training history could not be read safely. Today's recommendation is withheld rather than assuming recent training is empty. Retry when the source is available.",
      actions: [],
    });
  });

  it('names a temporarily unavailable legacy training-history source', () => {
    expect(resolveDecisionCompositionRepairState(
      new TrainingHistorySourceError('activities', {
        status: 'UNAVAILABLE',
        operation: 'read activities',
        retryable: true,
      }),
    )).toEqual({
      message: 'Activity history is temporarily unavailable, so normal planning is paused. Retry when it can be read.',
      actions: [],
    });
  });

  it('distinguishes invalid history from transient unavailability', () => {
    expect(resolveDecisionCompositionRepairState(
      new TrainingHistorySourceError('recommendations', {
        status: 'INVALID',
        issues: [{ code: 'schema', documentPath: 'users/u/daily_recommendations/bad' }],
      }),
    )).toEqual({
      message: 'Recommendation history contains invalid data, so normal planning is blocked. Retry after the affected data is repaired.',
      actions: [],
    });
  });

  it('does not guess a repair surface for unknown exceptions', () => {
    expect(resolveDecisionCompositionRepairState(new Error('boom'))).toBeNull();
  });
});
