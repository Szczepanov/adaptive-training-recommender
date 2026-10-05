import type { SessionDiaryMutation } from './sessionExecutionService';

export interface DiaryReceipt {
    mutation: SessionDiaryMutation;
    state: 'queued' | 'failed';
}

const PREFIX = 'session-diary-receipt-v1:';
// Node emulator tests have no browser storage. The real browser must persist receipts
// before reporting local acceptance; quota/storage errors are allowed to fail closed.
const memory = new Map<string, string>();
function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> {
    if (typeof window !== 'undefined') return window.localStorage;
    return {
        getItem: key => memory.get(key) ?? null,
        setItem: (key, value) => { memory.set(key, value); },
        removeItem: key => { memory.delete(key); },
        key: index => [...memory.keys()][index] ?? null,
        get length() { return memory.size; },
    };
}

function scope(userId: string, executionId: string): string {
    return `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(executionId)}:`;
}

export function saveDiaryReceipt(userId: string, receipt: DiaryReceipt): void {
    const mutation = receipt.mutation;
    storage().setItem(`${scope(userId, mutation.executionId)}${encodeURIComponent(mutation.id)}`, JSON.stringify(receipt));
}

export function removeDiaryReceipt(userId: string, executionId: string, mutationId: string): void {
    storage().removeItem(`${scope(userId, executionId)}${encodeURIComponent(mutationId)}`);
}

/** Receipts preserve rejected intent, but never replay writes or compete with the SDK. */
export function readDiaryReceipts(userId: string, executionId: string): DiaryReceipt[] {
    const store = storage();
    const prefix = scope(userId, executionId);
    const receipts: DiaryReceipt[] = [];
    for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        if (!key?.startsWith(prefix)) continue;
        const value = store.getItem(key);
        if (!value) continue;
        // A malformed receipt is an explicit storage error, never silently discarded.
        const receipt = JSON.parse(value) as DiaryReceipt;
        if (!receipt.mutation || receipt.mutation.executionId !== executionId
            || !['queued', 'failed'].includes(receipt.state)) throw new Error('Invalid diary receipt.');
        receipts.push(receipt);
    }
    return receipts;
}
