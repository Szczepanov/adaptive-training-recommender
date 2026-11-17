import { describe, expect, it } from 'vitest';
import type { NormalizedExecutionRecord } from '../sessions/legacyStrengthAdapter';
import type { SessionDefinition, SessionEntry } from '../sessions/models';
import { choiceOverridesForExecution } from './ledgerChoiceOverrides';

const AT = '2026-11-19T07:00:00.000Z';

const definition = {
    schemaVersion: 1, id: 'w', revision: 1, title: 'Strength', intent: 'training',
    blocks: [{
        id: 'b1', role: 'main',
        steps: [
            {
                id: 'squat', kind: 'exercise', title: 'Back Squat', exerciseRef: { kind: 'catalog', exerciseId: 'back_squat' },
                alternatives: [{ id: 'alt-goblet', title: 'Goblet Squat', exerciseRef: { kind: 'catalog', exerciseId: 'goblet_squat' } }],
            },
            { id: 'curl', kind: 'exercise', title: 'Curl', exerciseRef: { kind: 'catalog', exerciseId: 'curl' } },
        ],
        optionSets: [
            {
                id: 'knee', appliesAtStepId: 'squat', trigger: { kind: 'athlete_observed', description: 'knee?' },
                options: [
                    { id: 'swap', label: 'Swap', actions: [{ kind: 'select_alternative', targetStepId: 'squat', alternativeId: 'alt-goblet' }] },
                    { id: 'lighter', label: 'Lighter', actions: [{ kind: 'reduce_load_percent', targetStepId: 'squat', percent: 10 }] },
                    { id: 'skip-both', label: 'Skip', actions: [{ kind: 'omit_step', targetStepId: 'squat' }, { kind: 'omit_step', targetStepId: 'curl' }] },
                    { id: 'bad-alt', label: 'Bad', actions: [{ kind: 'select_alternative', targetStepId: 'squat', alternativeId: 'nope' }] },
                ],
            },
        ],
    }],
} as unknown as SessionDefinition;

const choice = (id: string, optionId: string, extra: Partial<SessionEntry> = {}, reason?: string): SessionEntry => ({
    id, executionId: 'exec-1', completedAt: AT, createdAt: AT, updatedAt: AT,
    payload: { kind: 'choice', choiceId: 'knee', optionId, ...(reason !== undefined ? { reason } : {}) },
    ...extra,
}) as SessionEntry;

const run = (entries: SessionEntry[], source: object = { kind: 'external_plan', planId: 'plan-1', revision: 2, sessionId: 's1', contentHash: 'h' }) => ({
    execution: { executionId: 'exec-1', date: '2026-11-19', state: 'completed', sessionSource: source },
    entries,
}) as unknown as NormalizedExecutionRecord;

describe('choiceOverridesForExecution', () => {
    it('reports a chosen alternative as a swap with the step, replacement and reason', () => {
        expect(choiceOverridesForExecution(run([choice('c1', 'swap', {}, ' Knee tight ')]), { definition })).toEqual([{
            id: 'exec-1:c1:0', date: '2026-11-19', executionState: 'completed', planId: 'plan-1', sessionId: 's1',
            kind: 'swapped', step: 'Back Squat', replacement: 'Goblet Squat', reason: 'Knee tight',
        }]);
    });

    it('reports each omitted step, and no override for load, set or rep reductions', () => {
        const rows = choiceOverridesForExecution(run([choice('c1', 'skip-both')]), { definition });
        expect(rows.map(row => [row.id, row.kind, row.step])).toEqual([['exec-1:c1:0', 'omitted', 'Back Squat'], ['exec-1:c1:1', 'omitted', 'Curl']]);
        expect(choiceOverridesForExecution(run([choice('c2', 'lighter')]), { definition })).toEqual([]);
    });

    it('keeps explicit missingness for an unresolvable choice instead of guessing', () => {
        const [unknownOption] = choiceOverridesForExecution(run([choice('c1', 'gone')]), { definition });
        expect(unknownOption).toMatchObject({ kind: null, kindState: 'invalid' });
        const [unreadable] = choiceOverridesForExecution(run([choice('c1', 'swap')]), { state: 'unavailable' });
        expect(unreadable).toMatchObject({ kind: null, kindState: 'unavailable' });
        const [badAlternative] = choiceOverridesForExecution(run([choice('c1', 'bad-alt')]), { definition });
        expect(badAlternative).toMatchObject({ kind: 'swapped', step: 'Back Squat', replacementState: 'invalid' });
        expect(badAlternative.replacement).toBeUndefined();
    });

    it('counts only the effective event of a correction chain, so a correction is not a second override', () => {
        const rows = choiceOverridesForExecution(run([
            choice('c1', 'swap'),
            choice('c2', 'lighter', { supersedesChoiceEntryId: 'c1', completedAt: '2026-11-19T07:05:00.000Z' }),
        ]), { definition });
        expect(rows).toEqual([]);
    });

    it('ignores deleted choices, omits a blank reason, and has no plan ids for a non-plan session', () => {
        expect(choiceOverridesForExecution(run([choice('c1', 'swap', { deletedAt: AT })]), { definition })).toEqual([]);
        const [row] = choiceOverridesForExecution(run([choice('c1', 'swap', {}, '   ')], { kind: 'manual', definitionId: 'd', revision: 1, contentHash: 'h' }), { definition });
        expect(row.reason).toBeUndefined();
        expect(row.planId).toBeUndefined();
        expect(row.sessionId).toBeUndefined();
    });
});
