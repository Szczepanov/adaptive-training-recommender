import { describe, expect, it } from 'vitest';
import { validateSessionEntry } from './validation';

const at = '2026-10-05T08:01:00Z';
function base(payload: Record<string, unknown>) { return { id: 'entry-2', executionId: 'exec-1', completedAt: at, createdAt: at, updatedAt: at, payload }; }

describe('choice entry reference validation', () => {
    it('accepts legacy choices, explicit supersession, and performed governing references', () => {
        expect(validateSessionEntry(base({ kind: 'choice', choiceId: 'c1', optionId: 'o1' })).ok).toBe(true);
        expect(validateSessionEntry({ ...base({ kind: 'choice', choiceId: 'c1', optionId: 'o2' }), supersedesChoiceEntryId: 'entry-1' }).ok).toBe(true);
        expect(validateSessionEntry({ ...base({ kind: 'repetition', setIndex: 1, reps: 5 }), governingChoiceEntryId: 'entry-1' }).ok).toBe(true);
    });

    it('rejects self-supersession and choice/performed reference shape inversion', () => {
        expect(validateSessionEntry({ ...base({ kind: 'choice', choiceId: 'c1', optionId: 'o2' }), supersedesChoiceEntryId: 'entry-2' }).ok).toBe(false);
        expect(validateSessionEntry({ ...base({ kind: 'repetition', setIndex: 1, reps: 5 }), supersedesChoiceEntryId: 'entry-1' }).ok).toBe(false);
        expect(validateSessionEntry({ ...base({ kind: 'choice', choiceId: 'c1', optionId: 'o1' }), governingChoiceEntryId: 'entry-1' }).ok).toBe(false);
    });
});
