import type { SessionChoice } from './models';

/** D-MCHOICE: a recorded answer must name an option from the frozen authored choice. */
export function assertChoiceOptionBelongsToChoice(choice: SessionChoice, optionId: string): void {
    if (!choice.options.some(option => option.id === optionId)) {
        throw new Error('Selected option must belong to the authored choice in the frozen session definition.');
    }
}
