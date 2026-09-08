/**
 * Issue #430's real persistence-boundary tests. These use two independent authenticated
 * Firestore clients because mocked transactions cannot prove Firestore's retry/commit
 * behavior or that security rules reject a direct SDK bypass attempt.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { ScheduleWindowService } from '../services/scheduleWindowService';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const USER_ID = 'schedule-athlete';
const DATE = '2026-09-10';
const NOW = '2026-09-01T00:00:00.000Z';
let environment: RulesTestEnvironment;

function window(id: string, startLocal: string, endLocal: string, revision = 1) {
    return { id, userId: USER_ID, date: DATE, startLocal, endLocal, revision, createdAt: NOW, updatedAt: NOW };
}

function manifest(windows: ReturnType<typeof window>[], revision = 1) {
    return { userId: USER_ID, date: DATE, revision, windows, createdAt: NOW, updatedAt: NOW };
}

function service(db: Firestore, id: string) {
    return new ScheduleWindowService(db, () => NOW, () => id);
}

emulatorDescribe('ScheduleWindow manifest persistence boundary (#430)', () => {
    beforeAll(async () => {
        environment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await environment.clearFirestore();
    });

    afterAll(async () => {
        await environment.cleanup();
    });

    it('allows at most one of two concurrent overlapping creates to commit', async () => {
        const firstDb = environment.authenticatedContext(USER_ID).firestore();
        const secondDb = environment.authenticatedContext(USER_ID).firestore();

        const results = await Promise.allSettled([
            service(firstDb as unknown as Firestore, 'am').createWindow(USER_ID, { date: DATE, startLocal: '06:00', endLocal: '08:00' }),
            service(secondDb as unknown as Firestore, 'pm').createWindow(USER_ID, { date: DATE, startLocal: '07:00', endLocal: '09:00' }),
        ]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        const stored = await getDoc(doc(firstDb, 'users', USER_ID, 'schedule_window_manifests', DATE));
        expect(stored.data()?.windows).toHaveLength(1);
    });

    it('allows at most one of two concurrent moves that would overlap to commit', async () => {
        const firstDb = environment.authenticatedContext(USER_ID).firestore();
        const secondDb = environment.authenticatedContext(USER_ID).firestore();
        const ref = doc(firstDb, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(ref, manifest([window('first', '06:00', '07:00'), window('second', '09:00', '10:00')]));

        const results = await Promise.allSettled([
            service(firstDb as unknown as Firestore, 'unused-a').updateWindow(USER_ID, DATE, 'first', { endLocal: '08:00' }),
            service(secondDb as unknown as Firestore, 'unused-b').updateWindow(USER_ID, DATE, 'second', { startLocal: '07:00' }),
        ]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        const stored = await getDoc(ref);
        expect(stored.data()?.revision).toBe(2);
    });

    it('rejects a direct SDK write of an overlapping manifest and every write to the retired sibling collection', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await assertFails(setDoc(manifestRef, manifest([window('first', '06:00', '08:00'), window('second', '07:00', '09:00')])));
        await assertFails(setDoc(
            doc(db, 'users', USER_ID, 'schedule_windows', 'bypass'),
            window('bypass', '06:00', '07:00'),
        ));
    });

    it('keeps manifest and per-window revisions monotonic through update and delete', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const windows = service(db as unknown as Firestore, 'unused');
        await setDoc(doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE), manifest([window('stable', '06:00', '07:00')]));

        await windows.updateWindow(USER_ID, DATE, 'stable', { endLocal: '07:30' });
        await windows.deleteWindow(USER_ID, DATE, 'stable');

        const stored = await getDoc(doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE));
        expect(stored.data()).toMatchObject({ revision: 3, windows: [] });
    });
});
