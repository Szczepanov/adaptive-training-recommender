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

    it('enforces same-day immediate/later_day and later-date next_morning semantics', async () => {
        const db = testEnvironment.authenticatedContext(ownerId).firestore();

        await assertSucceeds(setDoc(doc(db, responsePath('immediate-same-day')), {
            ...validSessionResponse('immediate-same-day'),
            window: 'immediate',
        }));
        await assertFails(setDoc(doc(db, responsePath('immediate-next-day')), {
            ...validSessionResponse('immediate-next-day'),
            window: 'immediate',
            date: '2026-08-19',
        }));

        await assertSucceeds(setDoc(doc(db, responsePath('later-day-same-day')), {
            ...validSessionResponse('later-day-same-day'),
            window: 'later_day',
        }));
        await assertFails(setDoc(doc(db, responsePath('later-day-previous-day')), {
            ...validSessionResponse('later-day-previous-day'),
            window: 'later_day',
            date: '2026-08-17',
        }));
        await assertFails(setDoc(doc(db, responsePath('later-day-next-day')), {
            ...validSessionResponse('later-day-next-day'),
            window: 'later_day',
            date: '2026-08-19',
        }));

        await assertFails(setDoc(doc(db, responsePath('next-morning-same-day')), {
            ...validSessionResponse('next-morning-same-day'),
            window: 'next_morning',
        }));
        await assertFails(setDoc(doc(db, responsePath('next-morning-previous-day')), {
            ...validSessionResponse('next-morning-previous-day'),
            window: 'next_morning',
            date: '2026-08-17',
        }));
        await assertSucceeds(setDoc(doc(db, responsePath('next-morning-next-day')), {
            ...validSessionResponse('next-morning-next-day'),
            window: 'next_morning',
            date: '2026-08-19',
            checkinRef: { date: '2026-08-19' },
        }));
    });
});
