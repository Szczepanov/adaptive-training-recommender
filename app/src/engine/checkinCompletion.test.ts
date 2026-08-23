import { describe, expect, it } from 'vitest';
import {
  hasCompletedSubjectiveCheckinForDecision,
  isCompletedSubjectiveCheckin,
} from './checkinCompletion';

describe('check-in completion semantics', () => {
  it('does not treat an incomplete draft as completed', () => {
    expect(isCompletedSubjectiveCheckin({
      dataQuality: { isComplete: false },
    })).toBe(false);
  });

  it('treats validated complete check-ins as completed without relying on submission timestamps', () => {
    expect(isCompletedSubjectiveCheckin({
      dataQuality: { isComplete: true },
    })).toBe(true);
  });

  it('fails closed when decision-input completion flags disagree', () => {
    expect(hasCompletedSubjectiveCheckinForDecision({
      dataQuality: {
        hasRecoverySnapshot: true,
        hasSubjectiveCheckin: false,
        subjectiveCheckinComplete: true,
        profileReady: true,
      },
    })).toBe(false);
  });

  it('accepts a composed decision only when a complete subjective check-in exists', () => {
    expect(hasCompletedSubjectiveCheckinForDecision({
      dataQuality: {
        hasRecoverySnapshot: true,
        hasSubjectiveCheckin: true,
        subjectiveCheckinComplete: true,
        profileReady: true,
      },
    })).toBe(true);
  });
});
