import { describe, expect, it } from 'vitest';
import type { SessionStep } from './models';
import { DEFAULT_SESSION_REST_SECONDS, resolvePostEntryRestSeconds } from './restTiming';

const repetitionStep = (rest?: SessionStep['rest']): SessionStep => ({
    id: 'step-1',
    kind: 'exercise',
    title: 'Test step',
    dose: { kind: 'repetition', sets: 1, reps: 5 },
    ...(rest !== undefined ? { rest } : {}),
});

describe('resolvePostEntryRestSeconds', () => {
    it('keeps authored fixed rest in warm-up blocks', () => {
        expect(resolvePostEntryRestSeconds(repetitionStep(45), 'warmup')).toBe(45);
    });

    it('uses the minimum of an authored rest range', () => {
        expect(resolvePostEntryRestSeconds(repetitionStep({ min: 75, max: 105 }), 'main')).toBe(75);
    });

    it('does not invent a countdown for a warm-up step with no authored rest', () => {
        expect(resolvePostEntryRestSeconds(repetitionStep(), 'warmup')).toBe(0);
    });

    it('preserves the legacy fallback outside warm-up blocks', () => {
        expect(resolvePostEntryRestSeconds(repetitionStep(), 'main')).toBe(DEFAULT_SESSION_REST_SECONDS);
    });
});
