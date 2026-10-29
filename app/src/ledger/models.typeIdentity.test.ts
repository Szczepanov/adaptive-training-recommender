import { expectTypeOf, test } from 'vitest';

test('shared types retain their engine identities', () => {
    expectTypeOf<import('../engine/models').WorkoutStimulusProfile>().toEqualTypeOf<import('./models').WorkoutStimulusProfile>();
    expectTypeOf<import('../engine/models').ActivityOverride>().toEqualTypeOf<import('./models').ActivityOverride>();
    expectTypeOf<import('../engine/models').CompletedTrainingIntensity>().toEqualTypeOf<import('./models').CompletedTrainingIntensity>();
    expectTypeOf<import('../engine/models').EvidenceTier>().toEqualTypeOf<import('./models').EvidenceTier>();
    expectTypeOf<import('../engine/models').AthleticCapabilityKey>().toEqualTypeOf<import('./models').AthleticCapabilityKey>();
    expectTypeOf<import('../engine/models').PerformanceGoalFamily>().toEqualTypeOf<import('./models').PerformanceGoalFamily>();
    expectTypeOf<import('../engine/models').PerformanceSubjectRef>().toEqualTypeOf<import('./models').PerformanceSubjectRef>();
    expectTypeOf<import('../engine/models').GoalPerformanceTarget>().toEqualTypeOf<import('./models').GoalPerformanceTarget>();
    expectTypeOf<import('../derived/assessments/performanceTargetPolicy').PerformanceGoalFamily>().toEqualTypeOf<import('./models').PerformanceGoalFamily>();
    expectTypeOf<import('../derived/assessments/performanceTargetPolicy').PerformanceSubjectRef>().toEqualTypeOf<import('./models').PerformanceSubjectRef>();
    expectTypeOf<import('../derived/assessments/performanceTargetPolicy').GoalPerformanceTarget>().toEqualTypeOf<import('./models').GoalPerformanceTarget>();
    expectTypeOf<import('../engine/models').SessionTemplate['category']>().toEqualTypeOf<import('./models').SessionCategory>();
    expectTypeOf<import('./models').ActivityOverride['overriddenModality']>().toEqualTypeOf<import('../engine/models').SessionTemplate['modality'] | 'Unknown'>();
});
