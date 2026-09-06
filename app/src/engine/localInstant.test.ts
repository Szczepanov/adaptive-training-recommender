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

    // CodeRabbit review finding on PR #427: DATE_PATTERN's shape check alone accepts a
    // calendar-invalid value like day 30 in February; Date.UTC then silently normalizes
    // it into March, and the wall-clock round-trip check would misclassify the result as
    // a DST gap ('nonexistent') rather than rejecting the malformed input outright.
    it('rejects a calendar-invalid dateStr (e.g. February 30) rather than normalizing it into the following month', () => {
        expect(() => resolveLocalInstant('2026-02-30', '07:00')).toThrow(/valid calendar date/);
        expect(() => resolveLocalInstant('2026-04-31', '07:00')).toThrow(/valid calendar date/); // April has 30 days
        expect(() => resolveLocalInstant('2026-13-01', '07:00')).toThrow(/valid calendar date/); // no month 13
    });

    // CodeRabbit review finding on PR #427: the original sample window was centered on
    // the naive instant (wall-clock reading treated as if it were UTC), which only
    // happens to sit near the true candidate for zones close to UTC. A zone whose offset
    // magnitude is large enough (a Western zone with a very negative offset, or an
    // Eastern zone with a large positive one) puts the true candidate instants hours away
    // from that naive instant, outside the +-2h window, silently returning only one of
    // two valid answers during a fall-back fold instead of reporting it as ambiguous.
    describe('offset discovery is correctly centered regardless of the zone\'s UTC distance', () => {
        it('a Western zone far from UTC: America/New_York 2026 fall-back (EDT UTC-4 -> EST UTC-5) is ambiguous', () => {
            // Verified transition: 2026-11-01 06:00Z is 2026-11-01 01:00 EST; the hour
            // before that (01:00-01:59 local) occurs twice, once per offset.
            const result = resolveLocalInstant('2026-11-01', '01:30', 'America/New_York');
            expect(result.status).toBe('ambiguous');
            if (result.status !== 'ambiguous') throw new Error('unreachable');
            expect(result.candidates[0]).toEqual({ instant: '2026-11-01T05:30:00.000Z', offsetMinutes: -240 }); // EDT, earlier
            expect(result.candidates[1]).toEqual({ instant: '2026-11-01T06:30:00.000Z', offsetMinutes: -300 }); // EST, later
        });

        it('a high-positive-offset zone: Pacific/Auckland 2026 fall-back (NZDT UTC+13 -> NZST UTC+12) is ambiguous', () => {
            // Verified transition: 2026-04-04 14:00Z is 2026-04-05 02:00 NZST; the hour
            // before that (02:00-02:59 local on 2026-04-05) occurs twice, once per offset.
            const result = resolveLocalInstant('2026-04-05', '02:30', 'Pacific/Auckland');
            expect(result.status).toBe('ambiguous');
            if (result.status !== 'ambiguous') throw new Error('unreachable');
            expect(result.candidates[0]).toEqual({ instant: '2026-04-04T13:30:00.000Z', offsetMinutes: 780 }); // NZDT, earlier
            expect(result.candidates[1]).toEqual({ instant: '2026-04-04T14:30:00.000Z', offsetMinutes: 720 }); // NZST, later
        });

        it('resolves an ordinary Western-zone date unambiguously', () => {
            const result = resolveLocalInstant('2026-08-17', '09:00', 'America/New_York');
            expect(result.status).toBe('resolved');
            if (result.status !== 'resolved') throw new Error('unreachable');
            expect(result.offsetMinutes).toBe(-240); // EDT
            expect(result.instant).toBe('2026-08-17T13:00:00.000Z');
        });
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
