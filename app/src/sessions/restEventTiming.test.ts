import { describe, expect, it } from 'vitest';
import {
    adjustRest,
    closeRest,
    restDeadlineMs,
    restSecondsRemainingAt,
    restTotalSeconds,
    sessionElapsedSecondsAt,
    startRest,
} from './restEventTiming';

describe('restEventTiming', () => {
    it('timer elapsed normally: actualSeconds reflects real elapsed time, endReason timer_elapsed', () => {
        const active = startRest('entry-1', '2026-08-26T06:00:00.000Z', 90);
        const event = closeRest(active, '2026-08-26T06:01:30.000Z', 'timer_elapsed');

        expect(event).toMatchObject({
            afterEntryId: 'entry-1',
            startedAt: '2026-08-26T06:00:00.000Z',
            endedAt: '2026-08-26T06:01:30.000Z',
            actualSeconds: 90,
            endReason: 'timer_elapsed',
            prescribedSeconds: 90,
        });
        expect(event.adjustmentSeconds).toBeUndefined();
    });

    it('rest skipped: actualSeconds is the real (short) elapsed time, endReason skipped', () => {
        const active = startRest('entry-1', '2026-08-26T06:00:00.000Z', 90);
        const event = closeRest(active, '2026-08-26T06:00:10.000Z', 'skipped');

        expect(event.actualSeconds).toBe(10);
        expect(event.endReason).toBe('skipped');
    });

    it('rest extended: adjustmentSeconds accumulates across multiple taps and is reported on close', () => {
        let active = startRest('entry-1', '2026-08-26T06:00:00.000Z', 60);
        active = adjustRest(active, 15);
        active = adjustRest(active, 15);
        const event = closeRest(active, '2026-08-26T06:01:30.000Z', 'timer_elapsed');

        expect(event.adjustmentSeconds).toBe(30);
        expect(event.actualSeconds).toBe(90); // real elapsed time, independent of the reported adjustment
    });

    it('rest reduced: a negative adjustment is preserved, not clamped away', () => {
        let active = startRest('entry-1', '2026-08-26T06:00:00.000Z', 60);
        active = adjustRest(active, -20);
        const event = closeRest(active, '2026-08-26T06:00:40.000Z', 'skipped');

        expect(event.adjustmentSeconds).toBe(-20);
    });

    it('next set starts before timer completes: the prior rest closes with endReason next_set_started at the real elapsed time', () => {
        const active = startRest('entry-1', '2026-08-26T06:00:00.000Z', 90);
        const event = closeRest(active, '2026-08-26T06:00:45.000Z', 'next_set_started');

        expect(event.actualSeconds).toBe(45);
        expect(event.endReason).toBe('next_set_started');
    });

    it('session ends during rest: closes with endReason session_ended at the real elapsed time', () => {
        const active = startRest('entry-1', '2026-08-26T06:00:00.000Z', 90);
        const event = closeRest(active, '2026-08-26T06:00:20.000Z', 'session_ended');

        expect(event.actualSeconds).toBe(20);
        expect(event.endReason).toBe('session_ended');
    });

    it('never derives actualSeconds from two different entries -- it is always startedAt/endedAt of the same rest instance', () => {
        // Two entries logged 145s apart (the Finding 5 example from the analysis doc) must
        // never leak into this module at all -- it only ever sees one rest's own instants.
        const active = startRest('entry-1', '2026-08-26T06:52:30.000Z', 120);
        const event = closeRest(active, '2026-08-26T06:53:15.000Z', 'skipped'); // athlete skipped early
        expect(event.actualSeconds).toBe(45); // not the 145s gap between entries
    });

    it('clamps actualSeconds to zero rather than persisting a negative duration on out-of-order timestamps', () => {
        const active = startRest('entry-1', '2026-08-26T06:00:10.000Z', 60);
        const event = closeRest(active, '2026-08-26T06:00:00.000Z', 'skipped');
        expect(event.actualSeconds).toBe(0);
    });

    it('omits prescribedSeconds when the step had none', () => {
        const active = startRest('entry-1', '2026-08-26T06:00:00.000Z');
        const event = closeRest(active, '2026-08-26T06:00:30.000Z', 'skipped');
        expect(event).not.toHaveProperty('prescribedSeconds');
    });
});

describe('wall-clock derivation (#908)', () => {
    const startIso = '2026-08-26T06:00:00.000Z';
    const startMs = Date.parse(startIso);

    it('derives the countdown remainder from the deadline, not from callback count', () => {
        const active = startRest('entry-1', startIso, 90);
        expect(restTotalSeconds(active)).toBe(90);
        expect(restDeadlineMs(active)).toBe(startMs + 90_000);
        // Halfway through, whatever ticks did or did not fire.
        expect(restSecondsRemainingAt(active, startMs + 45_000)).toBe(45);
        expect(restSecondsRemainingAt(active, startMs + 89_100)).toBe(1);
    });

    it('a multi-minute background jump lands on zero, never negative, exactly once at the boundary', () => {
        const active = startRest('entry-1', startIso, 90);
        // The deadline instant itself has just elapsed.
        expect(restSecondsRemainingAt(active, startMs + 90_000)).toBe(0);
        // A tab throttled for five minutes observes the same terminal zero.
        expect(restSecondsRemainingAt(active, startMs + 5 * 60_000)).toBe(0);
        // Closing that far past the deadline still persists real elapsed time.
        const event = closeRest(active, new Date(startMs + 5 * 60_000).toISOString(), 'timer_elapsed');
        expect(event.actualSeconds).toBe(300);
        expect(event.endReason).toBe('timer_elapsed');
    });

    it('a +30s extension moves the deadline deterministically', () => {
        let active = startRest('entry-1', startIso, 60);
        active = adjustRest(active, 30);
        expect(restTotalSeconds(active)).toBe(90);
        expect(restDeadlineMs(active)).toBe(startMs + 90_000);
        expect(restSecondsRemainingAt(active, startMs + 75_000)).toBe(15);
        expect(adjustRest(active, 0).adjustmentSeconds).toBe(30);
    });

    it('skip and next-set-started close at the real wall-clock age, not the prescription', () => {
        const skipped = startRest('entry-1', startIso, 90);
        expect(restSecondsRemainingAt(skipped, startMs + 10_000)).toBe(80);
        expect(closeRest(skipped, new Date(startMs + 10_000).toISOString(), 'skipped').actualSeconds).toBe(10);

        const interrupted = startRest('entry-2', startIso, 90);
        expect(restSecondsRemainingAt(interrupted, startMs + 45_000)).toBe(45);
        const event = closeRest(interrupted, new Date(startMs + 45_000).toISOString(), 'next_set_started');
        expect(event.actualSeconds).toBe(45);
        expect(event.endReason).toBe('next_set_started');
    });

    it('derives session elapsed from startedAt across a background-style clock jump', () => {
        expect(sessionElapsedSecondsAt(startIso, startMs + 5_000)).toBe(5);
        // Ten minutes pass with no callback firing in between.
        expect(sessionElapsedSecondsAt(startIso, startMs + 10 * 60_000)).toBe(600);
        // Clock skew or out-of-order reads never display negative time.
        expect(sessionElapsedSecondsAt(startIso, startMs - 1_000)).toBe(0);
        expect(sessionElapsedSecondsAt('not-a-date', startMs)).toBe(0);
    });
});
