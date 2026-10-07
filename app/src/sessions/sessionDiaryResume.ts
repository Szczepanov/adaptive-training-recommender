import type { SessionEntry } from './models';
import type { DiaryReceipt } from '../services/sessionDiaryReceipts';
import { canonicalizeJson } from '../utils/canonicalJson';
import { validateSessionEntry } from './validation';

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
        .filter(receipt => receipt.state === 'queued' && receipt.mutation.targetKind === 'entry');
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
        const current = states.get(targetId) ?? null;
        const mutations = new Map<string, DiaryReceipt['mutation']>();
        for (const receipt of targetReceipts) {
            const mutation = receipt.mutation;
            const parsed = validateSessionEntry(mutation.after);
            if (!parsed.ok || parsed.value.id !== targetId
                || parsed.value.executionId !== mutation.executionId
                || parsed.value.diaryMutationId !== mutation.id
                || (mutation.before && (mutation.before.id !== targetId
                    || mutation.before.executionId !== mutation.executionId))) {
                conflict = true;
                break;
            }
            const duplicate = mutations.get(mutation.id);
            if (duplicate && !same(duplicate, mutation)) {
                conflict = true;
                break;
            }
            mutations.set(mutation.id, mutation);
        }
        if (conflict) break;
        // ponytail: quadratic per-target chain scan; index canonical states if long offline edit chains matter.
        const remaining = [...mutations.values()];
        const roots = remaining.filter(mutation => !remaining.some(other => same(other.after, mutation.before)));
        if (roots.length !== 1) { conflict = true; break; }
        let tail = roots[0].before;
        let matchesPersisted = same(current, tail);
        while (remaining.length > 0) {
            const next = remaining.filter(mutation => same(mutation.before, tail));
            if (next.length !== 1) {
                conflict = true;
                break;
            }
            tail = next[0].after as SessionEntry;
            matchesPersisted ||= same(current, tail);
            remaining.splice(remaining.indexOf(next[0]), 1);
        }
        if (conflict || !matchesPersisted) { conflict = true; break; }
        states.set(targetId, tail as SessionEntry);
    }

    for (const entry of states.values()) {
        if (entry.deletedAt) continue;
        const governor = entry.governingChoiceEntryId ? states.get(entry.governingChoiceEntryId) : null;
        const predecessor = entry.supersedesChoiceEntryId ? states.get(entry.supersedesChoiceEntryId) : null;
        if (entry.governingChoiceEntryId && (!governor || governor.deletedAt
            || governor.payload.kind !== 'choice' || governor.payload.optionId !== entry.selectedOptionId)
            || entry.supersedesChoiceEntryId && (!predecessor || predecessor.deletedAt
                || predecessor.payload.kind !== 'choice' || entry.payload.kind !== 'choice'
                || predecessor.payload.choiceId !== entry.payload.choiceId)) conflict = true;
    }

    // A conflict must not publish a partially replayed queue as performed work.
    const materialized = conflict ? [...persistedEntries, ...(persistedLastDeletedEntry ? [persistedLastDeletedEntry] : [])] : [...states.values()];
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
