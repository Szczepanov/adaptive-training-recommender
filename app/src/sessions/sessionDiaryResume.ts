import type { SessionEntry } from './models';
import type { DiaryReceipt } from '../services/sessionDiaryReceipts';
import { canonicalizeJson } from '../utils/canonicalJson';

export type ResumeDiaryOverlayResult =
    | {
        status: 'ready';
        entries: SessionEntry[];
        lastDeletedEntry: SessionEntry | null;
        queuedReceiptCount: number;
        failedReceiptCount: number;
    }
    | {
        status: 'degraded';
        reason: 'queued-diary-causal-conflict';
        entries: SessionEntry[];
        lastDeletedEntry: SessionEntry | null;
        queuedReceiptCount: number;
        failedReceiptCount: number;
    };

function canonical(value: unknown): string {
    return JSON.stringify(canonicalizeJson(value));
}

function same(left: unknown, right: unknown): boolean {
    return canonical(left) === canonical(right);
}

/**
 * Overlays locally-accepted Firebase-persistent-queue receipts on the server view.
 * Failed receipts are diagnostics only and never count as performed work. Queued
 * mutations are admitted only when their before/after chain is causally consistent
 * with the persisted materialized target. Rest receipts are intentionally excluded:
 * performed rest events do not advance the workout cursor and an in-flight rest is
 * never reconstructed after reload.
 */
export function overlayQueuedDiaryState(
    persistedEntries: readonly SessionEntry[],
    persistedLastDeletedEntry: SessionEntry | null,
    receipts: readonly DiaryReceipt[],
): ResumeDiaryOverlayResult {
    const failedReceiptCount = receipts.filter(receipt => receipt.state === 'failed').length;
    const queued = receipts
        .filter(receipt => receipt.state === 'queued' && receipt.mutation.targetKind === 'entry')
        .sort((left, right) => left.mutation.at.localeCompare(right.mutation.at)
            || left.mutation.id.localeCompare(right.mutation.id));
    const queuedReceiptCount = queued.length;

    const states = new Map<string, SessionEntry>();
    for (const entry of persistedEntries) states.set(entry.id, entry);
    if (persistedLastDeletedEntry && !states.has(persistedLastDeletedEntry.id)) {
        states.set(persistedLastDeletedEntry.id, persistedLastDeletedEntry);
    }

    const byTarget = new Map<string, typeof queued>();
    for (const receipt of queued) {
        const list = byTarget.get(receipt.mutation.targetId) ?? [];
        list.push(receipt);
        byTarget.set(receipt.mutation.targetId, list);
    }

    let conflict = false;
    for (const [targetId, targetReceipts] of byTarget) {
        let current: SessionEntry | null = states.get(targetId) ?? null;
        const seenIds = new Set<string>();
        for (const receipt of targetReceipts) {
            const mutation = receipt.mutation;
            if (seenIds.has(mutation.id)) {
                conflict = true;
                break;
            }
            seenIds.add(mutation.id);
            const after = mutation.after as SessionEntry;
            if (same(current, after)) {
                // Firebase may have already materialized this mutation while the local
                // receipt has not yet been removed. Treat the receipt as converged.
                continue;
            }
            if (!same(current, mutation.before)) {
                conflict = true;
                break;
            }
            current = after;
        }
        if (conflict) break;
        if (current) states.set(targetId, current);
        else states.delete(targetId);
    }

    const materialized = [...states.values()];
    const entries = materialized
        .filter(entry => entry.deletedAt == null)
        .sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.id.localeCompare(right.id));
    const deleted = materialized
        .filter(entry => typeof entry.deletedAt === 'string')
        .sort((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? '')
            || right.updatedAt.localeCompare(left.updatedAt));
    const lastDeletedEntry = deleted[0] ?? persistedLastDeletedEntry;

    return conflict
        ? { status: 'degraded', reason: 'queued-diary-causal-conflict', entries, lastDeletedEntry, queuedReceiptCount, failedReceiptCount }
        : { status: 'ready', entries, lastDeletedEntry, queuedReceiptCount, failedReceiptCount };
}
