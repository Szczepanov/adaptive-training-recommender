import { describe, expect, it } from 'vitest';
import type { NormalizedGarminActivity } from './models';
import { decideSessionComparability, type ResponseSessionIdentity } from './contextBriefComparability';

const zones = [
    { zoneNumber: 1, secondsInZone: 100, lowBoundary: 0 },
    { zoneNumber: 2, secondsInZone: 1000, lowBoundary: 140 },
];

function activity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'a', date: '2026-09-18', type: 'road_biking', durationMin: 90,
        trainingEffectAerobic: 2, trainingEffectAnaerobic: 0, averageHr: 135,
        activityTrainingLoad: 50, intensityTag: 'easy', stimulusDomain: 'endurance',
        normalizedPower: 180, variabilityIndex: 1.02, powerInZones: zones,
        hrMeasurement: {
            measurementConfidence: 'high', signalQuality: 'clean',
            summaryCompatibility: 'verified_same_effective_trace', artifactFlags: [], reasons: [],
        } as never,
        ...overrides,
    };
}

function decide(
    current: NormalizedGarminActivity,
    prior: NormalizedGarminActivity,
    currentIdentity?: ResponseSessionIdentity,
    priorIdentity?: ResponseSessionIdentity,
) {
    return decideSessionComparability({
        featureFamily: 'cycling_steady_power_hr',
        current: { activity: current, ...(currentIdentity ? { identity: currentIdentity } : {}) },
        prior: { activity: prior, ...(priorIdentity ? { identity: priorIdentity } : {}) },
    });
}

