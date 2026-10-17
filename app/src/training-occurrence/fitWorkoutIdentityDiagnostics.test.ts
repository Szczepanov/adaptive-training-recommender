import { describe, expect, it } from 'vitest';
import type { PerformedOccurrenceSourceRef } from './models';
import {
    FIT_IDENTITY_OBSERVATION_STATUSES,
    countFitWorkoutIdentityObservations,
    countUnlinkedSameDayFitPairs,
    observeFitWorkoutIdentity,
} from './fitWorkoutIdentityDiagnostics';

const SEMANTIC_A = 'fit-workout-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SEMANTIC_B = 'fit-workout-v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function structured(overrides: Partial<Extract<PerformedOccurrenceSourceRef, { kind: 'structured_execution' }>> = {}): PerformedOccurrenceSourceRef {
    return { kind: 'structured_execution', executionId: 'exec-1', ...overrides };
}

function provider(overrides: Partial<Extract<PerformedOccurrenceSourceRef, { kind: 'provider_activity' }>> = {}): PerformedOccurrenceSourceRef {
    return { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1', ...overrides };
}

type ObserveInput = Parameters<typeof observeFitWorkoutIdentity>[0];

/** Both documents read unless a test says otherwise. */
const observe = (input: Omit<ObserveInput, 'executionDocumentRead' | 'providerDocumentRead'>
    & Partial<Pick<ObserveInput, 'executionDocumentRead' | 'providerDocumentRead'>>) =>
    observeFitWorkoutIdentity({ executionDocumentRead: true, providerDocumentRead: true, ...input });

const semantic = (fingerprint: string) => ({ fitWorkoutFingerprint: fingerprint, fitWorkoutFingerprintKind: 'semantic_definition' as const });

describe('observeFitWorkoutIdentity (ADR-0051 D7)', () => {
    it('reports a semantic match when the one execution and the one provider source share a fingerprint', () => {
        expect(observe({
            sourceRefs: [structured(semantic(SEMANTIC_A)), provider(semantic(SEMANTIC_A))],
        })).toEqual({ status: 'semantic_match' });
    });

    it('reports a mismatch when both are semantic but differ', () => {
        expect(observe({
            sourceRefs: [structured(semantic(SEMANTIC_A)), provider(semantic(SEMANTIC_B))],
        })).toEqual({ status: 'semantic_mismatch', reason: 'fingerprint_differs' });
    });

    it('separates a fingerprint-version difference from a content difference', () => {
        expect(observe({
            sourceRefs: [
                structured(semantic(SEMANTIC_A)),
                provider(semantic('fit-workout-v3:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
            ],
        })).toEqual({ status: 'semantic_mismatch', reason: 'fingerprint_version_differs' });
    });

    it.each([
        ['no structured source', [provider(semantic(SEMANTIC_A))], 'no_structured_source'],
        ['no provider source', [structured(semantic(SEMANTIC_A))], 'no_provider_source'],
        ['two structured sources', [structured(semantic(SEMANTIC_A)), structured({ executionId: 'exec-2', ...semantic(SEMANTIC_A) }), provider(semantic(SEMANTIC_A))], 'multiple_structured_sources'],
        ['two provider sources', [structured(semantic(SEMANTIC_A)), provider(semantic(SEMANTIC_A)), provider({ activityId: 'act-2', ...semantic(SEMANTIC_A) })], 'multiple_provider_sources'],
    ] as const)('is not applicable with %s, even if fingerprints would match', (_label, sourceRefs, reason) => {
        expect(observe({ sourceRefs })).toEqual({ status: 'not_applicable', reason });
    });

    it('is not comparable when the execution carries no fingerprint', () => {
        expect(observe({
            sourceRefs: [structured(), provider(semantic(SEMANTIC_A))],
        })).toEqual({ status: 'not_comparable', reason: 'execution_fingerprint_absent' });
    });

    it('is not comparable when the provider fingerprint is only an index fallback', () => {
        expect(observe({
            sourceRefs: [
                structured(semantic(SEMANTIC_A)),
                provider({ fitWorkoutFingerprint: SEMANTIC_A, fitWorkoutFingerprintKind: 'index_fallback' }),
            ],
        })).toEqual({ status: 'not_comparable', reason: 'provider_fingerprint_not_semantic' });
    });

    it('is not comparable when the provider recorded no workout structure', () => {
        expect(observe({
            sourceRefs: [structured(semantic(SEMANTIC_A)), provider()],
        })).toEqual({ status: 'not_comparable', reason: 'provider_fingerprint_absent' });
    });

    it('reports an unread execution document as not observable, never as an absent fingerprint', () => {
        expect(observe({
            sourceRefs: [structured(), provider(semantic(SEMANTIC_A))],
            executionDocumentRead: false,
        })).toEqual({ status: 'not_observable', reason: 'execution_unread' });
    });

    it('reports an unread provider document as not observable, never as a recording without structure', () => {
        expect(observe({
            sourceRefs: [structured(semantic(SEMANTIC_A)), provider()],
            providerDocumentRead: false,
        })).toEqual({ status: 'not_observable', reason: 'provider_unread' });
    });

    it('still compares on the source-link copies when the documents were not read', () => {
        expect(observe({
            sourceRefs: [structured(semantic(SEMANTIC_A)), provider(semantic(SEMANTIC_A))],
            executionDocumentRead: false,
            providerDocumentRead: false,
        })).toEqual({ status: 'semantic_match' });
    });

    it('prefers the hydrated documents over the denormalized source-link copies', () => {
        // A link made before source refs carried fingerprints still compares on the documents.
        expect(observe({
            sourceRefs: [structured(), provider()],
            executionDocument: { fingerprint: SEMANTIC_A, kind: 'semantic_definition' },
            providerDocument: { fingerprint: SEMANTIC_A, kind: 'semantic_definition' },
        })).toEqual({ status: 'semantic_match' });
        expect(observe({
            sourceRefs: [structured(semantic(SEMANTIC_A)), provider(semantic(SEMANTIC_A))],
            providerDocument: { fingerprint: SEMANTIC_B, kind: 'semantic_definition' },
        })).toEqual({ status: 'semantic_mismatch', reason: 'fingerprint_differs' });
    });

    it('never treats a matching activity date or time as identity evidence', () => {
        // Only fingerprints are inputs; there is no timestamp path to a match.
        expect(observe({ sourceRefs: [structured(), provider()] }))
            .toEqual({ status: 'not_comparable', reason: 'execution_fingerprint_absent' });
    });
});

describe('countFitWorkoutIdentityObservations', () => {
    it('counts every status, including zeros, in a fixed order', () => {
        const counts = countFitWorkoutIdentityObservations([
            { status: 'semantic_match' },
            { status: 'semantic_match' },
            { status: 'not_applicable', reason: 'no_provider_source' },
            { status: 'not_observable', reason: 'not_projected' },
        ]);
        expect(Object.keys(counts)).toEqual([...FIT_IDENTITY_OBSERVATION_STATUSES]);
        expect(counts).toEqual({
            semantic_match: 2,
            semantic_mismatch: 0,
            not_comparable: 0,
            not_applicable: 1,
            not_observable: 1,
        });
    });
});

describe('countUnlinkedSameDayFitPairs', () => {
    const sem = (fingerprint: string) => ({ fingerprint, kind: 'semantic_definition' as const });

    it('counts same-day structured/recording pairs by fingerprint equality', () => {
        expect(countUnlinkedSameDayFitPairs([
            { side: 'structured', localDate: '2026-10-10', evidence: sem(SEMANTIC_A) },
            { side: 'provider', localDate: '2026-10-10', evidence: sem(SEMANTIC_B) },
            { side: 'structured', localDate: '2026-10-11', evidence: sem(SEMANTIC_A) },
            { side: 'provider', localDate: '2026-10-11', evidence: sem(SEMANTIC_A) },
        ])).toEqual({ sameFingerprint: 1, differentFingerprint: 1 });
    });

    it('never pairs across dates, within one side, or with index-fallback or undated rows', () => {
        expect(countUnlinkedSameDayFitPairs([
            { side: 'structured', localDate: '2026-10-10', evidence: sem(SEMANTIC_A) },
            { side: 'provider', localDate: '2026-10-11', evidence: sem(SEMANTIC_B) },
            { side: 'structured', localDate: '2026-10-11', evidence: sem(SEMANTIC_B) },
            { side: 'provider', localDate: '2026-10-10', evidence: { fingerprint: SEMANTIC_A, kind: 'index_fallback' } },
            { side: 'provider', evidence: sem(SEMANTIC_A) },
        ])).toEqual({ sameFingerprint: 1, differentFingerprint: 0 });
    });

    it('counts every combination when a day has several unlinked rows on each side', () => {
        expect(countUnlinkedSameDayFitPairs([
            { side: 'structured', localDate: '2026-10-10', evidence: sem(SEMANTIC_A) },
            { side: 'structured', localDate: '2026-10-10', evidence: sem(SEMANTIC_B) },
            { side: 'provider', localDate: '2026-10-10', evidence: sem(SEMANTIC_A) },
            { side: 'provider', localDate: '2026-10-10', evidence: sem(SEMANTIC_B) },
        ])).toEqual({ sameFingerprint: 2, differentFingerprint: 2 });
    });
});
