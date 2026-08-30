import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { firestoreDateToDate } from './firestoreDate';

describe('firestoreDateToDate', () => {
  it('converts a Firestore Timestamp to Date', () => {
    const expected = new Date('2026-08-01T12:30:00.000Z');
    expect(firestoreDateToDate(Timestamp.fromDate(expected))).toEqual(expected);
  });

  it('accepts an ISO timestamp from the authenticated status endpoint', () => {
    expect(firestoreDateToDate('2026-08-01T12:30:00+00:00')?.toISOString())
      .toBe('2026-08-01T12:30:00.000Z');
  });

  it('returns null for absent or invalid values', () => {
    expect(firestoreDateToDate(undefined)).toBeNull();
    expect(firestoreDateToDate('not-a-date')).toBeNull();
  });
});
