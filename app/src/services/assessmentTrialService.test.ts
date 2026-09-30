import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessmentTrialIdFor } from '../observations/assessmentTrials';
import { makeTrial, trialAttempt, TRIAL_ATTEMPT_ID } from '../observations/fixtures/assessmentTrialFixtures';
import { STANDING_BROAD_JUMP_PROTOCOL } from '../observations/physicalCapitalProtocols';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    runTransaction: vi.fn(),
    transaction: {
        get: vi.fn(),
        set: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('firebase/firestore', () => ({
    collection: firestore.collection,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    getDocs: firestore.getDocs,
    setDoc: firestore.setDoc,
    updateDoc: firestore.updateDoc,
    runTransaction: firestore.runTransaction,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({ id: 'db' })) }));

import { AssessmentTrialService } from './assessmentTrialService';

function snapshot<T>(value: T | null, id = 'doc-id') {
    return value === null
        ? { exists: () => false, data: () => undefined, id }
        : { exists: () => true, data: () => value, id };
}

describe('AssessmentTrialService', () => {
    let service: AssessmentTrialService;
    const userId = 'user-1';
    const protocol = STANDING_BROAD_JUMP_PROTOCOL;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AssessmentTrialService({} as never);
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({
            path: segments.join('/'),
            id: segments[segments.length - 1],
        }));
        firestore.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({
            path: segments.join('/'),
        }));
        firestore.runTransaction.mockImplementation(async (_db: unknown, fn: (tx: typeof firestore.transaction) => Promise<unknown>) => {
            return fn(firestore.transaction);
        });
    });

    it('batch creates trials on an in_progress attempt', async () => {
        const attempt = trialAttempt({ state: 'in_progress' });
        const trial1 = makeTrial(1, { distance_cm: 235 });
        const trial2 = makeTrial(2, { distance_cm: 240 });

        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(attempt)) // attempt
            .mockResolvedValueOnce(snapshot(null)) // trial-1
            .mockResolvedValueOnce(snapshot(null)); // trial-2

        const result = await service.createTrials(userId, protocol, attempt.id, [trial1, trial2]);

        expect(result).toHaveLength(2);
        expect(firestore.transaction.set).toHaveBeenCalledTimes(2);
        expect(firestore.transaction.set).toHaveBeenNthCalledWith(1, { path: `users/${userId}/assessment_attempts/${attempt.id}/trials/${trial1.id}`, id: trial1.id }, trial1);
        expect(firestore.transaction.set).toHaveBeenNthCalledWith(2, { path: `users/${userId}/assessment_attempts/${attempt.id}/trials/${trial2.id}`, id: trial2.id }, trial2);
    });

    it('performs an exact retry idempotently without writing', async () => {
        const attempt = trialAttempt({ state: 'in_progress' });
        const existingTrial = makeTrial(1, { distance_cm: 235 }, { createdAt: '2026-10-19T07:30:00.000Z' });
        const retryTrial = makeTrial(1, { distance_cm: 235 }, { createdAt: '2026-10-19T07:35:00.000Z' });

        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(attempt))
            .mockResolvedValueOnce(snapshot(existingTrial));

        const result = await service.createTrials(userId, protocol, attempt.id, [retryTrial]);

        expect(result).toEqual([existingTrial]);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('throws when a trial with a different payload already exists at the target id', async () => {
        const attempt = trialAttempt({ state: 'in_progress' });
        const existingTrial = makeTrial(1, { distance_cm: 235 });
        const conflictingTrial = makeTrial(1, { distance_cm: 245 });

        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(attempt))
            .mockResolvedValueOnce(snapshot(existingTrial));

        await expect(service.createTrials(userId, protocol, attempt.id, [conflictingTrial]))
            .rejects.toThrow(/already exists with different content; append a correction instead/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('throws when a correction trial supersedes a record that does not exist', async () => {
        const attempt = trialAttempt({ state: 'in_progress' });
        const correctionTrial = makeTrial(1, { distance_cm: 238 }, {
            correctionIndex: 1,
            supersedesTrialId: 'trial-1',
            correctionReason: 'Misread tape',
        });

        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(attempt)) // attempt
            .mockResolvedValueOnce(snapshot(null)) // target trial-1-c1
            .mockResolvedValueOnce(snapshot(null)); // superseded trial-1 (missing!)

        await expect(service.createTrials(userId, protocol, attempt.id, [correctionTrial]))
            .rejects.toThrow(/Superseded trial trial-1 does not exist/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('rejects a new ordinal on a completed attempt but admits a valid correction', async () => {
        const completedAttempt = trialAttempt({
            state: 'completed',
            completedAt: '2026-10-19T08:00:00.000Z',
        });

        // 1. New ordinal rejects
        const newTrial = makeTrial(2, { distance_cm: 240 });
        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(completedAttempt))
            .mockResolvedValueOnce(snapshot(null));

        await expect(service.createTrials(userId, protocol, completedAttempt.id, [newTrial]))
            .rejects.toThrow(/only accepts supersession \(correction\) trials/);

        // 2. Correction of existing ordinal admits
        const supersededOriginal = makeTrial(1, { distance_cm: 230 });
        const correctionTrial = makeTrial(1, { distance_cm: 235 }, {
            correctionIndex: 1,
            supersedesTrialId: 'trial-1',
            correctionReason: 'Corrected measurement',
        });

        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(completedAttempt))
            .mockResolvedValueOnce(snapshot(null)) // target trial-1-c1
            .mockResolvedValueOnce(snapshot(supersededOriginal)); // superseded trial-1 exists

        const result = await service.createTrials(userId, protocol, completedAttempt.id, [correctionTrial]);
        expect(result).toEqual([correctionTrial]);
        expect(firestore.transaction.set).toHaveBeenCalledWith(
            expect.objectContaining({ path: `users/${userId}/assessment_attempts/${completedAttempt.id}/trials/${correctionTrial.id}` }),
            correctionTrial,
        );
    });

    it('rejects trial writes on an abandoned attempt', async () => {
        const abandonedAttempt = trialAttempt({ state: 'abandoned' });
        const trial = makeTrial(1, { distance_cm: 235 });

        firestore.transaction.get
            .mockResolvedValueOnce(snapshot(abandonedAttempt))
            .mockResolvedValueOnce(snapshot(null));

        await expect(service.createTrials(userId, protocol, abandonedAttempt.id, [trial]))
            .rejects.toThrow(/Cannot record assessment trials on a abandoned attempt/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('throws when the parent attempt protocol does not match the service protocol', async () => {
        const mismatchedAttempt = trialAttempt({
            protocolRef: { id: 'other-protocol', revision: 1 },
        });
        const trial = makeTrial(1, { distance_cm: 235 });

        firestore.transaction.get.mockResolvedValueOnce(snapshot(mismatchedAttempt));

        await expect(service.createTrials(userId, protocol, mismatchedAttempt.id, [trial]))
            .rejects.toThrow(/is bound to other-protocol@1, not/);
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });

    it('validates set consistency and path/id mismatch on list', async () => {
        // Path/id mismatch throws
        const badDoc = {
            id: 'trial-1',
            data: () => makeTrial(2, { distance_cm: 240 }), // payload says trial-2
        };
        firestore.getDocs.mockResolvedValueOnce({ docs: [badDoc] });

        await expect(service.listTrialsForAttempt(userId, protocol, TRIAL_ATTEMPT_ID))
            .rejects.toThrow(/Assessment trial path mismatch/);

        // Inconsistent set (e.g. invalid set structure like broken supersedes chain) throws
        const brokenChain = [
            makeTrial(1, { distance_cm: 240 }, { correctionIndex: 2, supersedesTrialId: assessmentTrialIdFor(1, 1) }),
        ];
        firestore.getDocs.mockResolvedValueOnce({
            docs: brokenChain.map(t => ({ id: t.id, data: () => t })),
        });

        await expect(service.listTrialsForAttempt(userId, protocol, TRIAL_ATTEMPT_ID))
            .rejects.toThrow(/supersedes missing trial/);

        // Valid set returns sorted
        const validDocs = [
            makeTrial(2, { distance_cm: 245 }),
            makeTrial(1, { distance_cm: 235 }),
        ];
        firestore.getDocs.mockResolvedValueOnce({
            docs: validDocs.map(t => ({ id: t.id, data: () => t })),
        });

        const list = await service.listTrialsForAttempt(userId, protocol, TRIAL_ATTEMPT_ID);
        expect(list.map(t => t.id)).toEqual(['trial-1', 'trial-2']);
    });

    it('ensures no writes happen when validation fails before transaction', async () => {
        // Invalid trial value (distance_cm cannot be negative)
        const invalidTrial = makeTrial(1, { distance_cm: -5 });

        await expect(service.createTrials(userId, protocol, TRIAL_ATTEMPT_ID, [invalidTrial]))
            .rejects.toThrow();

        expect(firestore.runTransaction).not.toHaveBeenCalled();
        expect(firestore.transaction.set).not.toHaveBeenCalled();
    });
});
