/**
 * ADR-0037 D-AUTHORITY: athlete-scoped singleton progression confirmation.
 *
 * Confirmation is intentionally stricter than the UI. The caller supplies a proposal, but
 * this service is the mutation boundary: it must prove that the proposal still describes
 * exactly one bounded step of the current contract before it authors a new revision.
 */

import { doc, getDoc, runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { getDb } from '../firebase';
import { isValidLocalDateString, validateIntentBlock, type IntentBlock } from '../engine/blockIntent';
import type { ProposedProgressionChange } from '../engine/progressionReview';
import { buildTreatmentIntentReplayPayloadV1, hashTreatmentIntentReplayPayload } from '../engine/blockIntentReplay';
import { addDaysToLocalDateString } from '../utils/localDate';
import { parseTrainingSettings } from './trainingSettingsService';
import { deriveProgressionProposalId } from './progressionProposalIdentity';
import {
    IntentBlockService,
    type IntentBlockHeader,
    type IntentBlockRevisionDocument,
} from './intentBlockService';

export type ProgressionConfirmationCode =
    | 'active_progression_experiment_exists'
    | 'stale-source-revision'
    | 'activation-identity-mismatch'
    | 'block-not-found'
    | 'no-progression-contract'
    | 'unknown-target-objective'
    | 'invalid-proposed-change'
    | 'review-not-due'
    | 'active-constraint-conflict';

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
    /** Current header at the time this call resolves. On an idempotent replay it may be newer
     * than the immutable activation revision; use activation.activationRevisionId when
     * presenting the revision created by this proposal. */
    header: IntentBlockHeader;
    activation: ProgressionExperimentActivation;
    created: boolean;
}

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

function trainingSettingsRef(db: Firestore, userId: string) {
    return doc(db, 'users', userId, 'trainingSettings', 'profile');
}

function settingsSnapshot(variable: string, unit: string, value: number): ProgressionSettingsSnapshot {
    return { variable, unit, value };
}

function sameTargetBinding(
    left: ProposedProgressionChange['targetBinding'],
    right: NonNullable<IntentBlock['progressionContract']>['targetBinding'],
): boolean {
    return left.objectiveId === right.objectiveId
        && left.sessionId === right.sessionId
        && left.stepId === right.stepId;
}

function invalidChange(detail: string): never {
    throw new ProgressionConfirmationError(
        'invalid-proposed-change',
        detail,
        'This proposed change no longer matches the current progression contract. Please run the review again.',
    );
}

function assertReviewDate(current: IntentBlock, reviewAsOfDate: string): void {
    if (!isValidLocalDateString(reviewAsOfDate)
        || reviewAsOfDate < current.dateRange.startDate
        || reviewAsOfDate > current.dateRange.endDate) {
        invalidChange(`Review date '${reviewAsOfDate}' is outside block '${current.id}'`);
    }
    if (reviewAsOfDate < current.reviewSchedule.nextReviewDate) {
        throw new ProgressionConfirmationError(
            'review-not-due',
            `Review date '${reviewAsOfDate}' precedes nextReviewDate '${current.reviewSchedule.nextReviewDate}'`,
            `This block is not due for review until ${current.reviewSchedule.nextReviewDate}.`,
        );
    }
}

/** Revalidates the proposal at the mutation boundary rather than trusting UI-produced data.
 * Only the one bounded advance or configured bounded reduction can be confirmed. */
function assertProposedChangeMatchesCurrentContract(
    current: IntentBlock,
    change: ProposedProgressionChange,
): void {
    const contract = current.progressionContract;
    if (!contract) {
        throw new ProgressionConfirmationError(
            'no-progression-contract',
            `IntentBlock '${current.id}' has no progressionContract to confirm a revision against`,
            'This block no longer has an active progression target.',
        );
    }

    if (!current.objectives.some(objective => objective.id === contract.targetBinding.objectiveId)) {
        throw new ProgressionConfirmationError(
            'unknown-target-objective',
            `IntentBlock '${current.id}' progressionContract targets missing objective '${contract.targetBinding.objectiveId}'`,
            'This proposed change no longer matches the block. Please review it again.',
        );
    }

    if (!sameTargetBinding(change.targetBinding, contract.targetBinding)) {
        invalidChange(`Proposal target binding does not equal the current contract target binding for '${current.id}'`);
    }
    if (change.variable !== contract.variable || change.unit !== contract.unit) {
        invalidChange(`Proposal variable/unit '${change.variable} ${change.unit}' does not equal '${contract.variable} ${contract.unit}'`);
    }
    if (![change.previousValue, change.proposedValue, change.derivedDoseEffects.delta].every(Number.isFinite)) {
        invalidChange('Proposal contains a non-finite numeric value');
    }
    if (change.previousValue !== contract.currentValue) {
        invalidChange(`Proposal previousValue ${change.previousValue} does not equal currentValue ${contract.currentValue}`);
    }
    if (change.derivedDoseEffects.delta !== change.proposedValue - change.previousValue) {
        invalidChange('Proposal derived dose delta does not equal proposedValue - previousValue');
    }

    const allowedValues = new Set<number>();
    if (contract.currentValue < contract.permittedRange.max) {
        allowedValues.add(Math.min(contract.permittedRange.max, contract.currentValue + contract.increment));
    }
    if (contract.reductionAlternative && contract.currentValue > contract.permittedRange.min) {
        allowedValues.add(Math.max(
            contract.permittedRange.min,
            contract.currentValue - contract.reductionAlternative.decrement,
        ));
    }
    if (!allowedValues.has(change.proposedValue)) {
        invalidChange(
            `Proposal value ${change.proposedValue} is not one bounded step from currentValue ${contract.currentValue}`,
        );
    }
}

