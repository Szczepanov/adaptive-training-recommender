import type { ComparisonContext, MeasurementProtocol } from './models';
import { COMPARISON_CANONICALIZATION_V1 } from './comparability';
import type { TestingSessionDefinition } from './testingWorkflow';

export interface PerformanceTestDefinition {
    id: string;
    protocol: MeasurementProtocol;
    sessionDefinition: TestingSessionDefinition & { summary: string };
    defaultContext: ComparisonContext;
    expectedSource: string;
}

const CREATED_AT = '2026-08-21T00:00:00.000Z';
const STANDARD_WARMUP = 'cycling-tt-standard-warmup-r1';

const twentyMinuteProtocol: MeasurementProtocol = {
    id: 'cycling-20m-tt',
    revision: 1,
    title: 'Cycling 20-minute TT',
    intent: 'testing',
    metricIds: ['cycling_tt_20m_mean_power_w'],
    instructions: [
        { id: 'warmup', text: 'Complete the standard warm-up without adding hard efforts.' },
        { id: 'calibrate', text: 'Use the declared power source and complete its normal zero-offset/calibration procedure.' },
        { id: 'effort', text: 'Ride 20 minutes continuously at the highest sustainable effort; record raw mean power, not FTP.' },
    ],
    warmupRef: STANDARD_WARMUP,
    comparisonContext: {
        required: [
            'power_source_id',
            'bike_setup_id',
            'test_environment',
            'course_or_trainer_id',
            'duration_seconds',
            'start_mode',
            'warmup_revision',
            'feedback_rule',
        ],
        seriesDefining: [
            'power_source_id',
            'bike_setup_id',
            'test_environment',
            'course_or_trainer_id',
            'duration_seconds',
            'start_mode',
            'warmup_revision',
            'feedback_rule',
        ],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'high',
    expectedRecoveryHours: 36,
    invalidationRules: [
        'Effort was interrupted or materially shortened.',
        'Declared power source or bike/setup changed during the test.',
        'Major pacing aid, drafting, or environmental condition differed from the declared protocol.',
        'Illness, acute pain, or equipment failure materially affected the effort.',
    ],
    createdAt: CREATED_AT,
};

const twentyMinuteSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-cycling-20m-tt',
    revision: 1,
    title: 'Cycling 20-minute TT',
    summary: 'Protocol-locked 20-minute cycling benchmark. Captures raw mean power; it does not estimate FTP.',
    intent: 'testing',
    modalities: ['cycling'],
    dominantModality: 'cycling',
    duration: { min: 35, max: 50 },
    prohibitedAdditions: ['Extra maximal intervals before the test effort', 'Unplanned sprint finish after the timed effort'],
    blocks: [
        {
            id: 'warmup',
            title: 'Standard warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'standard-warmup',
                    kind: 'exercise',
                    title: 'Standard cycling warm-up',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Standard cycling warm-up' },
                    dose: { kind: 'duration', seconds: 900 },
                    notes: 'Keep this warm-up identical on repeat attempts. Do not add hard efforts.',
                },
                {
                    id: 'power-calibration',
                    kind: 'exercise',
                    title: 'Power source calibration / zero offset',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Power source calibration' },
                    dose: { kind: 'checkoff' },
                },
            ],
        },
        {
            id: 'test',
            title: '20-minute time trial',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'tt-20m',
                    kind: 'exercise',
                    title: '20-minute maximal sustainable effort',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Cycling 20-minute TT' },
                    dose: { kind: 'duration', seconds: 1200 },
                    notes: 'Record the raw 20-minute mean power shown by the declared source. Do not convert it to FTP.',
                    stopConditions: [...twentyMinuteProtocol.invalidationRules],
                },
            ],
        },
        {
            id: 'cooldown',
            title: 'Cool-down',
            role: 'cooldown',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'cooldown-spin',
                    kind: 'exercise',
                    title: 'Easy spin',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Easy cycling cool-down' },
                    dose: { kind: 'duration', seconds: { min: 300, max: 600 } },
                    optional: true,
                },
            ],
        },
    ],
};

