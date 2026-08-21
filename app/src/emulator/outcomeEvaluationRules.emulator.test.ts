import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-ov-evaluation';
const otherUserId = 'athlete-other';
const evaluationId = 'cycling-build-1';
const headPath = `users/${ownerId}/outcome_evaluations/${evaluationId}`;
const revisionPath = (revision: number) => `${headPath}/revisions/${revision}`;

function binding(id = 'p20') {
    return {
        id,
        metricId: 'cycling_tt_20m_mean_power_w',
        protocolRef: { id: 'cycling-20m-tt', revision: 1 },
        role: 'primary',
        expectedDirection: { kind: 'higher_is_better' },
        baseline: { kind: 'declared_observation', observationId: 'baseline:cycling_tt_20m_mean_power_w' },
        targetObservationWindow: { startDate: '2026-09-28', endDate: '2026-10-04' },
        practicalThreshold: { kind: 'percent', value: 2 },
        rationale: 'Primary block outcome',
    };
}

function draftRevision(revision = 1) {
    return {
        id: evaluationId,
        revision,
        title: 'Cycling build block',
        startDate: '2026-08-24',
        endDate: '2026-10-04',
        status: 'draft',
        contentHash: '',
        createdAt: revision === 1 ? '2026-08-21T08:00:00.000Z' : '2026-08-22T08:00:00.000Z',
        bindings: [binding()],
    };
}

function head(currentRevision = 1) {
    return {
        id: evaluationId,
        currentRevision,
        createdAt: '2026-08-21T08:00:00.000Z',
        updatedAt: currentRevision === 1 ? '2026-08-21T08:00:00.000Z' : '2026-08-22T08:00:00.000Z',
    };
}

function activeRevision(revision = 1) {
    return {
        ...draftRevision(revision),
        status: 'active',
        activatedAt: '2026-08-23T08:00:00.000Z',
        contentHash: 'a'.repeat(64),
    };
}

async function writeInitialDraft() {
    const db = testEnvironment.authenticatedContext(ownerId).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, revisionPath(1)), draftRevision(1));
    batch.set(doc(db, headPath), head(1));
    await assertSucceeds(batch.commit());
    return db;
}

emulatorDescribe('Outcome evaluation Firestore rules (OV5.1)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-ov-evaluation',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows owner read but denies cross-user read/write', async () => {
        const ownerDb = await writeInitialDraft();
        await assertSucceeds(getDoc(doc(ownerDb, revisionPath(1))));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, revisionPath(1))));
        await assertFails(setDoc(doc(otherDb, revisionPath(2)), draftRevision(2)));
    });

    it('requires revision 1 and head creation atomically', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, revisionPath(1)), draftRevision(1)));
        await assertFails(setDoc(doc(db, headPath), head(1)));
        await writeInitialDraft();
    });

    it('requires contiguous new draft revision plus head advance atomically', async () => {
        const db = await writeInitialDraft();
        await assertFails(setDoc(doc(db, revisionPath(2)), draftRevision(2)));
        await assertFails(updateDoc(doc(db, headPath), { currentRevision: 2, updatedAt: '2026-08-22T08:00:00.000Z' }));

        const batch = writeBatch(db);
        batch.set(doc(db, revisionPath(2)), draftRevision(2));
        batch.update(doc(db, headPath), { currentRevision: 2, updatedAt: '2026-08-22T08:00:00.000Z' });
        await assertSucceeds(batch.commit());
    });

    it('denies skipped revision/head advances', async () => {
        const db = await writeInitialDraft();
        const batch = writeBatch(db);
        batch.set(doc(db, revisionPath(3)), draftRevision(3));
        batch.update(doc(db, headPath), { currentRevision: 3, updatedAt: '2026-08-23T08:00:00.000Z' });
        await assertFails(batch.commit());
    });

    it('denies arbitrary mutation of a persisted draft', async () => {
        const db = await writeInitialDraft();
        await assertFails(updateDoc(doc(db, revisionPath(1)), { title: 'Rewritten block' }));
        await assertFails(updateDoc(doc(db, revisionPath(1)), { bindings: [{ ...binding(), rationale: 'Changed criteria' }] }));
    });

    it('allows draft activation only while all frozen criteria and bindings are preserved', async () => {
        const db = await writeInitialDraft();
        await assertSucceeds(setDoc(doc(db, revisionPath(1)), activeRevision(1)));
        await assertFails(setDoc(doc(db, revisionPath(1)), {
            ...activeRevision(1),
            bindings: [{ ...binding(), practicalThreshold: { kind: 'percent', value: 5 } }],
        }));
    });

    it('denies activating a draft revision the head has already moved past', async () => {
        const db = await writeInitialDraft();
        const batch = writeBatch(db);
        batch.set(doc(db, revisionPath(2)), draftRevision(2));
        batch.update(doc(db, headPath), { currentRevision: 2, updatedAt: '2026-08-22T08:00:00.000Z' });
        await assertSucceeds(batch.commit());

        await assertFails(setDoc(doc(db, revisionPath(1)), activeRevision(1)));
        await assertSucceeds(setDoc(doc(db, revisionPath(2)), activeRevision(2)));
    });

    it('requires activation hash/timestamp and rejects malformed activation provenance', async () => {
        const db = await writeInitialDraft();
        await assertFails(setDoc(doc(db, revisionPath(1)), { ...draftRevision(1), status: 'active', contentHash: '' }));
        await assertFails(setDoc(doc(db, revisionPath(1)), { ...activeRevision(1), contentHash: 'not-a-sha256' }));
    });

    it('allows active -> completed -> archived while preserving frozen content', async () => {
        const db = await writeInitialDraft();
        await assertSucceeds(setDoc(doc(db, revisionPath(1)), activeRevision(1)));
        await assertSucceeds(updateDoc(doc(db, revisionPath(1)), { status: 'completed' }));
        await assertSucceeds(updateDoc(doc(db, revisionPath(1)), { status: 'archived' }));
        await assertFails(updateDoc(doc(db, revisionPath(1)), { status: 'active' }));
    });

    it('denies criteria mutation after activation and denies revision/head deletes', async () => {
        const db = await writeInitialDraft();
        await assertSucceeds(setDoc(doc(db, revisionPath(1)), activeRevision(1)));
        await assertFails(updateDoc(doc(db, revisionPath(1)), { endDate: '2026-10-11' }));
        await assertFails(updateDoc(doc(db, revisionPath(1)), { contentHash: 'b'.repeat(64) }));
        const batch = writeBatch(db);
        batch.delete(doc(db, revisionPath(1)));
        batch.delete(doc(db, headPath));
        await assertFails(batch.commit());
    });
});
