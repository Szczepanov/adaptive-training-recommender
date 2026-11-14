/**
 * Clipboard payload builders for the History card's copy buttons. Kept out of
 * `CompletedWorkoutList` so the response-read policy is testable without a DOM.
 */
import type { SessionResponse } from '../responses/models';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import { formatCompletedWorkoutMarkdown } from '../training-occurrence/completedWorkoutMarkdown';

export type ResponseLoader = (executionId: string) => Promise<SessionResponse[]>;

/**
 * `undefined` when responses cannot apply (no loader or no execution), `'unavailable'` when
 * the read fails, otherwise the loaded responses.
 */
export async function loadWorkoutResponses(
    view: CompletedWorkoutView,
    loadResponses: ResponseLoader | undefined,
): Promise<readonly SessionResponse[] | 'unavailable' | undefined> {
    const executionId = view.structured?.execution?.executionId;
    if (!executionId || !loadResponses) return undefined;
    try {
        return await loadResponses(executionId);
    } catch {
        return 'unavailable';
    }
}

/** Markdown session report for pasting into an AI assistant. */
export async function buildWorkoutAiCopy(
    view: CompletedWorkoutView,
    exportedAt: string,
    loadResponses: ResponseLoader | undefined,
): Promise<string> {
    return formatCompletedWorkoutMarkdown(view, exportedAt, await loadWorkoutResponses(view, loadResponses));
}
