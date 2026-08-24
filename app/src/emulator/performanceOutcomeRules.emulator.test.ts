import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-ov';
const otherUserId = 'athlete-other';
const protocolId = 'cycling-20m-tt';
const protocolRevisionPath = `users/${ownerId}/measurement_protocols/${protocolId}/revisions/1`;
const attemptId = 'attempt-1';
const attemptPath = `users/${ownerId}/assessment_attempts/${attemptId}`;
const metricId = 'cycling_tt_20m_mean_power_w';
const observationKey = `${attemptId}:${metricId}`;
const observationPath = `users/${ownerId}/metric_observations/${observationKey}`;
const revision1Path = `${observationPath}/revisions/1`;
const competitionPath = `users/${ownerId}/competition_outcomes/race-1`;

function validProtocol() {
    return {
        id: protocolId,
        revision: 1,
        title: 'Cycling 20-minute TT',
        intent: 'testing',
        metricIds: [metricId],
        instructions: [{ id: 'main', text: 'Complete the declared protocol.' }],
        comparisonContext: {
            required: ['power_source_id', 'duration_seconds', 'warmup_revision'],
            seriesDefining: ['power_source_id', 'duration_seconds', 'warmup_revision'],
            contextOnly: [] as string[],
            canonicalizationVersion: 'comparison-series-v1',
        },
        familiarization: { required: true, minimumExposures: 1 },
        burden: 'high',
        expectedRecoveryHours: 24,
        invalidationRules: ['Interrupted effort'],
        createdAt: '2026-08-21T06:00:00.000Z',
    };
}

function validAttempt() {
    return {
        id: attemptId,
        protocolRef: { id: protocolId, revision: 1 },
        scheduledDate: '2026-08-21',
        startedAt: '2026-08-21T06:00:00.000Z',
        completedAt: '2026-08-21T06:25:00.000Z',
        state: 'completed',
        purpose: 'baseline',
    };
}

function validRevision(revision = 1) {
    return {
        observationKey,
        revision,
        ...(revision > 1 ? { supersedesRevision: revision - 1, correctionReason: 'Transcription correction' } : {}),
        metricId,
        value: revision === 1 ? 300 : 301,
        unit: 'W',
        observedAt: '2026-08-21T06:20:00.000Z',
        source: 'manual',
        device: { provider: 'Favero', model: 'Assioma Duo', deviceId: 'pedals-a' },
        protocolRef: { id: protocolId, revision: 1 },
        comparisonSeriesKey: 'a'.repeat(64),
        comparisonCanonicalizationVersion: 'comparison-series-v1',
        assessmentAttemptId: attemptId,
        validity: 'valid',
        context: { power_source_id: 'assioma', duration_seconds: 1200, warmup_revision: 'wu-1' },
        createdAt: revision === 1 ? '2026-08-21T06:30:00.000Z' : '2026-08-21T07:00:00.000Z',
    };
}

function validHead(headRevision = 1) {
    return {
        observationKey,
        assessmentAttemptId: attemptId,
        metricId,
        headRevision,
        createdAt: '2026-08-21T06:30:00.000Z',
        updatedAt: headRevision === 1 ? '2026-08-21T06:30:00.000Z' : '2026-08-21T07:00:00.000Z',
    };
}

function validCompetitionOutcome() {
    return {
        id: 'race-1',
        sport: 'cycling',
        occurredAt: '2026-08-20T10:00:00.000Z',
        source: 'manual',
        result: { completed: true, placing: 12, fieldSize: 100, elapsedSeconds: 3600, distanceM: 40000 },
        metrics: { normalized_power_w: 280 },
        context: { course: 'loop-a', weather: 'dry' },
        createdAt: '2026-08-21T06:00:00.000Z',
    };
}

async function seedProtocolAndAttempt() {
    const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
    await assertSucceeds(setDoc(doc(ownerDb, protocolRevisionPath), validProtocol()));
    await assertSucceeds(setDoc(doc(ownerDb, attemptPath), validAttempt()));
    return ownerDb;
}

