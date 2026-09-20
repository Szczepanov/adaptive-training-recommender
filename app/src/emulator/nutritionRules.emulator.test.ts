import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-nutrition-owner';
const otherUserId = 'athlete-intruder';
const daySourceId = '2026-09-20_garmin_myfitnesspal';
const nutritionDocPath = `users/${ownerId}/nutrition_days/${daySourceId}`;

function sampleNutritionDay() {
    return {
        schemaVersion: 1,
        logicalDate: '2026-09-20',
        date: '2026-09-20',
        provider: 'garmin',
        transport: 'garmin_connect',
        origin: 'myfitnesspal',
        energyIntakeKcal: 2150,
        isPartial: false,
        ingestedAt: '2026-09-20T10:00:00.000Z',
    };
}

emulatorDescribe('Nutrition days Firestore rules (ADR-0042)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-nutrition-rules',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('denies client writes to nutrition_days (backend-only ingestion)', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, nutritionDocPath), sampleNutritionDay()));
    });

    it('allows owner to read their own nutrition documents', async () => {
        // Seed document using admin context
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const adminDb = context.firestore();
            await setDoc(doc(adminDb, nutritionDocPath), sampleNutritionDay());
        });

        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(getDoc(doc(ownerDb, nutritionDocPath)));
    });

    it('denies non-owner from reading other users nutrition documents', async () => {
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const adminDb = context.firestore();
            await setDoc(doc(adminDb, nutritionDocPath), sampleNutritionDay());
        });

        const intruderDb = testEnvironment.authenticatedContext(otherUserId).firestore();
        await assertFails(getDoc(doc(intruderDb, nutritionDocPath)));
    });

    it('denies unauthenticated read access to nutrition documents', async () => {
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const adminDb = context.firestore();
            await setDoc(doc(adminDb, nutritionDocPath), sampleNutritionDay());
        });

        const unauthDb = testEnvironment.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(unauthDb, nutritionDocPath)));
    });
});
