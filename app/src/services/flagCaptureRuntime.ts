/** Account-scoped notification only; mutation services never load the capture writer. */
export const FLAG_INPUTS_CHANGED = 'adaptive:flag-inputs-changed';
export function notifyFlagInputsChanged(userId: string): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FLAG_INPUTS_CHANGED, { detail: { userId } }));
}
