/**
 * Single-flight guard for irreversible or write-producing UI actions (#724).
 *
 * React state is not enough: two taps delivered before the next render both observe
 * "not busy". The lock lives in a ref (or any `{ current }` box) and is taken
 * synchronously, so a second call while the first is pending is dropped, not queued.
 * The lock is always released, including when `action` rejects.
 */
export async function runExclusive<T>(lock: { current: boolean }, action: () => Promise<T>): Promise<T | undefined> {
    if (lock.current) return undefined;
    lock.current = true;
    try {
        return await action();
    } finally {
        lock.current = false;
    }
}
