/**
 * `PerformedTrainingOccurrenceRepository` -- transactional idempotent persistence for
 * `users/{uid}/performedTrainingOccurrences/{id}` and
 * `users/{uid}/performedOccurrenceSourceLinks/{encodedSourceKey}` (ADR-0034 "Source-link
 * uniqueness", `docs/plans/training-occurrence-pr1-scope.md` "Transaction boundary").
 *
 * Idempotent-create pattern mirrors `services/healthAnomalyPersistence.ts`: read inside a
 * transaction, return the existing record unchanged when a claim already exists, only
 * `transaction.set` when it doesn't. Firestore's optimistic-concurrency retry on
 * `runTransaction` (it re-runs the callback if a read document changed before commit) is
 * what makes two concurrent callers for the same source converge to one canonical
 * occurrence rather than requiring an external lock.
 */
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    where,
    type Firestore,
    type Transaction,
} from 'firebase/firestore';
import { getDb } from '../firebase';
import type {
    ManualReconciliationDecision,
    PerformedOccurrenceSourceRef,
    PerformedTrainingOccurrence,
    ReconciliationProvenance,
    ReconciliationSourceFacts,
} from './models';
import { PERFORMED_OCCURRENCE_SCHEMA_VERSION } from './models';
import { buildProjection, projectionAfterAttach, type OccurrenceProjection } from './projectionBuilder';
import { encodeSourceKeyForDocId, sourceKeyForRef } from './sourceIdentity';
import { parsePerformedOccurrenceSourceLink, parsePerformedTrainingOccurrence } from './validation';

const OCCURRENCES_COLLECTION = 'performedTrainingOccurrences';
const SOURCE_LINKS_COLLECTION = 'performedOccurrenceSourceLinks';
const MAX_MERGE_CHAIN_HOPS = 10;

export class SourceLinkConflictError extends Error {
    readonly sourceKey: string;
    readonly existingOccurrenceId: string;
    readonly requestedOccurrenceId: string;

    constructor(sourceKey: string, existingOccurrenceId: string, requestedOccurrenceId: string) {
        super(`Source ${sourceKey} is already linked to ${existingOccurrenceId}, cannot attach to ${requestedOccurrenceId}`);
        this.sourceKey = sourceKey;
        this.existingOccurrenceId = existingOccurrenceId;
        this.requestedOccurrenceId = requestedOccurrenceId;
        this.name = 'SourceLinkConflictError';
    }
}

