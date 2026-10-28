import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, runTransaction, startAfter, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';
import type {
    ExternalPlanHeader,
    ExternalPlanPlacement,
    ExternalPlanRevisionActivation,
    ExternalTrainingPlan,
} from '../engine/models';
import type { DataIssue, DataState } from '../engine/dataState';
import { validateExternalPlanPlacement } from '../engine/validation';
import { computeContentHash } from '../engine/externalPlanHash';
import { getErrorCode, getErrorMessage } from '../utils/errors';
import { type ExternalTrainingPlanV2 } from '../sessions/externalPlanV2';
import { type ExternalTrainingPlanV3 } from '../sessions/externalPlanV3';
import { type ExternalTrainingPlanV4 } from '../sessions/externalPlanV4';
import { EXTERNAL_PLAN_SCHEMA_V5, type ExternalTrainingPlanV5 } from '../sessions/externalPlanV5';
import { EXTERNAL_PLAN_SCHEMA_V6, type ExternalTrainingPlanV6 } from '../sessions/externalPlanV6';
import { validateAnyExternalTrainingPlan, validateExternalPlanImport } from '../sessions/externalPlanValidation';
import { isValidDate } from '../engine/validation';
import { getLocalDateString } from '../utils/localDate';
import {
    PLACEMENT_HISTORY_TRUNCATED_OPERATION,
    PLACEMENT_PREVIOUS_STATE_REASONS,
    type PlacementEvent,
    type PlacementPreviousStateReason,
} from '../ledger/placementHistory';

/**
 * Placement history is read per revision in document-id-ordered pages, the paging pattern of
 * `competitionOutcomeService.listOutcomesWithDiagnostics`. Each user save appends one event, so
 * the hard bound is far above a realistic revision (two moves a day for over two years). One
 * extra sentinel document detects truncation, reported as UNAVAILABLE with
 * `PLACEMENT_HISTORY_TRUNCATED_OPERATION`, never as complete history
 * (docs/architecture/ledger-export-contract.md).
 */
export const PLACEMENT_HISTORY_PAGE_SIZE = 200;
export const PLACEMENT_HISTORY_MAX_SCANNED_EVENTS = 2000;
export { PLACEMENT_HISTORY_TRUNCATED_OPERATION };

interface PreviousOverlay {
    overlay: ExternalPlanPlacement | null;
    invalid?: PlacementPreviousStateReason;
    /** Canonical ISO `updatedAt` read from a corrupt overlay, used only to order the repair event. */
    invalidUpdatedAt?: string;
}

/**
 * A stored overlay that names another owner is a security signal, never repairable corruption.
 * The rule applies whether or not the rest of the document parses: a string `userId` that is
 * not the caller's. `getPlacementState` reports it as `owner-mismatch`; `savePlacement` refuses it.
 */
export function placementClaimsOtherOwner(raw: unknown, userId: string): boolean {
    const claimedOwner = raw && typeof raw === 'object' ? (raw as { userId?: unknown }).userId : undefined;
    return typeof claimedOwner === 'string' && claimedOwner !== userId;
}

const canonicalInstant = (value: unknown): string | undefined => typeof value === 'string'
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : undefined;

/**
 * Classifies the overlay a save is about to replace. Corruption is recoverable and recorded;
 * a document that claims another owner is a security signal and is never overwritten.
 */
