/** Synthetic `CompletedWorkoutView` builders shared by the #895 WP5 diagnostics tests. */
import type { NormalizedGarminActivity } from '../engine/models';
import type { CompletedWorkoutSourceReads, CompletedWorkoutView } from './completedWorkoutView';

export function garminActivity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'act-1',
        date: '2026-08-26',
        type: 'strength_training',
        durationMin: 40,
        trainingEffectAerobic: null,
        trainingEffectAnaerobic: null,
        averageHr: null,
        activityTrainingLoad: null,
        intensityTag: 'moderate',
        exerciseSets: [{ setOrder: 0, setType: 'active', exerciseName: 'squat', repetitionCount: 5, weightKg: 100 }],
        ...overrides,
    };
}

/** An activity whose `exerciseSets` key is absent (detail never stored), as opposed to `[]`. */
export function garminActivityWithoutSets(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return Object.fromEntries(
        Object.entries(garminActivity(overrides)).filter(([key]) => key !== 'exerciseSets'),
    ) as unknown as NormalizedGarminActivity;
}

export const completeReads: CompletedWorkoutSourceReads = {
    structured: { status: 'available' },
    provider: 'available',
    outbox: { status: 'read', queued: 0, failed: 0 },
    reconciliationSweep: 'completed',
    ambiguousCounterpart: false,
};

/** Default: a healthy matched structured + Garmin workout. Override per scenario. */
export function workoutView(
    overrides: Partial<Omit<CompletedWorkoutView, 'sourceReads'>> & { sourceReads?: Partial<CompletedWorkoutSourceReads> } = {},
): CompletedWorkoutView {
    const { sourceReads, ...rest } = overrides;
    return {
        performedOccurrenceId: 'pto-1',
        sourceKeys: ['structured_execution:exec-1', 'provider_activity:garmin:act-1'],
        localDate: '2026-08-26',
        modality: 'strength',
        startedAt: '2026-08-26T06:52:00.000Z',
        endedAt: '2026-08-26T07:32:00.000Z',
        sourceBadge: { hasStructured: true, hasProvider: true, providers: ['garmin'] },
        reconciliation: { state: 'matched', matcherVersion: 'matcher-v2', policyVersion: 'policy-v1', confidence: 0.9 },
        garmin: garminActivity(),
        garminExerciseSetsAreDiagnosticOnly: true,
        sourceReads: { ...completeReads, ...sourceReads },
        ...rest,
    };
}

/** Structured execution only: no provider ref, healthy reads, evaluated by a completed sweep. */
export function structuredOnlyView(
    overrides: Parameters<typeof workoutView>[0] = {},
): CompletedWorkoutView {
    const { sourceReads, ...rest } = overrides;
    return workoutView({
        performedOccurrenceId: 'pto-structured',
        sourceKeys: ['structured_execution:exec-1'],
        sourceBadge: { hasStructured: true, hasProvider: false, providers: [] },
        reconciliation: { state: 'single_source' },
        garmin: undefined,
        sourceReads: { provider: 'not_linked', ...sourceReads },
        ...rest,
    });
}

/** Garmin activity only: no structured ref. */
export function garminOnlyView(
    overrides: Parameters<typeof workoutView>[0] = {},
): CompletedWorkoutView {
    const { sourceReads, ...rest } = overrides;
    return workoutView({
        performedOccurrenceId: 'pto-garmin',
        sourceKeys: ['provider_activity:garmin:act-1'],
        sourceBadge: { hasStructured: false, hasProvider: true, providers: ['garmin'] },
        reconciliation: { state: 'single_source' },
        garminExerciseSetsAreDiagnosticOnly: false,
        sourceReads: { structured: { status: 'not_linked' }, outbox: { status: 'not_linked' }, ...sourceReads },
        ...rest,
    });
}
