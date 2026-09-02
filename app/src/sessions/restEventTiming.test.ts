import { describe, expect, it } from 'vitest';
import { adjustRest, closeRest, startRest } from './restEventTiming';

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