function readPreviousOverlay(source: 'current' | 'legacy' | null, raw: unknown, userId: string,
    planId: string, revision: number): PreviousOverlay {
    if (!source) return { overlay: null };
    if (placementClaimsOtherOwner(raw, userId)) {
        throw new Error('Previous placement overlay belongs to another owner');
    }
    const invalid = (reason: PlacementPreviousStateReason): PreviousOverlay => {
        const updatedAt = raw && typeof raw === 'object' ? canonicalInstant((raw as { updatedAt?: unknown }).updatedAt) : undefined;
        return { overlay: null, invalid: reason, ...(updatedAt ? { invalidUpdatedAt: updatedAt } : {}) };
    };
    const parsed = validateExternalPlanPlacement(raw);
    if (!parsed.isValid || !parsed.data) return invalid(`${source}-schema-invalid`);
    if (parsed.data.planId !== planId) return invalid(`${source}-identity-mismatch`);
    // A legacy overlay of another revision is simply not applicable; a revision-scoped one is corrupt.
    if (parsed.data.revision !== revision) return source === 'current' ? invalid('current-identity-mismatch') : { overlay: null };
    return { overlay: parsed.data };
}

/** Re-exported so existing callers keep one import site. The implementation lives in
 * `engine/externalPlanHash.ts` because `replay.ts` verifies against it and must not pull
 * a Firestore-bound module into the audit path. */
export { computeContentHash } from '../engine/externalPlanHash';

export interface ImportResult {
    header: ExternalPlanHeader;
    plan: ExternalTrainingPlan | ExternalTrainingPlanV2 | ExternalTrainingPlanV3 | ExternalTrainingPlanV4 | ExternalTrainingPlanV5 | ExternalTrainingPlanV6;
}

/**
 * `external-plan@5` materializes intent blocks into a separate live collection. Until the
 * IntentBlock domain gains an explicit retirement/tombstone operation, omission from a newer
 * source-plan revision cannot safely mean deletion: the prior materialized block would remain
 * independently selectable. Preserve every previously-authored block id across source-plan
 * revisions so supersession is always explicit through another revision of that same block.
 */
function validateIntentBlockSupersession(
    previous: { planId: string; intentBlocks?: { id: string }[] },
    next: ImportResult['plan'],
    userId: string,
): DataIssue[] {
    const previousIds = new Set((previous.intentBlocks ?? []).map(block => block.id));
    if (previousIds.size === 0) return [];

    const documentPath = `users/${userId}/external_plans/${previous.planId}`;
    if (next.schema !== EXTERNAL_PLAN_SCHEMA_V5 && next.schema !== EXTERNAL_PLAN_SCHEMA_V6) {
        return [{
            code: 'intent-block-retirement-unsupported',
            field: 'schema',
            documentPath,
        }];
    }

    const nextIds = new Set((next.intentBlocks ?? []).map(block => block.id));
    return [...previousIds]
        .filter(blockId => !nextIds.has(blockId))
        .map(blockId => ({
            code: 'intent-block-retirement-unsupported',
            field: `intentBlocks.${blockId}`,
            documentPath,
        }));
}

function revisionNotNewer(userId: string, planId: string): DataState<ImportResult> {
    return {
        status: 'INVALID',
        issues: [{ code: 'revision-not-newer', field: 'revision', documentPath: `users/${userId}/external_plans/${planId}` }],
    };
}

/** User-scoped persistence for externally-authored plans. A stored revision is immutable:
 * this service only ever creates one, never updates or deletes it. Rescheduling belongs to
 * the placement overlay, and an AI adjustment is a new revision. */
export class ExternalPlanService {
    private headerRef(userId: string, planId: string) {
        return doc(getDb(), 'users', userId, 'external_plans', planId);
    }

    private revisionRef(userId: string, planId: string, revision: number) {
        return doc(getDb(), 'users', userId, 'external_plans', planId, 'revisions', String(revision));
    }

    private placementRef(userId: string, planId: string, revision: number) {
        return doc(getDb(), 'users', userId, 'external_plans', planId, 'revisions', String(revision), 'placement', 'current');
    }

    private legacyPlacementRef(userId: string, planId: string) {
        return doc(getDb(), 'users', userId, 'external_plans', planId, 'placement', 'current');
    }

    private activationRef(userId: string, planId: string, revision: number) {
        return doc(getDb(), 'users', userId, 'external_plans', planId, 'activations', String(revision));
    }

