/**
 * Throwing validators for `PerformedTrainingOccurrence`/`PerformedOccurrenceSourceLink`
 * documents, mirroring `services/healthAnomalyPersistence.ts`'s
 * `parseHealthAnomalyAssessmentRevision` convention for an internal (not yet
 * DataState/UI-consumed) collection: malformed data throws inside a transaction rather
 * than degrading to a DataState -- this collection has no public read API in PR 1.
 */
import { isValidDate } from '../engine/validationCore';
import type { FitWorkoutFingerprintKind } from '../ledger/models';
import type {
    ManualReconciliationDecision,
    PerformedOccurrenceSourceKind,
    PerformedOccurrenceSourceLink,
    PerformedOccurrenceSourceRef,
    PerformedOccurrenceStatus,
    PerformedTrainingOccurrence,
    ReconciliationProvenance,
    ReconciliationStatus,
} from './models';

const STATUSES: readonly PerformedOccurrenceStatus[] = ['active', 'merged'];
const RECONCILIATION_STATES: readonly ReconciliationStatus[] = ['single_source', 'matched', 'ambiguous'];
const SOURCE_KINDS: readonly PerformedOccurrenceSourceKind[] = ['structured_execution', 'provider_activity'];
const MANUAL_DECISIONS: readonly ManualReconciliationDecision['decision'][] = ['link', 'unlink', 'keep_separate'];

