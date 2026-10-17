import { describe, expect, it } from 'vitest';
import { deliveredPatternWork } from './deliveredComposition';
import type { SessionEntry, SessionEntryPayload } from './models';

function entry(id: string, payload: SessionEntryPayload, overrides: Partial<SessionEntry> = {}): SessionEntry {
    return {
        id, executionId: 'exec-1', stepId: 'split-squat', compositionPatterns: ['unilateral_lower_body'],
        completedAt: '2026-10-17T08:00:00.000Z', createdAt: '2026-10-17T08:00:00.000Z', updatedAt: '2026-10-17T08:00:00.000Z',
        payload, ...overrides,
    };
}

const workingSet = (id: string, overrides: Partial<SessionEntry> = {}) =>
    entry(id, { kind: 'repetition', setIndex: 1, reps: 8, weightKg: 20 }, overrides);

describe('deliveredPatternWork (#803 delivered-exposure rule)', () => {
    it('counts logged working sets stamped with the pattern and lists their steps', () => {
        expect(deliveredPatternWork([
            workingSet('a'),
            workingSet('b', { stepId: 'step-up' }),
            entry('c', { kind: 'duration', seconds: 30 }),
            entry('d', { kind: 'checkoff', completed: true }, { stepId: 'lunge' }),
        ], 'unilateral_lower_body')).toEqual({ workingSets: 4, stepIds: ['lunge', 'split-squat', 'step-up'] });
    });

    it.each([
        ['a warm-up set', workingSet('w', { payload: { kind: 'repetition', setIndex: 1, reps: 10, isWarmup: true } })],
        ['a zero-rep set', workingSet('z', { payload: { kind: 'repetition', setIndex: 1, reps: 0 } })],
        ['a deleted set', workingSet('x', { deletedAt: '2026-10-17T08:05:00.000Z' })],
        ['a set without the pattern', workingSet('n', { compositionPatterns: ['knee_dominant_bilateral'] })],
        ['a set with no composition evidence', workingSet('u', { compositionPatterns: undefined })],
        ['an unchecked item', entry('k', { kind: 'checkoff', completed: false })],
        ['a choice event', entry('ch', { kind: 'choice', choiceId: 'c', optionId: 'o' })],
    ])('ignores %s and reports no evidence rather than a negative', (_label, ignored) => {
        expect(deliveredPatternWork([ignored], 'unilateral_lower_body')).toBeNull();
    });

    it('returns null for an empty diary', () => {
        expect(deliveredPatternWork([], 'unilateral_lower_body')).toBeNull();
    });
});
