import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    deriveFactsFromOccurrence,
    compareCanonicalVsLegacyFacts,
    normalizeModality,
    templateIdForWorkoutId,
    type PerformedExposureFact,
    type HydratedOccurrenceContext,
} from './performedTrainingFacts';
import { getPerformedTrainingFactsInRange } from '../training-occurrence/performedTrainingFactsService';
import type { PerformedTrainingOccurrence } from '../training-occurrence/models';
import { performedTrainingOccurrenceRepository as repository } from '../training-occurrence/repository';
import { activityService } from '../services/activityService';
import type { NormalizedGarminActivity, CompletedTrainingEvent } from './models';

vi.mock('../training-occurrence/repository', () => ({
    performedTrainingOccurrenceRepository: {
        queryActiveInDateWindow: vi.fn(),
    },
}));

vi.mock('../services/sessionExecutionService', () => ({
    sessionExecutionService: {
        getExecution: vi.fn(),
    },
}));

vi.mock('../services/activityService', () => ({
    activityService: {
        getActivitiesInRange: vi.fn(),
    },
}));

vi.mock('../sessions/sessionDefinitionResolver', () => ({
    resolveSessionDefinition: vi.fn().mockResolvedValue({ status: 'MISSING' }),
}));

function mockOccurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-test-1',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-09-01',
        modality: 'Strength',
        sourceRefs: [],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-09-01T10:00:00Z',
        updatedAt: '2026-09-01T10:00:00Z',
        ...overrides,
    };
}

function legacyEvent(
    id: string,
    date: string,
    modality: 'Strength' | 'Cycling' | 'Running',
): CompletedTrainingEvent {
    return {
        id,
        date,
        durationMin: 60,
        modality,
        intensity: 'easy',
        evidenceTier: 'durationIntensity',
    } as unknown as CompletedTrainingEvent;
}

function canonicalExposure(
    id: string,
    localDate: string,
    modality: PerformedExposureFact['modality'],
): PerformedExposureFact {
    return {
        performedOccurrenceId: id,
        localDate,
        modality,
        confidence: 'inferred',
        sourceKinds: ['provider_activity'],
        evidenceTier: 'durationIntensity',
    };
}

