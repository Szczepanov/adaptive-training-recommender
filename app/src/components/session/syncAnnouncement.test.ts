import { describe, expect, it } from 'vitest';
import { nextSyncAnnouncement, type SyncStatus } from './syncAnnouncement';

const run = (statuses: SyncStatus[]) => statuses.reduce<string | null>((prev, s) => nextSyncAnnouncement(prev, s), null);

describe('nextSyncAnnouncement', () => {
    it('stays silent for routine pending/synced churn after each write', () => {
        expect(run(['synced', 'pending', 'synced', 'pending', 'synced'])).toBeNull();
    });

    it('announces queued and unavailable', () => {
        expect(run(['synced', 'pending', 'queued'])).toBe('Sync status: queued');
        expect(run(['pending', 'unavailable'])).toBe('Sync status: unavailable');
    });

    it('announces recovery to synced only from an actionable state, then goes quiet again', () => {
        expect(run(['queued', 'pending', 'synced'])).toBe('Sync status: synced');
        expect(nextSyncAnnouncement('Sync status: synced', 'pending')).toBe('Sync status: synced');
        expect(run(['unavailable', 'synced', 'pending', 'synced', 'queued'])).toBe('Sync status: queued');
    });
});
