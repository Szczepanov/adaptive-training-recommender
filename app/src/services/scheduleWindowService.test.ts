import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleWindow } from '../engine/models';

const firestore = vi.hoisted(() => {
    return {
        addDoc: vi.fn(),
        collection: vi.fn(),
        deleteDoc: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        getDocs: vi.fn(),
        query: vi.fn(),
        setDoc: vi.fn(),
        where: vi.fn(),
    };
});

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { ScheduleWindowService } from './scheduleWindowService';

const validInput: Omit<ScheduleWindow, 'id' | 'userId' | 'revision' | 'createdAt' | 'updatedAt'> = {
    date: '2026-09-10',
    startLocal: '06:00',
    endLocal: '07:00',
    label: 'AM',
};

function docSnapshot(id: string, data: Record<string, unknown>) {
    return { id, exists: () => true, data: () => data };
}

describe('ScheduleWindowService persistence shape', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.collection.mockReturnValue({ path: 'schedule_windows' });
        firestore.doc.mockReturnValue({ path: 'schedule_windows/window-1' });
        firestore.addDoc.mockResolvedValue({ id: 'window-1' });
        firestore.setDoc.mockResolvedValue(undefined);
        firestore.getDocs.mockResolvedValue({ docs: [] });
    });

    it('creates a valid window and returns it with the generated document id and revision 1', async () => {
        const service = new ScheduleWindowService();
        const result = await service.createWindow('u1', validInput);

        expect(result.id).toBe('window-1');
        const payload = firestore.addDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload).not.toHaveProperty('id');
        expect(payload.userId).toBe('u1');
        expect(payload.revision).toBe(1);
        expect(payload.startLocal).toBe('06:00');
    });

    it('rejects a cross-midnight window (startLocal after endLocal)', async () => {
        const service = new ScheduleWindowService();
        await expect(service.createWindow('u1', { ...validInput, startLocal: '22:00', endLocal: '02:00' }))
            .rejects.toThrow(/Validation failed/);
        expect(firestore.addDoc).not.toHaveBeenCalled();
    });

    it('rejects creating a window that overlaps an existing same-date window', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [docSnapshot('existing', {
                userId: 'u1', date: '2026-09-10', startLocal: '06:30', endLocal: '07:30',
                revision: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
            })],
        });
        const service = new ScheduleWindowService();
        await expect(service.createWindow('u1', validInput)).rejects.toThrow(/overlaps/);
        expect(firestore.addDoc).not.toHaveBeenCalled();
    });

    it('allows creating a non-overlapping second same-date window (AM/PM)', async () => {
        firestore.getDocs.mockResolvedValue({
            docs: [docSnapshot('am', {
                userId: 'u1', date: '2026-09-10', startLocal: '06:00', endLocal: '07:00',
                revision: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
            })],
        });
        const service = new ScheduleWindowService();
        const result = await service.createWindow('u1', { ...validInput, startLocal: '17:00', endLocal: '18:00', label: 'PM' });
        expect(result.startLocal).toBe('17:00');
        expect(firestore.addDoc).toHaveBeenCalled();
    });

    it('updateWindow bumps revision and preserves createdAt', async () => {
        firestore.getDoc.mockResolvedValue(docSnapshot('window-1', {
            userId: 'u1', date: '2026-09-10', startLocal: '06:00', endLocal: '07:00',
            revision: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        }));
        firestore.getDocs.mockResolvedValue({ docs: [] });
        const service = new ScheduleWindowService();
        const result = await service.updateWindow('u1', 'window-1', { endLocal: '07:30' });
        expect(result.revision).toBe(2);
        expect(result.endLocal).toBe('07:30');
        const payload = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
        expect(payload.createdAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('deleteWindow calls deleteDoc on the resolved document reference', async () => {
        const service = new ScheduleWindowService();
        await service.deleteWindow('u1', 'window-1');
        expect(firestore.deleteDoc).toHaveBeenCalled();
    });
});
