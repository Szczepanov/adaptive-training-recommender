/**
 * Throwing validators for `PerformedTrainingOccurrence`/`PerformedOccurrenceSourceLink`
 * documents, mirroring `services/healthAnomalyPersistence.ts`'s
 * `parseHealthAnomalyAssessmentRevision` convention for an internal (not yet
 * DataState/UI-consumed) collection: malformed data throws inside a transaction rather
 * than degrading to a DataState -- this collection has no public read API in PR 1.
 */
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
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
