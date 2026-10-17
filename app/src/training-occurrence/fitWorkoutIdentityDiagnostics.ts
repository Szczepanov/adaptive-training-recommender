/**
 * ADR-0051 D7 feasibility gate: does a canonical occurrence's one structured execution carry
 * the same semantic FIT workout fingerprint as its one provider recording? Counting these
 * across real workouts decides whether cross-source step identity is worth building.
 *
 * Pure: inputs are the occurrence's source refs plus the hydrated documents' own identity.
 * Policy effect: none (diagnostic/export only). Only fingerprints are compared; dates, times
 * and durations are never identity evidence here.
 */
import type { FitWorkoutFingerprintKind } from '../engine/models';
import { isProviderActivityRef, isStructuredExecutionRef, type PerformedOccurrenceSourceRef } from './models';

export interface FitIdentityEvidence {
    fingerprint: string;
    kind: FitWorkoutFingerprintKind;
}

export const FIT_IDENTITY_OBSERVATION_STATUSES = [
    'semantic_match',
    'semantic_mismatch',
    'not_comparable',
    'not_applicable',
    'not_observable',
] as const;

export type FitIdentityObservationStatus = (typeof FIT_IDENTITY_OBSERVATION_STATUSES)[number];

export type FitWorkoutIdentityObservation =
    | { status: 'semantic_match' }
    | { status: 'semantic_mismatch'; reason: 'fingerprint_differs' | 'fingerprint_version_differs' }
    | {
        status: 'not_comparable';
        reason:
            | 'execution_fingerprint_absent'
            | 'execution_fingerprint_not_semantic'
            | 'provider_fingerprint_absent'
            | 'provider_fingerprint_not_semantic';
    }
    | {
        status: 'not_applicable';
        reason: 'no_structured_source' | 'multiple_structured_sources' | 'no_provider_source' | 'multiple_provider_sources';
    }
    /** A needed document was not read (or the view was built without this observation).
     * Never read as "no fingerprint" or "no match". */
    | { status: 'not_observable'; reason: 'not_projected' | 'execution_unread' | 'provider_unread' };

export function fitIdentityEvidenceOf(
    source: { fitWorkoutFingerprint?: string; fitWorkoutFingerprintKind?: FitWorkoutFingerprintKind } | undefined,
): FitIdentityEvidence | undefined {
    return source?.fitWorkoutFingerprint && source.fitWorkoutFingerprintKind
        ? { fingerprint: source.fitWorkoutFingerprint, kind: source.fitWorkoutFingerprintKind }
        : undefined;
}

function fingerprintVersion(fingerprint: string): string {
    const separator = fingerprint.indexOf(':');
    return separator === -1 ? '' : fingerprint.slice(0, separator);
}

/**
 * A feasibility count, not D2 itself: exactly one structured execution and exactly one
 * provider recording (stricter than D2's unambiguous source set, and blind to reconciliation
 * state), both semantic, same version, equal. Each side uses its hydrated document's
 * fingerprint when it carries one, else the source-link copy, which can predate fingerprints
 * on the link. A side with neither is "absent" only when its document was actually read;
 * otherwise the evidence is missing and the result is `not_observable`.
 */
export function observeFitWorkoutIdentity(input: {
    sourceRefs: readonly PerformedOccurrenceSourceRef[];
    executionDocument?: FitIdentityEvidence;
    /** Whether the execution document itself was read (with or without a fingerprint). */
    executionDocumentRead: boolean;
    providerDocument?: FitIdentityEvidence;
    /** Whether the provider activity document itself was read (with or without a fingerprint). */
    providerDocumentRead: boolean;
}): FitWorkoutIdentityObservation {
    const structuredRefs = input.sourceRefs.filter(isStructuredExecutionRef);
    const providerRefs = input.sourceRefs.filter(isProviderActivityRef);
    if (structuredRefs.length === 0) return { status: 'not_applicable', reason: 'no_structured_source' };
    if (structuredRefs.length > 1) return { status: 'not_applicable', reason: 'multiple_structured_sources' };
    if (providerRefs.length === 0) return { status: 'not_applicable', reason: 'no_provider_source' };
    if (providerRefs.length > 1) return { status: 'not_applicable', reason: 'multiple_provider_sources' };

    const execution = input.executionDocument ?? fitIdentityEvidenceOf(structuredRefs[0]);
    const recording = input.providerDocument ?? fitIdentityEvidenceOf(providerRefs[0]);
    if (!execution && !input.executionDocumentRead) return { status: 'not_observable', reason: 'execution_unread' };
    if (!execution) return { status: 'not_comparable', reason: 'execution_fingerprint_absent' };
    if (execution.kind !== 'semantic_definition') return { status: 'not_comparable', reason: 'execution_fingerprint_not_semantic' };
    if (!recording && !input.providerDocumentRead) return { status: 'not_observable', reason: 'provider_unread' };
    if (!recording) return { status: 'not_comparable', reason: 'provider_fingerprint_absent' };
    if (recording.kind !== 'semantic_definition') return { status: 'not_comparable', reason: 'provider_fingerprint_not_semantic' };
    if (fingerprintVersion(execution.fingerprint) !== fingerprintVersion(recording.fingerprint)) {
        return { status: 'semantic_mismatch', reason: 'fingerprint_version_differs' };
    }
    return execution.fingerprint === recording.fingerprint
        ? { status: 'semantic_match' }
        : { status: 'semantic_mismatch', reason: 'fingerprint_differs' };
}

/** One single-source row's own semantic FIT identity, for the unlinked-pair count only. */
export interface SingleSourceFitEvidence {
    side: 'structured' | 'provider';
    localDate?: string;
    evidence: FitIdentityEvidence;
}

export interface UnlinkedSameDayFitPairs {
    sameFingerprint: number;
    differentFingerprint: number;
}

/**
 * Reconciliation treats a semantic mismatch as a hard negative (`reconciliationScore.ts`
 * `compareFitWorkoutIdentity`), so a mismatched execution/recording pair is never linked and
 * cannot appear as `semantic_mismatch` above. Without this count, zero matches could not be told
 * apart from "every pair mismatched and was split". Pairs a structured-only row with a
 * provider-only row on the same local date, both semantic. The date only selects rows to count;
 * it never makes a pair the same workout, and the result is a number, not a link.
 */
export function countUnlinkedSameDayFitPairs(rows: readonly SingleSourceFitEvidence[]): UnlinkedSameDayFitPairs {
    const semantic = rows.filter(row => row.localDate && row.evidence.kind === 'semantic_definition');
    const structured = semantic.filter(row => row.side === 'structured');
    const recordings = semantic.filter(row => row.side === 'provider');
    return structured.reduce((counts, execution) => recordings
        .filter(recording => recording.localDate === execution.localDate)
        .reduce((inner, recording) => recording.evidence.fingerprint === execution.evidence.fingerprint
            ? { ...inner, sameFingerprint: inner.sameFingerprint + 1 }
            : { ...inner, differentFingerprint: inner.differentFingerprint + 1 }, counts),
    { sameFingerprint: 0, differentFingerprint: 0 });
}

export function countFitWorkoutIdentityObservations(
    observations: readonly FitWorkoutIdentityObservation[],
): Record<FitIdentityObservationStatus, number> {
    const zero = Object.fromEntries(FIT_IDENTITY_OBSERVATION_STATUSES.map(status => [status, 0])) as Record<FitIdentityObservationStatus, number>;
    return observations.reduce((counts, { status }) => ({ ...counts, [status]: counts[status] + 1 }), zero);
}
