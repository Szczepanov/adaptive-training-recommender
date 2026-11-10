import { describe, expect, it } from 'vitest';
import type { PerformedOccurrenceSourceLink, PerformedTrainingOccurrence } from './models';
import {
    assertValidPerformedOccurrenceSourceLinkWrite,
    assertValidPerformedTrainingOccurrenceWrite,
    validatePerformedOccurrenceSourceLinkWrite,
    validatePerformedTrainingOccurrenceWrite,
} from './validation';

// Issue #1202 item 1 PR C (ADR-0053): these validators own the nested value checks the
// performedTrainingOccurrences / performedOccurrenceSourceLinks rules no longer duplicate.

const userId = 'user-1';
const validFingerprint = 'fit-workout-v2:0123456789abcdef0123456789abcdef';

function occurrence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId,
        status: 'active',
        localDate: '2026-08-26',
        modality: 'strength',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T07:32:00.000Z',
        updatedAt: '2026-08-26T07:32:00.000Z',
        ...overrides,
    };
}

function sourceLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        sourceKey: 'structured_execution:exec-1',
        sourceKind: 'structured_execution',
        userId,
        performedOccurrenceId: 'pto-1',
        createdAt: '2026-08-26T07:32:00.000Z',
        updatedAt: '2026-08-26T07:32:00.000Z',
        ...overrides,
    };
}

function issuePaths(value: Record<string, unknown>): string[] {
    return validatePerformedTrainingOccurrenceWrite(value, userId).map(issue => issue.path);
}

