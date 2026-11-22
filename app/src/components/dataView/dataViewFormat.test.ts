import { describe, expect, it } from 'vitest';
import {
  describeSourceState,
  formatCandidateBaseline,
  formatCandidateDelta,
  formatCandidateNumber,
  formatSleepStageMinutes,
} from './dataViewFormat';

describe('describeSourceState', () => {
  it('returns distinct guidance for MISSING, INVALID, and UNAVAILABLE states', () => {
    expect(describeSourceState('MISSING')).toBe('No record exists for this date yet.');
    expect(describeSourceState('INVALID')).toBe('The stored record is malformed and needs repair.');
    expect(describeSourceState('UNAVAILABLE')).toBe('The data source is temporarily unavailable. Retry the dashboard refresh.');
  });
});

describe('formatCandidateNumber', () => {
  it('formats finite numbers including zero and negative values, and falls back to N/A otherwise', () => {
    expect(formatCandidateNumber(42)).toBe('42');
    expect(formatCandidateNumber(0)).toBe('0');
    expect(formatCandidateNumber(-3.5)).toBe('-3.5');
    expect(formatCandidateNumber(null)).toBe('N/A');
    expect(formatCandidateNumber(undefined)).toBe('N/A');
    expect(formatCandidateNumber(Number.NaN)).toBe('N/A');
    expect(formatCandidateNumber(Number.POSITIVE_INFINITY)).toBe('N/A');
    expect(formatCandidateNumber(Number.NEGATIVE_INFINITY)).toBe('N/A');
  });
});

describe('formatCandidateDelta', () => {
  it('prefixes positive finite values with +, preserves zero and negative values, and falls back to N/A otherwise', () => {
    expect(formatCandidateDelta(5)).toBe('+5');
    expect(formatCandidateDelta(0.25)).toBe('+0.25');
    expect(formatCandidateDelta(0)).toBe('0');
    expect(formatCandidateDelta(-4)).toBe('-4');
    expect(formatCandidateDelta(null)).toBe('N/A');
    expect(formatCandidateDelta(undefined)).toBe('N/A');
    expect(formatCandidateDelta(Number.NaN)).toBe('N/A');
    expect(formatCandidateDelta(Number.POSITIVE_INFINITY)).toBe('N/A');
    expect(formatCandidateDelta(Number.NEGATIVE_INFINITY)).toBe('N/A');
  });
});

describe('formatSleepStageMinutes', () => {
  it('rounds finite seconds to minutes and returns N/A for non-finite or missing values', () => {
    expect(formatSleepStageMinutes(0)).toBe('0m');
    expect(formatSleepStageMinutes(3600)).toBe('60m');
    expect(formatSleepStageMinutes(3629)).toBe('60m');
    expect(formatSleepStageMinutes(3630)).toBe('61m');
    expect(formatSleepStageMinutes(-60)).toBe('-1m');
    expect(formatSleepStageMinutes(null)).toBe('N/A');
    expect(formatSleepStageMinutes(undefined)).toBe('N/A');
    expect(formatSleepStageMinutes(Number.NaN)).toBe('N/A');
    expect(formatSleepStageMinutes(Number.POSITIVE_INFINITY)).toBe('N/A');
  });
});

describe('formatCandidateBaseline', () => {
  it('formats finite baseline stats and deltas with N/A fallbacks for missing or non-finite inputs', () => {
    expect(formatCandidateBaseline(80, 78, 4, 2, -3)).toBe('7d med 80 · 28d med 78 · MAD 4 · Δ7 +2 · Δ28 -3');
    expect(formatCandidateBaseline(0, 0, 0, 0, 0)).toBe('7d med 0 · 28d med 0 · MAD 0 · Δ7 0 · Δ28 0');
    expect(formatCandidateBaseline(null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 1.5))
      .toBe('7d med N/A · 28d med N/A · MAD N/A · Δ7 N/A · Δ28 +1.5');
  });
});
