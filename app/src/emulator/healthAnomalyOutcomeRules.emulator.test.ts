import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-health-anomaly-outcome';
const otherId = 'other-health-anomaly-outcome';
const episodeId = 'health-anomaly:2026-08-20';
const assessmentDate = '2026-08-20';
const revisionId = 'ha-1234567890abcdef';
const assessmentPath = `users/${ownerId}/health_anomaly_assessments/${assessmentDate}/revisions/${revisionId}`;
const outcomePath = `users/${ownerId}/health_anomaly_outcomes/${episodeId}`;

function outcome() {
    return {
        userId: ownerId,
        episodeId,
        sourceAssessment: { date: assessmentDate, revisionId },
        explanation: 'nothing_obvious',
        symptomOnset: null,
        respiratoryTest: null,
        note: null,
        createdAt: '2026-08-21T06:30:00.000Z',
        updatedAt: '2026-08-21T06:30:00.000Z',
        schemaVersion: 1,
    };
}

async function seedAssessment(): Promise<void> {
    await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), assessmentPath), {
            userId: ownerId,
            date: assessmentDate,
            revisionId,
            assessment: { episodeId },
        });
    });
}

emulatorDescribe('Health anomaly prospective outcome rules (HA6)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-health-anomaly-outcomes',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows the owner to create, read and later revise the mutable conclusion', async () => {
        await seedAssessment();
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, outcomePath), outcome()));
        await assertSucceeds(getDoc(doc(db, outcomePath)));
        await assertSucceeds(updateDoc(doc(db, outcomePath), {
            explanation: 'illness_symptoms',
            symptomOnset: { date: '2026-08-21', precision: 'day' },
            respiratoryTest: { result: 'positive', testedOn: '2026-08-21', source: 'user_reported' },
            updatedAt: '2026-08-21T18:00:00.000Z',
        }));
    });

    it('rejects cross-user access and deletion', async () => {
        await seedAssessment();
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, outcomePath), outcome()));

        const otherDb = testEnvironment.authenticatedContext(otherId).firestore();
        await assertFails(getDoc(doc(otherDb, outcomePath)));
        await assertFails(setDoc(doc(otherDb, outcomePath), { ...outcome(), userId: otherId }));
        await assertFails(deleteDoc(doc(ownerDb, outcomePath)));
    });

    it('requires a real referenced assessment whose episode identity matches', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, outcomePath), outcome()));

        await seedAssessment();
        await assertFails(setDoc(doc(db, `users/${ownerId}/health_anomaly_outcomes/different-episode`), {
            ...outcome(), episodeId: 'different-episode',
        }));
    });

    it('keeps episode/source identity and createdAt immutable while allowing conclusions to change', async () => {
        await seedAssessment();
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, outcomePath), outcome()));
        await assertFails(updateDoc(doc(db, outcomePath), { sourceAssessment: { date: assessmentDate, revisionId: 'ha-fedcba0987654321' } }));
        await assertFails(updateDoc(doc(db, outcomePath), { createdAt: '2026-08-22T00:00:00.000Z' }));
        await assertFails(updateDoc(doc(db, outcomePath), { episodeId: 'different-episode' }));
    });

    it('rejects malformed explanation, onset and respiratory-test labels', async () => {
        await seedAssessment();
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, outcomePath), { ...outcome(), explanation: 'diagnosed_flu' }));
        await assertFails(setDoc(doc(db, outcomePath), {
            ...outcome(), symptomOnset: { date: '2026-02-31', precision: 'day' },
        }));
        await assertFails(setDoc(doc(db, outcomePath), {
            ...outcome(), respiratoryTest: { result: 'unknown', testedOn: '2026-08-21', source: 'user_reported' },
        }));
    });
});