function assertNoNewBlockingRestriction(
    userId: string,
    rawSettings: unknown,
    reviewAsOfDate: string,
    proposedChange: ProposedProgressionChange,
): void {
    // A reduction is a tightening action and must remain available even when a new
    // restriction appears. Only an increase needs this additional fail-closed gate.
    if (proposedChange.proposedValue <= proposedChange.previousValue || rawSettings === undefined) return;

    const settings = parseTrainingSettings(rawSettings, userId);
    if (!settings) {
        throw new ProgressionConfirmationError(
            'active-constraint-conflict',
            'Current training settings are invalid and cannot be safely rechecked at confirmation',
            'Your current training restrictions could not be verified. Review Training Setup before confirming an increase.',
        );
    }
    const blocking = (settings.injuries ?? []).some(injury =>
        (injury.severity === 'limit' || injury.severity === 'exclude')
        && (!injury.reviewBy || injury.reviewBy >= reviewAsOfDate),
    );
    if (blocking) {
        throw new ProgressionConfirmationError(
            'active-constraint-conflict',
            `A current limit/exclude injury restriction is active as of ${reviewAsOfDate}`,
            'Your training restrictions changed since this proposal was reviewed. Run the progression review again before increasing the target.',
        );
    }
}

/** Advance cadence from the evidence-as-of date that produced the proposal, not from a stale
 * historical due date. This avoids a late-confirmed revision becoming immediately due again. */
function nextReviewDate(current: IntentBlock, reviewAsOfDate: string): string {
    const candidate = addDaysToLocalDateString(reviewAsOfDate, current.reviewSchedule.reviewCadenceDays);
    return candidate > current.dateRange.endDate ? current.dateRange.endDate : candidate;
}

