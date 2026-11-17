/**
 * Clipboard payload builders for the History card's copy buttons. Kept out of
 * `CompletedWorkoutList` so the response-read policy is testable without a DOM.
 */
import type { SessionResponse } from '../responses/models';
import type { CompletedWorkoutView } from '../training-occurrence/completedWorkoutView';
import type { SessionResponseRead } from '../training-occurrence/completedWorkoutJsonExport';
import { formatCompletedWorkoutMarkdown } from '../training-occurrence/completedWorkoutMarkdown';

/** One execution's responses plus the count of response documents that could not be parsed. */
export type ResponseLoader = (executionId: string) => Promise<{ responses: SessionResponse[]; invalidRecords: number }>;

const STRUCTURED_EXECUTION_KEY_PREFIX = 'structured_execution:';

/**
 * Every structured execution the occurrence links to, from its source refs (`sourceKeys`),
 * plus the hydrated execution. Responses join on `sourceSession` to these ids;
 * `SessionResponse.occurrenceId` is a planning identity and is never used here (#1261).
 */
export function structuredExecutionIdsOf(view: CompletedWorkoutView): string[] {
    const fromRefs = view.sourceKeys
        .filter(key => key.startsWith(STRUCTURED_EXECUTION_KEY_PREFIX))
        .map(key => key.slice(STRUCTURED_EXECUTION_KEY_PREFIX.length));
    const hydrated = view.structured?.execution?.executionId;
    return [...new Set([...fromRefs, ...(hydrated ? [hydrated] : [])])].filter(id => id.length > 0);
}

/**
 * `undefined` when responses cannot apply (no loader or no structured execution). A failed
 * read of any linked execution is `failed`: the windows can then not be known. Every window
 * is read, whatever its date, so a historical workout includes its later responses.
 */
export async function loadWorkoutResponses(
    view: CompletedWorkoutView,
    loadResponses: ResponseLoader | undefined,
): Promise<SessionResponseRead | undefined> {
    const executionIds = structuredExecutionIdsOf(view);
    if (executionIds.length === 0 || !loadResponses) return undefined;
    try {
        const reads = await Promise.all(executionIds.map(id => loadResponses(id)));
        const byId = new Map<string, SessionResponse>();
        for (const read of reads) for (const response of read.responses) byId.set(response.responseId, response);
        return {
            status: 'read',
            responses: [...byId.values()],
            invalidRecords: reads.reduce((sum, read) => sum + read.invalidRecords, 0),
        };
    } catch {
        return { status: 'failed' };
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
