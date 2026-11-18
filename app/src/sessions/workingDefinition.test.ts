import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionDefinition, SessionEntry } from './models';
import { resolveResumeCursor } from './sessionProgressProjection';
import { saveStepLayout } from './stepOrderStorage';
import { restoreWorkingDefinition } from './workingDefinition';

const definition: SessionDefinition = {
    schemaVersion: 2, id: 'def', revision: 1, title: 'Lower', intent: 'training',
    blocks: [{
        id: 'main', title: 'Main', role: 'main', executionMode: 'sequential',
        steps: [
            { id: 'squat', kind: 'exercise', dose: { kind: 'repetition', sets: 1, reps: 5 } },
            { id: 'rdl', kind: 'exercise', dose: { kind: 'repetition', sets: 3, reps: 8 } },
        ],
    }],
} as SessionDefinition;

const set = (id: string, stepId: string, at: string, extra: Partial<SessionEntry> = {}): SessionEntry => ({
    id, executionId: 'exec-1', stepId, completedAt: at, createdAt: at, updatedAt: at,
    payload: { kind: 'repetition', setIndex: 1, reps: 5 }, ...extra,
});

describe('restoreWorkingDefinition', () => {
    beforeEach(() => {
        const data = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => { data.set(k, v); },
            removeItem: (k: string) => { data.delete(k); },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('rebuilds a logged added exercise where the athlete placed it and resumes against that order', () => {
        saveStepLayout('exec-1', [{ blockId: 'main', stepIds: ['squat', 'added-nordic', 'rdl'] }]);
        const entries = [
            set('e1', 'squat', '2026-11-18T10:00:00Z'),
            set('e2', 'added-nordic', '2026-11-18T10:05:00Z', { exerciseRef: { kind: 'catalog', exerciseId: 'nordic_hamstring_curl' } }),
        ];

        const restored = restoreWorkingDefinition(definition, entries, 'exec-1');

        expect(restored.blocks.map(b => b.steps.map(s => s.id))).toEqual([['squat', 'added-nordic', 'rdl']]);
        // Resume goes to the next unfinished planned step; its index must reflect the moved order.
        expect(resolveResumeCursor(restored, entries)).toMatchObject({ blockIndex: 0, stepIndex: 2 });
    });

    it('keeps the authored order when nothing was moved', () => {
        const restored = restoreWorkingDefinition(definition, [], 'exec-2');
        expect(restored.blocks.map(b => b.steps.map(s => s.id))).toEqual([['squat', 'rdl']]);
    });
});
