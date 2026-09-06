import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionPrescription } from '../sessions/models';
import { hashExecutionPrescription } from '../sessions/sessionDefinitionHash';

const { docStore, mockDoc, mockGetDoc, mockRunTransaction, state } = vi.hoisted(() => {
    const docStore = new Map<string, Record<string, unknown>>();
    const state = { versionCounter: 0 };

    function pathOf(segments: unknown[]): string {
        return segments.filter(segment => typeof segment === 'string').join('/');
    }

    const mockDoc = vi.fn((...args: unknown[]) => ({ path: pathOf(args) }));
    const mockGetDoc = vi.fn(async (ref: { path: string }) => {
        const data = docStore.get(ref.path);
        return { exists: () => data !== undefined, data: () => data };
    });

    const mockRunTransaction = vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
        // Simulate Firestore retry on contention
        for (let attempt = 0; attempt < 5; attempt++) {
            const readVersion = state.versionCounter;
            const tx = {
                get: vi.fn(async (ref: { path: string }) => {
                    const data = docStore.get(ref.path);
                    return { exists: () => data !== undefined, data: () => data };
                }),
                set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
                    if (state.versionCounter !== readVersion) {
                        throw new Error('TRANSACTION_CONTENTION');
                    }
                    state.versionCounter++;
                    docStore.set(ref.path, data);
                }),
            };

            try {
                return await fn(tx);
            } catch (err: unknown) {
                if ((err as Error).message === 'TRANSACTION_CONTENTION') {
                    continue;
                }
                throw err;
            }
        }
        throw new Error('Transaction retry limit exceeded');
    });

    return { docStore, mockDoc, mockGetDoc, mockRunTransaction, state };
});

vi.mock('firebase/firestore', () => ({
    doc: mockDoc,
    getDoc: mockGetDoc,
    runTransaction: mockRunTransaction,
}));
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { ExecutionPrescriptionService } from './executionPrescriptionService';

function makeBasePrescription(): Omit<ExecutionPrescription, 'prescriptionHash'> {
    return {
        schemaVersion: 1,
        sessionSource: {
            kind: 'external_plan',
            planId: 'plan-test',
            revision: 1,
            sessionId: 'session-abc',
            contentHash: 'a'.repeat(64),
        },
        definitionHash: 'b'.repeat(64),
        blocks: [{
            id: 'block-1',
            role: 'main',
            executionMode: 'sequential',
            steps: [{
                id: 'step-1',
                kind: 'exercise',
                title: 'Bench Press',
                exerciseRef: { kind: 'catalog', exerciseId: 'bench-press' },
                dose: { kind: 'repetition', sets: 3, reps: 10 },
            }],
        }],
        displayMetadata: {
            title: 'Upper Body Strength',
            intent: 'training',
            dominantModality: 'strength',
        },
        createdAt: '2026-09-06T10:00:00.000Z',
    };
}

