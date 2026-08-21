import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { MeasurementProtocol } from '../observations/models';
import { assertValidMeasurementProtocol } from '../observations/protocols';
import { deepEqual } from '../utils/deepEqual';

/** User-scoped immutable protocol revisions. Material edits must be a new revision. */
export class MeasurementProtocolService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private revisionRef(userId: string, protocolId: string, revision: number) {
        return doc(this.db, 'users', userId, 'measurement_protocols', protocolId, 'revisions', String(revision));
    }

    async createRevision(userId: string, protocol: MeasurementProtocol): Promise<MeasurementProtocol> {
        assertValidMeasurementProtocol(protocol);
        const ref = this.revisionRef(userId, protocol.id, protocol.revision);
        const existing = await getDoc(ref);
        if (existing.exists()) {
            throw new Error(`Measurement protocol ${protocol.id}@${protocol.revision} already exists and is immutable`);
        }
        await setDoc(ref, protocol);
        return protocol;
    }

    /**
     * Materialize an immutable bundled/default revision idempotently. An existing revision is
     * reusable only when its full protocol contract is structurally identical; an id/revision
     * collision with different criteria fails closed rather than changing the test silently.
     */
    async ensureRevision(userId: string, protocol: MeasurementProtocol): Promise<MeasurementProtocol> {
        assertValidMeasurementProtocol(protocol);
        const existing = await this.getRevision(userId, protocol.id, protocol.revision);
        if (existing) {
            if (!deepEqual(existing, protocol)) {
                throw new Error(`Measurement protocol ${protocol.id}@${protocol.revision} conflicts with the bundled immutable revision`);
            }
            return existing;
        }
        return this.createRevision(userId, protocol);
    }

    async getRevision(userId: string, protocolId: string, revision: number): Promise<MeasurementProtocol | null> {
        const snapshot = await getDoc(this.revisionRef(userId, protocolId, revision));
        if (!snapshot.exists()) return null;
        const protocol = snapshot.data() as MeasurementProtocol;
        assertValidMeasurementProtocol(protocol);
        if (protocol.id !== protocolId || protocol.revision !== revision) {
            throw new Error(`Measurement protocol path identity mismatch for ${protocolId}@${revision}`);
        }
        return protocol;
    }
}

export const measurementProtocolService = new MeasurementProtocolService();
