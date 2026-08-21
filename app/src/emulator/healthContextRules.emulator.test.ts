import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let testEnvironment: RulesTestEnvironment;

const ownerId = 'athlete-health-context';
const date = '2026-08-21';
const checkinPath = `users/${ownerId}/daily_subjective_checkins/${date}`;

function baseCheckin() {
    return {
        userId: ownerId,
        date,
        illnessSymptoms: false,
        createdAt: '2026-08-21T06:00:00.000Z',
        updatedAt: '2026-08-21T06:00:00.000Z',
    };
}

emulatorDescribe('Daily subjective check-in health-context rules (HA1)', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            // Use an isolated project because emulator suites clear their own project after
            // every test and Vitest may execute files in parallel.
            projectId: 'demo-adaptive-training-health-context',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it('allows a legacy-only illness flag with no healthContext', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), { ...baseCheckin(), illnessSymptoms: true }));
    });

    it('allows context-only rich symptoms without requiring the legacy field on the raw write', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const payload = baseCheckin();
        const { illnessSymptoms: _legacy, ...withoutLegacy } = payload;
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...withoutLegacy,
            healthContext: { symptoms: { present: true, onset: 'today', severity: 'mild', types: ['sore_throat'] } },
        }));
    });

    it('allows a shape-valid conflicting legacy value because app/parser precedence is authoritative', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            illnessSymptoms: true,
            healthContext: { symptoms: { present: false } },
        }));
    });

    it('accepts a true to false clear only when stale symptom details are removed or null', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            illnessSymptoms: true,
            healthContext: {
                symptoms: {
                    present: true,
                    onset: 'yesterday',
                    severity: 'moderate',
                    types: ['cough', 'unusual_fatigue'],
                },
            },
        }));

        await assertFails(updateDoc(doc(db, checkinPath), {
            illnessSymptoms: false,
            'healthContext.symptoms.present': false,
        }));

        await assertSucceeds(updateDoc(doc(db, checkinPath), {
            illnessSymptoms: false,
            healthContext: { symptoms: { present: false, onset: null, severity: null, types: null } },
            updatedAt: '2026-08-21T07:00:00.000Z',
        }));
    });

    it('rejects timezoneShiftHours outside the real-world offset range', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { travelDisruption: 'timezone_shift', timezoneShiftHours: 14.1 },
        }));
        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { travelDisruption: 'timezone_shift', timezoneShiftHours: -14.1 },
        }));
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { travelDisruption: 'timezone_shift', timezoneShiftHours: 14 },
        }));
    });

    it('rejects onset, severity, or types when symptoms are false', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        for (const symptoms of [
            { present: false, onset: 'today' },
            { present: false, severity: 'mild' },
            { present: false, types: ['cough'] },
        ]) {
            await assertFails(setDoc(doc(db, checkinPath), {
                ...baseCheckin(),
                healthContext: { symptoms },
            }));
        }
    });

    it('rejects malformed supplied context fields while keeping every context field optional', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), baseCheckin()));
        await testEnvironment.clearFirestore();

        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { alcoholDrinksLast24h: 4 },
        }));
        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { closeSickContact: 'yes' },
        }));
        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { unknownHealthField: true },
        }));
    });
});
