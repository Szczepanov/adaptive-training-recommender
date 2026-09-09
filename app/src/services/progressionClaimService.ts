/**
 * ADR-0037 D-AUTHORITY: the athlete-scoped singleton progression-claim transaction, Phase C
 * of `docs/plans/h5c-progression-claim-design.md` -- implemented as specified there, not
 * redesigned. Modeled directly on H4's `services/intradayLaunchClaim.ts`
 * (`claimIntradayMemberLaunch`/`releaseIntradayMemberClaim`): one addressable claim
 * document, a revision-gated transaction, compare-and-clear release, and a typed conflict
 * error distinguishing "someone else is mid-experiment" from "your proposal is stale."
 *
 * `confirmProgressionRevision` composes `intentBlockService.ts`'s transaction-composable
 * `stageRevision` primitive (Phase A) with the claim/activation writes, inside one
 * transaction it owns -- the design doc's "transaction-aware authoring boundary"
 * requirement.
 *
 * No query-then-create, ever: every read here is a direct document reference
 * (`progression_experiment_claim/current`, the deterministic activation key, the block's own
 * header/revision refs). Nothing queries a collection to establish uniqueness.
 */

import { doc, getDoc, runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import type { IntentBlock } from '../engine/blockIntent';
import type { ProposedProgressionChange } from '../engine/progressionReview';
import { buildTreatmentIntentReplayPayloadV1, hashTreatmentIntentReplayPayload } from '../engine/blockIntentReplay';
import {
    IntentBlockService,
    resolvePinnedProfile,
    MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION,
    type IntentBlockHeader,
    type IntentBlockRevisionDocument,
} from './intentBlockService';
import { TrainingIntentProfileService } from './trainingIntentProfileService';

export type ProgressionConfirmationCode =
    | 'active_progression_experiment_exists'
    | 'stale-source-revision'
    | 'activation-identity-mismatch'
    | 'block-not-found'
    | 'no-progression-contract'
    | 'unknown-target-objective';

/** Mirrors `intradayLaunchClaim.ts`'s `StaleDecisionError`: a machine `code` plus a
 * separate, deliberately distinct `athleteMessage` a UI can show as-is. */
export class ProgressionConfirmationError extends Error {
    readonly code: ProgressionConfirmationCode;
    readonly athleteMessage: string;

    constructor(code: ProgressionConfirmationCode, detail: string, athleteMessage: string) {
        super(detail);
        this.name = 'ProgressionConfirmationError';
        this.code = code;
        this.athleteMessage = athleteMessage;
    }
}

export interface ProgressionExperimentClaim {
    userId: string;
    state: 'held' | 'released';
    experimentId: string;
    blockId: string;
    proposalId: string;
    sourcePlanRevision: number;
    activationKey: string;
    activationRevisionId: string;
    acquiredAt: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface ProgressionSettingsSnapshot {
    variable: string;
    unit: string;
    value: number;
}

export interface ProgressionExperimentActivation {
    userId: string;
    activationKey: string;
    experimentId: string;
    blockId: string;
    proposalId: string;
    sourcePlanRevision: number;
    activationRevisionId: string;
    claimRevision: number;
    activatedAt: string;
    priorSettings: ProgressionSettingsSnapshot;
    acceptedSettings: ProgressionSettingsSnapshot;
}

export interface ConfirmProgressionRevisionResult {
    header: IntentBlockHeader;
    activation: ProgressionExperimentActivation;
    /** True only on the very first successful confirmation; false when this call resolved
     * an already-existing activation (idempotent replay). */
    created: boolean;
}

/** Deterministic, bounded, Firestore-safe encoding of `(blockId, proposalId)` -- reuses the
 * same SHA-256/hex recipe as `engine/externalPlanHash.ts`'s `computeContentHash` and
 * `blockIntentReplay.ts`'s `hashTreatmentIntentReplayPayload`, so this codebase has exactly
 * one hashing convention rather than a second ad hoc one. Never a random UUID or timestamp:
 * the same logical confirmation retried from another tab must resolve to the same reference. */
export async function deterministicActivationKey(blockId: string, proposalId: string): Promise<string> {
    const canonical = JSON.stringify({ blockId, proposalId });
    const bytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function claimRef(db: Firestore, userId: string) {
    return doc(db, 'users', userId, 'progression_experiment_claim', 'current');
}

function activationRef(db: Firestore, userId: string, activationKey: string) {
    return doc(db, 'users', userId, 'progression_experiment_activations', activationKey);
}

function settingsSnapshot(variable: string, unit: string, value: number): ProgressionSettingsSnapshot {
    return { variable, unit, value };
}

/** Applies one proposed change onto the block's current progression contract, producing
 * the next forward-only revision. Never mutates `current` -- `stageRevision` (Phase A)
 * writes the result as a brand new immutable revision document. */
function nextBlockWithAppliedChange(current: IntentBlock, change: ProposedProgressionChange): IntentBlock {
    if (!current.progressionContract) {
        throw new ProgressionConfirmationError(
            'no-progression-contract',
            `IntentBlock '${current.id}' has no progressionContract to confirm a revision against`,
            'This block no longer has an active progression target.',
        );
    }
    return {
        ...current,
        revision: current.revision + 1,
        progressionContract: { ...current.progressionContract, currentValue: change.proposedValue },
    };
}

/**
 * Confirms an athlete-reviewed `ProposedProgressionChange` (H5b's `evaluateProgressionReview`
 * output) as a new bounded `IntentBlock` revision, atomically with acquiring the
 * one-experiment-per-athlete singleton claim. `expectedSourcePlanRevision` must be the block
 * revision the caller observed when it generated `proposedChange` (i.e. when the review ran),
 * not a value re-derived inside this function -- staleness is judged against exactly that.
 */
export async function confirmProgressionRevision(
    userId: string,
    blockId: string,
    proposalId: string,
    expectedSourcePlanRevision: number,
    proposedChange: ProposedProgressionChange,
    db: Firestore = getDb(),
): Promise<ConfirmProgressionRevisionResult> {
    const activationKey = await deterministicActivationKey(blockId, proposalId);
    const experimentId = activationKey;
    const intentBlocks = new IntentBlockService(db);
    const pinnedProfile = await resolvePinnedProfile(userId, new TrainingIntentProfileService(db));
    const now = new Date().toISOString();

    let created = true;

    const result = await runTransaction(db, async (transaction: Transaction) => {
        // 1. Reads before writes, in the design doc's own order.
        const activationSnap = await transaction.get(activationRef(db, userId, activationKey));
        const claimSnap = await transaction.get(claimRef(db, userId));
        const headerRef = intentBlocks.headerRef(userId, blockId);
        const headerSnap = await transaction.get(headerRef);

        if (activationSnap.exists()) {
            const existing = activationSnap.data() as ProgressionExperimentActivation;
            if (existing.blockId !== blockId || existing.proposalId !== proposalId) {
                throw new ProgressionConfirmationError(
                    'activation-identity-mismatch',
                    `Activation '${activationKey}' identity (${existing.blockId}/${existing.proposalId}) does not match the requested confirmation (${blockId}/${proposalId})`,
                    'Something unexpected happened confirming this change. Please refresh and try again.',
                );
            }
            // Idempotent replay: no second claim/plan write. Read the header as it stands
            // now purely to return a fresh IntentBlockHeader alongside the existing activation.
            if (!headerSnap.exists()) {
                throw new ProgressionConfirmationError(
                    'block-not-found',
                    `IntentBlock '${blockId}' header missing after an activation was already recorded for it`,
                    'This progression block could not be found.',
                );
            }
            created = false;
            return { header: headerSnap.data() as IntentBlockHeader, activation: existing };
        }

        if (!headerSnap.exists()) {
            throw new ProgressionConfirmationError(
                'block-not-found',
                `IntentBlock '${blockId}' does not exist`,
                'This progression block could not be found.',
            );
        }
        const header = headerSnap.data() as IntentBlockHeader;

        const claim = claimSnap.exists() ? (claimSnap.data() as ProgressionExperimentClaim) : null;
        if (claim && claim.state === 'held' && !(claim.blockId === blockId && claim.proposalId === proposalId)) {
            throw new ProgressionConfirmationError(
                'active_progression_experiment_exists',
                `Claim already held by block '${claim.blockId}' proposal '${claim.proposalId}'`,
                'You already have an active progression experiment running. Finish or cancel it before starting another.',
            );
        }

        if (header.revision !== expectedSourcePlanRevision) {
            throw new ProgressionConfirmationError(
                'stale-source-revision',
                `IntentBlock '${blockId}' is at revision ${header.revision}, expected ${expectedSourcePlanRevision}`,
                'This progression block has changed since you reviewed it. Please review it again before confirming.',
            );
        }

        const currentRevisionSnap = await transaction.get(intentBlocks.revisionRef(userId, blockId, header.revision));
        if (!currentRevisionSnap.exists()) {
            throw new ProgressionConfirmationError(
                'block-not-found',
                `IntentBlock '${blockId}' revision ${header.revision} document is missing`,
                'This progression block could not be found.',
            );
        }
        const currentRevisionDoc = currentRevisionSnap.data() as IntentBlockRevisionDocument;
        const currentBlock = currentRevisionDoc.block;
        const targetObjective = currentBlock.objectives.find(objective => objective.id === proposedChange.targetBinding.objectiveId);
        if (!targetObjective || !currentBlock.progressionContract) {
            throw new ProgressionConfirmationError(
                'unknown-target-objective',
                `IntentBlock '${blockId}' has no objective/progressionContract matching proposedChange.targetBinding`,
                'This proposed change no longer matches the block. Please review it again.',
            );
        }

        const nextBlock = nextBlockWithAppliedChange(currentBlock, proposedChange);
        const payload = buildTreatmentIntentReplayPayloadV1(nextBlock, pinnedProfile, MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION, undefined);
        const contentHash = await hashTreatmentIntentReplayPayload(payload);

        const newHeader = intentBlocks.stageRevision(
            transaction, userId, header, nextBlock, pinnedProfile,
            MANUAL_INTENT_BLOCK_SOURCE_SCHEMA_VERSION, null, contentHash, now,
        );

        const claimRevision = (claim?.revision ?? 0) + 1;
        const nextClaim: ProgressionExperimentClaim = {
            userId, state: 'held', experimentId, blockId, proposalId,
            sourcePlanRevision: expectedSourcePlanRevision,
            activationKey, activationRevisionId: String(nextBlock.revision),
            acquiredAt: now, revision: claimRevision,
            createdAt: claim?.createdAt ?? now, updatedAt: now,
        };
        transaction.set(claimRef(db, userId), nextClaim);

        const activation: ProgressionExperimentActivation = {
            userId, activationKey, experimentId, blockId, proposalId,
            sourcePlanRevision: expectedSourcePlanRevision,
            activationRevisionId: String(nextBlock.revision),
            claimRevision,
            activatedAt: now,
            priorSettings: settingsSnapshot(proposedChange.variable, proposedChange.unit, proposedChange.previousValue),
            acceptedSettings: settingsSnapshot(proposedChange.variable, proposedChange.unit, proposedChange.proposedValue),
        };
        transaction.set(activationRef(db, userId, activationKey), activation);

        return { header: newHeader, activation };
    });

    return { ...result, created };
}

/**
 * Compare-and-clear release, modeled on `releaseIntradayMemberClaim`: only clears the claim
 * when the stored `experimentId` still matches the caller's, so a delayed cleanup for an old
 * experiment can never clear a newer one's claim. The immutable activation record is never
 * deleted or mutated -- it remains the historical/idempotency evidence for that confirmation.
 */
export async function releaseProgressionClaim(
    userId: string,
    experimentId: string,
    db: Firestore = getDb(),
): Promise<{ released: boolean; reason?: string }> {
    try {
        return await runTransaction(db, async (transaction: Transaction) => {
            const snap = await transaction.get(claimRef(db, userId));
            if (!snap.exists()) return { released: false, reason: 'no claim exists' };
            const claim = snap.data() as ProgressionExperimentClaim;
            if (claim.state !== 'held' || claim.experimentId !== experimentId) {
                return { released: false, reason: `claim is '${claim.state}' owned by '${claim.experimentId}', not '${experimentId}'` };
            }
            const released: ProgressionExperimentClaim = { ...claim, state: 'released', revision: claim.revision + 1, updatedAt: new Date().toISOString() };
            transaction.set(claimRef(db, userId), released);
            return { released: true };
        });
    } catch (err) {
        return { released: false, reason: (err as Error).message };
    }
}

/** Read-only convenience for a UI to check whether the athlete already has a held claim
 * before offering another confirmation. Never used to establish claim uniqueness itself --
 * that guarantee comes only from the transaction above. */
export async function getCurrentProgressionClaim(userId: string, db: Firestore = getDb()): Promise<ProgressionExperimentClaim | null> {
    const snap = await getDoc(claimRef(db, userId));
    return snap.exists() ? (snap.data() as ProgressionExperimentClaim) : null;
}
