/**
 * H5c (ADR-0037) authoring-boundary implementation gate: persistence for `IntentBlock`
 * (H5a, `engine/blockIntent.ts`). Investigated 2026-09-09
 * (`docs/plans/h5c-progression-claim-design.md`): no such persistence existed anywhere in
 * this repository before this file. There is also no existing "authoring boundary" to
 * adapt -- the closest candidates (`PlanBlockService` for travel overlays,
 * `ExternalPlanService` for imported plans) are each a mismatch by shape or by concurrency
 * discipline (see the design doc's "Authoring-boundary implementation gate" section).
 *
 * Modeled on two existing precedents rather than invented from scratch:
 *
 * - **Revisioned, hash-provenanced storage** shaped like `ExternalPlanService`'s
 *   `external_plans/{planId}` header + immutable `external_plans/{planId}/revisions/{revision}`
 *   split. Unlike that service, this one does the revision-not-newer precondition check
 *   with `transaction.get`, not a plain `getDoc` followed by a separate `writeBatch` --
 *   `ExternalPlanService.import` has a real read-then-conditional-write race under
 *   concurrency that this file deliberately does not repeat.
 * - **Transaction-composable primitive with no internal `runTransaction`**, exactly like
 *   `dailyLedgerAggregateService.ts`'s `seedIfAbsent`/`applyReservation`: `stageRevision`
 *   below takes a caller-supplied `Transaction`, does only `transaction.get`-informed
 *   validation and `transaction.set`, and returns the resulting header -- it does not own a
 *   transaction itself, because H5c's confirmation flow must commit an `IntentBlock`
 *   revision atomically with its own claim/activation writes, not as a separate round trip.
 *   `IntentBlockService.save` is the composing owner for the normal (non-H5c) authoring
 *   path: it opens its own transaction and calls `stageRevision` once.
 *
 * Per ADR-0037 D-REPLAY, an `IntentBlock` alone is not enough to reproduce its own content
 * hash later -- `blockIntentReplay.ts`'s `buildTreatmentIntentReplayPayloadV1` also needs the
 * athlete's `TrainingIntentProfile` priorities/weekly commitment *as they were pinned at
 * authoring time*. Each revision document therefore stores that pinned snapshot alongside
 * the raw block, so a later verification never depends on the athlete's possibly-since-changed
 * live profile (the same "retain immutable replay inputs, not only pointers to mutable
 * latest records" discipline ADR-0036 D-AUDIT states for a different collection).
 */

