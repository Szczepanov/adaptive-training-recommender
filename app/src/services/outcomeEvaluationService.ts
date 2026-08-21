import {
    collection,
    doc,
    getDoc,
    getDocs,
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
    assertValidOutcomeMetricBinding,
} from '../outcomes/evaluationSpec';
import { hashEvaluationContent, sortOutcomeBindings } from '../outcomes/evaluationHash';

export interface OutcomeEvaluationHead {
    id: string;
    currentRevision: number;
    createdAt: string;
    updatedAt: string;
}

function assertValidHead(head: OutcomeEvaluationHead, expectedId?: string): void {
    if (!head.id || (expectedId !== undefined && head.id !== expectedId)) throw new Error('Outcome evaluation head id mismatch');
    if (!Number.isInteger(head.currentRevision) || head.currentRevision < 1) throw new Error('Outcome evaluation currentRevision must be positive');
    if (!Number.isFinite(Date.parse(head.createdAt)) || !Number.isFinite(Date.parse(head.updatedAt))) throw new Error('Outcome evaluation head timestamps are invalid');
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

    private bindingRef(userId: string, evaluationId: string, revision: number, bindingId: string) {
        return doc(this.db, 'users', userId, 'outcome_evaluations', evaluationId, 'revisions', String(revision), 'metrics', bindingId);
    }

    private bindingsCollection(userId: string, evaluationId: string, revision: number) {
        return collection(this.db, 'users', userId, 'outcome_evaluations', evaluationId, 'revisions', String(revision), 'metrics');
    }

    /**
     * Draft criteria are immutable once persisted. Editing is represented by creating the next
     * draft revision. This deliberately chooses the plan's "replaced" option over in-place
     * mutation so activation can hash bytes that no concurrent client is allowed to rewrite.
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

            for (const binding of snapshot.bindings) {
                transaction.set(this.bindingRef(userId, revision.id, revision.revision, binding.id), binding);
            }
            transaction.set(revisionRef, revision);
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
        const value = revisionSnapshot.data() as OutcomeEvaluationSpecRevision;
        assertValidOutcomeEvaluationRevision(value);
        if (value.id !== evaluationId || value.revision !== revision) throw new Error(`Outcome evaluation path mismatch for ${evaluationId}@${revision}`);

        const bindingSnapshots = await getDocs(this.bindingsCollection(userId, evaluationId, revision));
        const bindings = bindingSnapshots.docs.map(snapshot => {
            const binding = snapshot.data() as OutcomeMetricBinding;
            assertValidOutcomeMetricBinding(binding);
            if (binding.id !== snapshot.id) throw new Error(`Outcome binding path mismatch for ${snapshot.id}`);
            return binding;
        });
        const result: OutcomeEvaluationSnapshot = { revision: value, bindings: sortOutcomeBindings(bindings) };
        assertValidOutcomeEvaluationSnapshot(result);
        return result;
    }

    async activateRevision(userId: string, evaluationId: string, revision: number, activatedAt = new Date().toISOString()): Promise<OutcomeEvaluationSnapshot> {
        const current = await this.getRevision(userId, evaluationId, revision);
        if (!current) throw new Error(`Outcome evaluation ${evaluationId}@${revision} does not exist`);
        if (current.revision.status !== 'draft') throw new Error(`Cannot activate outcome evaluation from ${current.revision.status}`);

        const contentHash = await hashEvaluationContent(current);
        const activated: OutcomeEvaluationSpecRevision = {
            ...current.revision,
            status: 'active',
            activatedAt,
            contentHash,
        };
        assertValidOutcomeEvaluationSnapshot({ revision: activated, bindings: current.bindings });

        const revisionRef = this.revisionRef(userId, evaluationId, revision);
        await runTransaction(this.db, async transaction => {
            const persistedSnapshot = await transaction.get(revisionRef);
            if (!persistedSnapshot.exists()) throw new Error(`Outcome evaluation ${evaluationId}@${revision} disappeared during activation`);
            const persisted = persistedSnapshot.data() as OutcomeEvaluationSpecRevision;
            assertValidOutcomeEvaluationRevision(persisted);
            if (persisted.status !== 'draft' || persisted.contentHash !== '') {
                throw new Error(`Outcome evaluation ${evaluationId}@${revision} is no longer an activatable draft`);
            }
            transaction.set(revisionRef, activated);
        });
        return { revision: activated, bindings: current.bindings };
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
            const current = snapshot.data() as OutcomeEvaluationSpecRevision;
            assertValidOutcomeEvaluationRevision(current);
            if (current.status !== 'active' && !(status === 'archived' && current.status === 'completed')) {
                throw new Error(`Cannot transition outcome evaluation from ${current.status} to ${status}`);
            }
            transaction.set(revisionRef, { ...current, status });
        });
    }
}

export const outcomeEvaluationService = new OutcomeEvaluationService();
