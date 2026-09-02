import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    deriveFactsFromOccurrence,
    getPerformedTrainingFactsInRange,
    compareCanonicalVsLegacyFacts,
    normalizeModality,
    type PerformedExposureFact,
    type HydratedOccurrenceContext,
} from './performedTrainingFacts';
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

    describe('deriveFactsFromOccurrence (pure derivation)', () => {
        it('Garmin-only strength produces broad Strength exposure and generic_modality_only credit', () => {
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
            expect(exposure.confidence).toBe('inferred');
            expect(exposure.sourceKinds).toEqual(['provider_activity']);
            expect(exposure.durationMin).toBe(77);
            expect(exposure.workoutId).toBeUndefined();

            // Weekly coverage credit should NOT be exact; generic modality only (D1, D5)
            expect(coverageCredits).toHaveLength(1);
            expect(coverageCredits[0].coverageKey).toBe('primary_strength');
            expect(coverageCredits[0].creditKind).toBe('none');
            expect(coverageCredits[0].reasonCode).toBe('generic_modality_only');
        });

        it('Structured strength + Garmin produces one exposure where structured execution semantics win (D4)', () => {
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
                    category: 'Full-body Strength',
                    durationMin: 45,
                },
                provider: {
                    activityId: 'act-1',
                    provider: 'garmin',
                    modality: 'Strength',
                    durationMin: 77, // watch ran longer
                },
            };

            const { exposure, coverageCredits } = deriveFactsFromOccurrence(occurrence, hydrated);

            expect(exposure.modality).toBe('Strength');
            expect(exposure.category).toBe('Full-body Strength');
            expect(exposure.workoutId).toBe('strength_full_body_maintenance_01');
            expect(exposure.templateId).toBe('str_full_01');
            expect(exposure.confidence).toBe('exact');
            expect(exposure.sourceKinds).toEqual(['structured_execution', 'provider_activity']);
            expect(exposure.durationMin).toBe(45); // structured duration wins

            // Weekly coverage awards exact credit once (D1, D4)
            expect(coverageCredits).toHaveLength(1);
            expect(coverageCredits[0].coverageKey).toBe('primary_strength');
            expect(coverageCredits[0].creditKind).toBe('exact');
            expect(coverageCredits[0].reasonCode).toBe('exact_workout_identity');
        });

        it('Legacy strength produces broad Strength exposure with high confidence (D3)', () => {
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
            expect(exposure.confidence).toBe('high');
            expect(exposure.sourceKinds).toEqual(['legacy_strength']);
            expect(exposure.workoutId).toBeUndefined(); // generic legacy does not invent exact workoutId

            expect(coverageCredits).toHaveLength(1);
            expect(coverageCredits[0].creditKind).toBe('none');
            expect(coverageCredits[0].reasonCode).toBe('generic_modality_only');
        });
    });

    describe('getPerformedTrainingFactsInRange (query & repository interaction)', () => {
        it('returns empty snapshot when date range is empty', async () => {
            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-02', '2026-09-02');
            expect(snapshot.exposures).toHaveLength(0);
            expect(snapshot.coverageCredits).toHaveLength(0);
        });

        it('hydrates active occurrences within range and ignores merged loser occurrences', async () => {
            const occ1 = mockOccurrence({ performedOccurrenceId: 'pto-1', localDate: '2026-09-01' });
            const occ2 = mockOccurrence({ performedOccurrenceId: 'pto-2', localDate: '2026-09-01' });

            // queryActiveInDateWindow already filters status == 'active', so merged occurrences are never returned
            vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occ1, occ2]);
            vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
                status: 'AVAILABLE',
                data: [],
                revision: 'rev-1',
            });

            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-08-31', '2026-09-02');
            expect(snapshot.exposures).toHaveLength(2);
            expect(repository.queryActiveInDateWindow).toHaveBeenCalledWith('user-1', '2026-08-31', '2026-09-01');
        });
    });

    describe('compareCanonicalVsLegacyFacts', () => {
        it('reports parity when exposure counts match', () => {
            const canonical: PerformedExposureFact[] = [{
                performedOccurrenceId: 'pto-1',
                localDate: '2026-09-01',
                modality: 'Strength',
                confidence: 'inferred',
                sourceKinds: ['provider_activity'],
                evidenceTier: 'durationIntensity',
            }];
            const legacy = [{
                id: 'evt-1',
                date: '2026-09-01',
                durationMin: 77,
                modality: 'Strength' as const,
                intensity: 'easy' as const,
                evidenceTier: 'durationIntensity' as const,
            }] as unknown as CompletedTrainingEvent[];

            const result = compareCanonicalVsLegacyFacts(canonical, legacy);
            expect(result.exposureCountDelta).toBe(0);
            expect(result.mismatchCount).toBe(0);
        });

        it('detects legacy duplicate split when legacy has 2 events for 1 physical session', () => {
            const canonical: PerformedExposureFact[] = [{
                performedOccurrenceId: 'pto-1',
                localDate: '2026-09-01',
                modality: 'Strength',
                confidence: 'exact',
                sourceKinds: ['structured_execution', 'provider_activity'],
                evidenceTier: 'completedStructuredWorkout',
            }];
            const legacy = [
                { id: 'evt-1', date: '2026-09-01', durationMin: 45, modality: 'Strength' as const, intensity: 'moderate' as const },
                { id: 'evt-2', date: '2026-09-01', durationMin: 77, modality: 'Strength' as const, intensity: 'easy' as const },
            ] as unknown as CompletedTrainingEvent[];

            const result = compareCanonicalVsLegacyFacts(canonical, legacy);
            expect(result.exposureCountDelta).toBe(-1);
            expect(result.mismatchCount).toBe(1);
            expect(result.mismatches[0].type).toBe('legacy_duplicate');
        });
    });
});