import { doc, getDoc, getDocs, collection, runTransaction, type DocumentReference, type Firestore, type Transaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { DataState } from '../engine/dataState';
import { getErrorCode, getErrorMessage } from '../utils/errors';
import { validateIntentBlock, type IntentBlock, type ValidationIssue } from '../engine/blockIntent';
import {
    buildTreatmentIntentReplayPayloadV1,
    hashTreatmentIntentReplayPayload,
    type PinnedTrainingIntentProfileSnapshot,
} from '../engine/blockIntentReplay';
import { TrainingIntentProfileService, trainingIntentProfileService } from './trainingIntentProfileService';

/** `IntentBlock.sourcePlanId`/`sourcePlanRevision` describe the plan an external import
 * would attach a block to (`external-plan@5`, separately scoped and unstarted). A block
 * authored directly by the athlete through this service has no such import behind it, so it
 * is deliberately self-sourced: `sourcePlanId` is the block's own id and `sourcePlanRevision`
 * is fixed at 1. This keeps the schema honest (it never claims a source plan that doesn't
 * exist) rather than fabricating a plausible-looking but meaningless external identity. */
export const MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION = 'manual-intent-block-v1';

export function manualIntentBlockSourceIdentity(blockId: string): { sourcePlanId: string; sourcePlanRevision: number } {
    return { sourcePlanId: blockId, sourcePlanRevision: 1 };
}

export interface IntentBlockHeader {
    userId: string;
    blockId: string;
    revision: number;
    contentHash: string;
    sourcePlanId: string;
    sourcePlanRevision: number;
    createdAt: string;
    updatedAt: string;
}

export interface IntentBlockRevisionDocument {
    userId: string;
    blockId: string;
    revision: number;
    block: IntentBlock;
    pinnedTrainingIntentProfile: PinnedTrainingIntentProfileSnapshot;
    sourceSchemaVersion: string;
    sourceRef: string | null;
    contentHash: string;
    createdAt: string;
}

export class IntentBlockValidationFailedError extends Error {
    readonly issues: readonly ValidationIssue[];
    constructor(issues: readonly ValidationIssue[]) {
        super(`IntentBlock validation failed: ${issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
        this.name = 'IntentBlockValidationFailedError';
        this.issues = issues;
    }
}

export class IntentBlockRevisionNotNewerError extends Error {
    constructor(blockId: string, attemptedRevision: number, storedRevision: number) {
        super(`IntentBlock '${blockId}' revision ${attemptedRevision} is not newer than the stored revision ${storedRevision}`);
        this.name = 'IntentBlockRevisionNotNewerError';
    }
}

/** Thrown by `IntentBlockService.save`/`create` when no `TrainingIntentProfile` exists yet.
 * The replay payload's provenance requires pinning real priorities/weekly commitment; there
 * is nothing honest to fabricate, so authoring is refused with a clear, actionable message
 * rather than silently pinning empty/default values that would misrepresent the athlete's
 * actual intent. */
export class MissingTrainingIntentProfileError extends Error {
    constructor() {
        super('A training intent profile must be configured before authoring an intent block.');
        this.name = 'MissingTrainingIntentProfileError';
    }
}

/** Exported for reuse by `progressionClaimService.ts`, which pins the same kind of
 * snapshot for a confirmation-driven revision rather than a manually-authored one.
 * Accepts an explicit profile-service instance (bound to the same `Firestore` as whatever
 * is calling this) rather than always reaching for the ungrounded default singleton --
 * without this, a caller constructed against an injected/emulator `db` would silently read
 * the profile from the production default instance instead. */
export async function resolvePinnedProfile(
    userId: string,
    profileService: TrainingIntentProfileService = trainingIntentProfileService,
): Promise<PinnedTrainingIntentProfileSnapshot> {
    const profileState = await profileService.getProfileState(userId);
    if (profileState.status !== 'AVAILABLE') throw new MissingTrainingIntentProfileError();
    const profile = profileState.data;
    return {
        priorities: [...profile.priorities],
        weeklyCommitment: { ...profile.weeklyCommitment },
        schemaVersion: profile.schemaVersion,
    };
}

export class IntentBlockService {
    private readonly db: Firestore;

    constructor(db: Firestore = getDb()) {
        this.db = db;
    }

    headerRef(userId: string, blockId: string): DocumentReference {
        return doc(this.db, 'users', userId, 'intent_blocks', blockId);
    }

    revisionRef(userId: string, blockId: string, revision: number): DocumentReference {
        return doc(this.db, 'users', userId, 'intent_blocks', blockId, 'revisions', String(revision));
    }

    async getHeaderState(userId: string, blockId: string): Promise<DataState<IntentBlockHeader>> {
        try {
            const snapshot = await getDoc(this.headerRef(userId, blockId));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const data = snapshot.data() as IntentBlockHeader;
            if (data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath: `users/${userId}/intent_blocks/${blockId}` }] };
            }
            if (data.blockId !== blockId) {
                return { status: 'INVALID', issues: [{ code: 'path-identity-mismatch', field: 'blockId', documentPath: `users/${userId}/intent_blocks/${blockId}` }] };
            }
            return { status: 'AVAILABLE', data, revision: data.contentHash };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read intent block header', retryable: getErrorCode(error) !== 'permission-denied', message: getErrorMessage(error) };
        }
    }

    /** Re-validates on read, per the same discipline as `ExternalPlanService.getRevisionState`:
     * a revision that no longer satisfies the contract is `INVALID`, never coerced. */
    async getRevisionState(userId: string, blockId: string, revision: number): Promise<DataState<IntentBlockRevisionDocument>> {
        const documentPath = `users/${userId}/intent_blocks/${blockId}/revisions/${revision}`;
        try {
            const snapshot = await getDoc(this.revisionRef(userId, blockId, revision));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const data = snapshot.data() as IntentBlockRevisionDocument;
            const validation = validateIntentBlock(data.block);
            if (!validation.valid) {
                return { status: 'INVALID', issues: validation.issues.map(issue => ({ code: issue.code, field: issue.path, documentPath })) };
            }
            if (data.userId !== userId || data.blockId !== blockId || data.revision !== revision || data.block.id !== blockId || data.block.revision !== revision) {
                return { status: 'INVALID', issues: [{ code: 'path-identity-mismatch', documentPath }] };
            }
            return { status: 'AVAILABLE', data, revision: String(revision) };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read intent block revision', retryable: getErrorCode(error) !== 'permission-denied', message: getErrorMessage(error) };
        }
    }

    async listBlockIds(userId: string): Promise<DataState<string[]>> {
        try {
            const snapshot = await getDocs(collection(this.db, 'users', userId, 'intent_blocks'));
            return { status: 'AVAILABLE', data: snapshot.docs.map(item => item.id).sort(), revision: null };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'list intent blocks', retryable: getErrorCode(error) !== 'permission-denied', message: getErrorMessage(error) };
        }
    }

    /**
     * Transaction-composable primitive. `existingHeader` must already have been read via
     * `transaction.get` in the *same* transaction (Firestore's reads-before-writes rule) --
     * this re-verifies the revision-not-newer precondition from that transactional read
     * rather than trusting an earlier plain `getDoc`, closing the TOCTOU gap
     * `ExternalPlanService.import` has. `contentHash`/`pinnedProfile` are computed by the
     * caller *before* entering the transaction: both are pure functions of already-known
     * data, so recomputing them on a Firestore-triggered retry is safe, but there is no
     * reason to pay for it inside the retriable callback either.
     */
    stageRevision(
        transaction: Transaction,
        userId: string,
        existingHeader: IntentBlockHeader | null,
        block: IntentBlock,
        pinnedProfile: PinnedTrainingIntentProfileSnapshot,
        sourceSchemaVersion: string,
        sourceRef: string | null,
        contentHash: string,
        now: string,
    ): IntentBlockHeader {
        if (existingHeader && block.revision <= existingHeader.revision) {
            throw new IntentBlockRevisionNotNewerError(block.id, block.revision, existingHeader.revision);
        }
        const header: IntentBlockHeader = {
            userId,
            blockId: block.id,
            revision: block.revision,
            contentHash,
            sourcePlanId: block.sourcePlanId,
            sourcePlanRevision: block.sourcePlanRevision,
            createdAt: existingHeader?.createdAt ?? now,
            updatedAt: now,
        };
        const revisionDoc: IntentBlockRevisionDocument = {
            userId,
            blockId: block.id,
            revision: block.revision,
            block,
            pinnedTrainingIntentProfile: pinnedProfile,
            sourceSchemaVersion,
            sourceRef,
            contentHash,
            createdAt: now,
        };
        transaction.set(this.headerRef(userId, block.id), header);
        transaction.set(this.revisionRef(userId, block.id, block.revision), revisionDoc);
        return header;
    }

    /**
     * Composing-owner path for normal (non-H5c) authoring: validates, pins the current
     * `TrainingIntentProfile`, computes the content hash, then opens its own transaction and
     * calls `stageRevision` once. Works for both a block's first revision and any later one --
     * driven entirely by `block.revision`, mirroring `ExternalPlanService.import`'s single
     * entry point for both cases. Throws (does not write anything) on validation failure,
     * a missing profile, or a non-newer revision.
     */
    async save(
        userId: string,
        block: IntentBlock,
        options: { sourceSchemaVersion?: string; sourceRef?: string | null } = {},
    ): Promise<IntentBlockHeader> {
        const validation = validateIntentBlock(block);
        if (!validation.valid) throw new IntentBlockValidationFailedError(validation.issues);

        const pinnedProfile = await resolvePinnedProfile(userId, new TrainingIntentProfileService(this.db));
        const sourceSchemaVersion = options.sourceSchemaVersion ?? MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION;
        const sourceRef = options.sourceRef ?? null;
        const payload = buildTreatmentIntentReplayPayloadV1(block, pinnedProfile, sourceSchemaVersion, sourceRef ?? undefined);
        const contentHash = await hashTreatmentIntentReplayPayload(payload);
        const now = new Date().toISOString();

        return runTransaction(this.db, async transaction => {
            const snapshot = await transaction.get(this.headerRef(userId, block.id));
            const existingHeader = snapshot.exists() ? (snapshot.data() as IntentBlockHeader) : null;
            return this.stageRevision(transaction, userId, existingHeader, block, pinnedProfile, sourceSchemaVersion, sourceRef, contentHash, now);
        });
    }
}

export const intentBlockService = new IntentBlockService();
