import { describe, expect, it } from 'vitest';
import type { CapabilityMaintenanceResult } from './capabilityMaintenance';
import {
    deriveExposureLedger,
    renderExposureLedger,
    type ExposureLedgerInput,
    type ExposurePlannedSession,
} from './contextBriefExposureLedger';
import type {
    ActivityOverride,
    DailyRecommendation,
    NormalizedGarminActivity,
    TrainingSettings,
    UserPreferences,
} from './models';
import type { PerformedExposureFact } from '../derived/training/performedTrainingFacts';

const AS_OF = '2026-09-24';
const START = '2026-09-11';

function activity(overrides: Partial<NormalizedGarminActivity>): NormalizedGarminActivity {
    return {
        activityId: 'a',
        date: '2026-09-20',
        type: 'cycling',
        durationMin: 60,
        trainingEffectAerobic: 2.5,
        trainingEffectAnaerobic: 0.2,
        averageHr: 130,
        activityTrainingLoad: 80,
        intensityTag: 'easy',
        intensityClassificationVersion: 2,
        stimulusDomain: 'endurance',
        sessionCost: 'low',
        ...overrides,
    };
}

function recommendation(overrides: Partial<DailyRecommendation>): DailyRecommendation {
    return {
        userId: 'athlete',
        date: '2026-09-24',
        templateId: 'str_lower_01',
        templateTitle: 'Lower body',
        category: 'Lower-body Strength',
        modality: 'Strength',
        mode: 'train',
        rationale: 'test',
        schemaVersion: 1,
        createdAt: '',
        updatedAt: '',
        adherence: {
            respondedAt: null,
            followed: null,
            actualModality: null,
            actualDurationMin: null,
            skipped: false,
            notes: null,
        },
        ...overrides,
    };
}

function makeSettings(overrides: Partial<TrainingSettings> = {}): TrainingSettings {
    return {
        userId: 'athlete',
        schemaVersion: 3,
        equipment: {
            cable_machine: false,
            free_weights: true,
            indoor_bike: true,
            pullup_bar: false,
            treadmill: false,
        } as unknown as TrainingSettings['equipment'],
        guardrails: {
            avoid_high_impact: false,
            avoid_heavy_lower_body: false,
            avoid_overhead_pressing: false,
            avoid_heavy_spinal_loading: false,
        },
        defaults: { weekdayMaxMinutes: 90, weekendMaxMinutes: 240, environment: 'either' },
        preferences: { preferActiveRecovery: false },
        migration: { legacyReviewed: true, migratedAt: null },
        createdAt: '',
        updatedAt: '',
        ...overrides,
    } as TrainingSettings;
}

const mixedActivities: readonly NormalizedGarminActivity[] = [
    activity({
        activityId: 'race',
        date: '2026-09-13',
        intensityTag: 'hard',
        stimulusDomain: 'race',
        sessionCost: 'very_high',
        durationMin: 150,
        trainingEffectAerobic: 4.8,
        trainingEffectAnaerobic: 3.1,
        activityTrainingLoad: 320,
    }),
    activity({
        activityId: 'thr',
        date: '2026-09-18',
        intensityTag: 'hard',
        stimulusDomain: 'threshold',
        sessionCost: 'moderate',
        trainingEffectAerobic: 3.9,
    }),
    activity({
        activityId: 'z2long',
        date: '2026-09-21',
        intensityTag: 'easy',
        stimulusDomain: 'endurance',
        sessionCost: 'high',
        durationMin: 240,
        activityTrainingLoad: 210,
        trainingEffectAerobic: 3.4,
    }),
    activity({
        activityId: 'misc',
        date: '2026-09-19',
        type: 'other',
        intensityTag: 'moderate',
        stimulusDomain: 'unknown',
        sessionCost: 'low',
    }),
];

const mixedRecommendations: readonly DailyRecommendation[] = [
    recommendation({
        date: '2026-09-17',
        adherence: {
            respondedAt: '2026-09-17T18:00:00Z',
            followed: true,
            actualModality: null,
            actualDurationMin: 45,
            skipped: false,
            notes: null,
        },
    }),
];

const mixedFacts: readonly PerformedExposureFact[] = [
    {
        performedOccurrenceId: 'occ-power',
        localDate: '2026-09-20',
        modality: 'Strength',
        category: 'Full-body Strength',
        workoutId: 'strength_full_body_maintenance_01',
        workoutVariantId: 'full',
        confidence: 'exact',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'completedStructuredWorkout',
        deliveredUnilateralLowerBody: { workingSets: 4, stepIds: ['split-squat'] },
    },
    {
        performedOccurrenceId: 'occ-run',
        localDate: '2026-09-22',
        modality: 'Running',
        category: 'Easy Endurance',
        workoutId: 'running_easy_continuous_01',
        workoutVariantId: 'full',
        confidence: 'exact',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'completedStructuredWorkout',
    },
    {
        performedOccurrenceId: 'occ-field-rtt',
        localDate: '2026-09-16',
        modality: 'Field',
        category: 'Field Maintenance',
        workoutId: 'field_controlled_maintenance_01',
        workoutVariantId: 'return_to_training',
        confidence: 'exact',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'completedStructuredWorkout',
    },
];

