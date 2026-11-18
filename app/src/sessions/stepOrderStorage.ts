import type { StepMove } from './stepReorder';

/**
 * Per-device memory of the athlete's step moves for one execution, so a reload keeps the order
 * they chose. Order is a display convenience: the performed order is already durable through
 * each entry's `completedAt`, so losing this (private window, cleared site data) only restores
 * the authored order.
 */
const keyFor = (executionId: string) => `session-step-order:v1:${executionId}`;

function isStepMove(value: unknown): value is StepMove {
    if (typeof value !== 'object' || value === null) return false;
    const move = value as Record<string, unknown>;
    return typeof move.stepId === 'string' && typeof move.targetStepId === 'string'
        && (move.position === 'before' || move.position === 'after');
}

export function loadStepMoves(executionId: string): StepMove[] {
    try {
        const raw = globalThis.localStorage?.getItem(keyFor(executionId));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isStepMove) : [];
    } catch {
        return [];
    }
}

export function saveStepMoves(executionId: string, moves: readonly StepMove[]): void {
    try {
        globalThis.localStorage?.setItem(keyFor(executionId), JSON.stringify(moves));
    } catch {
        // Storage unavailable or full: the order still applies for this page lifetime.
    }
}

/** Forget an execution's order once it has ended; nothing reloads a finished session's runner. */
export function clearStepMoves(executionId: string): void {
    try {
        globalThis.localStorage?.removeItem(keyFor(executionId));
    } catch {
        // Nothing to clean up when storage is unavailable.
    }
}
