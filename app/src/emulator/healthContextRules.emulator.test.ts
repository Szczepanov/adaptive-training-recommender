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

function contextOnlyCheckin() {
    return {
        userId: ownerId,
        date,
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
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...contextOnlyCheckin(),
            healthContext: { symptoms: { present: true, onset: 'today', severity: 'mild', types: ['sore_throat'] } },
        }));
    });

    it('allows the allergy-oriented symptom types and a suspected cause', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...contextOnlyCheckin(),
            healthContext: {
                symptoms: {
                    present: true,
                    severity: 'mild',
                    types: ['sneezing', 'runny_nose'],
                    suspectedCause: 'allergy',
                },
            },
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

    // Issue #1201 rules scope: every health-context VALUE (enums, ranges, symptom/presence
    // coupling) is validated by engine/validation.ts validateCheckin (validateHealthContext)
    // in checkinService.upsertCheckin before every write -- see healthContextContract.test.ts.
    // The rules keep the key allow-lists, size caps and the merged-document illness answer.
    it.each([
        ['an unrecognized suspectedCause', { symptoms: { present: true, suspectedCause: 'viral' } }],
        ['an out-of-range timezoneShiftHours', { travelDisruption: 'timezone_shift', timezoneShiftHours: 14.1 }],
        ['stale onset on cleared symptoms', { symptoms: { present: false, onset: 'today' } }],
        ['an out-of-range alcoholDrinksLast24h', { alcoholDrinksLast24h: 4 }],
        ['a non-boolean closeSickContact beside valid symptoms', { symptoms: { present: true, onset: 'today' }, closeSickContact: 'yes' }],
    ])('accepts %s at the rules boundary (validateCheckin owns it)', async (_label, healthContext) => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), { ...baseCheckin(), healthContext }));
    });

    // upsertCheckin merges, so the required illness answer is checked on the merged document.
    it('rejects a write with neither the legacy illness flag nor a rich symptoms block', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, checkinPath), contextOnlyCheckin()));
        await assertFails(setDoc(doc(db, checkinPath), {
            ...contextOnlyCheckin(),
            healthContext: { travelDisruption: 'none' },
        }));
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...contextOnlyCheckin(),
            healthContext: { symptoms: { present: false } },
        }));
    });

    it('rejects unknown health-context and symptom keys, including beside a valid symptoms block', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), baseCheckin()));
        await testEnvironment.clearFirestore();
        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { unknownHealthField: true },
        }));
        await assertFails(setDoc(doc(db, checkinPath), {
            ...contextOnlyCheckin(),
            healthContext: {
                symptoms: { present: true, onset: 'today', severity: 'mild' },
                unknownHealthField: true,
            },
        }));
        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { symptoms: { present: true, unknownSymptomField: 'x' } },
        }));
    });

    it('rejects an oversized otherDisruption or symptom type list', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertFails(setDoc(doc(db, checkinPath), { ...baseCheckin(), healthContext: { otherDisruption: 'x'.repeat(501) } }));
        await assertFails(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { symptoms: { present: true, types: Array.from({ length: 11 }, () => 'cough') } },
        }));
        await assertSucceeds(setDoc(doc(db, checkinPath), {
            ...baseCheckin(),
            healthContext: { otherDisruption: 'x'.repeat(500), symptoms: { present: true, types: Array.from({ length: 10 }, () => 'cough') } },
        }));
    });

    it('applies the caps to the merged document on update', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, checkinPath), { ...baseCheckin(), healthContext: { symptoms: { present: true } } }));
        await assertFails(updateDoc(doc(db, checkinPath), { 'healthContext.otherDisruption': 'x'.repeat(501) }));
        await assertSucceeds(updateDoc(doc(db, checkinPath), { 'healthContext.symptoms.present': false, updatedAt: '2026-08-21T07:00:00.000Z' }));
    });
});
