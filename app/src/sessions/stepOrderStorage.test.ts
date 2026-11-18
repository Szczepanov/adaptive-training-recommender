import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStepLayout, loadStepLayout, saveStepLayout } from './stepOrderStorage';

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

describe('step layout storage', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('round-trips a layout per execution and clears it', () => {
        const layout = [{ blockId: 'main', stepIds: ['squat', 'added-1', 'bench'] }];
        saveStepLayout('exec-1', layout);
        expect(loadStepLayout('exec-1')).toEqual(layout);
        expect(loadStepLayout('exec-2')).toEqual([]);
        clearStepLayout('exec-1');
        expect(loadStepLayout('exec-1')).toEqual([]);
    });

    it('drops malformed stored data instead of throwing', () => {
        localStorage.setItem('session-step-layout:v1:exec-1', '{not json');
        expect(loadStepLayout('exec-1')).toEqual([]);
        localStorage.setItem('session-step-layout:v1:exec-1', JSON.stringify([{ blockId: 'a' }, { blockId: 'main', stepIds: ['x', 3] }, { blockId: 'b', stepIds: ['y'] }]));
        expect(loadStepLayout('exec-1')).toEqual([{ blockId: 'b', stepIds: ['y'] }]);
    });

    it('works without storage at all', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); },
        });
        expect(() => saveStepLayout('exec-1', [])).not.toThrow();
        expect(loadStepLayout('exec-1')).toEqual([]);
        expect(() => clearStepLayout('exec-1')).not.toThrow();
    });
});
