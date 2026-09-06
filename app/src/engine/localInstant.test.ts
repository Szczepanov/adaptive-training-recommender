import { describe, expect, it } from 'vitest';
import { resolveLocalInstant, elapsedMinutesBetweenInstants } from './localInstant';

// Europe/Warsaw 2026 DST transitions (verified against Intl.DateTimeFormat directly):
// spring-forward 2026-03-29 02:00 -> 03:00 (CET/UTC+1 -> CEST/UTC+2, gap [02:00,03:00));
// fall-back 2026-10-25 03:00 -> 02:00 (CEST/UTC+2 -> CET/UTC+1, repeated [02:00,03:00)).

describe('resolveLocalInstant (ADR-0036 D-TIME)', () => {
    it('resolves an ordinary winter (CET, UTC+1) wall-clock time', () => {
        const result = resolveLocalInstant('2026-08-17', '07:00', 'Europe/Warsaw'); // actually summer, CEST
        expect(result.status).toBe('resolved');
        if (result.status !== 'resolved') throw new Error('unreachable');
        expect(result.offsetMinutes).toBe(120); // CEST = UTC+2
        expect(result.instant).toBe('2026-08-17T05:00:00.000Z');
    });

    it('resolves an ordinary winter (CET, UTC+1) date correctly', () => {
        const result = resolveLocalInstant('2026-01-15', '07:00', 'Europe/Warsaw');
        expect(result.status).toBe('resolved');
        if (result.status !== 'resolved') throw new Error('unreachable');
        expect(result.offsetMinutes).toBe(60); // CET = UTC+1
        expect(result.instant).toBe('2026-01-15T06:00:00.000Z');
    });

    it('rejects a spring-forward local time that never existed', () => {
        const result = resolveLocalInstant('2026-03-29', '02:30', 'Europe/Warsaw');
        expect(result.status).toBe('nonexistent');
    });

    it('resolves a spring-forward date just before/after the gap normally', () => {
        const before = resolveLocalInstant('2026-03-29', '01:30', 'Europe/Warsaw');
        expect(before.status).toBe('resolved');
        if (before.status !== 'resolved') throw new Error('unreachable');
        expect(before.offsetMinutes).toBe(60);

        const after = resolveLocalInstant('2026-03-29', '03:30', 'Europe/Warsaw');
        expect(after.status).toBe('resolved');
        if (after.status !== 'resolved') throw new Error('unreachable');
        expect(after.offsetMinutes).toBe(120);
    });

    it('reports a fall-back local time as ambiguous with both real candidate instants, earlier first', () => {
        const result = resolveLocalInstant('2026-10-25', '02:30', 'Europe/Warsaw');
        expect(result.status).toBe('ambiguous');
        if (result.status !== 'ambiguous') throw new Error('unreachable');
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0].offsetMinutes).toBe(120); // still-CEST instance, first chronologically
        expect(result.candidates[1].offsetMinutes).toBe(60); // CET instance, second chronologically
        expect(Date.parse(result.candidates[0].instant)).toBeLessThan(Date.parse(result.candidates[1].instant));
        // Exactly one hour (3600000ms) apart -- the DST fold width.
        expect(Date.parse(result.candidates[1].instant) - Date.parse(result.candidates[0].instant)).toBe(3600000);
    });

    it('resolves a fall-back date just before/after the repeated hour normally', () => {
        const before = resolveLocalInstant('2026-10-25', '01:30', 'Europe/Warsaw');
        expect(before.status).toBe('resolved');
        if (before.status !== 'resolved') throw new Error('unreachable');
        expect(before.offsetMinutes).toBe(120);

        const after = resolveLocalInstant('2026-10-25', '03:30', 'Europe/Warsaw');
        expect(after.status).toBe('resolved');
        if (after.status !== 'resolved') throw new Error('unreachable');
        expect(after.offsetMinutes).toBe(60);
    });

    it('treats the exact gap boundary (02:00, the first nonexistent minute) as nonexistent and 03:00 (the first valid minute after) as resolved', () => {
        expect(resolveLocalInstant('2026-03-29', '02:00', 'Europe/Warsaw').status).toBe('nonexistent');
        const justAfter = resolveLocalInstant('2026-03-29', '03:00', 'Europe/Warsaw');
        expect(justAfter.status).toBe('resolved');
        if (justAfter.status !== 'resolved') throw new Error('unreachable');
        expect(justAfter.offsetMinutes).toBe(120);
    });

    it('treats the exact fold boundary (02:00, first occurrence) as ambiguous and 03:00 (past the fold) as resolved', () => {
        expect(resolveLocalInstant('2026-10-25', '02:00', 'Europe/Warsaw').status).toBe('ambiguous');
        const pastFold = resolveLocalInstant('2026-10-25', '03:00', 'Europe/Warsaw');
        expect(pastFold.status).toBe('resolved');
        if (pastFold.status !== 'resolved') throw new Error('unreachable');
        expect(pastFold.offsetMinutes).toBe(60);
    });

    it('rejects a malformed dateStr or timeStr rather than silently misparsing it', () => {
        expect(() => resolveLocalInstant('2026/08/17', '07:00')).toThrow(/dateStr/);
        expect(() => resolveLocalInstant('2026-08-17', '7:00')).toThrow(/timeStr/);
        expect(() => resolveLocalInstant('2026-08-17', '24:00')).toThrow(/timeStr/);
    });
});

describe('elapsedMinutesBetweenInstants', () => {
    it('computes prospective separation as start minus predecessor end, across a DST boundary', () => {
        // Predecessor ends 2026-03-29 01:45 local (CET, UTC+1); next start is 2026-03-29
        // 04:00 local (CEST, UTC+2) -- only 75 real minutes elapsed, not the naive 135
        // minutes a calendar-label subtraction would produce.
        const predecessorEnd = resolveLocalInstant('2026-03-29', '01:45', 'Europe/Warsaw');
        const nextStart = resolveLocalInstant('2026-03-29', '04:00', 'Europe/Warsaw');
        if (predecessorEnd.status !== 'resolved' || nextStart.status !== 'resolved') throw new Error('unreachable');

        expect(elapsedMinutesBetweenInstants(nextStart.instant, predecessorEnd.instant)).toBe(75);
    });

    it('returns a negative value when the "end" instant is actually after the "start" instant', () => {
        expect(elapsedMinutesBetweenInstants('2026-08-17T05:00:00.000Z', '2026-08-17T06:00:00.000Z')).toBe(-60);
    });
});