const FIT_WORKOUT_FINGERPRINT_PATTERN = /^fit-workout-v2:[0-9a-f]{32}$/;
const FIT_WORKOUT_FINGERPRINT_KINDS = new Set(['semantic_definition', 'index_fallback']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function parseFingerprintFields(value: Record<string, unknown>): {
    fitWorkoutFingerprint?: string;
    fitWorkoutFingerprintKind?: FitWorkoutFingerprintKind;
} {
    if ((value.fitWorkoutFingerprint === undefined) !== (value.fitWorkoutFingerprintKind === undefined)) {
        throw new Error('Performed-occurrence FIT fingerprint and kind must be provided together');
    }
    if (value.fitWorkoutFingerprint !== undefined) {
        if (typeof value.fitWorkoutFingerprint !== 'string' || !FIT_WORKOUT_FINGERPRINT_PATTERN.test(value.fitWorkoutFingerprint)) {
            throw new Error('Invalid performed-occurrence source ref fitWorkoutFingerprint');
        }
    }
    if (value.fitWorkoutFingerprintKind !== undefined) {
        if (typeof value.fitWorkoutFingerprintKind !== 'string' || !FIT_WORKOUT_FINGERPRINT_KINDS.has(value.fitWorkoutFingerprintKind)) {
            throw new Error('Invalid performed-occurrence source ref fitWorkoutFingerprintKind');
        }
    }
    return {
        ...(typeof value.fitWorkoutFingerprint === 'string' ? { fitWorkoutFingerprint: value.fitWorkoutFingerprint } : {}),
        ...(typeof value.fitWorkoutFingerprintKind === 'string' ? { fitWorkoutFingerprintKind: value.fitWorkoutFingerprintKind as FitWorkoutFingerprintKind } : {}),
    };
}

function parseSourceRef(value: unknown): PerformedOccurrenceSourceRef {
    if (!isPlainObject(value) || !(SOURCE_KINDS as readonly string[]).includes(value.kind as string)) {
        throw new Error('Invalid performed-occurrence source ref');
    }
    if (value.kind === 'structured_execution') {
        if (!isNonEmptyString(value.executionId)) throw new Error('Invalid structured_execution source ref executionId');
        return {
            kind: 'structured_execution',
            executionId: value.executionId,
            ...(typeof value.sessionOccurrenceId === 'string' ? { sessionOccurrenceId: value.sessionOccurrenceId } : {}),
            ...(typeof value.prescriptionHash === 'string' ? { prescriptionHash: value.prescriptionHash } : {}),
            ...parseFingerprintFields(value),
        };
    }
    if (!isNonEmptyString(value.provider) || !isNonEmptyString(value.activityId)) {
        throw new Error('Invalid provider_activity source ref');
    }
    return {
        kind: 'provider_activity',
        provider: value.provider,
        activityId: value.activityId,
        ...(typeof value.deviceId === 'string' ? { deviceId: value.deviceId } : {}),
        ...parseFingerprintFields(value),
    };
}

function parseManualDecision(value: unknown): ManualReconciliationDecision {
    if (!isPlainObject(value) || !(MANUAL_DECISIONS as readonly string[]).includes(value.decision as string)) {
        throw new Error('Invalid manual reconciliation decision');
    }
    if (!isNonEmptyString(value.actor) || !isNonEmptyString(value.decidedAt)) {
        throw new Error('Invalid manual reconciliation decision actor/decidedAt');
    }
    return {
        decision: value.decision as ManualReconciliationDecision['decision'],
        actor: value.actor,
        decidedAt: value.decidedAt,
        ...(typeof value.previousState === 'string' ? { previousState: value.previousState } : {}),
        ...(typeof value.resultingState === 'string' ? { resultingState: value.resultingState } : {}),
        ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
        ...(typeof value.matcherVersionAtDecision === 'string' ? { matcherVersionAtDecision: value.matcherVersionAtDecision } : {}),
        ...(typeof value.scoreAtDecision === 'number' ? { scoreAtDecision: value.scoreAtDecision } : {}),
    };
}

function parseReconciliation(value: unknown): ReconciliationProvenance {
    if (!isPlainObject(value) || !(RECONCILIATION_STATES as readonly string[]).includes(value.state as string)) {
        throw new Error('Invalid reconciliation provenance');
    }
    return {
        state: value.state as ReconciliationStatus,
        ...(typeof value.matcherVersion === 'string' ? { matcherVersion: value.matcherVersion } : {}),
        ...(typeof value.policyVersion === 'string' ? { policyVersion: value.policyVersion } : {}),
        ...(typeof value.confidence === 'number' ? { confidence: value.confidence } : {}),
        ...(isPlainObject(value.features) ? { features: value.features as ReconciliationProvenance['features'] } : {}),
        ...(typeof value.linkedAt === 'string' ? { linkedAt: value.linkedAt } : {}),
        ...(value.manualDecision !== undefined ? { manualDecision: parseManualDecision(value.manualDecision) } : {}),
        ...(Array.isArray(value.excludedSourceKeys) && value.excludedSourceKeys.every(key => typeof key === 'string')
            ? { excludedSourceKeys: value.excludedSourceKeys as string[] }
            : {}),
    };
}

export function parsePerformedTrainingOccurrence(value: unknown, expectedUserId?: string): PerformedTrainingOccurrence {
    if (!isPlainObject(value)) throw new Error('Performed training occurrence must be an object');
    if (value.schemaVersion !== 1) throw new Error('Unsupported performed-occurrence schemaVersion');
    if (!isNonEmptyString(value.performedOccurrenceId)) throw new Error('Invalid performedOccurrenceId');
    if (!isNonEmptyString(value.userId)) throw new Error('Invalid performed-occurrence userId');
    if (expectedUserId && value.userId !== expectedUserId) throw new Error('Performed-occurrence ownership mismatch');
    if (!(STATUSES as readonly string[]).includes(value.status as string)) throw new Error('Invalid performed-occurrence status');
    if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) throw new Error('Performed occurrence requires at least one source ref');

    return {
        schemaVersion: 1,
        performedOccurrenceId: value.performedOccurrenceId,
        userId: value.userId,
        status: value.status as PerformedOccurrenceStatus,
        ...(typeof value.mergedIntoOccurrenceId === 'string' ? { mergedIntoOccurrenceId: value.mergedIntoOccurrenceId } : {}),
        ...(typeof value.startedAt === 'string' ? { startedAt: value.startedAt } : {}),
        ...(typeof value.endedAt === 'string' ? { endedAt: value.endedAt } : {}),
        ...(typeof value.localDate === 'string' ? { localDate: value.localDate } : {}),
        ...(typeof value.modality === 'string' ? { modality: value.modality } : {}),
        sourceRefs: value.sourceRefs.map(parseSourceRef),
        reconciliation: parseReconciliation(value.reconciliation),
        createdAt: isNonEmptyString(value.createdAt) ? value.createdAt : (() => { throw new Error('Invalid performed-occurrence createdAt'); })(),
        updatedAt: isNonEmptyString(value.updatedAt) ? value.updatedAt : (() => { throw new Error('Invalid performed-occurrence updatedAt'); })(),
    };
}

