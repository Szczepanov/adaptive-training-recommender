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

const ownerId = 'athlete-session-response-window';
const sourceDate = '2026-08-18';

function responsePath(responseId: string): string {
    return `users/${ownerId}/session_responses/${responseId}`;
}

function validSessionResponse(responseId: string) {
    return {
        userId: ownerId,
        responseId,
        sourceSession: { kind: 'execution', id: 'exec-1', date: sourceDate },
        window: 'immediate',
        date: sourceDate,
        checkinRef: { date: sourceDate },
        sessionRpe: 7,
        createdAt: '2026-08-18T10:45:00Z',
        updatedAt: '2026-08-18T10:45:00Z',
    };
}

// Issue #1202 (ADR-0053): the window/date ordering is owned by validateSessionResponse
// (responses/validation.ts), which SessionResponseService runs before every create -- see
// responses/validation.test.ts and sessionResponseService.test.ts. The rules accept every
// ordering at the boundary, but keep `window` and `date` immutable after create, so a
// create-validated ordering cannot be changed later.
emulatorDescribe('SessionResponse window/date rules', () => {
    beforeAll(async () => {
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-adaptive-training-session-response-window',
            firestore: { rules: readFileSync('firestore.rules', 'utf8') },
        });
    });

    afterEach(async () => {
        await testEnvironment.clearFirestore();
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    it.each([
        ['immediate', sourceDate],
        ['immediate', '2026-08-19'],
        ['later_day', sourceDate],
        ['later_day', '2026-08-17'],
        ['next_morning', sourceDate],
        ['next_morning', '2026-08-19'],
    ])('accepts a %s response dated %s at the rules boundary (validateSessionResponse owns the ordering)', async (window, date) => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        const responseId = `${window}-${date}`;
        await assertSucceeds(setDoc(doc(db, responsePath(responseId)), {
            ...validSessionResponse(responseId),
            window,
            date,
            checkinRef: { date },
        }));
    });

    it('keeps window and date immutable after create', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();
        await assertSucceeds(setDoc(doc(db, responsePath('immutable')), validSessionResponse('immutable')));
        await assertFails(setDoc(doc(db, responsePath('immutable')), {
            ...validSessionResponse('immutable'), window: 'later_day',
        }));
        await assertFails(setDoc(doc(db, responsePath('immutable')), {
            ...validSessionResponse('immutable'), window: 'next_morning', date: '2026-08-19',
        }));
    });
});