const unknownVariantAndUnavailableFacts: readonly PerformedExposureFact[] = [
    {
        performedOccurrenceId: 'occ-field-unknown-variant',
        localDate: AS_OF,
        modality: 'Field',
        category: 'Field Maintenance',
        workoutId: 'field_controlled_maintenance_01',
        confidence: 'exact',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'completedStructuredWorkout',
    },
    {
        performedOccurrenceId: 'occ-strength-unreadable-sets',
        localDate: '2026-09-23',
        modality: 'Strength',
        category: 'Lower-body Strength',
        confidence: 'exact',
        sourceKinds: ['structured_execution'],
        evidenceTier: 'completedStructuredWorkout',
        deliveredCompositionUnavailable: true,
    },
];

const sampleOverride: Readonly<Record<string, ActivityOverride>> = {
    misc: {
        activityId: 'misc',
        userId: 'athlete',
        date: '2026-09-19',
        originalType: 'other',
        originalIntensityTag: 'moderate',
        overriddenModality: 'Running',
        overriddenIntensity: 'easy',
        createdAt: '',
        updatedAt: '',
    },
};

const samplePlannedSessions: readonly ExposurePlannedSession[] = [
    { date: '2026-09-25', modality: 'Cycling', intensity: 'hard', title: 'Threshold intervals' },
    { date: '2026-09-26', modality: 'Strength', intensity: 'moderate', title: 'Lower-body strength' },
    { date: '2026-09-27', modality: 'Running', intensity: 'easy', title: 'Easy run' },
    { date: '2026-09-28', modality: 'Field', intensity: 'moderate', title: 'Field maintenance' },
];

const maintenancePresent: CapabilityMaintenanceResult = {
    enabled: true,
    intervalDays: 14,
    placements: [],
    softContext: [],
    capabilities: [
        {
            capability: 'linear_speed_skill',
            status: 'satisfied',
            requiredStage: 2,
            lastQualifyingDate: '2026-09-20',
            nextDueDate: '2026-10-03',
            supportWorkoutIds: [],
            message: 'satisfied until 2026-10-03',
        },
        {
            capability: 'acceleration_deceleration',
            status: 'due',
            requiredStage: 3,
            lastQualifyingDate: AS_OF,
            nextDueDate: AS_OF,
            notBeforeDate: AS_OF,
            targetDate: AS_OF,
            fulfilment: { status: 'plannable' },
            supportWorkoutIds: ['field_acceleration_braking_01'],
            message: `due from ${AS_OF}; plannable`,
        },
        {
            capability: 'multidirectional_change_of_direction',
            status: 'satisfied',
            requiredStage: 4,
            lastQualifyingDate: AS_OF,
            nextDueDate: '2026-10-07',
            supportWorkoutIds: [],
            message: 'satisfied until 2026-10-07',
        },
        {
            capability: 'sport_skill',
            status: 'satisfied',
            requiredStage: 4,
            lastQualifyingDate: AS_OF,
            nextDueDate: '2026-10-07',
            supportWorkoutIds: [],
            message: 'satisfied until 2026-10-07',
        },
    ],
};

const maintenanceOverdue: CapabilityMaintenanceResult = {
    enabled: true,
    intervalDays: 14,
    placements: [],
    softContext: [],
    capabilities: [
        {
            capability: 'linear_speed_skill',
            status: 'overdue',
            requiredStage: 2,
            lastQualifyingDate: '2026-09-01',
            nextDueDate: '2026-09-14',
            notBeforeDate: AS_OF,
            targetDate: AS_OF,
            fulfilment: { status: 'blocked', reason: 'modality_avoided' },
            supportWorkoutIds: [],
            message: 'overdue since 2026-09-14; blocked (modality_avoided)',
        },
        {
            capability: 'acceleration_deceleration',
            status: 'overdue',
            requiredStage: 3,
            notBeforeDate: AS_OF,
            targetDate: AS_OF,
            fulfilment: { status: 'deliberately_suspended', reason: 'adverse_recovery' },
            supportWorkoutIds: [],
            message: 'overdue: no qualifying exposure in the observed window; deliberately suspended (adverse_recovery)',
        },
        {
            capability: 'multidirectional_change_of_direction',
            status: 'overdue',
            requiredStage: 4,
            lastQualifyingDate: AS_OF,
            nextDueDate: '2026-09-15',
            notBeforeDate: AS_OF,
            targetDate: AS_OF,
            fulfilment: { status: 'blocked', reason: 'no_support_capacity' },
            supportWorkoutIds: [],
            message: 'overdue since 2026-09-15; blocked (no_support_capacity)',
        },
        {
            capability: 'sport_skill',
            status: 'overdue',
            requiredStage: 4,
            lastQualifyingDate: AS_OF,
            nextDueDate: '2026-09-15',
            notBeforeDate: AS_OF,
            targetDate: AS_OF,
            fulfilment: { status: 'blocked', reason: 'mechanical_guardrail' },
            supportWorkoutIds: [],
            message: 'overdue since 2026-09-15; blocked (mechanical_guardrail)',
        },
    ],
};