export function parsePerformedOccurrenceSourceLink(value: unknown, expectedUserId?: string): PerformedOccurrenceSourceLink {
    if (!isPlainObject(value)) throw new Error('Source link must be an object');
    if (value.schemaVersion !== 1) throw new Error('Unsupported source-link schemaVersion');
    if (!isNonEmptyString(value.sourceKey)) throw new Error('Invalid source-link sourceKey');
    if (!(SOURCE_KINDS as readonly string[]).includes(value.sourceKind as string)) throw new Error('Invalid source-link sourceKind');
    if (!isNonEmptyString(value.userId)) throw new Error('Invalid source-link userId');
    if (expectedUserId && value.userId !== expectedUserId) throw new Error('Source-link ownership mismatch');
    if (!isNonEmptyString(value.performedOccurrenceId)) throw new Error('Invalid source-link performedOccurrenceId');
    if (!isNonEmptyString(value.createdAt) || !isNonEmptyString(value.updatedAt)) throw new Error('Invalid source-link timestamps');

    return {
        schemaVersion: 1,
        sourceKey: value.sourceKey,
        sourceKind: value.sourceKind as PerformedOccurrenceSourceKind,
        userId: value.userId,
        performedOccurrenceId: value.performedOccurrenceId,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}

// ---------------------------------------------------------------------------------------
// Write-side validators (issue #1202 item 1 PR C, ADR-0053).
//
// The parsers above are read-side and lenient about optional fields (a wrong-typed
// optional value is dropped). These validators run on every client write in
// `repository.ts` before the document reaches Firestore. They own the nested domain-value
// checks that the rules no longer duplicate: `schemaVersion`, the `status` enum and the
// optional scalar types, the `localDate` calendar date, each source ref's kind, required
// identity fields, optional types and FIT fingerprint/kind pairing and format, the
// reconciliation `state` enum, `confidence` range and manual decision, and the source-link
// `schemaVersion`, `sourceKind` and `performedOccurrenceId`. The rules keep ownership, the
// occurrence path binding, key allow-lists (including a per-ref allow-list), the
// `sourceRefs` 1..4 and `excludedSourceKeys` <= 16 bounds, timestamp shape and update
// immutability.
// ---------------------------------------------------------------------------------------

export interface PerformedOccurrenceWriteIssue {
    path: string;
    message: string;
}

const STRUCTURED_REF_KEYS = new Set(['kind', 'executionId', 'sessionOccurrenceId', 'prescriptionHash', 'fitWorkoutFingerprint', 'fitWorkoutFingerprintKind']);
const PROVIDER_REF_KEYS = new Set(['kind', 'provider', 'activityId', 'deviceId', 'fitWorkoutFingerprint', 'fitWorkoutFingerprintKind']);
const MAX_SOURCE_REFS = 4;
const MAX_EXCLUDED_SOURCE_KEYS = 16;

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
}

function formatIssues(issues: readonly PerformedOccurrenceWriteIssue[]): string {
    return issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
}

function fingerprintIssues(ref: Record<string, unknown>, path: string): PerformedOccurrenceWriteIssue[] {
    const issues: PerformedOccurrenceWriteIssue[] = [];
    if ((ref.fitWorkoutFingerprint === undefined) !== (ref.fitWorkoutFingerprintKind === undefined)) {
        issues.push({ path, message: 'fitWorkoutFingerprint and fitWorkoutFingerprintKind must be provided together' });
    }
    if (ref.fitWorkoutFingerprint !== undefined
        && (typeof ref.fitWorkoutFingerprint !== 'string' || !FIT_WORKOUT_FINGERPRINT_PATTERN.test(ref.fitWorkoutFingerprint))) {
        issues.push({ path: `${path}.fitWorkoutFingerprint`, message: 'fitWorkoutFingerprint must match fit-workout-v2:<32 hex>' });
    }
    if (ref.fitWorkoutFingerprintKind !== undefined
        && (typeof ref.fitWorkoutFingerprintKind !== 'string' || !FIT_WORKOUT_FINGERPRINT_KINDS.has(ref.fitWorkoutFingerprintKind))) {
        issues.push({ path: `${path}.fitWorkoutFingerprintKind`, message: 'fitWorkoutFingerprintKind must be semantic_definition or index_fallback' });
    }
    return issues;
}