function nextBlockWithAppliedChange(
    current: IntentBlock,
    change: ProposedProgressionChange,
    reviewAsOfDate: string,
): IntentBlock {
    assertReviewDate(current, reviewAsOfDate);
    assertProposedChangeMatchesCurrentContract(current, change);
    const contract = current.progressionContract!;
    const next: IntentBlock = {
        ...current,
        revision: current.revision + 1,
        reviewSchedule: {
            ...current.reviewSchedule,
            nextReviewDate: nextReviewDate(current, reviewAsOfDate),
        },
        progressionContract: { ...contract, currentValue: change.proposedValue },
    };

    const validation = validateIntentBlock(next);
    if (!validation.valid) {
        invalidChange(`Authored next revision is invalid: ${validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
    }
    return next;
}

function existingActivationMatchesRequest(
    existing: ProgressionExperimentActivation,
    blockId: string,
    proposalId: string,
    expectedSourcePlanRevision: number,
    proposedChange: ProposedProgressionChange,
): boolean {
    return existing.blockId === blockId
        && existing.proposalId === proposalId
        && existing.sourcePlanRevision === expectedSourcePlanRevision
        && existing.priorSettings.variable === proposedChange.variable
        && existing.priorSettings.unit === proposedChange.unit
        && existing.priorSettings.value === proposedChange.previousValue
        && existing.acceptedSettings.variable === proposedChange.variable
        && existing.acceptedSettings.unit === proposedChange.unit
        && existing.acceptedSettings.value === proposedChange.proposedValue;
}

/**
 * Confirms an athlete-reviewed proposal as one new bounded IntentBlock revision, atomically
 * with acquiring the athlete-wide singleton claim and writing immutable activation evidence.
 * `reviewAsOfDate` is the date of the review that generated the proposal and is revalidated
 * against the transactionally-read block schedule.
 */
export async function confirmProgressionRevision(
    userId: string,
    blockId: string,
    proposalId: string,
    expectedSourcePlanRevision: number,
    proposedChange: ProposedProgressionChange,
    reviewAsOfDate: string,
    db: Firestore = getDb(),
): Promise<ConfirmProgressionRevisionResult> {
    const expectedProposalId = deriveProgressionProposalId(
        expectedSourcePlanRevision,
        reviewAsOfDate,
        proposedChange,
    );
    if (proposalId !== expectedProposalId) {
        invalidChange(`Proposal id '${proposalId}' does not equal canonical id '${expectedProposalId}'`);
    }

    const activationKey = await deterministicActivationKey(blockId, proposalId);
    const experimentId = activationKey;
    const intentBlocks = new IntentBlockService(db);
    const now = new Date().toISOString();

    let created = true;

    const result = await runTransaction(db, async (transaction: Transaction) => {
        // All transactional reads occur before any write. The current settings read is part
        // of D-AUTHORITY's confirmation-time constraint recheck, not recommendation-time I/O.
        const activationSnap = await transaction.get(activationRef(db, userId, activationKey));
        const claimSnap = await transaction.get(claimRef(db, userId));
        const headerRef = intentBlocks.headerRef(userId, blockId);
        const headerSnap = await transaction.get(headerRef);

        if (activationSnap.exists()) {
            const existing = activationSnap.data() as ProgressionExperimentActivation;
            if (!existingActivationMatchesRequest(
                existing,
                blockId,
                proposalId,
                expectedSourcePlanRevision,
                proposedChange,
            )) {
                throw new ProgressionConfirmationError(
                    'activation-identity-mismatch',
                    `Activation '${activationKey}' does not match the requested confirmation payload`,
                    'This confirmation conflicts with an earlier activation. Please refresh before continuing.',
                );
            }
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
        const currentSettingsSnap = await transaction.get(trainingSettingsRef(db, userId));
        if (!currentRevisionSnap.exists()) {
            throw new ProgressionConfirmationError(
                'block-not-found',
                `IntentBlock '${blockId}' revision ${header.revision} document is missing`,
                'This progression block could not be found.',
            );
        }
        const currentRevisionDoc = currentRevisionSnap.data() as IntentBlockRevisionDocument;
        const currentBlock = currentRevisionDoc.block;

        assertReviewDate(currentBlock, reviewAsOfDate);
        assertProposedChangeMatchesCurrentContract(currentBlock, proposedChange);
        assertNoNewBlockingRestriction(
            userId,
            currentSettingsSnap.exists() ? currentSettingsSnap.data() : undefined,
            reviewAsOfDate,
            proposedChange,
        );
        const nextBlock = nextBlockWithAppliedChange(currentBlock, proposedChange, reviewAsOfDate);

        // A progression revision changes only the progression contract. Reuse the source
        // revision's frozen profile + source provenance rather than silently re-pinning a
        // newer live TrainingIntentProfile during confirmation.
        const pinnedProfile = {
            ...currentRevisionDoc.pinnedTrainingIntentProfile,
            priorities: [...currentRevisionDoc.pinnedTrainingIntentProfile.priorities],
            weeklyCommitment: { ...currentRevisionDoc.pinnedTrainingIntentProfile.weeklyCommitment },
        };
        const payload = buildTreatmentIntentReplayPayloadV1(
            nextBlock,
            { ...pinnedProfile, priorities: [...pinnedProfile.priorities] },
            currentRevisionDoc.sourceSchemaVersion,
            currentRevisionDoc.sourceRef ?? undefined,
        );
        const contentHash = await hashTreatmentIntentReplayPayload(payload);

        const newHeader = intentBlocks.stageRevision(
            transaction,
            userId,
            header,
            nextBlock,
            pinnedProfile,
            currentRevisionDoc.sourceSchemaVersion,
            currentRevisionDoc.sourceRef,
            contentHash,
            now,
        );

        const claimRevision = (claim?.revision ?? 0) + 1;
        const nextClaim: ProgressionExperimentClaim = {
            userId,
            state: 'held',
            experimentId,
            blockId,
            proposalId,
            sourcePlanRevision: expectedSourcePlanRevision,
            activationKey,
            activationRevisionId: String(nextBlock.revision),
            acquiredAt: now,
            revision: claimRevision,
            createdAt: claim?.createdAt ?? now,
            updatedAt: now,
        };
        transaction.set(claimRef(db, userId), nextClaim);

        const activation: ProgressionExperimentActivation = {
            userId,
            activationKey,
            experimentId,
            blockId,
            proposalId,
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
            const released: ProgressionExperimentClaim = {
                ...claim,
                state: 'released',
                revision: claim.revision + 1,
                updatedAt: new Date().toISOString(),
            };
            transaction.set(claimRef(db, userId), released);
            return { released: true };
        });
    } catch (err) {
        return { released: false, reason: (err as Error).message };
    }
}

export async function getCurrentProgressionClaim(
    userId: string,
    db: Firestore = getDb(),
): Promise<ProgressionExperimentClaim | null> {
    const snap = await getDoc(claimRef(db, userId));
    return snap.exists() ? (snap.data() as ProgressionExperimentClaim) : null;
}
