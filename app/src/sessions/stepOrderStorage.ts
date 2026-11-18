import type { StepLayout } from './stepReorder';

/**
 * Per-device memory of the athlete's step order for one execution, so a reload keeps the order
 * they chose. Order is a display convenience: the performed order is already durable through
 * each entry's `completedAt`, so losing this (private window, cleared site data) only restores
 * the authored order. The resulting order is stored, not the moves that produced it, so a lost
 * unlogged step or a different logging order cannot scramble it on restore.
 */
const keyFor = (executionId: string) => `session-step-layout:v1:${executionId}`;

function isLayoutEntry(value: unknown): value is StepLayout[number] {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.blockId === 'string' && Array.isArray(entry.stepIds) && entry.stepIds.every(id => typeof id === 'string');
}

export function loadStepLayout(executionId: string): StepLayout {
    try {
        const raw = globalThis.localStorage?.getItem(keyFor(executionId));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isLayoutEntry) : [];
    } catch {
        return [];
    }
}

export function saveStepLayout(executionId: string, layout: StepLayout): void {
    try {
        globalThis.localStorage?.setItem(keyFor(executionId), JSON.stringify(layout));
    } catch {
        // Storage unavailable or full: the order still applies for this page lifetime.
    }
}

/** Forget an execution's order once it has ended; nothing reloads a finished session's runner. */
export function clearStepLayout(executionId: string): void {
    try {
        globalThis.localStorage?.removeItem(keyFor(executionId));
    } catch {
        // Nothing to clean up when storage is unavailable.
    }
}
