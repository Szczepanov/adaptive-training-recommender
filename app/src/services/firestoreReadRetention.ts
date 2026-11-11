import {
    getDoc,
    getDocs,
    onSnapshot,
    queryEqual,
    type DocumentReference,
    type DocumentSnapshot,
    type Query,
    type QuerySnapshot,
} from 'firebase/firestore';

/**
 * Hot reads that reuse one short-lived watch target.
 *
 * An online `getDoc`/`getDocs` is served by the SDK as a one-shot listen: it adds a watch
 * target, waits for the synced snapshot, then removes the target. Reading the same
 * document or query again a moment later repeats the round trip. Home, the composer,
 * check-in, flag capture and the context brief each read today's recovery snapshot,
 * check-in, settings and plan data this way, so one screen load re-reads the same handful
 * of documents and collections dozens of times. Each read is a billed Firestore read
 * and, against the emulator, a WebChannel request that opens and closes a fresh loopback
 * connection inside the emulator JVM: the ephemeral-port churn behind
 * `net::ERR_NO_BUFFER_SPACE` in E2E runs.
 *
 * The retained variants keep a no-op listener on the document or query for a short idle
 * window. While one is active, the SDK serves a read of the same target from that synced
 * watch target without adding a new one (`eventManagerListen` takes its no-action path),
 * so repeated reads cost nothing on the wire. The read itself is still a plain
 * `getDoc`/`getDocs`: offline, cache and error behaviour is unchanged, and writes this
 * client makes with `setDoc`/`updateDoc`/batches are visible at once (latency compensation).
 *
 * Never retain a document or query that any code writes with `runTransaction`. Transaction
 * commits are not applied to the local cache; a retained target sees them only when the
 * watch stream pushes them, so a read right after a commit can return the pre-commit state,
 * where a one-shot read would fetch the committed one. Retention is per target, so it also
 * affects plain `getDoc` calls elsewhere for the same document, including write guards.
 * Excluded for that reason: daily_recommendations, session_occurrences, session_executions
 * headers, external_plans (header, revisions, activations, placement), trainingSettings,
 * execution_prescriptions, and every other transaction-written collection.
 */

export const READ_RETENTION_IDLE_MS = 60_000;
export const READ_RETENTION_MAX_LISTENERS = 32;

interface Retention {
    readonly unsubscribe: () => void;
    readonly timer: ReturnType<typeof setTimeout>;
    readonly query: Query | null;
}

// Insertion order doubles as least-recently-read order: each read re-inserts its entry.
const retained = new Map<string, Retention>();
let nextQueryId = 0;

function release(id: string): void {
    const entry = retained.get(id);
    if (!entry) return;
    retained.delete(id);
    clearTimeout(entry.timer);
    entry.unsubscribe();
}

function touch(id: string, entry: Retention): void {
    clearTimeout(entry.timer);
    retained.delete(id);
    retained.set(id, { ...entry, timer: setTimeout(() => release(id), READ_RETENTION_IDLE_MS) });
}

function openListener(id: string, target: DocumentReference | Query): (() => void) | null {
    try {
        // A listener that errors (permission denied after sign-out, a rejected path) is
        // already dead in the SDK; forget it so the next read retains afresh.
        return onSnapshot(target as Query, () => undefined, () => release(id));
    } catch {
        return null;
    }
}

function add(id: string, target: DocumentReference | Query, query: Query | null): void {
    const unsubscribe = openListener(id, target);
    if (!unsubscribe) return;
    retained.set(id, { unsubscribe, query, timer: setTimeout(() => release(id), READ_RETENTION_IDLE_MS) });
    while (retained.size > READ_RETENTION_MAX_LISTENERS) {
        const oldest = retained.keys().next().value;
        if (oldest === undefined) break;
        release(oldest);
    }
}

function findQuery(target: Query): string | null {
    for (const [id, entry] of retained) {
        if (entry.query && queryEqual(entry.query, target)) return id;
    }
    return null;
}

function retainDoc(ref: DocumentReference): void {
    const id = `doc:${ref.path}`;
    const existing = retained.get(id);
    if (existing) touch(id, existing);
    else add(id, ref, null);
}

function retainQuery(target: Query): void {
    let existingId: string | null;
    try {
        existingId = findQuery(target);
    } catch {
        return;
    }
    const existing = existingId === null ? undefined : retained.get(existingId);
    if (existingId !== null && existing) {
        touch(existingId, existing);
        return;
    }
    nextQueryId += 1;
    add(`query:${nextQueryId}`, target, target);
}

/** `getDoc` for a document the app reads repeatedly; see the module comment. */
export async function getDocRetained<T>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
    retainDoc(ref as DocumentReference);
    return getDoc(ref);
}

/** `getDocs` for a query the app runs repeatedly; see the module comment. */
export async function getDocsRetained<T>(target: Query<T>): Promise<QuerySnapshot<T>> {
    retainQuery(target as Query);
    return getDocs(target);
}

/** Stops every retaining listener, for example when the signed-in user changes. */
export function releaseRetainedReads(): void {
    for (const id of [...retained.keys()]) release(id);
}

/** Number of documents and queries currently retained; for tests and diagnostics. */
export function retainedReadCount(): number {
    return retained.size;
}