function baseInput(overrides: Partial<ExposureLedgerInput> = {}): ExposureLedgerInput {
    return {
        asOfDate: AS_OF,
        lookbackStart: START,
        activities: [],
        recommendations: [],
        activitiesReadable: true,
        recommendationsReadable: true,
        activityOverrides: {},
        performedFacts: [],
        plannedSessions: [],
        trainingSettings: makeSettings(),
        preferences: null,
        ...overrides,
    };
}

interface CharacterizationCase {
    name: string;
    input: ExposureLedgerInput;
}

const FIXTURE_GRID: readonly CharacterizationCase[] = [
    {
        name: 'facts null, overrides null, settings missing, maintenance absent, planned null, unreadable sources',
        input: baseInput({
            activitiesReadable: false,
            recommendationsReadable: false,
            activityOverrides: null,
            performedFacts: null,
            plannedSessions: null,
            trainingSettings: null,
            capabilityMaintenance: undefined,
        }),
    },
    {
        name: 'facts empty, overrides present (empty), settings baseline, maintenance absent, planned present',
        input: baseInput({
            activityOverrides: {},
            performedFacts: [],
            plannedSessions: samplePlannedSessions,
            trainingSettings: makeSettings(),
            capabilityMaintenance: null,
        }),
    },
    {
        name: 'facts mixed, overrides present, settings baseline, maintenance present, planned present',
        input: baseInput({
            activities: mixedActivities,
            recommendations: mixedRecommendations,
            activityOverrides: sampleOverride,
            performedFacts: mixedFacts,
            plannedSessions: samplePlannedSessions,
            trainingSettings: makeSettings(),
            capabilityMaintenance: maintenancePresent,
        }),
    },
    {
        name: 'facts mixed, overrides null, settings with guardrails, maintenance overdue, planned null',
        input: baseInput({
            activities: mixedActivities,
            recommendations: mixedRecommendations,
            activityOverrides: null,
            performedFacts: mixedFacts,
            plannedSessions: null,
            trainingSettings: makeSettings({
                guardrails: {
                    avoid_high_impact: true,
                    avoid_heavy_lower_body: true,
                    avoid_overhead_pressing: false,
                    avoid_heavy_spinal_loading: false,
                },
            }),
            capabilityMaintenance: maintenanceOverdue,
        }),
    },
    {
        name: 'facts mixed, overrides present, settings with injuries and unavailable modalities, maintenance overdue, planned present',
        input: baseInput({
            activities: mixedActivities,
            activityOverrides: sampleOverride,
            performedFacts: mixedFacts,
            plannedSessions: samplePlannedSessions,
            trainingSettings: makeSettings({
                injuries: [
                    { region: 'achilles', severity: 'limit' },
                    { region: 'knee', severity: 'exclude', restrictedModalities: ['Cycling'], reviewBy: '2026-10-01' },
                ],
            }),
            preferences: { unavailableModalities: ['Strength'] } as unknown as UserPreferences,
            capabilityMaintenance: maintenanceOverdue,
        }),
    },
    {
        name: 'unknown-variant and composition-unavailable facts with maintenance present and heavy-lower-body guardrail',
        input: baseInput({
            performedFacts: unknownVariantAndUnavailableFacts,
            plannedSessions: samplePlannedSessions,
            trainingSettings: makeSettings({
                guardrails: {
                    avoid_high_impact: false,
                    avoid_heavy_lower_body: true,
                    avoid_overhead_pressing: false,
                    avoid_heavy_spinal_loading: false,
                },
            }),
            capabilityMaintenance: maintenancePresent,
        }),
    },
    {
        name: 'unknown-variant and composition-unavailable facts with maintenance overdue and missing settings',
        input: baseInput({
            performedFacts: unknownVariantAndUnavailableFacts,
            plannedSessions: [],
            trainingSettings: null,
            capabilityMaintenance: maintenanceOverdue,
        }),
    },
];

describe('contextBriefExposureLedger characterization golden (#1185)', () => {
    it('renders identical output across the characterization fixture grid', () => {
        const rendered = Object.fromEntries(
            FIXTURE_GRID.map(testCase => [
                testCase.name,
                renderExposureLedger(deriveExposureLedger(testCase.input), START, AS_OF).join('\n'),
            ]),
        );
        expect(rendered).toMatchSnapshot();
    });
});
