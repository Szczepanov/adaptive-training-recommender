import { describe, expect, it } from 'vitest';
import { buildInfo, formatBuildTime } from './buildInfo';

describe('formatBuildTime', () => {
  it('formats an ISO timestamp in Warsaw timezone (summer DST UTC+2)', () => {
    expect(formatBuildTime('2026-09-30T06:55:00.000Z')).toBe('2026-09-30 08:55');
  });

  it('formats an ISO timestamp in Warsaw timezone (winter standard UTC+1)', () => {
    expect(formatBuildTime('2026-01-15T12:30:00.000Z')).toBe('2026-01-15 13:30');
  });

  it('supports custom timezone override', () => {
    expect(formatBuildTime('2026-09-30T06:55:00.000Z', 'UTC')).toBe('2026-09-30 06:55');
  });

  it('returns empty string for null, undefined, empty, or invalid input', () => {
    expect(formatBuildTime(null)).toBe('');
    expect(formatBuildTime(undefined)).toBe('');
    expect(formatBuildTime('')).toBe('');
    expect(formatBuildTime('not-a-date')).toBe('');
  });
});

describe('buildInfo', () => {
  it('exposes git and build timestamp properties', () => {
    expect(buildInfo).toHaveProperty('gitSha');
    expect(buildInfo).toHaveProperty('shortGitSha');
    expect(buildInfo).toHaveProperty('dirty');
    expect(buildInfo).toHaveProperty('label');
    expect(buildInfo).toHaveProperty('builtAt');
    expect(buildInfo).toHaveProperty('builtAtFormatted');

    expect(typeof buildInfo.gitSha).toBe('string');
    expect(typeof buildInfo.dirty).toBe('boolean');
    expect(typeof buildInfo.builtAt).toBe('string');
    expect(typeof buildInfo.builtAtFormatted).toBe('string');
  });

  it('formats shortGitSha to 7 characters or unknown', () => {
    if (buildInfo.gitSha !== 'unknown') {
      expect(buildInfo.shortGitSha).toHaveLength(7);
      expect(buildInfo.gitSha.startsWith(buildInfo.shortGitSha)).toBe(true);
    } else {
      expect(buildInfo.shortGitSha).toBe('unknown');
    }
  });

  it('reflects dirty flag in the label', () => {
    if (buildInfo.dirty) {
      expect(buildInfo.label).toContain('-dirty');
    } else {
      expect(buildInfo.label).not.toContain('-dirty');
    }
  });
});