describe('ExecutionPrescriptionService', () => {
    let service: ExecutionPrescriptionService;

    beforeEach(() => {
        docStore.clear();
        state.versionCounter = 0;
        vi.clearAllMocks();
        service = new ExecutionPrescriptionService({} as never);
    });

    describe('savePrescription (atomic transaction)', () => {
        it('saves a valid prescription inside a transaction', async () => {
            const raw = makeBasePrescription();
            const prescriptionHash = await hashExecutionPrescription({ ...raw, prescriptionHash: '' });
            const prescription: ExecutionPrescription = { ...raw, prescriptionHash };

            await service.savePrescription('u1', prescription);

            expect(mockRunTransaction).toHaveBeenCalledOnce();
            const stored = docStore.get('users/u1/execution_prescriptions/' + prescriptionHash);
            expect(stored).toBeDefined();
            expect(stored?.userId).toBe('u1');
            expect(stored?.prescriptionHash).toBe(prescriptionHash);
            expect(stored?.createdAt).toBe('2026-09-06T10:00:00.000Z');
        });

        it('rejects prescription if claimed prescriptionHash does not match computed hash', async () => {
            const raw = makeBasePrescription();
            const prescription: ExecutionPrescription = { ...raw, prescriptionHash: 'invalid_hash_value' };

            await expect(service.savePrescription('u1', prescription)).rejects.toThrow(/Prescription hash mismatch/);
            expect(mockRunTransaction).not.toHaveBeenCalled();
        });

        it('is idempotent and preserves existing record if identical content is already stored', async () => {
            const raw = makeBasePrescription();
            const prescriptionHash = await hashExecutionPrescription({ ...raw, prescriptionHash: '' });
            const firstPrescription: ExecutionPrescription = { ...raw, prescriptionHash, createdAt: '2026-09-06T10:00:00.000Z' };
            const secondPrescription: ExecutionPrescription = { ...raw, prescriptionHash, createdAt: '2026-09-06T11:00:00.000Z' };

            await service.savePrescription('u1', firstPrescription);
            await service.savePrescription('u1', secondPrescription);

            const stored = docStore.get('users/u1/execution_prescriptions/' + prescriptionHash);
            // Write-once semantics: first createdAt is preserved
            expect(stored?.createdAt).toBe('2026-09-06T10:00:00.000Z');
        });

        it('preserves the earliest write when concurrent calls share the same prescriptionHash with different timestamps', async () => {
            const raw = makeBasePrescription();
            const prescriptionHash = await hashExecutionPrescription({ ...raw, prescriptionHash: '' });
            const earliestTime = '2026-09-06T08:00:00.000Z';
            const laterTime = '2026-09-06T08:00:05.000Z';

            const firstPrescription: ExecutionPrescription = {
                ...raw,
                prescriptionHash,
                createdAt: earliestTime,
            };
            const secondPrescription: ExecutionPrescription = {
                ...raw,
                prescriptionHash,
                createdAt: laterTime,
            };

            // Simulate concurrent invocation
            await Promise.all([
                service.savePrescription('u1', firstPrescription),
                service.savePrescription('u1', secondPrescription),
            ]);

            const stored = docStore.get('users/u1/execution_prescriptions/' + prescriptionHash);
            expect(stored).toBeDefined();
            // Earliest write remains stored
            expect(stored?.createdAt).toBe(earliestTime);
        });

        it('preserves earliest write even when concurrent transactions experience contention and retry', async () => {
            const raw = makeBasePrescription();
            const prescriptionHash = await hashExecutionPrescription({ ...raw, prescriptionHash: '' });
            const earliestTime = '2026-09-06T09:00:00.000Z';
            const laterTime = '2026-09-06T09:00:10.000Z';

            const earlyPrescription: ExecutionPrescription = {
                ...raw,
                prescriptionHash,
                createdAt: earliestTime,
            };
            const latePrescription: ExecutionPrescription = {
                ...raw,
                prescriptionHash,
                createdAt: laterTime,
            };

            const p1 = service.savePrescription('u1', earlyPrescription);
            const p2 = (async () => {
                await new Promise(r => setTimeout(r, 2));
                return service.savePrescription('u1', latePrescription);
            })();

            await Promise.all([p1, p2]);

            const stored = docStore.get('users/u1/execution_prescriptions/' + prescriptionHash);
            expect(stored?.createdAt).toBe(earliestTime);
        });

        it('throws an error if existing document has corrupted hash', async () => {
            const raw = makeBasePrescription();
            const prescriptionHash = await hashExecutionPrescription({ ...raw, prescriptionHash: '' });
            const validPrescription: ExecutionPrescription = { ...raw, prescriptionHash };

            // Store corrupted record with same prescriptionHash key but altered definitionHash
            docStore.set('users/u1/execution_prescriptions/' + prescriptionHash, {
                ...validPrescription,
                definitionHash: 'corrupted_hash'.padEnd(64, '0'),
            });

            await expect(service.savePrescription('u1', validPrescription)).rejects.toThrow(
                /does not match its content hash/,
            );
        });
    });

    describe('getPrescription', () => {
        it('returns MISSING when document does not exist', async () => {
            const result = await service.getPrescription('u1', 'nonexistent_hash');
            expect(result).toEqual({ status: 'MISSING' });
        });

        it('returns AVAILABLE when document exists and has valid shape and hash', async () => {
            const raw = makeBasePrescription();
            const prescriptionHash = await hashExecutionPrescription({ ...raw, prescriptionHash: '' });
            const prescription: ExecutionPrescription = { ...raw, prescriptionHash };

            docStore.set('users/u1/execution_prescriptions/' + prescriptionHash, prescription as unknown as Record<string, unknown>);

            const result = await service.getPrescription('u1', prescriptionHash);
            expect(result.status).toBe('AVAILABLE');
            if (result.status === 'AVAILABLE') {
                expect(result.data.prescriptionHash).toBe(prescriptionHash);
                expect(result.revision).toBeNull();
            }
        });

        it('returns INVALID when document fails shape validation or hash verification', async () => {
            const raw = makeBasePrescription();
            const prescriptionHash = await hashExecutionPrescription({ ...raw, prescriptionHash: '' });
            docStore.set('users/u1/execution_prescriptions/' + prescriptionHash, {
                schemaVersion: 999,
                prescriptionHash,
            });

            const result = await service.getPrescription('u1', prescriptionHash);
            expect(result.status).toBe('INVALID');
        });
    });
});
