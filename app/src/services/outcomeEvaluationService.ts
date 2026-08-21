import {
    doc,
    getDoc,
    runTransaction,
    type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type {
    OutcomeEvaluationSnapshot,
    OutcomeEvaluationSpecRevision,
    OutcomeMetricBinding,
} from '../outcomes/evaluationSpec';
import {
    assertValidOutcomeEvaluationRevision,
    assertValidOutcomeEvaluationSnapshot,
} from '../outcomes/evaluationSpec';
import { hashEvaluationContent, sortOutcomeBindings } from '../outcomes/evaluationHash';

export interface OutcomeEvaluationHead {
    id: string;
    currentRevision: number;
    createdAt: string;
    updatedAt: string;
}

interface PersistedOutcomeEvaluationRevision extends OutcomeEvaluationSpecRevision {
    bindings: readonly OutcomeMetricBinding[];
}

function assertValidHead(head: OutcomeEvaluationHead, expectedId?: string): void {
    if (!head.id || (expectedId !== undefined && head.id !== expectedId)) throw new Error('Outcome evaluation head id mismatch');
    if (!Number.isInteger(head.currentRevision) || head.currentRevision < 1) throw new Error('Outcome evaluation currentRevision must be positive');
    if (!Number.isFinite(Date.parse(head.createdAt)) || !Number.isFinite(Date.parse(head.updatedAt))) throw new Error('Outcome evaluation head timestamps are invalid');
}

function toPersisted(snapshot: OutcomeEvaluationSnapshot): PersistedOutcomeEvaluationRevision {
    return { ...snapshot.revision, bindings: sortOutcomeBindings(snapshot.bindings) };
}

function fromPersisted(
    persisted: PersistedOutcomeEvaluationRevision,
    expectedId: string,
    expectedRevision: number,
): OutcomeEvaluationSnapshot {
    const { bindings, ...revision } = persisted;
    assertValidOutcomeEvaluationRevision(revision);
    if (revision.id !== expectedId || revision.revision !== expectedRevision) {
        throw new Error(`Outcome evaluation path mismatch for ${expectedId}@${expectedRevision}`);
    }
    const result: OutcomeEvaluationSnapshot = { revision, bindings: sortOutcomeBindings(bindings ?? []) };
    assertValidOutcomeEvaluationSnapshot(result);
    return result;
}

export class OutcomeEvaluationService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private headRef(userId: string, evaluationId: string) {
        return doc(this.db, 'users', userId, 'outcome_evaluations', evaluationId);
    }

    private revisionRef(userId: string, evaluationId: string, revision: number) {
        return doc(this.db, 'users', userId, 'outcome_evaluations', evaluationId, 'revisions', String(revision));
    }

    /**
     * Draft criteria are immutable once persisted. Editing is represented by creating the next
     * draft revision. Bindings are stored in the same revision document so activation freezes
     * the exact criteria atomically; there is no separately mutable binding subcollection that
     * can race the content hash.
     */
    async createDraftRevision(
        userId: string,
        revision: OutcomeEvaluationSpecRevision,
        bindings: readonly OutcomeMetricBinding[],
    ): Promise<OutcomeEvaluationSnapshot> {
        if (revision.status !== 'draft') throw new Error('createDraftRevision requires draft status');
        const snapshot: OutcomeEvaluationSnapshot = { revision, bindings: sortOutcomeBindings(bindings) };
        assertValidOutcomeEvaluationSnapshot(snapshot);

        const headRef = this.headRef(userId, revision.id);
        const revisionRef = this.revisionRef(userId, revision.id, revision.revision);
        await runTransaction(this.db, async transaction => {
            const [headSnapshot, revisionSnapshot] = await Promise.all([
                transaction.get(headRef),
                transaction.get(revisionRef),
            ]);
            if (revisionSnapshot.exists()) throw new Error(`Outcome evaluation ${revision.id}@${revision.revision} already exists`);
            const existingHead = headSnapshot.exists() ? headSnapshot.data() as OutcomeEvaluationHead : null;
            if (existingHead) {
                assertValidHead(existingHead, revision.id);
                if (revision.revision !== existingHead.currentRevision + 1) {
                    throw new Error(`Next outcome evaluation revision must be ${existingHead.currentRevision + 1}`);
                }
            } else if (revision.revision !== 1) {
                throw new Error('First outcome evaluation revision must be 1');
            }

            transaction.set(revisionRef, toPersisted(snapshot));
            const head: OutcomeEvaluationHead = existingHead
                ? { ...existingHead, currentRevision: revision.revision, updatedAt: revision.createdAt }
                : { id: revision.id, currentRevision: revision.revision, createdAt: revision.createdAt, updatedAt: revision.createdAt };
            transaction.set(headRef, head);
        });
        return snapshot;
    }

    async getRevision(userId: string, evaluationId: string, revision: number): Promise<OutcomeEvaluationSnapshot | null> {
        const revisionSnapshot = await getDoc(this.revisionRef(userId, evaluationId, revision));
        if (!revisionSnapshot.exists()) return null;
        return fromPersisted(
            revisionSnapshot.data() as PersistedOutcomeEvaluationRevision,
            evaluationId,
            revision,
        );
    }

    async activateRevision(
        userId: string,
        evaluationId: string,
        revision: number,
        activatedAt = new Date().toISOString(),
    ): Promise<OutcomeEvaluationSnapshot> {
        const revisionRef = this.revisionRef(userId, evaluationId, revision);
        return runTransaction(this.db, async transaction => {
            const persistedSnapshot = await transaction.get(revisionRef);
            if (!persistedSnapshot.exists()) throw new Error(`Outcome evaluation ${evaluationId}@${revision} does not exist`);
            const current = fromPersisted(
                persistedSnapshot.data() as PersistedOutcomeEvaluationRevision,
                evaluationId,
                revision,
            );
            if (current.revision.status !== 'draft') {
                throw new Error(`Cannot activate outcome evaluation from ${current.revision.status}`);
            }

            const contentHash = await hashEvaluationContent(current);
            const activated: OutcomeEvaluationSnapshot = {
                revision: {
                    ...current.revision,
                    status: 'active',
                    activatedAt,
                    contentHash,
                },
                bindings: current.bindings,
            };
            assertValidOutcomeEvaluationSnapshot(activated);
            transaction.set(revisionRef, toPersisted(activated));
            return activated;
        });
    }

    async transitionStatus(
        userId: string,
        evaluationId: string,
        revision: number,
        status: 'completed' | 'archived',
    ): Promise<void> {
        const revisionRef = this.revisionRef(userId, evaluationId, revision);
        await runTransaction(this.db, async transaction => {
            const snapshot = await transaction.get(revisionRef);
            if (!snapshot.exists()) throw new Error(`Outcome evaluation ${evaluationId}@${revision} does not exist`);
            const current = fromPersisted(
                snapshot.data() as PersistedOutcomeEvaluationRevision,
                evaluationId,
                revision,
            );
            const validTransition = (current.revision.status === 'active' && status === 'completed')
                || (current.revision.status === 'completed' && status === 'archived');
            if (!validTransition) {
                throw new Error(`Cannot transition outcome evaluation from ${current.revision.status} to ${status}`);
            }
            const next: OutcomeEvaluationSnapshot = {
                ...current,
                revision: { ...current.revision, status },
            };
            assertValidOutcomeEvaluationSnapshot(next);
            transaction.set(revisionRef, toPersisted(next));
        });
    }
}

export const outcomeEvaluationService = new OutcomeEvaluationService();