describe('performedTrainingFacts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('normalizeModality', () => {
        it('normalizes common strength and endurance terms', () => {
            expect(normalizeModality('strength_training')).toBe('Strength');
            expect(normalizeModality('weight_training')).toBe('Strength');
            expect(normalizeModality('cycling')).toBe('Cycling');
            expect(normalizeModality('road_biking')).toBe('Cycling');
            expect(normalizeModality('running')).toBe('Running');
            expect(normalizeModality('trail_running')).toBe('Running');
            expect(normalizeModality('yoga')).toBe('Mobility');
            expect(normalizeModality('unknown_sport')).toBe('Unknown');
            expect(normalizeModality(undefined)).toBe('Unknown');
        });
    });

    describe('template identity inference', () => {
        it('does not fabricate a template id when one workout serves multiple engine templates', () => {
            expect(templateIdForWorkoutId('strength_full_body_maintenance_01')).toBeUndefined();
        });
    });

    describe('deriveFactsFromOccurrence (pure derivation)', () => {
        it('Garmin-only strength produces broad Strength exposure without inventing an exact category', () => {
            const occurrence = mockOccurrence({
                sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }],
            });
            const garminActivity: NormalizedGarminActivity = {
                activityId: 'act-1',
                date: '2026-09-01',
                type: 'strength_training',
                durationMin: 77,
                averageHr: 85,
                trainingEffectAerobic: 0.2,
                trainingEffectAnaerobic: 0,
                activityTrainingLoad: 2.9,
                intensityTag: 'easy',
            };
            const hydrated: HydratedOccurrenceContext = {
                provider: {
                    activityId: 'act-1',
                    provider: 'garmin',
                    modality: 'Strength',
                    durationMin: 77,
                    garminActivity,
                },
            };

            const { exposure, coverageCredits } = deriveFactsFromOccurrence(occurrence, hydrated);

            expect(exposure.modality).toBe('Strength');
            expect(exposure.category).toBeUndefined();
            expect(exposure.confidence).toBe('inferred');
            expect(exposure.sourceKinds).toEqual(['provider_activity']);
            expect(exposure.durationMin).toBe(77);
            expect(exposure.workoutId).toBeUndefined();

            expect(coverageCredits).toHaveLength(1);
            expect(coverageCredits[0].coverageKey).toBe('primary_strength');
            expect(coverageCredits[0].creditKind).toBe('none');
            expect(coverageCredits[0].reasonCode).toBe('generic_modality_only');
        });

        it('generic cycling exposure does not synthesize Easy Endurance role semantics', () => {
            const occurrence = mockOccurrence({ modality: 'Cycling' });
            const { exposure } = deriveFactsFromOccurrence(occurrence, {
                provider: {
                    activityId: 'ride-1',
                    provider: 'garmin',
                    modality: 'Cycling',
                    durationMin: 45,
                },
            });

            expect(exposure.modality).toBe('Cycling');
            expect(exposure.category).toBeUndefined();
        });

        it('uses known provider modality when canonical modality is present but unrecognized', () => {
            const occurrence = mockOccurrence({ modality: 'provider_specific_unknown' });
            const { exposure } = deriveFactsFromOccurrence(occurrence, {
                provider: {
                    activityId: 'ride-1',
                    provider: 'garmin',
                    modality: 'Cycling',
                    durationMin: 45,
                },
            });

            expect(exposure.modality).toBe('Cycling');
        });

        it('keeps canonical local date across a midnight-adjacent provider timestamp', () => {
            const occurrence = mockOccurrence({
                localDate: '2026-09-01',
                startedAt: undefined,
                sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'ride-midnight' }],
            });
            const garminActivity: NormalizedGarminActivity = {
                activityId: 'ride-midnight',
                date: '2026-09-02',
                type: 'cycling',
                durationMin: 45,
                startedAt: '2026-09-02T00:05:00Z',
                endedAt: '2026-09-02T00:50:00Z',
                trainingEffectAerobic: 1.2,
                trainingEffectAnaerobic: 0,
                averageHr: 118,
                activityTrainingLoad: 18,
                intensityTag: 'easy',
            };

            const { exposure } = deriveFactsFromOccurrence(occurrence, {
                provider: {
                    activityId: 'ride-midnight',
                    provider: 'garmin',
                    modality: 'Cycling',
                    startedAt: garminActivity.startedAt,
                    endedAt: garminActivity.endedAt,
                    durationMin: 45,
                    garminActivity,
                },
            });

            expect(exposure.localDate).toBe('2026-09-01');
            expect(exposure.startedAt).toBe('2026-09-02T00:05:00Z');
        });

        it('derives a missing local date from the start instant in Europe/Warsaw', () => {
            const occurrence = mockOccurrence({
                localDate: undefined,
                startedAt: '2026-09-01T23:30:00Z',
            });

            const { exposure } = deriveFactsFromOccurrence(occurrence, {});

            expect(exposure.localDate).toBe('2026-09-02');
        });

        it('rejects an impossible canonical local calendar date', () => {
            const occurrence = mockOccurrence({ localDate: '2026-02-30' });

            expect(() => deriveFactsFromOccurrence(occurrence, {})).toThrow(
                'invalid performed local date: 2026-02-30',
            );
        });

        it('rejects a malformed start timestamp before deriving a local date', () => {
            const occurrence = mockOccurrence({
                localDate: undefined,
                startedAt: 'not-a-timestamp',
            });

            expect(() => deriveFactsFromOccurrence(occurrence, {})).toThrow(
                'invalid start time: not-a-timestamp',
            );
        });

        it('structured strength + Garmin produces one exposure and derives exact catalog category (D4)', () => {
            const occurrence = mockOccurrence({
                sourceRefs: [
                    { kind: 'structured_execution', executionId: 'exec-1' },
                    { kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' },
                ],
            });
            const hydrated: HydratedOccurrenceContext = {
                structured: {
                    executionId: 'exec-1',
                    workoutId: 'strength_full_body_maintenance_01',
                    templateId: 'str_full_01',
                    modality: 'Strength',
                    durationMin: 45,
                },
                provider: {
                    activityId: 'act-1',
                    provider: 'garmin',
                    modality: 'Strength',
                    durationMin: 77,
                },
            };

            const { exposure, coverageCredits } = deriveFactsFromOccurrence(occurrence, hydrated);

            expect(exposure.modality).toBe('Strength');
            expect(exposure.category).toBe('Full-body Strength');
            expect(exposure.workoutId).toBe('strength_full_body_maintenance_01');
            expect(exposure.templateId).toBe('str_full_01');
            expect(exposure.confidence).toBe('exact');
            expect(exposure.sourceKinds).toEqual(['structured_execution', 'provider_activity']);
            expect(exposure.durationMin).toBe(45);

            expect(coverageCredits).toHaveLength(1);
            expect(coverageCredits[0].coverageKey).toBe('primary_strength');
            expect(coverageCredits[0].creditKind).toBe('exact');
            expect(coverageCredits[0].reasonCode).toBe('exact_workout_identity');
        });

        it('derives a safe shared category from workout identity without inventing a shared template id', () => {
            const occurrence = mockOccurrence();
            const { exposure } = deriveFactsFromOccurrence(occurrence, {
                structured: {
                    executionId: 'exec-1',
                    workoutId: 'strength_full_body_maintenance_01',
                    modality: 'Strength',
                    durationMin: 45,
                },
            });

            expect(exposure.category).toBe('Full-body Strength');
            expect(exposure.templateId).toBeUndefined();
        });

        it('legacy strength stays generic instead of inventing full-body role semantics (D3)', () => {
            const occurrence = mockOccurrence({
                sourceRefs: [{ kind: 'structured_execution', executionId: 'legacy-sess-1' }],
            });
            const hydrated: HydratedOccurrenceContext = {
                structured: {
                    executionId: 'legacy-sess-1',
                    isLegacyStrength: true,
                    modality: 'Strength',
                    durationMin: 60,
                },
            };

            const { exposure, coverageCredits } = deriveFactsFromOccurrence(occurrence, hydrated);

            expect(exposure.modality).toBe('Strength');
            expect(exposure.category).toBeUndefined();
            expect(exposure.confidence).toBe('high');
            expect(exposure.sourceKinds).toEqual(['legacy_strength']);
            expect(exposure.workoutId).toBeUndefined();

            expect(coverageCredits).toHaveLength(1);
            expect(coverageCredits[0].creditKind).toBe('none');
            expect(coverageCredits[0].reasonCode).toBe('generic_modality_only');
        });

        it('fails visibly rather than fabricating a 1970 date when no performed date exists', () => {
            const occurrence = mockOccurrence({ localDate: undefined, startedAt: undefined });

            expect(() => deriveFactsFromOccurrence(occurrence, {})).toThrow(
                'has no performed local date or start time',
            );
        });
    });

    describe('getPerformedTrainingFactsInRange (query & repository interaction)', () => {
        it('returns empty snapshot when date range is empty', async () => {
            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-02', '2026-09-02');
            expect(snapshot.exposures).toHaveLength(0);
            expect(snapshot.coverageCredits).toHaveLength(0);
        });

        it('hydrates every active occurrence once so same-day unrelated workouts stay distinct', async () => {
            const occ1 = mockOccurrence({ performedOccurrenceId: 'pto-1', localDate: '2026-09-01' });
            const occ2 = mockOccurrence({ performedOccurrenceId: 'pto-2', localDate: '2026-09-01' });

            vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occ1, occ2]);
            vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
                status: 'AVAILABLE',
                data: [],
                revision: 'rev-1',
            });

            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-08-31', '2026-09-02');
            expect(snapshot.exposures.map(e => e.performedOccurrenceId)).toEqual(['pto-1', 'pto-2']);
            expect(repository.queryActiveInDateWindow).toHaveBeenCalledWith('user-1', '2026-08-31', '2026-09-01');
        });
    });

    describe('compareCanonicalVsLegacyFacts', () => {
        it('reports parity when date, modality and multiplicity match', () => {
            const result = compareCanonicalVsLegacyFacts(
                [canonicalExposure('pto-1', '2026-09-01', 'Strength')],
                [legacyEvent('evt-1', '2026-09-01', 'Strength')],
            );

            expect(result.exposureCountDelta).toBe(0);
            expect(result.mismatchCount).toBe(0);
            expect(result.mismatches).toEqual([]);
        });

        it('detects modality drift even when row counts match', () => {
            const result = compareCanonicalVsLegacyFacts(
                [canonicalExposure('pto-1', '2026-09-01', 'Strength')],
                [legacyEvent('evt-1', '2026-09-01', 'Cycling')],
            );

            expect(result.exposureCountDelta).toBe(0);
            expect(result.mismatchCount).toBe(1);
            expect(result.mismatches).toEqual([
                expect.objectContaining({ type: 'modality_mismatch' }),
            ]);
        });

        it('detects date drift even when row counts match', () => {
            const result = compareCanonicalVsLegacyFacts(
                [canonicalExposure('pto-1', '2026-09-02', 'Strength')],
                [legacyEvent('evt-1', '2026-09-01', 'Strength')],
            );

            expect(result.exposureCountDelta).toBe(0);
            expect(result.mismatchCount).toBe(1);
            expect(result.mismatches).toEqual([
                expect.objectContaining({ type: 'date_mismatch' }),
            ]);
        });

        it('is multiset-aware and detects a legacy duplicate split after consuming an exact match', () => {
            const result = compareCanonicalVsLegacyFacts(
                [canonicalExposure('pto-1', '2026-09-01', 'Strength')],
                [
                    legacyEvent('evt-1', '2026-09-01', 'Strength'),
                    legacyEvent('evt-2', '2026-09-01', 'Strength'),
                ],
            );

            expect(result.exposureCountDelta).toBe(-1);
            expect(result.mismatchCount).toBe(1);
            expect(result.mismatches).toEqual([
                expect.objectContaining({ type: 'legacy_duplicate' }),
            ]);
        });

        it('detects canonical occurrences that have no legacy counterpart', () => {
            const result = compareCanonicalVsLegacyFacts(
                [
                    canonicalExposure('pto-1', '2026-09-01', 'Strength'),
                    canonicalExposure('pto-2', '2026-09-02', 'Cycling'),
                ],
                [legacyEvent('evt-1', '2026-09-01', 'Strength')],
            );

            expect(result.exposureCountDelta).toBe(1);
            expect(result.mismatchCount).toBe(1);
            expect(result.mismatches).toEqual([
                expect.objectContaining({ type: 'legacy_unmatched' }),
            ]);
        });
    });
});