    /**
     * Validates and stores one revision. Rejects before writing anything: a plan that is
     * only partly understood must not be half-stored, because a silently dropped session
     * is a session the athlete believes was imported.
     *
     * Re-importing byte-identical immutable revision content is an idempotent success. This
     * matters for `external-plan@5`: plan storage and intent-block activation are deliberately
     * separate, so a transient activation failure can be retried without inventing a new plan
     * revision. Same-revision content that differs from the stored immutable bytes still fails.
     *
     * `supersededFrom` records the date this revision takes effect. Days already
     * adjudicated keep their persisted recommendations and audits regardless.
     */
    async import(userId: string, raw: unknown, effectiveFromOverride: string | null = null): Promise<DataState<ImportResult>> {
        const parsed = validateExternalPlanImport(raw);
        if (!parsed.isValid || !parsed.data) {
            const issues: DataIssue[] = parsed.errors.map(error => ({
                code: 'schema-validation-failed',
                field: error.field,
                documentPath: `users/${userId}/external_plans/${typeof (raw as { planId?: unknown })?.planId === 'string' ? (raw as { planId: string }).planId : 'unknown'}`,
            }));
            return { status: 'INVALID', issues };
        }

        const plan = parsed.data;
        const effectiveFrom = effectiveFromOverride ?? plan.startDate;
        if (!isValidDate(effectiveFrom)) {
            return { status: 'INVALID', issues: [{ code: 'invalid-effective-date', field: 'effectiveFrom', documentPath: `users/${userId}/external_plans/${plan.planId}` }] };
        }
        try {
            const now = new Date().toISOString();
            const contentHash = await computeContentHash(plan);
            return await runTransaction(getDb(), async transaction => {
                const headerRef = this.headerRef(userId, plan.planId);
                const revisionRef = this.revisionRef(userId, plan.planId, plan.revision);
                const activationRef = this.activationRef(userId, plan.planId, plan.revision);
                const [existing, sameRevision, sameActivation] = await Promise.all([
                    transaction.get(headerRef),
                    transaction.get(revisionRef),
                    transaction.get(activationRef),
                ]);
                const existingHeader = existing.exists() ? existing.data() as ExternalPlanHeader : null;
                let predecessorActivationToWrite: ExternalPlanRevisionActivation | null = null;
                if (existingHeader) {
                const storedRevision = existingHeader.revision;
                if (typeof storedRevision === 'number' && plan.revision < storedRevision) {
                    return revisionNotNewer(userId, plan.planId);
                }

                if (typeof storedRevision === 'number') {
                    // Intent blocks become independent persisted artifacts after v5 activation.
                    // A safe supersession or idempotent-retry decision therefore requires the
                    // immutable predecessor itself, not just the mutable header: if those bytes
                    // are missing, malformed, or stored under the wrong identity we cannot prove
                    // what live intent blocks or immutable content the header actually represents.
                    const previousDocumentPath = `users/${userId}/external_plans/${plan.planId}/revisions/${storedRevision}`;
                    const previousSnapshot = plan.revision === storedRevision ? sameRevision : await transaction.get(this.revisionRef(userId, plan.planId, storedRevision));
                    if (!previousSnapshot.exists()) {
                        return {
                            status: 'INVALID',
                            issues: [{
                                code: 'superseded-revision-missing',
                                field: 'revision',
                                documentPath: previousDocumentPath,
                            }],
                        };
                    }

                    const previousParsed = validateAnyExternalTrainingPlan(previousSnapshot.data());
                    if (
                        !previousParsed.isValid
                        || !previousParsed.data
                        || previousParsed.data.planId !== plan.planId
                        || previousParsed.data.revision !== storedRevision
                    ) {
                        return {
                            status: 'INVALID',
                            issues: [{
                                code: 'superseded-revision-invalid',
                                field: 'revision',
                                documentPath: previousDocumentPath,
                            }],
                        };
                    }

                    if (plan.revision === storedRevision) {
                        const storedHash = await computeContentHash(previousParsed.data);
                        if (storedHash !== contentHash || existingHeader.contentHash !== storedHash) {
                            return {
                                status: 'INVALID',
                                issues: [{
                                    code: 'immutable-revision-conflict',
                                    field: 'revision',
                                    documentPath: previousDocumentPath,
                                }],
                            };
                        }
                        const persistedActivation = sameActivation.exists()
                            ? sameActivation.data() as ExternalPlanRevisionActivation
                            : null;
                        if (persistedActivation && (
                            persistedActivation.effectiveFrom !== effectiveFrom
                            || persistedActivation.contentHash !== storedHash
                            || persistedActivation.userId !== userId
                            || persistedActivation.planId !== plan.planId
                        )) {
                            return { status: 'INVALID', issues: [{ code: 'immutable-activation-conflict', field: 'effectiveFrom', documentPath: `users/${userId}/external_plans/${plan.planId}/activations/${plan.revision}` }] };
                        }
                        if (!persistedActivation) {
                            const legacyDate = existingHeader.supersededFrom ?? previousParsed.data.startDate;
                            if (existingHeader.revision !== plan.revision || legacyDate !== effectiveFrom) {
                                return { status: 'INVALID', issues: [{ code: 'activation-history-unavailable', field: 'effectiveFrom', documentPath: `users/${userId}/external_plans/${plan.planId}/activations/${plan.revision}` }] };
                            }
                            transaction.set(activationRef, {
                                userId, planId: plan.planId, revision: plan.revision, contentHash: storedHash,
                                effectiveFrom, activatedAt: existingHeader.importedAt,
                            } as unknown as DocumentData);
                        }
                        return { status: 'AVAILABLE', data: { header: existingHeader, plan }, revision: storedHash };
                    }

                    const predecessorActivation = await transaction.get(this.activationRef(userId, plan.planId, storedRevision));
                    const predecessorHash = await computeContentHash(previousParsed.data);
                    if (predecessorHash !== existingHeader.contentHash) {
                        return { status: 'INVALID', issues: [{ code: 'superseded-revision-hash-mismatch', field: 'revision', documentPath: previousDocumentPath }] };
                    }
                    const predecessorEffectiveFrom = predecessorActivation.exists()
                        ? (predecessorActivation.data() as ExternalPlanRevisionActivation).effectiveFrom
                        : existingHeader.supersededFrom ?? previousParsed.data.startDate;
                    if (effectiveFrom < predecessorEffectiveFrom) {
                        return { status: 'INVALID', issues: [{ code: 'activation-date-regression', field: 'effectiveFrom', documentPath: `users/${userId}/external_plans/${plan.planId}` }] };
                    }

                    if (previousParsed.data.schema === EXTERNAL_PLAN_SCHEMA_V5 || previousParsed.data.schema === EXTERNAL_PLAN_SCHEMA_V6) {
                        const supersessionIssues = validateIntentBlockSupersession(previousParsed.data, plan, userId);
                        if (supersessionIssues.length > 0) {
                            return { status: 'INVALID', issues: supersessionIssues };
                        }
                    }
                    if (!predecessorActivation.exists()) {
                        predecessorActivationToWrite = {
                            userId,
                            planId: plan.planId,
                            revision: storedRevision,
                            contentHash: predecessorHash,
                            effectiveFrom: predecessorEffectiveFrom,
                            activatedAt: existingHeader.importedAt,
                        };
                    }
                }
                } else if (sameRevision.exists() || sameActivation.exists()) {
                    return { status: 'INVALID', issues: [{ code: 'orphaned-plan-revision', field: 'revision', documentPath: `users/${userId}/external_plans/${plan.planId}/revisions/${plan.revision}` }] };
                }

            const header: ExternalPlanHeader = {
                userId,
                planId: plan.planId,
                revision: plan.revision,
                title: plan.title,
                startDate: plan.startDate,
                weekCount: plan.weekCount,
                contentHash,
                importedAt: now,
                supersededFrom: effectiveFrom,
                updatedAt: now,
            };
            const activation: ExternalPlanRevisionActivation = {
                userId, planId: plan.planId, revision: plan.revision, contentHash,
                effectiveFrom, activatedAt: now,
            };
            if (predecessorActivationToWrite) {
                transaction.set(this.activationRef(userId, plan.planId, predecessorActivationToWrite.revision), predecessorActivationToWrite as unknown as DocumentData);
            }
            transaction.set(revisionRef, plan as unknown as DocumentData);
            transaction.set(activationRef, activation as unknown as DocumentData);
            transaction.set(headerRef, header as unknown as DocumentData);
            return { status: 'AVAILABLE', data: { header, plan }, revision: header.contentHash };
            });
        } catch (error: unknown) {
            if (getErrorCode(error) === 'permission-denied' && await this.hasNewerStoredRevision(userId, plan.planId, plan.revision)) {
                return revisionNotNewer(userId, plan.planId);
            }
            console.error('[ExternalPlanService.import] Failed:', error);
            return {
                status: 'UNAVAILABLE',
                operation: 'import external plan',
                retryable: getErrorCode(error) !== 'permission-denied',
                message: getErrorMessage(error),
            };
        }
    }

