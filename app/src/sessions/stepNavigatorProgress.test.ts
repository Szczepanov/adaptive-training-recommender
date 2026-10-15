import { describe, expect, it } from 'vitest';
import type { SessionBlock, SessionStep } from './models';
import { describeStepNavigatorProgress } from './stepNavigatorProgress';

const rep = (id: string, sets: number, optional = false): SessionStep => ({
    id, kind: 'exercise', ...(optional ? { optional } : {}), dose: { kind: 'repetition', sets, reps: 5 },
});
const block = (steps: SessionStep[], extra: Partial<SessionBlock> = {}): SessionBlock => (
    { id: 'main', role: 'main', executionMode: 'sequential', steps, ...extra }
);

describe('describeStepNavigatorProgress', () => {
    it('shows 0/target for an unstarted prescribed step and marks it required', () => {
        const step = rep('squat', 3);
        expect(describeStepNavigatorProgress(block([step]), step, 0))
            .toEqual({ progressText: '0/3 sets', requirement: 'required', complete: false });
    });

    it('marks optional work and completion', () => {
        const step = rep('curl', 2, true);
        expect(describeStepNavigatorProgress(block([step]), step, 2))
            .toEqual({ progressText: '2/2 sets', requirement: 'optional', complete: true });
    });

    it('uses block rounds as the authoritative target and singular units', () => {
        const step = rep('row', 4);
        expect(describeStepNavigatorProgress(block([step], { executionMode: 'circuit', rounds: 3 }), step, 1).progressText).toBe('1/3 sets');
        const single = rep('press', 1);
        expect(describeStepNavigatorProgress(block([single]), single, 0).progressText).toBe('0/1 set');
    });

    it('labels check-off and undosed steps without inventing sets', () => {
        const check: SessionStep = { id: 'c', kind: 'exercise', dose: { kind: 'checkoff' } };
        const bare: SessionStep = { id: 'b', kind: 'exercise' };
        expect(describeStepNavigatorProgress(block([check]), check, 0).progressText).toBe('0/1 check-off');
        expect(describeStepNavigatorProgress(block([bare]), bare, 0).progressText).toBe('0/1 done');
    });
});