describe('decideSessionComparability', () => {
    it('ranks exact authored identity above family, provider fingerprint, then controlled steady match', () => {
        const current = activity({ fitWorkoutFingerprint: 'same-fit' });
        const prior = activity({ activityId: 'prior', date: '2026-09-10', fitWorkoutFingerprint: 'same-fit' });
        expect(decide(current, prior, { prescriptionHash: 'p1' }, { prescriptionHash: 'p1' }).matchBasis)
            .toBe('exact_prescription_identity');
        expect(decide(current, prior, { protocolFamily: 'f1' }, { protocolFamily: 'f1' }).matchBasis)
            .toBe('authored_protocol_family');
        expect(decide(current, prior).matchBasis).toBe('provider_fallback');
        const controlled = decide(activity(), activity({ activityId: 'prior', date: '2026-09-10' }));
        expect(controlled.matchBasis).toBe('controlled_steady_match');
        expect(controlled.provenance.protocolIdentity).toBe('unknown');
    });

    it('never compares one physical occurrence with itself', () => {
        const result = decide(activity(), activity({ activityId: 'prior', date: '2026-09-10' }),
            { performedOccurrenceId: 'pto-1' }, { performedOccurrenceId: 'pto-1' });
        expect(result).toMatchObject({ state: 'not_comparable', hardRejections: ['same performed occurrence'] });
    });

    it('rejects different activity types, materially different duration and changed threshold', () => {
        expect(decide(activity(), activity({ type: 'running' })).hardRejections[0]).toContain('different activity type');
        expect(decide(activity(), activity({ activityId: 'long', date: '2026-09-10', durationMin: 240 }))
            .hardRejections[0]).toContain('different protocol duration');
        expect(decide(activity(), activity({ activityId: 'ftp', date: '2026-09-10', powerInZones: [{ ...zones[1], lowBoundary: 150 }] }))
            .hardRejections[0]).toContain('FTP');
    });

    it('owns steady eligibility for both sessions, including variability evidence', () => {
        expect(decide(activity(), activity({ activityId: 'no-vi', date: '2026-09-10', variabilityIndex: undefined })).state)
            .toBe('insufficient_evidence');
        expect(decide(activity(), activity({ activityId: 'variable', date: '2026-09-10', variabilityIndex: 1.12 })).state)
            .toBe('not_comparable');
        expect(decide(activity({ stimulusDomain: 'mixed' }), activity({ activityId: 'prior', date: '2026-09-10' })).state)
            .toBe('insufficient_evidence');
    });

    it('caps unknown threshold and venue context, even with a matching provider fingerprint', () => {
        const current = activity({ fitWorkoutFingerprint: 'same-fit', powerInZones: undefined });
        const prior = activity({ activityId: 'prior', date: '2026-09-10', fitWorkoutFingerprint: 'same-fit', powerInZones: undefined });
        const result = decide(current, prior);
        expect(result.state).toBe('comparable');
        expect(result.confidenceCeiling).toBe('low');
        expect(result.provenance.venueEnvironmentEvidence).toBe('unknown');
    });

    it('uses the weakest required provenance component as the confidence ceiling', () => {
        const result = decide(
            activity(),
            activity({ activityId: 'prior', date: '2026-09-10' }),
            { sourceCompleteness: 'canonical' },
            { sourceCompleteness: 'canonical' },
        );
        expect(result.provenance.measurementSensorEvidence).toBe('observational');
        expect(result.confidenceCeiling).toBe('low');
        expect(result.limitations).toContain('measurement/sensor authority observational');
    });

    it('treats missing comparison measurements as insufficient evidence', () => {
        const result = decideSessionComparability({
            featureFamily: 'cycling_steady_power_hr',
            current: { activity: activity() },
            prior: { activity: activity({ activityId: 'prior', date: '2026-09-10', normalizedPower: undefined }) },
        });
        expect(result.state).toBe('insufficient_evidence');
        expect(result.hardRejections).toEqual(['power or HR evidence unavailable or withheld']);
        expect(decide(activity({ normalizedPower: undefined }), activity({ activityId: 'prior', date: '2026-09-10' })).state)
            .toBe('insufficient_evidence');
        expect(decide(activity(), activity({ activityId: 'prior', date: '2026-09-10', averageHr: null })).state)
            .toBe('insufficient_evidence');
        expect(decide(activity(), activity({ activityId: 'prior', date: '2026-09-10', normalizedPower: 0 })).state)
            .toBe('insufficient_evidence');
        expect(decide(activity(), activity({ activityId: 'prior', date: '2026-09-10', averageHr: 0 })).state)
            .toBe('insufficient_evidence');
    });

    it('preserves source completeness instead of inferring it from occurrence IDs', () => {
        const result = decide(
            activity(), activity({ activityId: 'prior', date: '2026-09-10' }),
            { performedOccurrenceId: 'now', sourceCompleteness: 'partial' },
            { performedOccurrenceId: 'prior', sourceCompleteness: 'canonical' },
        );
        expect(result.provenance.sourceCompleteness).toBe('partial');
    });

    it('withholds comparison when multiple provider sources have no primary selection', () => {
        const result = decide(
            activity(), activity({ activityId: 'prior', date: '2026-09-10' }),
            { performedOccurrenceId: 'now', sourceCompleteness: 'ambiguous' },
            { performedOccurrenceId: 'prior', sourceCompleteness: 'canonical' },
        );
        expect(result.state).toBe('insufficient_evidence');
        expect(result.hardRejections).toEqual(['multiple provider sources lack a primary selection']);
        expect(result.provenance.sourceCompleteness).toBe('ambiguous');
    });

    it('keeps match basis scoped to the requested feature family', () => {
        const current = activity({ fitWorkoutFingerprint: 'same-fit' });
        const prior = activity({ activityId: 'prior', date: '2026-09-10', fitWorkoutFingerprint: 'same-fit' });
        const result = decideSessionComparability({
            featureFamily: 'cycling_steady_power_hr',
            current: {
                activity: current,
                strength: {
                    exerciseIdentity: 'catalog:front_squat',
                    identitySource: 'canonical',
                    loadType: 'external_load',
                    repetitions: 5,
                    sourceCompleteness: 'canonical',
                },
            },
            prior: {
                activity: prior,
                strength: {
                    exerciseIdentity: 'catalog:front_squat',
                    identitySource: 'canonical',
                    loadType: 'external_load',
                    repetitions: 5,
                    sourceCompleteness: 'canonical',
                },
            },
        });
        expect(result).toMatchObject({
            state: 'comparable',
            matchBasis: 'provider_fallback',
            provenance: { protocolIdentity: 'provider_fingerprint' },
        });
    });

    it('centralizes strength mechanics without requiring a synthetic Garmin activity', () => {
        const current = {
            identity: { sourceCompleteness: 'canonical' as const },
            strength: { exerciseIdentity: 'catalog:front_squat', identitySource: 'canonical' as const, loadType: 'external_load' as const, repetitions: 5, sourceCompleteness: 'canonical' as const },
        };
        const prior = {
            identity: { sourceCompleteness: 'canonical' as const },
            strength: { exerciseIdentity: 'catalog:front_squat', identitySource: 'canonical' as const, loadType: 'external_load' as const, repetitions: 5, sourceCompleteness: 'canonical' as const },
        };
        const comparable = decideSessionComparability({ featureFamily: 'strength_set_response', current, prior });
        expect(comparable).toMatchObject({
            state: 'comparable',
            matchBasis: 'canonical_exercise_identity',
            confidenceCeiling: 'moderate',
            provenance: { sourceCompleteness: 'canonical', measurementSensorEvidence: 'sufficient' },
        });

        const differentReps = decideSessionComparability({
            featureFamily: 'strength_set_response', current,
            prior: { ...prior, strength: { ...prior.strength, repetitions: 3 } },
        });
        expect(differentReps).toMatchObject({ state: 'not_comparable', hardRejections: ['different repetition count'] });

        const differentLoadType = decideSessionComparability({
            featureFamily: 'strength_set_response', current,
            prior: { ...prior, strength: { ...prior.strength, loadType: 'repetition_only' } },
        });
        expect(differentLoadType).toMatchObject({ state: 'not_comparable', hardRejections: ['different load type'] });

        const missingReps = decideSessionComparability({
            featureFamily: 'strength_set_response', current,
            prior: { ...prior, strength: { exerciseIdentity: 'catalog:front_squat', identitySource: 'canonical', loadType: 'external_load', sourceCompleteness: 'canonical' } },
        });
        expect(missingReps).toMatchObject({ state: 'insufficient_evidence', hardRejections: ['repetition evidence unavailable'] });

        const providerOnly = decideSessionComparability({
            featureFamily: 'strength_set_response',
            current: { strength: { ...current.strength, identitySource: 'provider', sourceCompleteness: 'provider_fallback' } },
            prior: { strength: { ...prior.strength, identitySource: 'provider', sourceCompleteness: 'provider_fallback' } },
        });
        expect(providerOnly).toMatchObject({
            state: 'comparable', matchBasis: 'provider_fallback', confidenceCeiling: 'low',
        });

        const structuredWithAmbiguousProviderSelection = decideSessionComparability({
            featureFamily: 'strength_set_response',
            current: { ...current, identity: { sourceCompleteness: 'ambiguous' } },
            prior,
        });
        expect(structuredWithAmbiguousProviderSelection).toMatchObject({
            state: 'comparable',
            matchBasis: 'canonical_exercise_identity',
            confidenceCeiling: 'moderate',
            provenance: { sourceCompleteness: 'canonical', venueEnvironmentEvidence: 'not_required' },
        });

        const ambiguousProviderOnly = decideSessionComparability({
            featureFamily: 'strength_set_response',
            current: { strength: { ...current.strength, identitySource: 'provider', sourceCompleteness: 'ambiguous' } },
            prior: { strength: { ...prior.strength, identitySource: 'provider', sourceCompleteness: 'provider_fallback' } },
        });
        expect(ambiguousProviderOnly).toMatchObject({
            state: 'insufficient_evidence',
            hardRejections: ['strength evidence source selection is ambiguous'],
        });

        const unresolvedStructured = decideSessionComparability({
            featureFamily: 'strength_set_response',
            current: { strength: { ...current.strength, identitySource: 'unresolved_structured' } },
            prior,
        });
        expect(unresolvedStructured).toMatchObject({
            state: 'insufficient_evidence',
            hardRejections: ['exercise identity sources do not align'],
        });

        const differentExercise = decideSessionComparability({
            featureFamily: 'strength_set_response',
            current,
            prior: { ...prior, strength: { ...prior.strength, exerciseIdentity: 'catalog:back_squat' } },
        });
        expect(differentExercise).toMatchObject({
            state: 'not_comparable',
            hardRejections: ['different exercise identity'],
        });
    });
});
