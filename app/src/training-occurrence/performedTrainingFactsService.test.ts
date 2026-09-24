import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getPerformedTrainingFactsInRange,
    getPerformedTrainingFactsThroughToday,
} from './performedTrainingFactsService';
import { performedTrainingOccurrenceRepository as repository } from './repository';
import type { PerformedTrainingOccurrence } from './models';
import { activityService } from '../services/activityService';
import { sessionExecutionService } from '../services/sessionExecutionService';
import { resolveSessionDefinition } from '../sessions/sessionDefinitionResolver';
import { recommendationService } from '../services/recommendationService';
import { templateIdForWorkoutId } from '../engine/performedTrainingFacts';
import type { DailyRecommendation, NormalizedGarminActivity } from '../engine/models';
import type { SessionExecution } from '../sessions/models';
import type { SessionDefinition } from '../sessions/models';

vi.mock('./repository', () => ({
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
    resolveSessionDefinition: vi.fn(),
}));

vi.mock('../services/recommendationService', () => ({
    recommendationService: {
        getRecommendationsInRange: vi.fn(),
    },
}));

function occurrence(overrides: Partial<PerformedTrainingOccurrence> = {}): PerformedTrainingOccurrence {
    return {
        schemaVersion: 1,
        performedOccurrenceId: 'pto-1',
        userId: 'user-1',
        status: 'active',
        localDate: '2026-09-01',
        sourceRefs: [],
        reconciliation: { state: 'single_source' },
        createdAt: '2026-09-01T10:00:00Z',
        updatedAt: '2026-09-01T11:00:00Z',
        ...overrides,
    };
}

function garminActivity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'act-1',
        date: '2026-09-01',
        type: 'cycling',
        durationMin: 60,
        averageHr: 140,
        trainingEffectAerobic: 3.0,
        trainingEffectAnaerobic: 1.0,
        activityTrainingLoad: 100,
        intensityTag: 'moderate',
        startedAt: '2026-09-01T08:00:00Z',
        endedAt: '2026-09-01T09:00:00Z',
        ...overrides,
    };
}

function sessionExecution(overrides: Partial<SessionExecution> = {}): SessionExecution {
    return {
        userId: 'user-1',
        executionId: 'exec-1',
        sessionSource: { kind: 'catalog', workoutId: 'VO2_MAX_INTERVALS', catalogVersion: 'v1' },
        prescriptionHash: 'hash-1',
        date: '2026-09-01',
        startedAt: '2026-09-01T08:00:00Z',
        completedAt: '2026-09-01T09:00:00Z',
        updatedAt: '2026-09-01T09:00:00Z',
        state: 'completed',
        schemaVersion: 1,
        ...overrides,
    };
}

const MODIFY_TIER_WALK_WORKOUT_ID = 'walking_brisk_continuous_01';

function modifyTierRecommendation(overrides: Partial<DailyRecommendation> = {}): DailyRecommendation {
    return {
        userId: 'user-1',
        date: '2026-09-01',
        templateId: templateIdForWorkoutId(MODIFY_TIER_WALK_WORKOUT_ID) ?? 'missing-template',
        templateTitle: 'Easy walk',
        category: 'Easy Endurance',
        modality: 'Walking',
        mode: 'modify',
        rationale: 'modify-tier day',
        schemaVersion: 2,
        createdAt: '2026-09-01T06:00:00Z',
        updatedAt: '2026-09-01T06:00:00Z',
        adjustment: {
            direction: 'easier',
            tier: 1,
            originalTemplateId: 'template',
            originalTemplateTitle: 'Session',
            adjustedDoseLabel: 'Short',
            rationale: 'easier dose',
        },
        primarySession: {
            sessionSource: { kind: 'catalog', workoutId: MODIFY_TIER_WALK_WORKOUT_ID, catalogVersion: 'v1' },
            prescriptionHash: 'hash-1',
        },
        adherence: { respondedAt: null, followed: null, actualModality: null, actualDurationMin: null, skipped: false, notes: null },
        ...overrides,
    };
}

