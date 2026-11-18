import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStepMoves, loadStepMoves, saveStepMoves } from './stepOrderStorage';

function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() { return data.size; },
        clear: () => data.clear(),
        getItem: key => data.get(key) ?? null,
        key: index => [...data.keys()][index] ?? null,
        removeItem: key => { data.delete(key); },
        setItem: (key, value) => { data.set(key, value); },
    };
}

describe('step order storage', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('round-trips moves per execution and clears them', () => {
        const moves = [{ stepId: 'added-1', targetStepId: 'squat', position: 'after' as const }];
        saveStepMoves('exec-1', moves);
        expect(loadStepMoves('exec-1')).toEqual(moves);
        expect(loadStepMoves('exec-2')).toEqual([]);
        clearStepMoves('exec-1');
        expect(loadStepMoves('exec-1')).toEqual([]);
    });

    it('drops malformed stored data instead of throwing', () => {
        localStorage.setItem('session-step-order:v1:exec-1', '{not json');
        expect(loadStepMoves('exec-1')).toEqual([]);
        localStorage.setItem('session-step-order:v1:exec-1', JSON.stringify([{ stepId: 'a' }, { stepId: 'b', targetStepId: 'c', position: 'before' }]));
        expect(loadStepMoves('exec-1')).toEqual([{ stepId: 'b', targetStepId: 'c', position: 'before' }]);
    });

    it('works without storage at all', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); },
        });
        expect(() => saveStepMoves('exec-1', [])).not.toThrow();
        expect(loadStepMoves('exec-1')).toEqual([]);
        expect(() => clearStepMoves('exec-1')).not.toThrow();
    });
});