async function writeInitialObservation() {
    const ownerDb = await seedProtocolAndAttempt();
    const batch = writeBatch(ownerDb);
    batch.set(doc(ownerDb, revision1Path), validRevision(1));
    batch.set(doc(ownerDb, observationPath), validHead(1));
    await assertSucceeds(batch.commit());
    return ownerDb;
}

emulatorDescribe('Performance outcome Firestore rules (OV2.4)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            // Isolated from firestoreRules.emulator.test.ts's project: vitest runs emulator
            // test files in parallel by default, and both suites call clearFirestore() in
            // their own afterEach. Sharing one emulator project let one file's
            // clearFirestore() wipe documents mid-transaction in the other, producing
            // intermittent "evaluation error" / PERMISSION_DENIED failures in CI even
            // though the rules themselves were correct.
            projectId: 'demo-adaptive-training-ov2',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows an owner to create an immutable measurement protocol revision and denies mutation', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, protocolRevisionPath), validProtocol()));
        await assertFails(updateDoc(doc(ownerDb, protocolRevisionPath), { title: 'Rewritten protocol' }));
    });

    it('denies cross-user protocol reads and writes', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, protocolRevisionPath), validProtocol()));
        const otherDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(otherDb, protocolRevisionPath)));
        await assertFails(setDoc(
            doc(otherDb, `users/${ownerId}/measurement_protocols/${protocolId}/revisions/2`),
            { ...validProtocol(), revision: 2 },
        ));
    });

    it('rejects a protocol comparisonContext that double-classifies or drops a required dimension', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const overlapping = validProtocol();
        overlapping.comparisonContext = {
            ...overlapping.comparisonContext,
            required: ['power_source_id', 'duration_seconds', 'warmup_revision'],
            seriesDefining: ['power_source_id', 'duration_seconds'],
            contextOnly: ['duration_seconds', 'warmup_revision'],
        };
        await assertFails(setDoc(doc(ownerDb, protocolRevisionPath), overlapping));

        const uncovered = validProtocol();
        uncovered.comparisonContext = {
            ...uncovered.comparisonContext,
            required: ['power_source_id', 'duration_seconds', 'warmup_revision'],
            seriesDefining: ['power_source_id'],
            contextOnly: ['duration_seconds'],
        };
        await assertFails(setDoc(doc(ownerDb, protocolRevisionPath), uncovered));
    });

    it('allows a valid manual observation only when revision 1 and the head are created atomically', async () => {
        const ownerDb = await seedProtocolAndAttempt();
        await assertFails(setDoc(doc(ownerDb, revision1Path), validRevision(1)));
        await assertFails(setDoc(doc(ownerDb, observationPath), validHead(1)));

        const batch = writeBatch(ownerDb);
        batch.set(doc(ownerDb, revision1Path), validRevision(1));
        batch.set(doc(ownerDb, observationPath), validHead(1));
        await assertSucceeds(batch.commit());
    });

    it('rejects an observation head whose observationKey does not match its own assessmentAttemptId/metricId', async () => {
        const ownerDb = await seedProtocolAndAttempt();
        const batch = writeBatch(ownerDb);
        batch.set(doc(ownerDb, revision1Path), validRevision(1));
        batch.set(doc(ownerDb, observationPath), { ...validHead(1), assessmentAttemptId: 'attempt-9' });
        await assertFails(batch.commit());
    });

    it('rejects malformed observation units and unknown fields', async () => {
        const ownerDb = await seedProtocolAndAttempt();
        for (const malformed of [
            { ...validRevision(1), unit: 'kW' },
            { ...validRevision(1), unsupportedField: true },
        ]) {
            const batch = writeBatch(ownerDb);
            batch.set(doc(ownerDb, revision1Path), malformed);
            batch.set(doc(ownerDb, observationPath), validHead(1));
            await assertFails(batch.commit());
        }
    });

    it('allows a correction chain only when immutable revision N+1 and head N+1 advance together', async () => {
        const ownerDb = await writeInitialObservation();
        const correctionPath = `${observationPath}/revisions/2`;
        const batch = writeBatch(ownerDb);
        batch.set(doc(ownerDb, correctionPath), validRevision(2));
        batch.update(doc(ownerDb, observationPath), { headRevision: 2, updatedAt: '2026-08-21T07:00:00.000Z' });
        await assertSucceeds(batch.commit());

        await assertFails(updateDoc(doc(ownerDb, correctionPath), { value: 999 }));
        await assertFails(updateDoc(doc(ownerDb, revision1Path), { value: 999 }));
    });

    it('rejects a stale or skipped correction head advance', async () => {
        const ownerDb = await writeInitialObservation();
        const skippedRevision = { ...validRevision(2), revision: 3, supersedesRevision: 1 };
        const batch = writeBatch(ownerDb);
        batch.set(doc(ownerDb, `${observationPath}/revisions/3`), skippedRevision);
        batch.update(doc(ownerDb, observationPath), { headRevision: 3, updatedAt: '2026-08-21T07:00:00.000Z' });
        await assertFails(batch.commit());

        await assertFails(updateDoc(doc(ownerDb, observationPath), { headRevision: 2, updatedAt: '2026-08-21T07:00:00.000Z' }));
    });

    it('preserves invalid/practice assessment evidence but constrains lifecycle identity', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, protocolRevisionPath), validProtocol()));
        await assertSucceeds(setDoc(doc(ownerDb, attemptPath), {
            id: attemptId,
            protocolRef: { id: protocolId, revision: 1 },
            state: 'scheduled',
            purpose: 'familiarization',
            scheduledDate: '2026-08-21',
        }));
        await assertSucceeds(updateDoc(doc(ownerDb, attemptPath), {
            state: 'in_progress', startedAt: '2026-08-21T06:00:00.000Z',
        }));
        await assertFails(updateDoc(doc(ownerDb, attemptPath), { purpose: 'post_block' }));
    });

    it('rejects rewriting startedAt/completedAt provenance timestamps on an assessment attempt', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, protocolRevisionPath), validProtocol()));
        await assertSucceeds(setDoc(doc(ownerDb, attemptPath), {
            id: attemptId,
            protocolRef: { id: protocolId, revision: 1 },
            state: 'in_progress',
            purpose: 'baseline',
            startedAt: '2026-08-21T06:00:00.000Z',
        }));
        // Rewriting startedAt while state stays in_progress must fail, even though the shape
        // is otherwise valid.
        await assertFails(updateDoc(doc(ownerDb, attemptPath), { startedAt: '1999-01-01T00:00:00.000Z' }));
        // A legitimate transition may add completedAt, but not also back-date startedAt.
        await assertFails(updateDoc(doc(ownerDb, attemptPath), {
            state: 'completed', startedAt: '1999-01-01T00:00:00.000Z', completedAt: '2026-08-21T06:25:00.000Z',
        }));
        await assertSucceeds(updateDoc(doc(ownerDb, attemptPath), {
            state: 'completed', completedAt: '2026-08-21T06:25:00.000Z',
        }));
        await assertFails(updateDoc(doc(ownerDb, attemptPath), { completedAt: '1999-01-01T00:00:00.000Z' }));
    });

    it('stores ecological competition evidence without protocol-only benchmark fields', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, competitionPath), validCompetitionOutcome()));
        await assertFails(setDoc(doc(ownerDb, `${competitionPath}-bad`), {
            ...validCompetitionOutcome(),
            id: 'race-1-bad',
            protocolRef: { id: protocolId, revision: 1 },
            comparisonSeriesKey: 'forbidden',
        }));
        await assertFails(updateDoc(doc(ownerDb, competitionPath), { metrics: { normalized_power_w: 999 } }));
    });
});
