import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-anthropometry-budget';
const entryPath = `users/${ownerId}/anthropometry_entries/entry-1`;

function entry(measurements: unknown[]) {
    return {
        id: 'entry-1',
        userId: ownerId,
        date: '2026-09-14',
        observedAt: '2026-09-14T06:00:00+02:00',
        protocol: 'home_anthropometry@1',
        context: {
            morningPostVoidPreIntake: true,
            trainingBeforeMeasurement: false,
        },
        measurements,
        schemaVersion: 1,
        revision: 1,
        createdAt: '2026-09-14T06:00:00+02:00',
        updatedAt: '2026-09-14T06:00:00+02:00',
    };
}

const validMass = {
    metricId: 'body_mass_kg',
    unit: 'kg',
    readings: [90.0],
    value: 90.0,
};

const validWaist = {
    metricId: 'waist_minimum_cm',
    unit: 'cm',
    readings: [93.0, 93.2],
    value: 93.1,
};

emulatorDescribe('Firestore anthropometry rule budget', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-anthropometry-rule-budget',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('rejects a malformed measurement after a valid first item', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, entryPath), entry([
            validMass,
            { ...validWaist, metricId: 'unknown_metric' },
        ])));
    });

    it('rejects a corrupt retained reading after a valid first item', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(ownerDb, entryPath), entry([
            validMass,
            { ...validWaist, readings: [93.0, 999.0] },
        ])));
    });

    it('accepts the full ten-item bounded payload without exhausting rule expressions', async () => {
        const ownerDb = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(ownerDb, entryPath), entry([
            validMass,
            validWaist,
            { metricId: 'abdomen_umbilicus_cm', unit: 'cm', readings: [96.0, 96.2], value: 96.1 },
            { metricId: 'hips_max_cm', unit: 'cm', readings: [101.0, 101.2], value: 101.1 },
            { metricId: 'chest_nipple_line_cm', unit: 'cm', readings: [104.0, 104.2], value: 104.1 },
            { metricId: 'upper_arm_relaxed_mid_cm', laterality: 'left', unit: 'cm', readings: [36.0, 36.2], value: 36.1 },
            { metricId: 'upper_arm_relaxed_mid_cm', laterality: 'right', unit: 'cm', readings: [36.2, 36.4], value: 36.3 },
            { metricId: 'forearm_max_cm', laterality: 'left', unit: 'cm', readings: [30.0, 30.2], value: 30.1 },
            { metricId: 'thigh_mid_cm', laterality: 'left', unit: 'cm', readings: [59.0, 59.2], value: 59.1 },
            { metricId: 'calf_max_cm', laterality: 'left', unit: 'cm', readings: [40.0, 40.2], value: 40.1 },
        ])));
    });
});