    /**
     * A concurrent import of a newer revision can commit between this transaction's reads and
     * its commit. Security rules then reject the stale header update (`revision` may not
     * regress) with `permission-denied`, which the SDK does not retry, so the transaction never
     * re-reads and reaches its own `revision-not-newer` check. One header re-read tells that
     * race apart from a genuine denial. If the re-read itself fails, the caller keeps the
     * original denial.
     */
    private async hasNewerStoredRevision(userId: string, planId: string, revision: number): Promise<boolean> {
        try {
            const snapshot = await getDoc(this.headerRef(userId, planId));
            const storedRevision = snapshot.exists() ? (snapshot.data() as Partial<ExternalPlanHeader>).revision : undefined;
            return typeof storedRevision === 'number' && storedRevision > revision;
        } catch {
            return false;
        }
    }

    async getHeaderState(userId: string, planId: string): Promise<DataState<ExternalPlanHeader>> {
        try {
            const snapshot = await getDoc(this.headerRef(userId, planId));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const data = snapshot.data() as ExternalPlanHeader;
            if (data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath: `users/${userId}/external_plans/${planId}` }] };
            }
            if (data.planId !== planId) {
                return { status: 'INVALID', issues: [{ code: 'path-identity-mismatch', field: 'planId', documentPath: `users/${userId}/external_plans/${planId}` }] };
            }
            return { status: 'AVAILABLE', data, revision: data.contentHash };
        } catch (error: unknown) {
            console.error('[ExternalPlanService.getHeaderState] Failed:', error);
            return {
                status: 'UNAVAILABLE',
                operation: 'read external plan header',
                retryable: getErrorCode(error) !== 'permission-denied',
                message: getErrorMessage(error),
            };
        }
    }

    /** Re-validates on read. A revision that no longer satisfies the contract -- because
     * the contract moved, or the document was tampered with -- is `INVALID`, never coerced. */
    async getRevisionState(userId: string, planId: string, revision: number): Promise<DataState<ExternalTrainingPlan | ExternalTrainingPlanV2 | ExternalTrainingPlanV3 | ExternalTrainingPlanV4 | ExternalTrainingPlanV5 | ExternalTrainingPlanV6>> {
        const documentPath = `users/${userId}/external_plans/${planId}/revisions/${revision}`;
        try {
            const snapshot = await getDoc(this.revisionRef(userId, planId, revision));
            if (!snapshot.exists()) return { status: 'MISSING' };
            const parsed = validateAnyExternalTrainingPlan(snapshot.data());
            if (!parsed.isValid || !parsed.data) {
                return {
                    status: 'INVALID',
                    issues: parsed.errors.map(error => ({
                        code: 'schema-validation-failed',
                        field: error.field,
                        documentPath,
                    })),
                };
            }
            // The immutable revision's identity is part of replay provenance. A valid plan
            // stored under the wrong path is still invalid evidence: trusting its internal
            // identifiers would let the path requested by the audit and the bytes actually
            // replayed disagree about which revision was adjudicated.
            if (parsed.data.planId !== planId || parsed.data.revision !== revision) {
                return {
                    status: 'INVALID',
                    issues: [{
                        code: 'path-identity-mismatch',
                        field: parsed.data.planId !== planId ? 'planId' : 'revision',
                        documentPath,
                    }],
                };
            }
            return { status: 'AVAILABLE', data: parsed.data, revision: String(revision) };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan revision', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async listPlanIds(userId: string): Promise<DataState<string[]>> {
        try {
            const snapshot = await getDocs(collection(getDb(), 'users', userId, 'external_plans'));
            return { status: 'AVAILABLE', data: snapshot.docs.map(item => item.id).sort(), revision: null };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'list external plans', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async getActivationState(userId: string, planId: string): Promise<DataState<ExternalPlanRevisionActivation[]>> {
        const documentPath = `users/${userId}/external_plans/${planId}/activations`;
        try {
            const snapshot = await getDocs(collection(getDb(), 'users', userId, 'external_plans', planId, 'activations'));
            const activationDocs = snapshot.docs.map(item => ({
                id: item.id,
                data: item.data() as ExternalPlanRevisionActivation,
            }));
            const pathMismatch = activationDocs.find(item => String(item.data.revision) !== item.id);
            if (pathMismatch) {
                return {
                    status: 'INVALID',
                    issues: [{
                        code: 'path-identity-mismatch',
                        field: 'revision',
                        documentPath: `${documentPath}/${pathMismatch.id}`,
                    }],
                };
            }
            const activations = activationDocs.map(item => item.data);
            if (activations.some(item => item.userId !== userId || item.planId !== planId
                || !Number.isSafeInteger(item.revision) || item.revision < 1
                || !/^[a-f0-9]{64}$/.test(item.contentHash)
                || !isValidDate(item.effectiveFrom)
                || typeof item.activatedAt !== 'string')) {
                return { status: 'INVALID', issues: [{ code: 'invalid-activation-history', documentPath }] };
            }
            return {
                status: 'AVAILABLE',
                data: activations.sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom) || left.revision - right.revision),
                revision: String(activations.length),
            };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan activation history', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async getPlacementState(userId: string, planId: string, revision?: number): Promise<DataState<ExternalPlanPlacement>> {
        try {
            let usedLegacyPath = revision === undefined;
            let snapshot = revision === undefined
                ? await getDoc(this.legacyPlacementRef(userId, planId))
                : await getDoc(this.placementRef(userId, planId, revision));
            if (revision !== undefined && !snapshot.exists()) {
                usedLegacyPath = true;
                snapshot = await getDoc(this.legacyPlacementRef(userId, planId));
            }
            if (!snapshot.exists()) return { status: 'MISSING' };
            const documentPath = usedLegacyPath
                ? `users/${userId}/external_plans/${planId}/placement/current`
                : `users/${userId}/external_plans/${planId}/revisions/${revision}/placement/current`;
            // Checked before the schema so a corrupt document naming another owner is never
            // reported as ordinary, repairable corruption (#1172).
            if (placementClaimsOtherOwner(snapshot.data(), userId)) {
                return { status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath }] };
            }
            const parsed = validateExternalPlanPlacement(snapshot.data());
            if (!parsed.isValid || !parsed.data) {
                return {
                    status: 'INVALID',
                    issues: parsed.errors.map(error => ({
                        code: 'schema-validation-failed',
                        field: error.field,
                        documentPath,
                    })),
                };
            }
            if (parsed.data.userId !== userId) {
                return { status: 'INVALID', issues: [{ code: 'owner-mismatch', documentPath }] };
            }
            if (parsed.data.planId !== planId) {
                return { status: 'INVALID', issues: [{ code: 'path-identity-mismatch', field: 'planId', documentPath }] };
            }
            if (revision !== undefined && parsed.data.revision !== revision) {
                // A mismatched legacy overlay belongs to another revision and is therefore
                // simply not applicable. A mismatched revision-scoped document is corrupt
                // authority evidence and must fail closed rather than look absent.
                return usedLegacyPath
                    ? { status: 'MISSING' }
                    : { status: 'INVALID', issues: [{ code: 'path-identity-mismatch', field: 'revision', documentPath }] };
            }
            return { status: 'AVAILABLE', data: parsed.data, revision: parsed.data.updatedAt };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan placement', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    async getPlacementHistoryState(userId: string, planId: string, revision: number): Promise<DataState<PlacementEvent[]>> {
        const documentPath = `users/${userId}/external_plans/${planId}/revisions/${revision}/placement_history`;
        try {
            const docs: QueryDocumentSnapshot[] = [];
            let cursor: QueryDocumentSnapshot | undefined;
            for (;;) {
                const pageSize = Math.min(PLACEMENT_HISTORY_PAGE_SIZE, PLACEMENT_HISTORY_MAX_SCANNED_EVENTS - docs.length + 1);
                const page = await getDocs(query(collection(getDb(), documentPath),
                    orderBy(documentId(), 'asc'), ...(cursor ? [startAfter(cursor)] : []), limit(pageSize)));
                docs.push(...page.docs);
                if (docs.length > PLACEMENT_HISTORY_MAX_SCANNED_EVENTS) {
                    return { status: 'UNAVAILABLE', operation: PLACEMENT_HISTORY_TRUNCATED_OPERATION, retryable: false,
                        message: `Placement history exceeds the ${PLACEMENT_HISTORY_MAX_SCANNED_EVENTS}-event scan limit` };
                }
                if (page.docs.length < pageSize) break;
                cursor = page.docs.at(-1);
            }
            const events = docs.map(item => item.data() as PlacementEvent);
            const validAssignments = (assignments: PlacementEvent['assignments']) => validateExternalPlanPlacement({
                userId, planId, revision, assignments, updatedAt: '',
            }).isValid;
            if (events.some(event => !event || typeof event !== 'object' || event.userId !== userId || event.planId !== planId || event.revision !== revision
                || !isValidDate(event.changedOn) || typeof event.recordedAt !== 'string'
                || !Number.isFinite(Date.parse(event.recordedAt))
                || new Date(event.recordedAt).toISOString() !== event.recordedAt
                || !validAssignments(event.previous) || !validAssignments(event.assignments)
                || (event.previousState === undefined ? event.previousStateReason !== undefined
                    : event.previousState !== 'invalid' || event.previous.length > 0
                        || !PLACEMENT_PREVIOUS_STATE_REASONS.includes(event.previousStateReason as PlacementPreviousStateReason))
                || !event.successors || typeof event.successors !== 'object' || Array.isArray(event.successors)
                || Object.values(event.successors).some(value => !value || !Number.isSafeInteger(value.revision)
                    || value.revision <= revision || typeof value.sessionId !== 'string' || !value.sessionId)
                || event.assignments.some(assignment => assignment.status === 'superseded' && !event.successors[assignment.sessionId]
                    && !event.previous.some(previous => previous.sessionId === assignment.sessionId
                        && previous.status === 'superseded' && previous.date === assignment.date)))) {
                return { status: 'INVALID', issues: [{ code: 'invalid-placement-history', documentPath }] };
            }
            return { status: 'AVAILABLE', data: events, revision: String(events.length) };
        } catch (error: unknown) {
            return { status: 'UNAVAILABLE', operation: 'read external plan placement history', retryable: getErrorCode(error) !== 'permission-denied' };
        }
    }

    /** Atomically retain each previous overlay alongside the new current read model. */
    async savePlacement(userId: string, placement: Omit<ExternalPlanPlacement, 'userId' | 'updatedAt'>,
        successors: PlacementEvent['successors'] = {}): Promise<ExternalPlanPlacement> {
        const now = new Date();
        const stored: ExternalPlanPlacement = { ...placement, userId, updatedAt: now.toISOString() };
        const parsed = validateExternalPlanPlacement(stored);
        if (!parsed.isValid) {
            throw new Error(`Invalid placement overlay: ${parsed.errors.map(error => `${error.field}: ${error.message}`).join('; ')}`);
        }
        const currentRef = this.placementRef(userId, placement.planId, placement.revision);
        const eventRef = doc(collection(getDb(), 'users', userId, 'external_plans', placement.planId,
            'revisions', String(placement.revision), 'placement_history'));
        return runTransaction(getDb(), async transaction => {
            const current = await transaction.get(currentRef);
            const legacy = current.exists() ? null : await transaction.get(this.legacyPlacementRef(userId, placement.planId));
            const source = current.exists() ? 'current' : legacy?.exists() ? 'legacy' : null;
            const prior = readPreviousOverlay(source, source === 'current' ? current.data() : legacy?.data(),
                userId, placement.planId, placement.revision);
            const applicable = prior.overlay;
            const existing = applicable?.successors ?? {};
            const retained: PlacementEvent['successors'] = {};
            for (const assignment of placement.assignments) {
                if (assignment.status !== 'superseded') continue;
                const wasSuperseded = applicable?.assignments.some(item => item.sessionId === assignment.sessionId && item.status === 'superseded');
                const priorSuccessor = wasSuperseded ? existing[assignment.sessionId] : undefined;
                const supplied = successors[assignment.sessionId];
                if (priorSuccessor && supplied && (priorSuccessor.revision !== supplied.revision || priorSuccessor.sessionId !== supplied.sessionId)) {
                    throw new Error('Cannot replace an existing placement successor');
                }
                const successor = supplied ?? priorSuccessor;
                if (!successor && applicable?.assignments.some(item => item.sessionId === assignment.sessionId
                    && item.status === 'superseded' && item.date === assignment.date)) continue;
                if (!successor || !Number.isSafeInteger(successor.revision) || successor.revision <= placement.revision
                    || typeof successor.sessionId !== 'string' || !successor.sessionId) {
                    throw new Error('Superseded placement requires an explicit successor in a newer revision');
                }
                retained[assignment.sessionId] = successor;
            }
            if (Object.keys(successors).some(id => !placement.assignments.some(item => item.sessionId === id && item.status === 'superseded'))) {
                throw new Error('Invalid placement successor');
            }
            // A repair event is floored after the corrupt overlay's own canonical instant too.
            const previousTime = applicable ? Date.parse(applicable.updatedAt)
                : prior.invalidUpdatedAt ? Date.parse(prior.invalidUpdatedAt) : NaN;
            const recordedAt = new Date(Math.max(now.getTime(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
            const next = { ...stored, successors: retained, updatedAt: recordedAt };
            const event: PlacementEvent = { userId, planId: placement.planId, revision: placement.revision,
                changedOn: getLocalDateString(new Date(recordedAt)), recordedAt, previous: applicable?.assignments ?? [],
                assignments: next.assignments, successors: retained,
                ...(prior.invalid ? { previousState: 'invalid' as const, previousStateReason: prior.invalid } : {}) };
            transaction.set(currentRef, next as unknown as DocumentData);
            transaction.set(eventRef, event as unknown as DocumentData);
            return next;
        });
    }

}

export const externalPlanService = new ExternalPlanService();
