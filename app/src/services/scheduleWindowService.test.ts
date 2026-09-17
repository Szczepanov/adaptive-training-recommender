import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleWindow, ScheduleWindowManifest } from '../engine/models';
import type { RecurringScheduleInput } from '../engine/scheduleWindowRecurrence';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    runTransaction: vi.fn(),
    where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { ScheduleWindowService } from './scheduleWindowService';

const DATE = '2026-09-10';
const NOW = '2026-09-01T00:00:00.000Z';
const validInput: Omit<ScheduleWindow, 'id' | 'userId' | 'revision' | 'createdAt' | 'updatedAt'> = {
    date: DATE, startLocal: '06:00', endLocal: '07:00', label: 'AM',
};

function snapshot(data?: object) {
    return { exists: () => data !== undefined, data: () => data };
}

function manifest(windows: ScheduleWindow[], revision = 1): ScheduleWindowManifest {
    return { userId: 'u1', date: DATE, revision, windows, createdAt: NOW, updatedAt: NOW };
}

function window(overrides: Partial<ScheduleWindow> = {}): ScheduleWindow {
    return { id: 'window-1', userId: 'u1', date: DATE, startLocal: '06:00', endLocal: '07:00', revision: 1, createdAt: NOW, updatedAt: NOW, ...overrides };
}