describe('validatePerformedTrainingOccurrenceWrite', () => {
    it('accepts a full valid occurrence, including both ref kinds, fingerprints and a manual decision', () => {
        expect(validatePerformedTrainingOccurrenceWrite(occurrence({
            status: 'merged',
            mergedIntoOccurrenceId: 'pto-2',
            sourceRefs: [
                { kind: 'structured_execution', executionId: 'exec-1', sessionOccurrenceId: 'so-1', prescriptionHash: 'h', fitWorkoutFingerprint: validFingerprint, fitWorkoutFingerprintKind: 'semantic_definition' },
                { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1', deviceId: 'dev', fitWorkoutFingerprint: validFingerprint, fitWorkoutFingerprintKind: 'index_fallback' },
            ],
            reconciliation: {
                state: 'matched',
                confidence: 1,
                matcherVersion: 'matcher-v2',
                manualDecision: { decision: 'unlink', actor: 'athlete', decidedAt: '2026-08-26T08:00:00.000Z' },
                excludedSourceKeys: ['provider_activity:garmin:act-9'],
            },
        }), userId)).toEqual([]);
        expect(() => assertValidPerformedTrainingOccurrenceWrite(occurrence() as unknown as PerformedTrainingOccurrence, userId)).not.toThrow();
    });

    it.each([
        ['schemaVersion', { schemaVersion: 2 }],
        ['userId', { userId: 'someone-else' }],
        ['performedOccurrenceId', { performedOccurrenceId: '' }],
        ['status', { status: 'deleted' }],
        ['mergedIntoOccurrenceId', { mergedIntoOccurrenceId: 7 }],
        ['startedAt', { startedAt: 7 }],
        ['endedAt', { endedAt: false }],
        ['modality', { modality: {} }],
        ['localDate', { localDate: '2026-02-30' }],
        ['localDate', { localDate: '26-08-2026' }],
        ['sourceRefs', { sourceRefs: [] }],
        ['sourceRefs', { sourceRefs: Array.from({ length: 5 }, (_, index) => ({ kind: 'provider_activity', provider: 'garmin', activityId: `a${index}` })) }],
        ['createdAt', { createdAt: '' }],
        ['updatedAt', { updatedAt: 1 }],
    ])('rejects an invalid %s', (path, overrides) => {
        expect(issuePaths(occurrence(overrides))).toContain(path);
    });

    it.each([
        ['sourceRefs[0].kind', { kind: 'unknown_kind' }],
        ['sourceRefs[0].executionId', { kind: 'structured_execution', executionId: '' }],
        ['sourceRefs[0].sessionOccurrenceId', { kind: 'structured_execution', executionId: 'e', sessionOccurrenceId: 1 }],
        ['sourceRefs[0].prescriptionHash', { kind: 'structured_execution', executionId: 'e', prescriptionHash: 1 }],
        ['sourceRefs[0].provider', { kind: 'provider_activity', activityId: 'a' }],
        ['sourceRefs[0].activityId', { kind: 'provider_activity', provider: 'garmin', activityId: '' }],
        ['sourceRefs[0].deviceId', { kind: 'provider_activity', provider: 'garmin', activityId: 'a', deviceId: 3 }],
        ['sourceRefs[0]', { kind: 'structured_execution', executionId: 'e', provider: 'garmin' }],
        ['sourceRefs[0]', { kind: 'structured_execution', executionId: 'e', fitWorkoutFingerprint: validFingerprint }],
        ['sourceRefs[0]', { kind: 'provider_activity', provider: 'garmin', activityId: 'a', fitWorkoutFingerprintKind: 'semantic_definition' }],
        ['sourceRefs[0].fitWorkoutFingerprint', { kind: 'structured_execution', executionId: 'e', fitWorkoutFingerprint: 'invalid', fitWorkoutFingerprintKind: 'semantic_definition' }],
        ['sourceRefs[0].fitWorkoutFingerprintKind', { kind: 'structured_execution', executionId: 'e', fitWorkoutFingerprint: validFingerprint, fitWorkoutFingerprintKind: 'unsupported' }],
    ])('rejects a source ref with an invalid %s', (path, ref) => {
        expect(issuePaths(occurrence({ sourceRefs: [ref] }))).toContain(path);
    });

    it('validates every source ref, not only the first four the rules can reach', () => {
        const refs = [
            { kind: 'structured_execution', executionId: 'e' },
            { kind: 'provider_activity', provider: 'garmin', activityId: 'a', fitWorkoutFingerprint: 'bad', fitWorkoutFingerprintKind: 'index_fallback' },
        ];
        expect(issuePaths(occurrence({ sourceRefs: refs }))).toContain('sourceRefs[1].fitWorkoutFingerprint');
    });

    it.each([
        ['reconciliation', { reconciliation: 'matched' }],
        ['reconciliation.state', { reconciliation: { state: 'not_a_real_state' } }],
        ['reconciliation.confidence', { reconciliation: { state: 'matched', confidence: 1.5 } }],
        ['reconciliation.confidence', { reconciliation: { state: 'matched', confidence: -0.1 } }],
        ['reconciliation.confidence', { reconciliation: { state: 'matched', confidence: Number.NaN } }],
        ['reconciliation.confidence', { reconciliation: { state: 'matched', confidence: '0.9' } }],
        ['reconciliation.manualDecision', { reconciliation: { state: 'matched', manualDecision: 'link' } }],
        ['reconciliation.manualDecision.decision', { reconciliation: { state: 'matched', manualDecision: { decision: 'merge', actor: 'a', decidedAt: 't' } } }],
        ['reconciliation.manualDecision.actor', { reconciliation: { state: 'matched', manualDecision: { decision: 'link', actor: '', decidedAt: 't' } } }],
        ['reconciliation.manualDecision.decidedAt', { reconciliation: { state: 'matched', manualDecision: { decision: 'link', actor: 'a' } } }],
        ['reconciliation.excludedSourceKeys', { reconciliation: { state: 'matched', excludedSourceKeys: [1] } }],
        ['reconciliation.excludedSourceKeys', { reconciliation: { state: 'matched', excludedSourceKeys: Array.from({ length: 17 }, (_, index) => `k${index}`) } }],
    ])('rejects an invalid %s', (path, overrides) => {
        expect(issuePaths(occurrence(overrides))).toContain(path);
    });

    it('assert throws with every issue path', () => {
        expect(() => assertValidPerformedTrainingOccurrenceWrite(
            occurrence({ status: 'deleted', localDate: 'x' }) as unknown as PerformedTrainingOccurrence,
            userId,
        )).toThrow(/status: .*; localDate: /);
    });
});

describe('validatePerformedOccurrenceSourceLinkWrite', () => {
    it('accepts a valid link', () => {
        expect(validatePerformedOccurrenceSourceLinkWrite(sourceLink(), userId)).toEqual([]);
        expect(() => assertValidPerformedOccurrenceSourceLinkWrite(sourceLink() as unknown as PerformedOccurrenceSourceLink, userId)).not.toThrow();
    });

    it.each([
        ['schemaVersion', { schemaVersion: 2 }],
        ['sourceKey', { sourceKey: '' }],
        ['sourceKind', { sourceKind: 'manual' }],
        ['userId', { userId: 'someone-else' }],
        ['performedOccurrenceId', { performedOccurrenceId: '' }],
        ['createdAt', { createdAt: 1 }],
        ['updatedAt', { updatedAt: '' }],
    ])('rejects an invalid %s', (path, overrides) => {
        expect(validatePerformedOccurrenceSourceLinkWrite(sourceLink(overrides), userId).map(issue => issue.path)).toContain(path);
        expect(() => assertValidPerformedOccurrenceSourceLinkWrite(sourceLink(overrides) as unknown as PerformedOccurrenceSourceLink, userId))
            .toThrow(/Invalid performed-occurrence source link write/);
    });
});