describe('performedTrainingFactsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
        vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'MISSING' });
        vi.mocked(resolveSessionDefinition).mockResolvedValue({ status: 'MISSING' });
        vi.mocked(recommendationService.getRecommendationsInRange).mockResolvedValue({ status: 'AVAILABLE', data: [], revision: null });
    });

    describe('getPerformedTrainingFactsInRange', () => {
        it('returns empty snapshot when toDateInclusive < fromDateInclusive', async () => {
            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-05', '2026-09-05');

            expect(snapshot).toEqual({
                asOfDate: '2026-09-05',
                windowDays: 0,
                revision: 'canonical-facts-v1:evergreen_general:2026-09-05:2026-09-05:empty',
                exposures: [],
                coverageCredits: [],
            });
            expect(repository.queryActiveInDateWindow).not.toHaveBeenCalled();
        });

        it('fetches activities from activityService when preloadedActivities are not provided', async () => {
            vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }] }),
            ]);
            vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
                status: 'AVAILABLE',
                data: [garminActivity({ activityId: 'act-1', type: 'running' })],
                revision: 'rev-1',
            });

            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

            expect(activityService.getActivitiesInRange).toHaveBeenCalledWith('user-1', '2026-09-01', '2026-09-02');
            expect(snapshot.exposures[0].modality).toBe('Running');
        });

        it('handles non-AVAILABLE activityService status gracefully', async () => {
            vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }] }),
            ]);
            vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
                status: 'UNAVAILABLE',
                operation: 'getActivitiesInRange',
                retryable: true,
            });

            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

            expect(snapshot.exposures).toHaveLength(1);
            expect(snapshot.exposures[0].modality).toBe('Unknown');
        });

        it('uses preloadedActivities when provided instead of calling activityService', async () => {
            vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }] }),
            ]);

            const preloaded = [garminActivity({ activityId: 'act-1', type: 'swimming' })];
            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02', {
                preloadedActivities: preloaded,
            });

            expect(activityService.getActivitiesInRange).not.toHaveBeenCalled();
            expect(snapshot.exposures[0].modality).toBe('Swimming');
        });

        describe('structured execution hydration', () => {
            it('hydrates a catalog workout structured execution using catalog metadata', async () => {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-1' }] }),
                ]);
                vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
                    status: 'AVAILABLE',
                    data: sessionExecution({
                        sessionSource: { kind: 'catalog', workoutId: 'VO2_MAX_INTERVALS', catalogVersion: 'v1' },
                        startedAt: '2026-09-01T08:00:00Z',
                        completedAt: '2026-09-01T09:15:00Z',
                    }),
                    revision: null,
                });

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0]).toMatchObject({
                    workoutId: 'VO2_MAX_INTERVALS',
                    durationMin: 75,
                });
            });

            it('hydrates legacy strength catalog workout correctly', async () => {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-legacy' }] }),
                ]);
                vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
                    status: 'AVAILABLE',
                    data: sessionExecution({
                        executionId: 'exec-legacy',
                        sessionSource: { kind: 'catalog', workoutId: 'legacy_strength', catalogVersion: 'v1' },
                    }),
                    revision: null,
                });

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0].modality).toBe('Strength');
            });

            it('hydrates manual legacy strength execution correctly', async () => {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-manual' }] }),
                ]);
                vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
                    status: 'AVAILABLE',
                    data: sessionExecution({
                        executionId: 'exec-manual',
                        sessionSource: { kind: 'manual', definitionId: 'legacy_strength', revision: 1, contentHash: 'abc' },
                    }),
                    revision: null,
                });

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0].modality).toBe('Strength');
            });

            it('resolves dominant modality from resolveSessionDefinition when workout catalog has no modality', async () => {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: 'exec-custom' }] }),
                ]);
                vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({
                    status: 'AVAILABLE',
                    data: sessionExecution({
                        executionId: 'exec-custom',
                        sessionSource: { kind: 'manual', definitionId: 'custom-def', revision: 1, contentHash: 'abc' },
                    }),
                    revision: null,
                });
                vi.mocked(resolveSessionDefinition).mockResolvedValue({
                    status: 'AVAILABLE',
                    data: { dominantModality: 'Cycling' } as SessionDefinition,
                    revision: 'rev-def-1',
                });

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0].modality).toBe('Cycling');
            });
        });

        describe('readiness-modified dose marker', () => {
            function arrangeStructuredExecution(execution: SessionExecution = sessionExecution({ sessionSource: { kind: 'catalog', workoutId: MODIFY_TIER_WALK_WORKOUT_ID, catalogVersion: 'v1' } })) {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'structured_execution', executionId: execution.executionId }] }),
                ]);
                vi.mocked(sessionExecutionService.getExecution).mockResolvedValue({ status: 'AVAILABLE', data: execution, revision: null });
            }

            function arrangeRecommendations(data: DailyRecommendation[], revision: string | null = null) {
                vi.mocked(recommendationService.getRecommendationsInRange).mockResolvedValue({ status: 'AVAILABLE', data, revision });
            }

            const baseRecommendation = modifyTierRecommendation();

            it('marks the executed primary session of a modify-tier easier-dose recommendation', async () => {
                arrangeStructuredExecution();
                arrangeRecommendations([baseRecommendation], '2026-09-01:3');

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0].isReadinessModifiedDose).toBe(true);
                expect(recommendationService.getRecommendationsInRange).toHaveBeenCalledWith('user-1', '2026-09-01', '2026-09-02');
                expect(snapshot.revision).toMatch(/:rec=2026-09-01:3$/);
            });

            it('falls back to the recommended template when the recommendation has no session binding', async () => {
                arrangeStructuredExecution();
                arrangeRecommendations([modifyTierRecommendation({ primarySession: undefined })]);

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0].isReadinessModifiedDose).toBe(true);
            });

            it.each([
                ['a train-tier recommendation', modifyTierRecommendation({ mode: 'train' })],
                ['a modify-tier recommendation without a dose adjustment', modifyTierRecommendation({ adjustment: undefined })],
                ['a harder adjustment', modifyTierRecommendation({ adjustment: { ...baseRecommendation.adjustment!, direction: 'harder' } })],
                ['a template swap rather than a dose variation', modifyTierRecommendation({ adjustment: { ...baseRecommendation.adjustment!, tier: 3 } })],
                ['a different bound prescription', modifyTierRecommendation({ primarySession: { ...baseRecommendation.primarySession!, prescriptionHash: 'hash-other' } })],
                ['a recommendation for another date', modifyTierRecommendation({ date: '2026-08-31' })],
            ])('does not mark an execution matched against %s', async (_label, recommendation) => {
                arrangeStructuredExecution();
                arrangeRecommendations([recommendation]);

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-08-31', '2026-09-02');

                expect(snapshot.exposures[0].isReadinessModifiedDose).toBeUndefined();
            });

            it('degrades to no marker when recommendations are unavailable', async () => {
                arrangeStructuredExecution();
                vi.mocked(recommendationService.getRecommendationsInRange).mockResolvedValue({
                    status: 'UNAVAILABLE', operation: 'read recommendation history', retryable: true,
                });

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures).toHaveLength(1);
                expect(snapshot.exposures[0].isReadinessModifiedDose).toBeUndefined();
                expect(snapshot.revision).not.toContain(':rec=');
            });

            it('skips the recommendation read when no occurrence has a structured execution', async () => {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }] }),
                ]);

                await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02', { preloadedActivities: [garminActivity()] });

                expect(recommendationService.getRecommendationsInRange).not.toHaveBeenCalled();
            });
        });

        describe('provider activity hydration', () => {
            it('hydrates provider activity with duration and modality when available', async () => {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-1' }] }),
                ]);
                vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
                    status: 'AVAILABLE',
                    data: [garminActivity({ activityId: 'act-1', type: 'running', durationMin: 45 })],
                    revision: null,
                });

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0]).toMatchObject({
                    modality: 'Running',
                    durationMin: 45,
                });
            });

            it('handles missing provider activity in activities map gracefully', async () => {
                vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([
                    occurrence({ sourceRefs: [{ kind: 'provider_activity', provider: 'garmin', activityId: 'act-missing' }] }),
                ]);
                vi.mocked(activityService.getActivitiesInRange).mockResolvedValue({
                    status: 'AVAILABLE',
                    data: [],
                    revision: null,
                });

                const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-02');

                expect(snapshot.exposures[0].modality).toBe('Unknown');
            });
        });

        it('sorts exposures by localDate and calculates revision based on occurrences', async () => {
            const occ1 = occurrence({ performedOccurrenceId: 'pto-2', localDate: '2026-09-02', updatedAt: '2026-09-02T10:00:00Z' });
            const occ2 = occurrence({ performedOccurrenceId: 'pto-1', localDate: '2026-09-01', updatedAt: '2026-09-01T10:00:00Z' });

            vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([occ1, occ2]);

            const snapshot = await getPerformedTrainingFactsInRange('user-1', '2026-09-01', '2026-09-03');

            expect(snapshot.exposures[0].performedOccurrenceId).toBe('pto-1');
            expect(snapshot.exposures[1].performedOccurrenceId).toBe('pto-2');
            expect(snapshot.revision).toContain('pto-1:2026-09-01T10:00:00Z|pto-2:2026-09-02T10:00:00Z');
            expect(snapshot.windowDays).toBe(2);
        });
    });

    describe('getPerformedTrainingFactsThroughToday', () => {
        it('calculates the next day inclusive date boundary correctly', async () => {
            vi.mocked(repository.queryActiveInDateWindow).mockResolvedValue([]);

            await getPerformedTrainingFactsThroughToday('user-1', '2026-09-01', '2026-09-05');

            expect(repository.queryActiveInDateWindow).toHaveBeenCalledWith('user-1', '2026-09-01', '2026-09-05');
        });
    });
});
