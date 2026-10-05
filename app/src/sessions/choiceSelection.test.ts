import { describe, expect, it } from 'vitest';
import type { SessionChoice } from './models';
import { assertChoiceOptionBelongsToChoice } from './choiceSelection';

const choice: SessionChoice = {
    id: 'c1',
    appliesAtStepId: 's1',
    trigger: { kind: 'athlete_observed', description: 'Choose one' },
    options: [{ id: 'o1', label: 'Option 1', actions: [] }],
};

describe('assertChoiceOptionBelongsToChoice', () => {
    it('accepts an option declared by the authored choice', () => {
        expect(() => assertChoiceOptionBelongsToChoice(choice, 'o1')).not.toThrow();
    });

    it('rejects an option that is not present in the frozen authored choice', () => {
        expect(() => assertChoiceOptionBelongsToChoice(choice, 'invented')).toThrow('must belong to the authored choice');
    });
});
