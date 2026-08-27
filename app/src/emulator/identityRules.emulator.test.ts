import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'identity-athlete';
const otherId = 'other-identity-athlete';
const assessmentId = 'assessment-2026-08-27';
const assessmentPath = `users/${ownerId}/health_identity_assessments/${assessmentId}`;
const currentPassportPath = `users/${ownerId}/physiological_identity_passports/current`;
const versionPassportPath = `users/${ownerId}/physiological_identity_passport_versions/2026-08-27.1`;

function review(overrides: Record<string, unknown> = {}) {
    return {
        id: 'review-1',
        assessmentId,
        schemaVersion: 1,
        label: 'USER',
        occupancyAttestation: 'EXCLUSIVE',
        supersedesReviewEventId: null,
        recordedAt: serverTimestamp(),
        source: 'user_ui',
        ...overrides,
    };
}

emulatorDescribe('Physiological identity persistence rules (PI6)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-identity',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    beforeEach(async () => {
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, assessmentPath), { id: assessmentId });
            await setDoc(doc(db, currentPassportPath), { passportVersion: '2026-08-27.1' });
            await setDoc(doc(db, versionPassportPath), { passportVersion: '2026-08-27.1' });
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows only the owner to read server-managed passports and assessments', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(getDoc(doc(ownerDb, assessmentPath)));
        await assertSucceeds(getDoc(doc(ownerDb, currentPassportPath)));
        await assertSucceeds(getDoc(doc(ownerDb, versionPassportPath)));

        const otherDb = testEnvironment.authenticatedContext(otherId).firestore();
        await assertFails(getDoc(doc(otherDb, assessmentPath)));
        await assertFails(getDoc(doc(otherDb, currentPassportPath)));
        await assertFails(getDoc(doc(otherDb, versionPassportPath)));
    });

    it('rejects all client writes to server-managed identity documents', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, assessmentPath), { forged: true }));
        await assertFails(setDoc(doc(db, currentPassportPath), { forged: true }));
        await assertFails(setDoc(doc(db, versionPassportPath), { forged: true }));
        await assertFails(deleteDoc(doc(db, assessmentPath)));
    });

    it('allows a constrained owner review and makes it append-only', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const path = `users/${ownerId}/health_identity_review_events/review-1`;
        await assertSucceeds(setDoc(doc(db, path), review()));
        await assertSucceeds(getDoc(doc(db, path)));
        await assertFails(updateDoc(doc(db, path), { label: 'NOT_USER' }));
        await assertFails(deleteDoc(doc(db, path)));
    });

    it('allows a monotonic correction for the same assessment', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const firstPath = `users/${ownerId}/health_identity_review_events/review-1`;
        const correctionPath = `users/${ownerId}/health_identity_review_events/review-2`;
        await assertSucceeds(setDoc(doc(db, firstPath), review()));
        await assertSucceeds(setDoc(doc(db, correctionPath), review({
            id: 'review-2',
            label: 'NOT_USER',
            occupancyAttestation: 'UNKNOWN',
            supersedesReviewEventId: 'review-1',
        })));
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            await setDoc(
                doc(context.firestore(), `users/${ownerId}/health_identity_review_events/future-review`),
                review({ id: 'future-review', recordedAt: Timestamp.fromDate(new Date('2100-01-01T00:00:00.000Z')) }),
            );
        });
        await assertFails(setDoc(doc(db, `users/${ownerId}/health_identity_review_events/review-3`), review({
            id: 'review-3',
            label: 'UNCERTAIN',
            occupancyAttestation: 'UNKNOWN',
            supersedesReviewEventId: 'future-review',
        })));
    });

    it('rejects forged fields, invalid semantics, malformed timestamps and missing assessments', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const path = (id: string) => `users/${ownerId}/health_identity_review_events/${id}`;
        await assertFails(setDoc(doc(db, path('bad-path')), review()));
        await assertFails(setDoc(doc(db, path('bad-label')), review({ id: 'bad-label', label: 'MAYBE' })));
        await assertFails(setDoc(doc(db, path('bad-attestation')), review({
            id: 'bad-attestation', occupancyAttestation: 'MIXED',
        })));
        await assertFails(setDoc(doc(db, path('bad-time')), review({
            id: 'bad-time', recordedAt: Timestamp.fromDate(new Date('2026-08-27T08:00:00.000Z')),
        })));
        await assertFails(setDoc(doc(db, path('forged')), review({
            id: 'forged', eligibility: { baselineLearning: true },
        })));
        await assertFails(setDoc(doc(db, path('orphan')), review({
            id: 'orphan', assessmentId: 'missing-assessment',
        })));
    });

    it('rejects cross-user reads/submissions and cross-assessment supersession', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        const firstPath = `users/${ownerId}/health_identity_review_events/review-1`;
        await assertSucceeds(setDoc(doc(ownerDb, firstPath), review()));

        const otherDb = testEnvironment.authenticatedContext(otherId).firestore();
        await assertFails(getDoc(doc(otherDb, firstPath)));
        await assertFails(setDoc(doc(otherDb, firstPath), review()));

        const secondAssessmentId = 'assessment-2';
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), `users/${ownerId}/health_identity_assessments/${secondAssessmentId}`), {
                id: secondAssessmentId,
            });
        });
        await assertFails(setDoc(
            doc(ownerDb, `users/${ownerId}/health_identity_review_events/review-cross`),
            review({
                id: 'review-cross',
                assessmentId: secondAssessmentId,
                label: 'UNCERTAIN',
                occupancyAttestation: 'UNKNOWN',
                supersedesReviewEventId: 'review-1',
            }),
        ));
    });
});