const fourMinuteProtocol: MeasurementProtocol = {
    id: 'cycling-4m-tt',
    revision: 1,
    title: 'Cycling 4-minute TT',
    intent: 'testing',
    metricIds: ['cycling_tt_4m_mean_power_w'],
    instructions: [
        { id: 'warmup', text: 'Complete the same standard warm-up used for repeat 4-minute tests.' },
        { id: 'calibrate', text: 'Use and calibrate the declared power source.' },
        { id: 'effort', text: 'Ride 4 minutes continuously at maximal sustainable effort and record raw mean power.' },
    ],
    warmupRef: STANDARD_WARMUP,
    comparisonContext: {
        required: [
            'power_source_id',
            'bike_setup_id',
            'test_environment',
            'course_or_trainer_id',
            'duration_seconds',
            'start_mode',
            'warmup_revision',
            'feedback_rule',
        ],
        seriesDefining: [
            'power_source_id',
            'bike_setup_id',
            'test_environment',
            'course_or_trainer_id',
            'duration_seconds',
            'start_mode',
            'warmup_revision',
            'feedback_rule',
        ],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'moderate',
    expectedRecoveryHours: 18,
    invalidationRules: [
        'Effort was interrupted or materially shortened.',
        'Declared power source or bike/setup changed during the test.',
        'Start mode or feedback rule differed from the declared protocol.',
        'Illness, acute pain, or equipment failure materially affected the effort.',
    ],
    createdAt: CREATED_AT,
};

const fourMinuteSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-cycling-4m-tt',
    revision: 1,
    title: 'Cycling 4-minute TT',
    summary: 'Lower-burden protocol-locked cycling benchmark capturing raw 4-minute mean power.',
    intent: 'testing',
    modalities: ['cycling'],
    dominantModality: 'cycling',
    duration: { min: 22, max: 35 },
    prohibitedAdditions: ['Extra maximal intervals before the test effort'],
    blocks: [
        {
            id: 'warmup',
            title: 'Standard warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'standard-warmup',
                    kind: 'exercise',
                    title: 'Standard cycling warm-up',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Standard cycling warm-up' },
                    dose: { kind: 'duration', seconds: 900 },
                    notes: 'Keep this warm-up identical on repeat attempts.',
                },
                {
                    id: 'power-calibration',
                    kind: 'exercise',
                    title: 'Power source calibration / zero offset',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Power source calibration' },
                    dose: { kind: 'checkoff' },
                },
            ],
        },
        {
            id: 'test',
            title: '4-minute time trial',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'tt-4m',
                    kind: 'exercise',
                    title: '4-minute maximal sustainable effort',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Cycling 4-minute TT' },
                    dose: { kind: 'duration', seconds: 240 },
                    notes: 'Record raw mean power from the declared source.',
                    stopConditions: [...fourMinuteProtocol.invalidationRules],
                },
            ],
        },
        {
            id: 'cooldown',
            title: 'Cool-down',
            role: 'cooldown',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'cooldown-spin',
                    kind: 'exercise',
                    title: 'Easy spin',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Easy cycling cool-down' },
                    dose: { kind: 'duration', seconds: { min: 300, max: 600 } },
                    optional: true,
                },
            ],
        },
    ],
};

export const PERFORMANCE_TEST_DEFINITIONS: readonly PerformanceTestDefinition[] = [
    {
        id: 'cycling-20m-tt-r1',
        protocol: twentyMinuteProtocol,
        sessionDefinition: twentyMinuteSession,
        defaultContext: {
            duration_seconds: 1200,
            start_mode: 'rolling',
            warmup_revision: STANDARD_WARMUP,
            feedback_rule: 'power-visible',
        },
        expectedSource: 'Manual entry from the declared power meter or smart trainer summary.',
    },
    {
        id: 'cycling-4m-tt-r1',
        protocol: fourMinuteProtocol,
        sessionDefinition: fourMinuteSession,
        defaultContext: {
            duration_seconds: 240,
            start_mode: 'rolling',
            warmup_revision: STANDARD_WARMUP,
            feedback_rule: 'power-visible',
        },
        expectedSource: 'Manual entry from the declared power meter or smart trainer summary.',
    },
];

export function getPerformanceTestDefinition(id: string): PerformanceTestDefinition {
    const definition = PERFORMANCE_TEST_DEFINITIONS.find(candidate => candidate.id === id);
    if (!definition) throw new Error(`Unknown performance test definition: ${id}`);
    return definition;
}
