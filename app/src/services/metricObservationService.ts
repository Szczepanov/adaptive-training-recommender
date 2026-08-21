import {
    doc,
    getDoc,
    runTransaction,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type { MetricObservationHead, MetricObservationRevision } from '../observations/models';
import {
    assertValidMetricObservationHead,
    assertValidMetricObservationRevision,
} from '../observations/validation';

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, canonicalize(entry)]),
        );
    }
    return value;
}

/**
 * `createdAt` is persistence metadata, not observation identity. An offline/reconnect retry may
 * rebuild the same canonical observation a few seconds later, so revision-1 idempotency compares
 * the evidence payload while deliberately ignoring only that timestamp.
 */
function sameCanonicalInitialPayload(
    existing: MetricObservationRevision,
    incoming: MetricObservationRevision,
): boolean {
    const { createdAt: _existingCreatedAt, ...existingPayload } = existing;
    const { createdAt: _incomingCreatedAt, ...incomingPayload } = incoming;
    return JSON.stringify(canonicalize(existingPayload)) === JSON.stringify(canonicalize(incomingPayload));
}

export class MetricObservationService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private headRef(userId: string, observationKey: string) {
        return doc(this.db, 'users', userId, 'metric_observations', observationKey);
    }

    private revisionRef(userId: string, observationKey: string, revision: number) {
        return doc(this.db, 'users', userId, 'metric_observations', observationKey, 'revisions', String(revision));
    }

    async createInitialRevision(userId: string, revision: MetricObservationRevision): Promise<MetricObservationRevision> {
        assertValidMetricObservationRevision(revision);
        if (revision.revision !== 1 || revision.supersedesRevision !== undefined) {
            throw new Error('Initial observation write must be revision 1 with no supersedesRevision');
        }

        const headRef = this.headRef(userId, revision.observationKey);
        const revisionRef = this.revisionRef(userId, revision.observationKey, 1);
        await runTransaction(this.db, async transaction => {
            const headSnapshot = await transaction.get(headRef);
            if (headSnapshot.exists()) {
                const head = headSnapshot.data() as MetricObservationHead;
                assertValidMetricObservationHead(head);
                if (head.observationKey !== revision.observationKey
                    || head.metricId !== revision.metricId
                    || head.assessmentAttemptId !== revision.assessmentAttemptId) {
                    throw new Error('Existing observation head does not match logical observation identity');
                }
                if (head.headRevision !== 1) {
                    throw new Error(`Observation ${revision.observationKey} already has corrections; use the correction workflow`);
                }
                const existingRevisionSnapshot = await transaction.get(revisionRef);
                if (!existingRevisionSnapshot.exists()) {
                    throw new Error(`Observation ${revision.observationKey} has a head but revision 1 is missing`);
                }
                const existingRevision = existingRevisionSnapshot.data() as MetricObservationRevision;
                assertValidMetricObservationRevision(existingRevision);
                if (sameCanonicalInitialPayload(existingRevision, revision)) return;
                throw new Error(`Observation ${revision.observationKey} already exists with different evidence; use the correction workflow`);
            }
            const revisionSnapshot = await transaction.get(revisionRef);
            if (revisionSnapshot.exists()) {
                throw new Error(`Observation revision path ${revision.observationKey}@1 already exists without a head`);
            }

            const head: MetricObservationHead = {
                observationKey: revision.observationKey,
                assessmentAttemptId: revision.assessmentAttemptId,
                metricId: revision.metricId,
                headRevision: 1,
                createdAt: revision.createdAt,
                updatedAt: revision.createdAt,
            };
            assertValidMetricObservationHead(head);
            transaction.set(revisionRef, revision);
            transaction.set(headRef, head);
        });
        return revision;
    }

    async appendCorrection(userId: string, revision: MetricObservationRevision): Promise<MetricObservationRevision> {
        assertValidMetricObservationRevision(revision);
        if (revision.revision < 2 || revision.supersedesRevision === undefined) {
            throw new Error('Correction must be revision 2 or greater and declare supersedesRevision');
        }
        if (!revision.correctionReason) throw new Error('Correction requires correctionReason');

        const headRef = this.headRef(userId, revision.observationKey);
        const nextRevisionRef = this.revisionRef(userId, revision.observationKey, revision.revision);
        await runTransaction(this.db, async transaction => {
            const headSnapshot = await transaction.get(headRef);
            if (!headSnapshot.exists()) throw new Error(`Observation ${revision.observationKey} does not exist`);
            const head = headSnapshot.data() as MetricObservationHead;
            assertValidMetricObservationHead(head);

            if (head.observationKey !== revision.observationKey
                || head.metricId !== revision.metricId
                || head.assessmentAttemptId !== revision.assessmentAttemptId) {
                throw new Error('Correction cannot change logical observation identity');
            }
            const expectedRevision = head.headRevision + 1;
            if (revision.revision !== expectedRevision || revision.supersedesRevision !== head.headRevision) {
                throw new Error(`Stale correction: expected revision ${expectedRevision} superseding ${head.headRevision}`);
            }

            const existingNext = await transaction.get(nextRevisionRef);
            if (existingNext.exists()) throw new Error(`Observation revision ${revision.revision} already exists`);

            transaction.set(nextRevisionRef, revision);
            transaction.update(headRef, {
                headRevision: revision.revision,
                updatedAt: revision.createdAt,
            });
        });
        return revision;
    }

    async getHead(userId: string, observationKey: string): Promise<MetricObservationHead | null> {
        const snapshot = await getDoc(this.headRef(userId, observationKey));
        if (!snapshot.exists()) return null;
        const head = snapshot.data() as MetricObservationHead;
        assertValidMetricObservationHead(head);
        if (head.observationKey !== observationKey) throw new Error(`Observation head path mismatch for ${observationKey}`);
        return head;
    }

    async getRevision(userId: string, observationKey: string, revision: number): Promise<MetricObservationRevision | null> {
        const snapshot = await getDoc(this.revisionRef(userId, observationKey, revision));
        if (!snapshot.exists()) return null;
        const value = snapshot.data() as MetricObservationRevision;
        assertValidMetricObservationRevision(value);
        if (value.observationKey !== observationKey || value.revision !== revision) {
            throw new Error(`Observation revision path mismatch for ${observationKey}@${revision}`);
        }
        return value;
    }

    async getCurrentRevision(userId: string, observationKey: string): Promise<MetricObservationRevision | null> {
        const head = await this.getHead(userId, observationKey);
        if (!head) return null;
        const revision = await this.getRevision(userId, observationKey, head.headRevision);
        if (!revision) throw new Error(`Observation ${observationKey} head points to missing revision ${head.headRevision}`);
        if (revision.metricId !== head.metricId || revision.assessmentAttemptId !== head.assessmentAttemptId) {
            throw new Error(`Observation ${observationKey} head/revision identity mismatch`);
        }
        return revision;
    }
}

export const metricObservationService = new MetricObservationService();