function newPerformedOccurrenceId(): string {
    return `pto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newOccurrenceDoc(
    userId: string,
    sourceRef: PerformedOccurrenceSourceRef,
    projection: ReturnType<typeof buildProjection>,
    now: string,
): PerformedTrainingOccurrence {
    return {
        schemaVersion: PERFORMED_OCCURRENCE_SCHEMA_VERSION,
        performedOccurrenceId: newPerformedOccurrenceId(),
        userId,
        status: 'active',
        ...projection,
        sourceRefs: [sourceRef],
        reconciliation: { state: 'single_source' },
        createdAt: now,
        updatedAt: now,
    };
}

export class PerformedTrainingOccurrenceRepository {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    private occurrencesColl(userId: string) {
        return collection(this.db, 'users', userId, OCCURRENCES_COLLECTION);
    }

    private occurrenceRef(userId: string, performedOccurrenceId: string) {
        return doc(this.db, 'users', userId, OCCURRENCES_COLLECTION, performedOccurrenceId);
    }

    private sourceLinkRef(userId: string, sourceKey: string) {
        return doc(this.db, 'users', userId, SOURCE_LINKS_COLLECTION, encodeSourceKeyForDocId(sourceKey));
    }

    private async followMergeChainTx(
        transaction: Transaction,
        userId: string,
        occurrence: PerformedTrainingOccurrence,
    ): Promise<PerformedTrainingOccurrence> {
        let current = occurrence;
        for (let hop = 0; hop < MAX_MERGE_CHAIN_HOPS; hop += 1) {
            if (current.status !== 'merged' || !current.mergedIntoOccurrenceId) return current;
            const nextSnap = await transaction.get(this.occurrenceRef(userId, current.mergedIntoOccurrenceId));
            if (!nextSnap.exists()) throw new Error(`Merge chain target ${current.mergedIntoOccurrenceId} does not exist`);
            current = parsePerformedTrainingOccurrence(nextSnap.data(), userId);
        }
        throw new Error(`Merge chain exceeded ${MAX_MERGE_CHAIN_HOPS} hops -- possible cycle`);
    }

    private async followMergeChain(userId: string, occurrence: PerformedTrainingOccurrence): Promise<PerformedTrainingOccurrence> {
        let current = occurrence;
        for (let hop = 0; hop < MAX_MERGE_CHAIN_HOPS; hop += 1) {
            if (current.status !== 'merged' || !current.mergedIntoOccurrenceId) return current;
            const nextSnap = await getDoc(this.occurrenceRef(userId, current.mergedIntoOccurrenceId));
            if (!nextSnap.exists()) throw new Error(`Merge chain target ${current.mergedIntoOccurrenceId} does not exist`);
            current = parsePerformedTrainingOccurrence(nextSnap.data(), userId);
        }
        throw new Error(`Merge chain exceeded ${MAX_MERGE_CHAIN_HOPS} hops -- possible cycle`);
    }

    async getById(userId: string, performedOccurrenceId: string): Promise<PerformedTrainingOccurrence | null> {
        const snap = await getDoc(this.occurrenceRef(userId, performedOccurrenceId));
        if (!snap.exists()) return null;
        return this.followMergeChain(userId, parsePerformedTrainingOccurrence(snap.data(), userId));
    }

    async getBySourceKey(userId: string, sourceKey: string): Promise<PerformedTrainingOccurrence | null> {
        const linkSnap = await getDoc(this.sourceLinkRef(userId, sourceKey));
        if (!linkSnap.exists()) return null;
        const link = parsePerformedOccurrenceSourceLink(linkSnap.data(), userId);
        return this.getById(userId, link.performedOccurrenceId);
    }

    /** `toDateInclusive` is inclusive -- callers pass a `[from, to]` local-date window
     * (ADR-0034: date is a search aid only, never match identity by itself). */
    async queryActiveInDateWindow(
        userId: string,
        fromDateInclusive: string,
        toDateInclusive: string,
    ): Promise<PerformedTrainingOccurrence[]> {
        const activeQuery = query(
            this.occurrencesColl(userId),
            where('status', '==', 'active'),
            where('localDate', '>=', fromDateInclusive),
            where('localDate', '<=', toDateInclusive),
        );
        const snap = await getDocs(activeQuery);
        return snap.docs.map(document => parsePerformedTrainingOccurrence(document.data(), userId));
    }

    /**
     * Idempotent: the first caller for a given source creates the occurrence + source
     * link atomically; every later caller for the same source (repeated sync, concurrent
     * arrival) observes the existing link and returns the same occurrence unchanged.
     */
    async createOrGetForSource(
        userId: string,
        facts: ReconciliationSourceFacts,
    ): Promise<{ occurrence: PerformedTrainingOccurrence; created: boolean }> {
        const sourceKey = sourceKeyForRef(facts.sourceRef);
        const linkRef = this.sourceLinkRef(userId, sourceKey);

        return runTransaction(this.db, async transaction => {
            const linkSnap = await transaction.get(linkRef);
            if (linkSnap.exists()) {
                const link = parsePerformedOccurrenceSourceLink(linkSnap.data(), userId);
                const occSnap = await transaction.get(this.occurrenceRef(userId, link.performedOccurrenceId));
                if (!occSnap.exists()) throw new Error(`Linked occurrence ${link.performedOccurrenceId} does not exist`);
                const occurrence = await this.followMergeChainTx(transaction, userId, parsePerformedTrainingOccurrence(occSnap.data(), userId));
                return { occurrence, created: false };
            }

            const now = new Date().toISOString();
            const projection = buildProjection([facts]);
            const occurrence = newOccurrenceDoc(userId, facts.sourceRef, projection, now);
            transaction.set(this.occurrenceRef(userId, occurrence.performedOccurrenceId), occurrence);
            transaction.set(linkRef, {
                schemaVersion: PERFORMED_OCCURRENCE_SCHEMA_VERSION,
                sourceKey,
                sourceKind: facts.sourceRef.kind,
                userId,
                performedOccurrenceId: occurrence.performedOccurrenceId,
                createdAt: now,
                updatedAt: now,
            });
            return { occurrence, created: true };
        });
    }

    /**
     * Attaches one additional source to an existing occurrence. Throws
     * `SourceLinkConflictError` (never silently double-links) when the source is already
     * claimed by a different live occurrence -- callers should route that case through
     * `mergeOccurrences` instead if the two occurrences are confirmed to be the same
     * workout, or record the conflict metric otherwise.
     */
    async attachSource(
        userId: string,
        performedOccurrenceId: string,
        facts: ReconciliationSourceFacts,
        reconciliation: ReconciliationProvenance,
    ): Promise<PerformedTrainingOccurrence> {
        const sourceKey = sourceKeyForRef(facts.sourceRef);
        const linkRef = this.sourceLinkRef(userId, sourceKey);
        const occRef = this.occurrenceRef(userId, performedOccurrenceId);

        return runTransaction(this.db, async transaction => {
            const occSnap = await transaction.get(occRef);
            if (!occSnap.exists()) throw new Error(`Occurrence ${performedOccurrenceId} does not exist`);
            const occurrence = await this.followMergeChainTx(transaction, userId, parsePerformedTrainingOccurrence(occSnap.data(), userId));

            const linkSnap = await transaction.get(linkRef);
            if (linkSnap.exists()) {
                const existingLink = parsePerformedOccurrenceSourceLink(linkSnap.data(), userId);
                if (existingLink.performedOccurrenceId === occurrence.performedOccurrenceId) return occurrence; // already attached -- idempotent no-op
                throw new SourceLinkConflictError(sourceKey, existingLink.performedOccurrenceId, occurrence.performedOccurrenceId);
            }

            const now = new Date().toISOString();
            const alreadyPresent = occurrence.sourceRefs.some(ref => sourceKeyForRef(ref) === sourceKey);
            const updated: PerformedTrainingOccurrence = {
                ...occurrence,
                ...projectionAfterAttach(occurrence, facts),
                sourceRefs: alreadyPresent ? occurrence.sourceRefs : [...occurrence.sourceRefs, facts.sourceRef],
                reconciliation,
                updatedAt: now,
            };
            transaction.set(this.occurrenceRef(userId, occurrence.performedOccurrenceId), updated);
            transaction.set(linkRef, {
                schemaVersion: PERFORMED_OCCURRENCE_SCHEMA_VERSION,
                sourceKey,
                sourceKind: facts.sourceRef.kind,
                userId,
                performedOccurrenceId: occurrence.performedOccurrenceId,
                createdAt: now,
                updatedAt: now,
            });
            return updated;
        });
    }

    /**
     * Detaches one source from `performedOccurrenceId` into its own fresh occurrence
     * (ADR-0034 "Manual reconciliation UX"). Never deletes the source link -- it is
     * re-pointed at the new occurrence, which is why the source-link rules only ever need
     * to permit updating `performedOccurrenceId`, never deleting the document. Sticky:
     * the source key is recorded in the survivor's `excludedSourceKeys` so a later sweep
     * does not immediately re-propose the same pairing.
     */
    async unlinkSource(
        userId: string,
        performedOccurrenceId: string,
        sourceKey: string,
        actor: string,
        reason?: string,
    ): Promise<{ survivor: PerformedTrainingOccurrence; detached: PerformedTrainingOccurrence }> {
        const occRef = this.occurrenceRef(userId, performedOccurrenceId);
        const linkRef = this.sourceLinkRef(userId, sourceKey);

        return runTransaction(this.db, async transaction => {
            const occSnap = await transaction.get(occRef);
            if (!occSnap.exists()) throw new Error(`Occurrence ${performedOccurrenceId} does not exist`);
            const occurrence = parsePerformedTrainingOccurrence(occSnap.data(), userId);
            const detachedRef = occurrence.sourceRefs.find(ref => sourceKeyForRef(ref) === sourceKey);
            if (!detachedRef) throw new Error(`Occurrence ${performedOccurrenceId} has no source ${sourceKey}`);
            if (occurrence.sourceRefs.length <= 1) throw new Error(`Cannot unlink the only source on occurrence ${performedOccurrenceId}`);

            const now = new Date().toISOString();
            const decision: ManualReconciliationDecision = {
                decision: 'unlink',
                actor,
                decidedAt: now,
                previousState: occurrence.reconciliation.state,
                resultingState: 'single_source',
                ...(reason ? { reason } : {}),
            };
            const remainingRefs = occurrence.sourceRefs.filter(ref => sourceKeyForRef(ref) !== sourceKey);
            const survivor: PerformedTrainingOccurrence = {
                ...occurrence,
                sourceRefs: remainingRefs,
                reconciliation: {
                    ...occurrence.reconciliation,
                    state: remainingRefs.length <= 1 ? 'single_source' : occurrence.reconciliation.state,
                    manualDecision: decision,
                    excludedSourceKeys: [...(occurrence.reconciliation.excludedSourceKeys ?? []), sourceKey],
                },
                updatedAt: now,
            };
            const detached = newOccurrenceDoc(userId, detachedRef, {}, now);
            const detachedWithDecision: PerformedTrainingOccurrence = {
                ...detached,
                reconciliation: { ...detached.reconciliation, manualDecision: { ...decision, resultingState: 'single_source' } },
            };

            transaction.set(occRef, survivor);
            transaction.set(this.occurrenceRef(userId, detached.performedOccurrenceId), detachedWithDecision);
            transaction.update(linkRef, { performedOccurrenceId: detached.performedOccurrenceId, updatedAt: now });

            return { survivor, detached: detachedWithDecision };
        });
    }

    /**
     * Merges `loserId` into `survivorId` when a later reconciliation discovers two
     * canonical occurrences describe the same workout (ADR-0034 "Identity and merge
     * semantics"). The loser is tombstoned (`status: 'merged'`), never deleted, and its
     * source links are re-pointed to the survivor so future lookups by source key resolve
     * to the survivor via `followMergeChain`.
     */
    async mergeOccurrences(
        userId: string,
        survivorId: string,
        loserId: string,
        reconciliationOverride?: ReconciliationProvenance,
    ): Promise<PerformedTrainingOccurrence> {
        if (survivorId === loserId) throw new Error('Cannot merge an occurrence into itself');
        const survivorRef = this.occurrenceRef(userId, survivorId);
        const loserRef = this.occurrenceRef(userId, loserId);

        return runTransaction(this.db, async transaction => {
            const [survivorSnap, loserSnap] = await Promise.all([transaction.get(survivorRef), transaction.get(loserRef)]);
            if (!survivorSnap.exists()) throw new Error(`Survivor occurrence ${survivorId} does not exist`);
            if (!loserSnap.exists()) throw new Error(`Loser occurrence ${loserId} does not exist`);
            const survivor = parsePerformedTrainingOccurrence(survivorSnap.data(), userId);
            const loser = parsePerformedTrainingOccurrence(loserSnap.data(), userId);
            if (loser.status === 'merged') return survivor; // already merged -- idempotent

            const now = new Date().toISOString();
            const survivorKeys = new Set(survivor.sourceRefs.map(sourceKeyForRef));
            const combinedRefs = [...survivor.sourceRefs, ...loser.sourceRefs.filter(ref => !survivorKeys.has(sourceKeyForRef(ref)))];
            const mergedSurvivor: PerformedTrainingOccurrence = {
                ...survivor,
                sourceRefs: combinedRefs,
                reconciliation: reconciliationOverride
                    ?? { ...survivor.reconciliation, state: combinedRefs.length > 1 ? 'matched' : survivor.reconciliation.state },
                updatedAt: now,
            };
            const tombstonedLoser: PerformedTrainingOccurrence = {
                ...loser,
                status: 'merged',
                mergedIntoOccurrenceId: survivorId,
                updatedAt: now,
            };

            transaction.set(survivorRef, mergedSurvivor);
            transaction.set(loserRef, tombstonedLoser);
            for (const ref of loser.sourceRefs) {
                transaction.update(this.sourceLinkRef(userId, sourceKeyForRef(ref)), { performedOccurrenceId: survivorId, updatedAt: now });
            }
            return mergedSurvivor;
        });
    }

    /**
     * Repair primitive (`docs/plans/training-occurrence-pr1-scope.md` "rebuild/repair API
     * or service primitive"): overwrites only the derived display-summary fields, leaving
     * `sourceRefs`, `status`, and -- critically -- `reconciliation.manualDecision`
     * untouched, so a rebuild can never silently discard a sticky manual decision.
     */
    async updateProjection(userId: string, performedOccurrenceId: string, projection: OccurrenceProjection): Promise<PerformedTrainingOccurrence> {
        const occRef = this.occurrenceRef(userId, performedOccurrenceId);
        return runTransaction(this.db, async transaction => {
            const snap = await transaction.get(occRef);
            if (!snap.exists()) throw new Error(`Occurrence ${performedOccurrenceId} does not exist`);
            const occurrence = parsePerformedTrainingOccurrence(snap.data(), userId);
            const updated: PerformedTrainingOccurrence = { ...occurrence, ...projection, updatedAt: new Date().toISOString() };
            transaction.set(occRef, updated);
            return updated;
        });
    }
}

export const performedTrainingOccurrenceRepository = new PerformedTrainingOccurrenceRepository();
