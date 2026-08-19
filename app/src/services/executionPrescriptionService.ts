import {
    doc,
    getDoc,
    setDoc,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import type { ExecutionPrescription } from '../sessions/models';
import { hashExecutionPrescription } from '../sessions/sessionDefinitionHash';

function hasSessionSource(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const source = value as Record<string, unknown>;
    if (source.kind === 'catalog') return typeof source.workoutId === 'string' && typeof source.catalogVersion === 'string';
    if (source.kind === 'manual') return typeof source.definitionId === 'string' && typeof source.revision === 'number' && typeof source.contentHash === 'string';
    if (source.kind === 'external_plan') return typeof source.planId === 'string' && typeof source.revision === 'number' && typeof source.sessionId === 'string' && typeof source.contentHash === 'string';
    return source.kind === 'unplanned_fixture' && typeof source.fixtureId === 'string';
}

/** Optional (M3.2): absent on prescriptions written before this field existed. */
function hasValidDisplayMetadata(value: unknown): boolean {
    if (value === undefined) return true;
    if (!value || typeof value !== 'object') return false;
    const meta = value as Record<string, unknown>;
    if (typeof meta.title !== 'string' || typeof meta.intent !== 'string') return false;
    if (meta.summary !== undefined && typeof meta.summary !== 'string') return false;
    if (meta.dominantModality !== undefined && typeof meta.dominantModality !== 'string') return false;
    if (meta.duration !== undefined) {
        if (!meta.duration || typeof meta.duration !== 'object') return false;
        const duration = meta.duration as Record<string, unknown>;
        if (typeof duration.min !== 'number' || typeof duration.max !== 'number') return false;
    }
    return true;
}

export class ExecutionPrescriptionService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private prescriptionRef(userId: string, prescriptionHash: string) {
        return doc(this.db, 'users', userId, 'execution_prescriptions', prescriptionHash);
    }

    async savePrescription(userId: string, prescription: ExecutionPrescription): Promise<void> {
        const computedHash = await hashExecutionPrescription(prescription);
        if (prescription.prescriptionHash !== computedHash) {
            throw new Error(`Prescription hash mismatch: claimed ${prescription.prescriptionHash}, computed ${computedHash}`);
        }

        const ref = this.prescriptionRef(userId, prescription.prescriptionHash);
        const existing = await getDoc(ref);
        if (existing.exists()) {
            const persisted = existing.data() as ExecutionPrescription;
            const persistedHash = await hashExecutionPrescription(persisted);
            if (persistedHash !== prescription.prescriptionHash) {
                throw new Error(`Stored prescription ${prescription.prescriptionHash} does not match its content hash`);
            }
            return;
        }

        await setDoc(ref, {
            ...prescription,
            userId,
        });
    }

    async getPrescription(userId: string, prescriptionHash: string): Promise<DataState<ExecutionPrescription>> {
        const path = `users/${userId}/execution_prescriptions/${prescriptionHash}`;
        try {
            const snap = await getDoc(this.prescriptionRef(userId, prescriptionHash));
            if (!snap.exists()) {
                return { status: 'MISSING' };
            }
            const data = snap.data() as Record<string, unknown>;
            if (
                data.schemaVersion === 1 &&
                typeof data.prescriptionHash === 'string' &&
                hasSessionSource(data.sessionSource) &&
                typeof data.definitionHash === 'string' &&
                Array.isArray(data.blocks) &&
                hasValidDisplayMetadata(data.displayMetadata)
            ) {
                const prescription = data as unknown as ExecutionPrescription;
                if (await hashExecutionPrescription(prescription) !== prescriptionHash) {
                    return {
                        status: 'INVALID',
                        issues: [{ code: 'prescription-hash-mismatch', documentPath: path, field: 'prescriptionHash' }],
                    };
                }
                return {
                    status: 'AVAILABLE',
                    data: prescription,
                    revision: null,
                };
            }
            return {
                status: 'INVALID',
                issues: [{ code: 'invalid-prescription-shape', documentPath: path }],
            };
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === 'permission-denied') throw err;
            return { status: 'UNAVAILABLE', operation: 'getPrescription', retryable: true };
        }
    }
}

export const executionPrescriptionService = new ExecutionPrescriptionService();
