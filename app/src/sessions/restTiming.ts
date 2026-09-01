import type { BlockRole, SessionStep } from './models';

export const DEFAULT_SESSION_REST_SECONDS = 60;

/**
 * Resolve the advisory countdown started after a logged entry.
 *
 * Authored rest always wins. Outside warm-up blocks the runner retains its legacy 60-second
 * fallback for steps with no explicit rest. A structured warm-up is different: omission means
 * the author did not prescribe a pause, so simple rehearsal/preparation drills should flow into
 * the next drill without an invented countdown. Warm-up steps that need recovery must author it.
 */
export function resolvePostEntryRestSeconds(step: SessionStep, blockRole?: BlockRole): number {
    if (step.rest !== undefined) {
        return typeof step.rest === 'number' ? step.rest : step.rest.min;
    }
    return blockRole === 'warmup' ? 0 : DEFAULT_SESSION_REST_SECONDS;
}
