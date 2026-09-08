/**
 * Issue #430's real persistence-boundary tests. These use independent authenticated
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

type WindowOptions = { date?: string; revision?: number };

function window(id: string, startLocal: string, endLocal: string, options: WindowOptions = {}) {
    const date = options.date ?? DATE;
    return {
        id,
        userId: USER_ID,
        date,
        startLocal,
        endLocal,
        revision: options.revision ?? 1,
        createdAt: NOW,
        updatedAt: NOW,
    };
}

function manifest(windows: ReturnType<typeof window>[], revision = 1, date = DATE) {
    return { userId: USER_ID, date, revision, windows, createdAt: NOW, updatedAt: NOW };
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

    it('allows at most one of two concurrent same-date updates that would overlap to commit', async () => {
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

    it('allows at most one of two concurrent cross-date moves into overlapping target slots to commit', async () => {
        const firstDb = environment.authenticatedContext(USER_ID).firestore();
        const secondDb = environment.authenticatedContext(USER_ID).firestore();
        const sourceA = '2026-09-08';
        const sourceB = '2026-09-09';
        const target = '2026-09-11';

        await setDoc(
            doc(firstDb, 'users', USER_ID, 'schedule_window_manifests', sourceA),
            manifest([window('first', '06:00', '07:00', { date: sourceA })], 1, sourceA),
        );
        await setDoc(
            doc(secondDb, 'users', USER_ID, 'schedule_window_manifests', sourceB),
            manifest([window('second', '09:00', '10:00', { date: sourceB })], 1, sourceB),
        );

        const results = await Promise.allSettled([
            service(firstDb as unknown as Firestore, 'unused-a').updateWindow(USER_ID, sourceA, 'first', {
                date: target, startLocal: '07:00', endLocal: '09:00',
            }),
            service(secondDb as unknown as Firestore, 'unused-b').updateWindow(USER_ID, sourceB, 'second', {
                date: target, startLocal: '08:00', endLocal: '10:00',
            }),
        ]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        const storedTarget = await getDoc(doc(firstDb, 'users', USER_ID, 'schedule_window_manifests', target));
        expect(storedTarget.data()?.windows).toHaveLength(1);
        expect(storedTarget.data()?.windows[0]).toMatchObject({ date: target, revision: 2 });
    });

    it('rejects direct SDK creates that violate nested window shape, duplicate-id, or overlap invariants', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);

        await assertFails(setDoc(manifestRef, manifest([window('bad-time', '07:00', '07:00')])));
        await assertFails(setDoc(manifestRef, manifest([
            { ...window('bad-environment', '06:00', '07:00'), environment: 'space' } as ReturnType<typeof window>,
        ])));
        await assertFails(setDoc(manifestRef, manifest([
            window('duplicate', '06:00', '07:00'),
            window('duplicate', '08:00', '09:00'),
        ])));
        await assertFails(setDoc(manifestRef, manifest([
            window('first', '06:00', '08:00'),
            window('second', '07:00', '09:00'),
        ])));
    });

    it('rejects a direct SDK update that turns a valid manifest into an overlapping one', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(manifestRef, manifest([
            window('first', '06:00', '07:00'),
            window('second', '08:00', '09:00'),
        ]));

        await assertFails(setDoc(manifestRef, {
            ...manifest([
                window('first', '06:00', '08:30', { revision: 2 }),
                window('second', '08:00', '09:00'),
            ], 2),
            updatedAt: '2026-09-01T01:00:00.000Z',
        }));
    });

    it('rejects a direct SDK interval edit without the nested window revision bump', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(manifestRef, manifest([window('stable', '06:00', '07:00')]));

        await assertFails(setDoc(manifestRef, {
            ...manifest([window('stable', '06:00', '07:30')], 2),
            updatedAt: '2026-09-01T01:00:00.000Z',
        }));
    });

    it('rejects a direct SDK same-size update that replaces a stable window id', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(manifestRef, manifest([window('stable', '06:00', '07:00')]));

        await assertFails(setDoc(manifestRef, {
            ...manifest([window('replacement', '06:00', '07:00', { revision: 2 })], 2),
            updatedAt: '2026-09-01T01:00:00.000Z',
        }));
    });

    it('rejects every direct SDK write to the retired sibling collection', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        await assertFails(setDoc(
            doc(db, 'users', USER_ID, 'schedule_windows', 'bypass'),
            window('bypass', '06:00', '07:00'),
        ));
    });

    it('lets the owner detect a retired-only representation and fails the service read closed', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        await environment.withSecurityRulesDisabled(async context => {
            await setDoc(
                doc(context.firestore(), 'users', USER_ID, 'schedule_windows', 'retired-window'),
                window('retired-window', '08:00', '09:00'),
            );
        });

        const state = await service(db as unknown as Firestore, 'unused').getWindowsForDateState(USER_ID, DATE);

        expect(state).toMatchObject({
            status: 'INVALID',
            issues: [expect.objectContaining({ code: 'retired-schedule-window-representation' })],
        });
    });

    it('fails closed when an authoritative manifest and retired sibling rows coexist', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        await environment.withSecurityRulesDisabled(async context => {
            await setDoc(
                doc(context.firestore(), 'users', USER_ID, 'schedule_window_manifests', DATE),
                manifest([window('manifest-window', '06:00', '07:00')]),
            );
            await setDoc(
                doc(context.firestore(), 'users', USER_ID, 'schedule_windows', 'retired-window'),
                window('retired-window', '08:00', '09:00'),
            );
        });

        const state = await service(db as unknown as Firestore, 'unused').getWindowsForDateState(USER_ID, DATE);

        expect(state).toMatchObject({
            status: 'INVALID',
            issues: [expect.objectContaining({ code: 'retired-schedule-window-representation' })],
        });
    });

    it('keeps stable window identity and monotonic revisions through update and delete', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const windows = service(db as unknown as Firestore, 'unused');
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(manifestRef, manifest([window('stable', '06:00', '07:00')]));

        await windows.updateWindow(USER_ID, DATE, 'stable', { endLocal: '07:30' });
        const updated = await getDoc(manifestRef);
        expect(updated.data()).toMatchObject({
            revision: 2,
            windows: [expect.objectContaining({ id: 'stable', revision: 2, createdAt: NOW, endLocal: '07:30' })],
        });

        await windows.deleteWindow(USER_ID, DATE, 'stable');
        const stored = await getDoc(manifestRef);
        expect(stored.data()).toMatchObject({ revision: 3, windows: [] });
    });
});
