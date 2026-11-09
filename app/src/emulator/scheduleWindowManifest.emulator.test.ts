/**
 * Issue #430's real persistence-boundary tests. These use independent authenticated
 * Firestore clients because mocked transactions cannot prove Firestore's retry/commit
 * behavior or that security rules reject a direct SDK bypass attempt.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
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
            // A project id of this file's own, not the bare 'demo-adaptive-training' that
            // `firestoreRules.emulator.test.ts` uses. Separate projects are separate
            // namespaces within the same emulator process, and that sibling clears the
            // whole project in `afterEach` (and twice mid-test) -- sharing the id would let
            // it wipe a manifest this file's own concurrency tests just seeded, under the
            // parallel runner. Every other `*.emulator.test.ts` in this directory already
            // carries a distinct id for exactly this reason; this file had not caught up.
            projectId: 'demo-adaptive-training-schedule-window-manifest',
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

        await assertFails(setDoc(manifestRef, manifest([window('bad-time', '7:00', '08:00')])));
        await assertFails(setDoc(manifestRef, manifest([
            { ...window('extra-field', '06:00', '07:00'), surprise: true } as ReturnType<typeof window>,
        ])));
        await assertFails(setDoc(manifestRef, manifest([
            window('duplicate', '06:00', '07:00'),
            window('duplicate', '08:00', '09:00'),
        ])));
        await assertFails(setDoc(manifestRef, manifest([
            window('duplicate-edge', '06:00', '07:00'),
            window('middle', '08:00', '09:00'),
            window('duplicate-edge', '10:00', '11:00'),
        ])));
        await assertFails(setDoc(manifestRef, manifest([
            window('first', '06:00', '08:00'),
            window('second', '07:00', '09:00'),
        ])));
    });

    // Issue #1202 (ADR-0053): a window's positive duration and environment enum are owned by
    // validateScheduleWindow, which ScheduleWindowService.buildManifest runs before every
    // write (scheduleWindows.test.ts). The rules keep the HH:mm pattern, the key allow-lists,
    // the caps, duplicate ids and overlap.
    it('accepts a zero-length window or unknown environment at the rules boundary (validateScheduleWindow owns them)', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        await assertSucceeds(setDoc(
            doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE),
            manifest([window('zero-length', '07:00', '07:00')]),
        ));
        await assertSucceeds(setDoc(
            doc(db, 'users', USER_ID, 'schedule_window_manifests', '2026-09-11'),
            manifest([{ ...window('bad-environment', '06:00', '07:00', { date: '2026-09-11' }), environment: 'space' } as ReturnType<typeof window>], 1, '2026-09-11'),
        ));
    });

    it('accepts a valid four-window manifest through the eight-position path and rejects an overlap there', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        const four = [
            window('early', '05:00', '06:00'),
            window('morning', '06:00', '09:00'),
            window('afternoon', '12:00', '16:00'),
            window('evening', '17:30', '18:30'),
        ];
        await assertFails(setDoc(manifestRef, manifest([...four.slice(0, 3), window('evening', '15:30', '18:30')])));
        await assertFails(setDoc(manifestRef, manifest([...four.slice(0, 3), { ...window('evening', '17:30', '18:30'), surprise: true } as ReturnType<typeof window>])));
        await assertSucceeds(setDoc(manifestRef, manifest(four)));
    });

    it('accepts a valid three-window AM, PM, and evening manifest through the rules fast path', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);

        await assertSucceeds(setDoc(manifestRef, manifest([
            window('morning', '06:00', '09:00'),
            window('afternoon', '12:00', '16:00'),
            window('evening', '17:30', '18:30'),
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

    // Per-window transition validation (stable id/createdAt, revision advanced exactly once)
    // was dropped from the `update` rule: at the 8-window cap it pushed rules evaluation over
    // Firestore's 1000-expression-per-request ceiling under concurrent writers, which denied
    // BOTH racing `updateWindow` calls outright instead of the intended one-winner outcome --
    // see the removal's comment in `firestore.rules` above `hasNonOverlappingScheduleWindowManifestEntries`.
    // These two cases are the direct consequence: a raw SDK write skipping the nested
    // revision bump, or replacing a window's id, is no longer blocked at the rules layer.
    //
    // This is a real, deliberate narrowing, not an oversight papered over -- recorded here
    // rather than silently dropped so it stays visible to review. It is scoped to `isOwner`:
    // a client exploiting it can only corrupt metadata on its OWN schedule, never another
    // athlete's, and never create an overlap (`hasNonOverlappingScheduleWindowManifestEntries`
    // still runs on every create and update, and the test above still proves it holds under
    // a direct SDK bypass). Every legitimate path still gets a correct revision/id, and that
    // is covered independently in `scheduleWindowService.test.ts`, without depending on the
    // rules layer at all.
    it('no longer rejects a direct SDK interval edit that skips the nested window revision bump', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(manifestRef, manifest([window('stable', '06:00', '07:00')]));

        await assertSucceeds(setDoc(manifestRef, {
            ...manifest([window('stable', '06:00', '07:30')], 2),
            updatedAt: '2026-09-01T01:00:00.000Z',
        }));
    });

    it('no longer rejects a direct SDK same-size update that replaces a stable window id', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(manifestRef, manifest([window('stable', '06:00', '07:00')]));

        await assertSucceeds(setDoc(manifestRef, {
            ...manifest([window('replacement', '06:00', '07:00', { revision: 2 })], 2),
            updatedAt: '2026-09-01T01:00:00.000Z',
        }));
    });

    // The invariant that must survive the narrowing above: even without per-window
    // transition validation, an update that introduces an overlap is still rejected.
    it('still rejects a direct SDK update that introduces an overlap via a same-size edit', async () => {
        const db = environment.authenticatedContext(USER_ID).firestore();
        const manifestRef = doc(db, 'users', USER_ID, 'schedule_window_manifests', DATE);
        await setDoc(manifestRef, manifest([
            window('first', '06:00', '07:00'),
            window('second', '08:00', '09:00'),
        ]));

        await assertFails(setDoc(manifestRef, {
            ...manifest([
                window('first', '06:00', '08:30'),
                window('second', '08:00', '09:00'),
            ], 2),
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
