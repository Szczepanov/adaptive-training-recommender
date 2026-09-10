import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssessmentAttempt } from '../observations/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
    collection: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    doc: firestore.doc,
    collection: firestore.collection,
    getDoc: firestore.getDoc,
    getDocs: firestore.getDocs,
    setDoc: firestore.setDoc,
    runTransaction: firestore.runTransaction,
}));

vi.mock('../firebase', () => ({
    getDb: vi.fn(() => ({})),
}));

import { AssessmentAttemptService, assessmentAttemptService } from './assessmentAttemptService';

const validAttempt: AssessmentAttempt = {
    id: 'attempt-1',
    protocolRef: { id: 'proto-1', revision: 1 },
    state: 'scheduled',
    purpose: 'baseline',
    scheduledDate: '2026-03-30',
};

function docSnapshot(exists: boolean, data?: unknown, id = 'attempt-1') {
    return {
        id,
        exists: () => exists,
        data: () => data,
    };
}

describe('AssessmentAttemptService', () => {
    let service: AssessmentAttemptService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AssessmentAttemptService({} as never);
    });

    it('exports a default instance initialized with default db', () => {
        expect(assessmentAttemptService).toBeInstanceOf(AssessmentAttemptService);
    });

    describe('createAttempt', () => {
        it('creates a valid assessment attempt when it does not exist', async () => {
            firestore.getDoc.mockResolvedValue(docSnapshot(false));

            const result = await service.createAttempt('user-1', validAttempt);

            expect(result).toEqual(validAttempt);
            expect(firestore.doc).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-1',
                'assessment_attempts',
                'attempt-1'
            );
            expect(firestore.setDoc).toHaveBeenCalledWith(
                expect.objectContaining({ path: 'users/user-1/assessment_attempts/attempt-1' }),
                validAttempt
            );
        });

        it('throws an error when attempt already exists', async () => {
            firestore.getDoc.mockResolvedValue(docSnapshot(true, validAttempt));

            await expect(service.createAttempt('user-1', validAttempt)).rejects.toThrow(
                'Assessment attempt attempt-1 already exists'
            );
            expect(firestore.setDoc).not.toHaveBeenCalled();
        });

        it('throws an error when invalid assessment attempt is provided', async () => {
            const invalidAttempt = { ...validAttempt, state: 'unknown' as never };

            await expect(service.createAttempt('user-1', invalidAttempt)).rejects.toThrow();
            expect(firestore.getDoc).not.toHaveBeenCalled();
        });
    });

    describe('getAttempt', () => {
        it('returns assessment attempt when document exists and is valid', async () => {
            firestore.getDoc.mockResolvedValue(docSnapshot(true, validAttempt));

            const result = await service.getAttempt('user-1', 'attempt-1');

            expect(result).toEqual(validAttempt);
        });

        it('returns null when document does not exist', async () => {
            firestore.getDoc.mockResolvedValue(docSnapshot(false));

            const result = await service.getAttempt('user-1', 'attempt-1');

            expect(result).toBeNull();
        });

        it('throws an error if attempt id in document does not match request id', async () => {
            const mismatchedAttempt = { ...validAttempt, id: 'attempt-2' };
            firestore.getDoc.mockResolvedValue(docSnapshot(true, mismatchedAttempt, 'attempt-1'));

            await expect(service.getAttempt('user-1', 'attempt-1')).rejects.toThrow(
                'Assessment attempt path mismatch for attempt-1'
            );
        });

        it('throws an error if document data fails validation', async () => {
            const invalidAttemptData = { id: 'attempt-1', state: 'invalid-state' };
            firestore.getDoc.mockResolvedValue(docSnapshot(true, invalidAttemptData));

            await expect(service.getAttempt('user-1', 'attempt-1')).rejects.toThrow();
        });
    });

    describe('findOpenAttempt', () => {
        it('returns candidate with most recent startedAt / scheduledDate in open state', async () => {
            const attempt1: AssessmentAttempt = {
                id: 'att-1',
                protocolRef: { id: 'proto-1', revision: 1 },
                state: 'scheduled',
                purpose: 'baseline',
                scheduledDate: '2026-03-25',
            };
            const attempt2: AssessmentAttempt = {
                id: 'att-2',
                protocolRef: { id: 'proto-1', revision: 1 },
                state: 'in_progress',
                purpose: 'checkpoint',
                startedAt: '2026-03-26T10:00:00.000Z',
            };
            const attemptCompleted: AssessmentAttempt = {
                id: 'att-3',
                protocolRef: { id: 'proto-1', revision: 1 },
                state: 'completed',
                purpose: 'post_block',
                startedAt: '2026-03-27T10:00:00.000Z',
                completedAt: '2026-03-27T11:00:00.000Z',
            };

            firestore.getDocs.mockResolvedValue({
                docs: [
                    docSnapshot(true, attempt1, 'att-1'),
                    docSnapshot(true, attempt2, 'att-2'),
                    docSnapshot(true, attemptCompleted, 'att-3'),
                ],
            });

            const result = await service.findOpenAttempt('user-1');

            expect(result).toEqual(attempt2);
            expect(firestore.collection).toHaveBeenCalledWith(
                expect.anything(),
                'users',
                'user-1',
                'assessment_attempts'
            );
        });

        it('ignores documents with validation errors or id mismatches', async () => {
            const invalidAttempt = { id: 'att-invalid', state: 'invalid' };
            const mismatchedAttempt = {
                id: 'att-other',
                protocolRef: { id: 'p1', revision: 1 },
                state: 'scheduled',
                purpose: 'baseline',
            };

            firestore.getDocs.mockResolvedValue({
                docs: [
                    docSnapshot(true, invalidAttempt, 'att-invalid'),
                    docSnapshot(true, mismatchedAttempt, 'att-doc-id'),
                ],
            });

            const result = await service.findOpenAttempt('user-1');

            expect(result).toBeNull();
        });

        it('returns null when no docs or open candidates exist', async () => {
            firestore.getDocs.mockResolvedValue({ docs: [] });

            const result = await service.findOpenAttempt('user-1');

            expect(result).toBeNull();
        });
    });

    describe('transitions (startAttempt, completeAttempt, abandonAttempt)', () => {
        let fakeTransaction: {
            get: ReturnType<typeof vi.fn>;
            set: ReturnType<typeof vi.fn>;
        };

        beforeEach(() => {
            fakeTransaction = {
                get: vi.fn(),
                set: vi.fn(),
            };
            firestore.runTransaction.mockImplementation((_db, callback) => callback(fakeTransaction));
        });

        describe('startAttempt', () => {
            it('transitions scheduled attempt to in_progress state', async () => {
                const scheduledAttempt: AssessmentAttempt = { ...validAttempt, state: 'scheduled' };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, scheduledAttempt));

                await service.startAttempt('user-1', 'attempt-1', '2026-03-30T12:00:00.000Z');

                expect(fakeTransaction.set).toHaveBeenCalledWith(
                    expect.anything(),
                    {
                        ...scheduledAttempt,
                        state: 'in_progress',
                        startedAt: '2026-03-30T12:00:00.000Z',
                    }
                );
            });

            it('throws error if attempt is not in scheduled state', async () => {
                const inProgressAttempt: AssessmentAttempt = {
                    ...validAttempt,
                    state: 'in_progress',
                    startedAt: '2026-03-30T10:00:00.000Z',
                };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, inProgressAttempt));

                await expect(
                    service.startAttempt('user-1', 'attempt-1', '2026-03-30T12:00:00.000Z')
                ).rejects.toThrow('Cannot start assessment from in_progress');
            });
        });

        describe('completeAttempt', () => {
            it('transitions in_progress attempt to completed state with optional notes', async () => {
                const inProgressAttempt: AssessmentAttempt = {
                    ...validAttempt,
                    state: 'in_progress',
                    startedAt: '2026-03-30T10:00:00.000Z',
                };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, inProgressAttempt));

                await service.completeAttempt(
                    'user-1',
                    'attempt-1',
                    '2026-03-30T13:00:00.000Z',
                    'All good'
                );

                expect(fakeTransaction.set).toHaveBeenCalledWith(
                    expect.anything(),
                    {
                        ...inProgressAttempt,
                        state: 'completed',
                        completedAt: '2026-03-30T13:00:00.000Z',
                        notes: 'All good',
                    }
                );
            });

            it('throws error if attempt is not in in_progress state', async () => {
                const scheduledAttempt: AssessmentAttempt = { ...validAttempt, state: 'scheduled' };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, scheduledAttempt));

                await expect(
                    service.completeAttempt('user-1', 'attempt-1', '2026-03-30T13:00:00.000Z')
                ).rejects.toThrow('Cannot complete assessment from scheduled');
            });
        });

        describe('abandonAttempt', () => {
            it('transitions scheduled attempt to abandoned state', async () => {
                const scheduledAttempt: AssessmentAttempt = { ...validAttempt, state: 'scheduled' };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, scheduledAttempt));

                await service.abandonAttempt('user-1', 'attempt-1', 'Feeling unwell');

                expect(fakeTransaction.set).toHaveBeenCalledWith(
                    expect.anything(),
                    {
                        ...scheduledAttempt,
                        state: 'abandoned',
                        notes: 'Feeling unwell',
                    }
                );
            });

            it('transitions in_progress attempt to abandoned state', async () => {
                const inProgressAttempt: AssessmentAttempt = {
                    ...validAttempt,
                    state: 'in_progress',
                    startedAt: '2026-03-30T10:00:00.000Z',
                };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, inProgressAttempt));

                await service.abandonAttempt('user-1', 'attempt-1');

                expect(fakeTransaction.set).toHaveBeenCalledWith(
                    expect.anything(),
                    {
                        ...inProgressAttempt,
                        state: 'abandoned',
                    }
                );
            });

            it('throws error if attempt is in completed state', async () => {
                const completedAttempt: AssessmentAttempt = {
                    ...validAttempt,
                    state: 'completed',
                    startedAt: '2026-03-30T10:00:00.000Z',
                    completedAt: '2026-03-30T11:00:00.000Z',
                };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, completedAttempt));

                await expect(
                    service.abandonAttempt('user-1', 'attempt-1')
                ).rejects.toThrow('Cannot abandon assessment from completed');
            });
        });

        describe('transitionAttempt errors', () => {
            it('throws error if document does not exist during transition', async () => {
                fakeTransaction.get.mockResolvedValue(docSnapshot(false));

                await expect(
                    service.startAttempt('user-1', 'attempt-1', '2026-03-30T12:00:00.000Z')
                ).rejects.toThrow('Assessment attempt attempt-1 does not exist');
            });

            it('throws error if document id mismatches during transition', async () => {
                const mismatchedAttempt = { ...validAttempt, id: 'attempt-2' };
                fakeTransaction.get.mockResolvedValue(docSnapshot(true, mismatchedAttempt, 'attempt-1'));

                await expect(
                    service.startAttempt('user-1', 'attempt-1', '2026-03-30T12:00:00.000Z')
                ).rejects.toThrow('Assessment attempt path mismatch for attempt-1');
            });
        });
    });
});