function sourceRefIssues(ref: unknown, path: string): PerformedOccurrenceWriteIssue[] {
    if (!isPlainObject(ref)) return [{ path, message: 'source ref must be an object' }];
    const issues: PerformedOccurrenceWriteIssue[] = [];
    let allowedKeys: ReadonlySet<string>;
    if (ref.kind === 'structured_execution') {
        allowedKeys = STRUCTURED_REF_KEYS;
        if (!isNonEmptyString(ref.executionId)) issues.push({ path: `${path}.executionId`, message: 'executionId must be a non-empty string' });
        if (!isOptionalString(ref.sessionOccurrenceId)) issues.push({ path: `${path}.sessionOccurrenceId`, message: 'sessionOccurrenceId must be a string' });
        if (!isOptionalString(ref.prescriptionHash)) issues.push({ path: `${path}.prescriptionHash`, message: 'prescriptionHash must be a string' });
    } else if (ref.kind === 'provider_activity') {
        allowedKeys = PROVIDER_REF_KEYS;
        if (!isNonEmptyString(ref.provider)) issues.push({ path: `${path}.provider`, message: 'provider must be a non-empty string' });
        if (!isNonEmptyString(ref.activityId)) issues.push({ path: `${path}.activityId`, message: 'activityId must be a non-empty string' });
        if (!isOptionalString(ref.deviceId)) issues.push({ path: `${path}.deviceId`, message: 'deviceId must be a string' });
    } else {
        return [{ path: `${path}.kind`, message: 'kind must be structured_execution or provider_activity' }];
    }
    const unknownKeys = Object.keys(ref).filter(key => !allowedKeys.has(key));
    if (unknownKeys.length > 0) issues.push({ path, message: `unexpected keys for ${ref.kind}: ${unknownKeys.join(', ')}` });
    return [...issues, ...fingerprintIssues(ref, path)];
}

function manualDecisionIssues(value: unknown): PerformedOccurrenceWriteIssue[] {
    const path = 'reconciliation.manualDecision';
    if (!isPlainObject(value)) return [{ path, message: 'manualDecision must be an object' }];
    const issues: PerformedOccurrenceWriteIssue[] = [];
    if (!(MANUAL_DECISIONS as readonly unknown[]).includes(value.decision)) issues.push({ path: `${path}.decision`, message: 'decision must be link, unlink or keep_separate' });
    if (!isNonEmptyString(value.actor)) issues.push({ path: `${path}.actor`, message: 'actor must be a non-empty string' });
    if (!isNonEmptyString(value.decidedAt)) issues.push({ path: `${path}.decidedAt`, message: 'decidedAt must be a non-empty string' });
    return issues;
}

function reconciliationIssues(value: unknown): PerformedOccurrenceWriteIssue[] {
    if (!isPlainObject(value)) return [{ path: 'reconciliation', message: 'reconciliation must be an object' }];
    const issues: PerformedOccurrenceWriteIssue[] = [];
    if (!(RECONCILIATION_STATES as readonly unknown[]).includes(value.state)) {
        issues.push({ path: 'reconciliation.state', message: 'state must be single_source, matched or ambiguous' });
    }
    // Number.isFinite also rejects NaN, which the old `>= 0 && <= 1` rule rejected too.
    if (value.confidence !== undefined
        && !(typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1)) {
        issues.push({ path: 'reconciliation.confidence', message: 'confidence must be a finite number between 0 and 1' });
    }
    if (value.manualDecision !== undefined) issues.push(...manualDecisionIssues(value.manualDecision));
    if (value.excludedSourceKeys !== undefined
        && !(Array.isArray(value.excludedSourceKeys)
            && value.excludedSourceKeys.length <= MAX_EXCLUDED_SOURCE_KEYS
            && value.excludedSourceKeys.every(isNonEmptyString))) {
        issues.push({ path: 'reconciliation.excludedSourceKeys', message: `excludedSourceKeys must be at most ${MAX_EXCLUDED_SOURCE_KEYS} non-empty strings` });
    }
    return issues;
}

/** Whole-document write validator for a `PerformedTrainingOccurrence`. Every client writer
 * replaces the whole document (`transaction.set`, never a merge), so the payload is the
 * stored document. */