describe('ScheduleWindowService manifest persistence', () => {
    let stored: ScheduleWindowManifest | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        stored = undefined;
        firestore.doc.mockImplementation((_db: unknown, ...path: string[]) => ({ path: path.join('/') }));
        firestore.collection.mockImplementation((_db: unknown, ...path: string[]) => ({ path: path.join('/') }));
        firestore.getDoc.mockImplementation(async () => snapshot(stored));
        firestore.getDocs.mockResolvedValue({ docs: [], empty: true });
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: { get: (ref: unknown) => Promise<ReturnType<typeof snapshot>>; set: (_ref: unknown, data: ScheduleWindowManifest) => void }) => Promise<void>) => {
            await callback({
                get: async () => snapshot(stored),
                set: (_ref, data) => { stored = data; },
            });
        });
    });

    function service(ids = ['window-1', 'window-2']): ScheduleWindowService {
        let index = 0;
        return new ScheduleWindowService({} as never, () => NOW, () => ids[index++] ?? `window-${index}`);
    }

    it('creates a versioned date manifest instead of a sibling window document', async () => {
        const result = await service().createWindow('u1', validInput);

        expect(result).toMatchObject({ id: 'window-1', userId: 'u1', revision: 1 });
        expect(stored).toMatchObject({ date: DATE, revision: 1, windows: [expect.objectContaining({ id: 'window-1' })] });
        expect(firestore.doc).toHaveBeenCalledWith(expect.anything(), 'users', 'u1', 'schedule_window_manifests', DATE);
    });

    it('rejects an overlapping create after reading the complete current manifest', async () => {
        stored = manifest([window({ endLocal: '08:00' })]);

        await expect(service(['window-2']).createWindow('u1', { ...validInput, startLocal: '07:00', endLocal: '09:00' }))
            .rejects.toThrow(/Overlapping schedule windows/);
        expect(stored.revision).toBe(1);
    });

    it('expands and persists a repeating schedule across date manifests', async () => {
        const manifests = new Map<string, ScheduleWindowManifest>();
        firestore.getDoc.mockImplementation(async (ref: { path: string }) => snapshot(manifests.get(ref.path)));
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: {
            get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
            set: (ref: { path: string }, data: ScheduleWindowManifest) => void;
        }) => Promise<void>) => {
            const writes = new Map<string, ScheduleWindowManifest>();
            await callback({
                get: async ref => snapshot(manifests.get(ref.path)),
                set: (ref, data) => { writes.set(ref.path, data); },
            });
            for (const [path, data] of writes) manifests.set(path, data);
        });
        const schedule: RecurringScheduleInput = {
            startDate: '2026-09-07',
            endDate: '2026-09-11',
            rules: [
                { weekdays: [1, 2, 3, 4, 5], startLocal: '06:00', endLocal: '09:00', label: 'AM' },
                { weekdays: [1, 2, 3, 4, 5], startLocal: '12:00', endLocal: '16:00', label: 'PM' },
            ],
        };

        const ids = Array.from({ length: 10 }, (_, index) => `window-${index + 1}`);
        const created = await service(ids).createRecurringWindows('u1', schedule);

        expect(created).toHaveLength(10);
        expect(manifests.size).toBe(5);
        expect(manifests.get('users/u1/schedule_window_manifests/2026-09-10')).toMatchObject({
            revision: 1,
            windows: [
                expect.objectContaining({ id: 'window-7', startLocal: '06:00' }),
                expect.objectContaining({ id: 'window-8', startLocal: '12:00' }),
            ],
        });
    });

    it('does not partially save a repeating schedule when one date conflicts', async () => {
        const manifests = new Map<string, ScheduleWindowManifest>([
            [`users/u1/schedule_window_manifests/${DATE}`, manifest([window({ startLocal: '12:00', endLocal: '13:00' })])],
        ]);
        firestore.getDoc.mockImplementation(async (ref: { path: string }) => snapshot(manifests.get(ref.path)));
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: {
            get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
            set: (ref: { path: string }, data: ScheduleWindowManifest) => void;
        }) => Promise<void>) => {
            const writes = new Map<string, ScheduleWindowManifest>();
            await callback({
                get: async ref => snapshot(manifests.get(ref.path)),
                set: (ref, data) => { writes.set(ref.path, data); },
            });
            for (const [path, data] of writes) manifests.set(path, data);
        });

        await expect(service(['new-window']).createRecurringWindows('u1', {
            startDate: DATE,
            endDate: '2026-09-11',
            rules: [{ weekdays: [4, 5], startLocal: '12:30', endLocal: '14:00' }],
        })).rejects.toThrow(/Overlapping schedule windows/);

        expect(manifests.size).toBe(1);
        expect(manifests.get('users/u1/schedule_window_manifests/2026-09-11')).toBeUndefined();
    });

    it('rolls back earlier recurring dates when a later date changes after preflight', async () => {
        const secondDate = '2026-09-11';
        const firstPath = `users/u1/schedule_window_manifests/${DATE}`;
        const secondPath = `users/u1/schedule_window_manifests/${secondDate}`;
        const manifests = new Map<string, ScheduleWindowManifest>();
        firestore.getDoc.mockImplementation(async (ref: { path: string }) => snapshot(manifests.get(ref.path)));
        let transactionCall = 0;
        firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: {
            get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
            set: (ref: { path: string }, data: ScheduleWindowManifest) => void;
        }) => Promise<void>) => {
            transactionCall += 1;
            if (transactionCall === 2) {
                manifests.set(secondPath, {
                    userId: 'u1', date: secondDate, revision: 1,
                    windows: [window({ id: 'concurrent-window', date: secondDate, startLocal: '18:00', endLocal: '19:00' })],
                    createdAt: NOW, updatedAt: NOW,
                });
            }
            const writes = new Map<string, ScheduleWindowManifest>();
            await callback({
                get: async ref => snapshot(manifests.get(ref.path)),
                set: (ref, data) => { writes.set(ref.path, data); },
            });
            for (const [path, data] of writes) manifests.set(path, data);
        });

        await expect(service(['first-new', 'second-new']).createRecurringWindows('u1', {
            startDate: DATE,
            endDate: secondDate,
            rules: [{ weekdays: [4, 5], startLocal: '12:30', endLocal: '14:00' }],
        })).rejects.toThrow(/data changed while applying 2026-09-11/);

        expect(manifests.get(firstPath)).toMatchObject({ revision: 2, windows: [] });
        expect(manifests.get(secondPath)).toMatchObject({
            revision: 1,
            windows: [expect.objectContaining({ id: 'concurrent-window' })],
        });
    });

    it('updates in place with a stable id, a per-window revision bump, and a manifest revision bump', async () => {
        stored = manifest([window()]);

        const result = await service().updateWindow('u1', DATE, 'window-1', { endLocal: '07:30' });

        expect(result).toMatchObject({ id: 'window-1', revision: 2, createdAt: NOW, endLocal: '07:30' });
        expect(stored).toMatchObject({ revision: 2, windows: [expect.objectContaining({ id: 'window-1', revision: 2 })] });
    });

    it('moves a window across dates atomically while preserving identity and advancing both manifests', async () => {
        const targetDate = '2026-09-11';
        const sourcePath = `users/u1/schedule_window_manifests/${DATE}`;
        const targetPath = `users/u1/schedule_window_manifests/${targetDate}`;
        const manifests = new Map<string, ScheduleWindowManifest>([
            [sourcePath, manifest([window()], 3)],
            [targetPath, {
                userId: 'u1', date: targetDate, revision: 4, windows: [], createdAt: NOW, updatedAt: NOW,
            }],
        ]);
        firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: {
            get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
            set: (ref: { path: string }, data: ScheduleWindowManifest) => void;
        }) => Promise<void>) => {
            await callback({
                get: async ref => snapshot(manifests.get(ref.path)),
                set: (ref, data) => { manifests.set(ref.path, data); },
            });
        });

        const result = await service().updateWindow('u1', DATE, 'window-1', { date: targetDate, startLocal: '08:00', endLocal: '09:00' });

        expect(result).toMatchObject({ id: 'window-1', date: targetDate, revision: 2, createdAt: NOW });
        expect(manifests.get(sourcePath)).toMatchObject({ revision: 4, windows: [] });
        expect(manifests.get(targetPath)).toMatchObject({
            revision: 5,
            windows: [expect.objectContaining({ id: 'window-1', date: targetDate, revision: 2, createdAt: NOW })],
        });
    });

    it('keeps an empty manifest after deleting the final window so revision history remains monotonic', async () => {
        stored = manifest([window()]);

        await service().deleteWindow('u1', DATE, 'window-1');

        expect(stored).toMatchObject({ revision: 2, windows: [] });
    });

    it('fails closed when a persisted manifest is malformed', async () => {
        stored = { ...manifest([window()]), windows: [{ ...window(), endLocal: 'bad' }] } as unknown as ScheduleWindowManifest;

        const state = await service().getWindowsForDateState('u1', DATE);

        expect(state.status).toBe('INVALID');
    });

    it('does not treat an unavailable manifest read as an empty legacy date', async () => {
        firestore.getDoc.mockRejectedValueOnce(new Error('offline'));

        const state = await service().getWindowsForDateState('u1', DATE);

        expect(state.status).toBe('UNAVAILABLE');
    });

    it('fails closed rather than treating retired sibling documents as a legacy empty date', async () => {
        firestore.getDocs.mockResolvedValueOnce({ docs: [{}], empty: false });

        const state = await service().getWindowsForDateState('u1', DATE);

        expect(state.status).toBe('INVALID');
    });
});
