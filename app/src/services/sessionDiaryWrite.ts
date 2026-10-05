import { onSnapshot, type DocumentReference, type WriteBatch } from 'firebase/firestore';

/** Server acknowledgement remains the default for non-runner callers. */
export interface DiaryWriteOptions {
    acknowledgeLocally?: boolean;
    onAcknowledged?: () => void;
    onFailed?: (error: unknown) => void;
    onLocallyAccepted?: () => void;
}

/**
 * Firestore's persistent cache is the outbox. A mutation-marker snapshot with a
 * pending local write proves this batch has entered local persistence; an older cached
 * copy of the same deterministic marker is not sufficient. commit resolves only after
 * backend acknowledgement. Never race a write against a timeout or navigator.onLine.
 */
export function commitDiaryWrite(
    batch: WriteBatch,
    marker: DocumentReference,
    options: DiaryWriteOptions = {},
): Promise<void> {
    let stop: (() => void) | undefined;
    const local = options.acknowledgeLocally
        ? new Promise<void>((resolve, reject) => {
            stop = onSnapshot(marker, { includeMetadataChanges: true }, snapshot => {
                if (snapshot.exists() && snapshot.metadata.hasPendingWrites) {
                    try { options.onLocallyAccepted?.(); resolve(); }
                    catch (error) { reject(error); }
                }
            }, reject);
        })
        : null;
    let committed: Promise<void>;
    try {
        committed = batch.commit();
    } catch (error) {
        stop?.();
        return Promise.reject(error);
    }
    const acknowledged = committed.then(
        () => { options.onAcknowledged?.(); },
        error => {
            options.onFailed?.(error);
            throw error;
        },
    );
    // The server promise is always observed, including after a local-only return.
    const accepted = local ? Promise.race([local, acknowledged]) : acknowledged;
    return accepted.finally(() => stop?.());
}