export function validatePerformedTrainingOccurrenceWrite(value: unknown, expectedUserId: string): PerformedOccurrenceWriteIssue[] {
    if (!isPlainObject(value)) return [{ path: '', message: 'performed occurrence must be an object' }];
    const issues: PerformedOccurrenceWriteIssue[] = [];
    if (value.schemaVersion !== 1) issues.push({ path: 'schemaVersion', message: 'schemaVersion must be 1' });
    if (!isNonEmptyString(value.performedOccurrenceId)) issues.push({ path: 'performedOccurrenceId', message: 'performedOccurrenceId must be a non-empty string' });
    if (value.userId !== expectedUserId) issues.push({ path: 'userId', message: 'userId must be the owner' });
    if (!(STATUSES as readonly unknown[]).includes(value.status)) issues.push({ path: 'status', message: 'status must be active or merged' });
    if (value.mergedIntoOccurrenceId !== undefined && !isNonEmptyString(value.mergedIntoOccurrenceId)) {
        issues.push({ path: 'mergedIntoOccurrenceId', message: 'mergedIntoOccurrenceId must be a non-empty string' });
    }
    for (const key of ['startedAt', 'endedAt', 'modality'] as const) {
        if (!isOptionalString(value[key])) issues.push({ path: key, message: `${key} must be a string` });
    }
    if (value.localDate !== undefined && !(typeof value.localDate === 'string' && isValidDate(value.localDate))) {
        issues.push({ path: 'localDate', message: 'localDate must be a real YYYY-MM-DD calendar date' });
    }
    if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length < 1 || value.sourceRefs.length > MAX_SOURCE_REFS) {
        issues.push({ path: 'sourceRefs', message: `sourceRefs must hold 1 to ${MAX_SOURCE_REFS} refs` });
    } else {
        value.sourceRefs.forEach((ref, index) => issues.push(...sourceRefIssues(ref, `sourceRefs[${index}]`)));
    }
    issues.push(...reconciliationIssues(value.reconciliation));
    if (!isNonEmptyString(value.createdAt)) issues.push({ path: 'createdAt', message: 'createdAt must be a non-empty string' });
    if (!isNonEmptyString(value.updatedAt)) issues.push({ path: 'updatedAt', message: 'updatedAt must be a non-empty string' });
    return issues;
}

export function assertValidPerformedTrainingOccurrenceWrite(value: PerformedTrainingOccurrence, expectedUserId: string): void {
    const issues = validatePerformedTrainingOccurrenceWrite(value, expectedUserId);
    if (issues.length > 0) throw new Error(`Invalid performed training occurrence write: ${formatIssues(issues)}`);
}

/** Whole-document write validator for a `PerformedOccurrenceSourceLink`. The re-pointing
 * `transaction.update` writes are validated on the merged document (stored link plus the
 * patch), so the check covers what Firestore will store. */
export function validatePerformedOccurrenceSourceLinkWrite(value: unknown, expectedUserId: string): PerformedOccurrenceWriteIssue[] {
    if (!isPlainObject(value)) return [{ path: '', message: 'source link must be an object' }];
    const issues: PerformedOccurrenceWriteIssue[] = [];
    if (value.schemaVersion !== 1) issues.push({ path: 'schemaVersion', message: 'schemaVersion must be 1' });
    if (!isNonEmptyString(value.sourceKey)) issues.push({ path: 'sourceKey', message: 'sourceKey must be a non-empty string' });
    if (!(SOURCE_KINDS as readonly unknown[]).includes(value.sourceKind)) issues.push({ path: 'sourceKind', message: 'sourceKind must be structured_execution or provider_activity' });
    if (value.userId !== expectedUserId) issues.push({ path: 'userId', message: 'userId must be the owner' });
    if (!isNonEmptyString(value.performedOccurrenceId)) issues.push({ path: 'performedOccurrenceId', message: 'performedOccurrenceId must be a non-empty string' });
    if (!isNonEmptyString(value.createdAt)) issues.push({ path: 'createdAt', message: 'createdAt must be a non-empty string' });
    if (!isNonEmptyString(value.updatedAt)) issues.push({ path: 'updatedAt', message: 'updatedAt must be a non-empty string' });
    return issues;
}

export function assertValidPerformedOccurrenceSourceLinkWrite(value: PerformedOccurrenceSourceLink, expectedUserId: string): void {
    const issues = validatePerformedOccurrenceSourceLinkWrite(value, expectedUserId);
    if (issues.length > 0) throw new Error(`Invalid performed-occurrence source link write: ${formatIssues(issues)}`);
}
