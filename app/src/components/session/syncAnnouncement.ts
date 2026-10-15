export type SyncStatus = 'synced' | 'pending' | 'queued' | 'unavailable';

/**
 * Next text for the polite sync live region. Only actionable states are announced: `queued` and
 * `unavailable`, plus the recovery to `synced` from one of those. `pending` and routine
 * `pending` -> `synced` churn after every logged set leave the previous announcement untouched,
 * so a screen reader is not interrupted 15-20 times per session. The visible pill is unaffected.
 */
export function nextSyncAnnouncement(previous: string | null, status: SyncStatus): string | null {
    if (status === 'queued' || status === 'unavailable') return `Sync status: ${status}`;
    if (status === 'synced' && previous !== null && previous !== 'Sync status: synced') return 'Sync status: synced';
    return previous;
}
