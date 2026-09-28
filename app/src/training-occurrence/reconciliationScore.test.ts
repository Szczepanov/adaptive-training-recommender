import { describe, expect, it } from 'vitest';
import type { PerformedTrainingOccurrence, ReconciliationSourceFacts } from './models';
import { scoreCandidate } from './reconciliationScore';

function facts(overrides: Partial<ReconciliationSourceFacts> = {}): ReconciliationSourceFacts {
    return {
        sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        durationMin: 40,
        modality: 'strength',
        ...overrides,
    };
}

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-08-26',
        startedAt: '2026-08-26T06:53:00.000Z',
        endedAt: '2026-08-26T07:30:00.000Z',
        modality: 'strength',
        sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-08-26T06:53:00.000Z',
        updatedAt: '2026-08-26T06:53:00.000Z',
        ...overrides,
    };
}

describe('scoreCandidate', () => {
    it('scores 1.0 on explicit prescriptionHash correlation regardless of timing', () => {
        const incoming = facts({ sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }, prescriptionHash: 'hash-abc', startedAt: undefined, endedAt: undefined, localDate: '2026-08-30' });
        const candidate = occurrence({
            localDate: '2026-01-01',
            startedAt: undefined,
            endedAt: undefined,
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', prescriptionHash: 'hash-abc' }],
        });

        const { confidence, features } = scoreCandidate(incoming, candidate);

        expect(confidence).toBe(1);
        expect(features.explicitCorrelation).toBe(true);
    });

    it('rejects an explicit prescriptionHash correlation when the two sides have a known modality conflict', () => {
        // A coincidental/corrupted prescriptionHash match must never auto-link across a
        // known modality conflict -- modality incompatibility is checked first.
        const incoming = facts({
            sourceRef: { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
            prescriptionHash: 'hash-abc',
            modality: 'cycling',
        });
        const candidate = occurrence({
            modality: 'strength',
            sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1', prescriptionHash: 'hash-abc' }],
        });

        const { confidence, features } = scoreCandidate(incoming, candidate);

        expect(confidence).toBe(0);
        expect(features.explicitCorrelation).toBe(true);
        expect(features.modalityCompatible).toBe(false);
    });

    it('scores 0 when modality is known and incompatible, even with strong temporal overlap', () => {
        const incoming = facts({ modality: 'cycling' });
        const candidate = occurrence({ modality: 'strength' });

        const { confidence, features } = scoreCandidate(incoming, candidate);

        expect(confidence).toBe(0);
        expect(features.modalityCompatible).toBe(false);
    });

    it('scores highly for overlapping absolute timestamps and compatible modality', () => {
        const { confidence, features } = scoreCandidate(facts(), occurrence());

        expect(features.hasAbsoluteTimestamps).toBe(true);
        expect(features.overlapSeconds).toBeGreaterThan(0);
        expect(confidence).toBeGreaterThan(0.75);
    });

    it('decays confidence as the start-time gap grows, with no overlap', () => {
        const near = scoreCandidate(
            facts({ startedAt: '2026-08-26T06:52:00.000Z', endedAt: '2026-08-26T06:52:00.000Z' }),
            occurrence({ startedAt: '2026-08-26T07:10:00.000Z', endedAt: '2026-08-26T07:10:00.000Z' }),
        );
        const far = scoreCandidate(
            facts({ startedAt: '2026-08-26T06:52:00.000Z', endedAt: '2026-08-26T06:52:00.000Z' }),
            occurrence({ startedAt: '2026-08-26T11:52:00.000Z', endedAt: '2026-08-26T11:52:00.000Z' }),
        );

        expect(near.confidence).toBeGreaterThan(far.confidence);
        expect(far.features.overlapSeconds).toBe(0);
    });

    it('caps confidence well below auto-link range when neither side has an absolute timestamp (date+duration only)', () => {
        const incoming = facts({ startedAt: undefined, endedAt: undefined });
        const candidate = occurrence({ startedAt: undefined, endedAt: undefined });

        const { confidence, features } = scoreCandidate(incoming, candidate);

        expect(features.hasAbsoluteTimestamps).toBe(false);
        expect(confidence).toBeLessThan(0.5);
    });

    it('treats unknown modality on either side as neutral, not disqualifying', () => {
        const incoming = facts({ modality: undefined });
        const candidate = occurrence({ modality: 'strength' });

        const { features } = scoreCandidate(incoming, candidate);

        expect(features.modalityCompatible).toBeNull();
    });

    describe('fit-workout-v2 semantic fingerprint reconciliation', () => {
        const FP_VO2 = 'fit-workout-v2:0123456789abcdef0123456789abcdef';
        const FP_ENDURANCE = 'fit-workout-v2:fedcba9876543210fedcba9876543210';

        it('auto-links (confidence 1.0) when semantic definitions match with temporal overlap', () => {
            const incoming = facts({
                fitWorkoutFingerprint: FP_VO2,
                fitWorkoutFingerprintKind: 'semantic_definition',
            });
            const candidate = occurrence({
                sourceRefs: [{
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: FP_VO2,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                }],
            });

            const { confidence, features } = scoreCandidate(incoming, candidate);

            expect(features.fingerprintMatch).toBe(true);
            expect(features.overlapSeconds).toBeGreaterThan(0);
            expect(confidence).toBe(1.0);
        });

        it('disqualifies candidate outright (confidence 0) when comparable semantic definitions mismatch (hard negative gate)', () => {
            const incoming = facts({
                fitWorkoutFingerprint: FP_VO2,
                fitWorkoutFingerprintKind: 'semantic_definition',
            });
            const candidate = occurrence({
                sourceRefs: [{
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: FP_ENDURANCE,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                }],
            });

            const { confidence, features } = scoreCandidate(incoming, candidate);

            expect(features.fingerprintMatch).toBe(false);
            expect(confidence).toBe(0);
        });

        it('does not grant 1.0 confidence when semantic definitions match but there is no temporal overlap', () => {
            // Repetition of the same template across different times of day or days
            const incoming = facts({
                startedAt: '2026-08-26T06:00:00.000Z',
                endedAt: '2026-08-26T06:45:00.000Z',
                fitWorkoutFingerprint: FP_VO2,
                fitWorkoutFingerprintKind: 'semantic_definition',
            });
            const candidate = occurrence({
                startedAt: '2026-08-26T18:00:00.000Z',
                endedAt: '2026-08-26T18:45:00.000Z',
                sourceRefs: [{
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: FP_VO2,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                }],
            });

            const { confidence, features } = scoreCandidate(incoming, candidate);

            expect(features.fingerprintMatch).toBe(true);
            expect(features.overlapSeconds).toBe(0);
            expect(confidence).toBeLessThan(1.0);
        });

        it('falls back to null fingerprintMatch and normal scoring when kind is index_fallback', () => {
            const incoming = facts({
                fitWorkoutFingerprint: FP_VO2,
                fitWorkoutFingerprintKind: 'index_fallback',
            });
            const candidate = occurrence({
                sourceRefs: [{
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: FP_ENDURANCE,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                }],
            });

            const { confidence, features } = scoreCandidate(incoming, candidate);

            expect(features.fingerprintMatch).toBeNull();
            expect(confidence).toBeGreaterThan(0.7); // falls back to temporal overlap
        });

        it('falls back to null fingerprintMatch when candidate lacks fingerprint', () => {
            const incoming = facts({
                fitWorkoutFingerprint: FP_VO2,
                fitWorkoutFingerprintKind: 'semantic_definition',
            });
            const candidate = occurrence({
                sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }],
            });

            const { features } = scoreCandidate(incoming, candidate);

            expect(features.fingerprintMatch).toBeNull();
        });

        it('disqualifies on modality conflict even if semantic fingerprints match', () => {
            const incoming = facts({
                modality: 'cycling',
                fitWorkoutFingerprint: FP_VO2,
                fitWorkoutFingerprintKind: 'semantic_definition',
            });
            const candidate = occurrence({
                modality: 'strength',
                sourceRefs: [{
                    kind: 'structured_execution',
                    executionId: 'exec-1',
                    fitWorkoutFingerprint: FP_VO2,
                    fitWorkoutFingerprintKind: 'semantic_definition',
                }],
            });

            const { confidence, features } = scoreCandidate(incoming, candidate);

            expect(confidence).toBe(0);
            expect(features.modalityCompatible).toBe(false);
            expect(features.fingerprintMatch).toBe(true);
        });
    });
});
