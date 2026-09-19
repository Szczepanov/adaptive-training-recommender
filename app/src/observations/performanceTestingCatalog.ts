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

const sprint10mStandingProtocol: MeasurementProtocol = {
    id: 'sprint-10m-standing',
    revision: 1,
    title: 'Standing-start 10 m sprint',
    intent: 'testing',
    metricIds: ['sprint_elapsed_time_s'],
    instructions: [
        { id: 'warmup', text: 'Complete a standard sprint-specific warm-up including progressive accelerations.' },
        { id: 'setup', text: 'Set the declared timing method at 0 m and 10 m. Use a fixed, motionless standing start position at the start line.' },
        { id: 'effort', text: 'Sprint maximally through 10 m. Record elapsed time from the declared timing method; do not convert between timing methods.' },
    ],
    comparisonContext: {
        required: ['start_mode', 'test_environment', 'timing_method'],
        seriesDefining: ['start_mode', 'test_environment', 'timing_method'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'moderate',
    expectedRecoveryHours: 48,
    invalidationRules: [
        'False start, rolling start, or any movement before the declared start signal/position.',
        'Declared timing method or timing-gate placement changed during the test.',
        'Surface, footwear, or start-line environment differed materially from the declared protocol.',
        'Illness, acute pain, or equipment failure materially affected the effort.',
    ],
    createdAt: CREATED_AT,
};

const sprint10mStandingSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-sprint-10m-standing',
    revision: 1,
    title: 'Standing-start 10 m sprint test',
    summary: 'Protocol-locked standing-start 10 m sprint. Captures raw elapsed time under a fixed start convention and timing method.',
    intent: 'testing',
    modalities: ['field'],
    dominantModality: 'field',
    duration: { min: 20, max: 35 },
    prohibitedAdditions: ['Maximal sprint repeats beyond the declared protocol before the timed attempt(s)'],
    blocks: [
        {
            id: 'warmup',
            title: 'Sprint-specific warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'standard-warmup',
                    kind: 'exercise',
                    title: 'Progressive acceleration warm-up',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Progressive sprint warm-up' },
                    dose: { kind: 'duration', seconds: 600 },
                    notes: 'Keep this warm-up identical on repeat attempts.',
                },
            ],
        },
        {
            id: 'test',
            title: 'Standing-start 10 m sprint',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'sprint-10m',
                    kind: 'exercise',
                    title: 'Maximal standing-start 10 m sprint',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Standing-start 10 m sprint' },
                    dose: { kind: 'repetition', sets: 2, reps: 1 },
                    notes: 'Record elapsed time from the declared timing method for each attempt; keep the best valid attempt.',
                    stopConditions: [...sprint10mStandingProtocol.invalidationRules],
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
                    id: 'cooldown-walk',
                    kind: 'exercise',
                    title: 'Easy walk/jog cool-down',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Easy cool-down' },
                    dose: { kind: 'duration', seconds: { min: 300, max: 600 } },
                    optional: true,
                },
            ],
        },
    ],
};

const cycling5sPeakPowerProtocol: MeasurementProtocol = {
    id: 'cycling-5s-peak-power',
    revision: 1,
    title: 'Cycling 5-second peak power',
    intent: 'testing',
    metricIds: ['cycling_5s_peak_power_w'],
    instructions: [
        { id: 'warmup', text: 'Complete the standard warm-up including at least one sub-maximal priming effort.' },
        { id: 'calibrate', text: 'Use and calibrate the declared power source.' },
        { id: 'effort', text: 'From the declared start mode, sprint maximally for 5 seconds. Record the highest 1-second (or shorter, if the device reports it) peak power over the effort.' },
    ],
    warmupRef: STANDARD_WARMUP,
    comparisonContext: {
        required: ['power_source_id', 'bike_setup_id', 'test_environment', 'duration_seconds', 'start_mode', 'warmup_revision'],
        seriesDefining: ['power_source_id', 'bike_setup_id', 'test_environment', 'duration_seconds', 'start_mode', 'warmup_revision'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'moderate',
    expectedRecoveryHours: 24,
    invalidationRules: [
        'Effort was interrupted or materially shortened.',
        'Declared power source or bike/setup changed during the test.',
        'Start mode differed from the declared protocol (e.g. rolling start used for a standing-start attempt).',
        'Illness, acute pain, or equipment failure materially affected the effort.',
    ],
    createdAt: CREATED_AT,
};

const cycling5sPeakPowerSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-cycling-5s-peak-power',
    revision: 1,
    title: 'Cycling 5-second peak power test',
    summary: 'Protocol-locked maximal 5-second cycling sprint. Captures raw peak power; it is not a mean-power or FTP test.',
    intent: 'testing',
    modalities: ['cycling'],
    dominantModality: 'cycling',
    duration: { min: 15, max: 25 },
    prohibitedAdditions: ['Additional maximal sprint efforts before the timed attempt'],
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
                    title: 'Standard cycling warm-up with priming effort',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Standard cycling warm-up' },
                    dose: { kind: 'duration', seconds: 600 },
                    notes: 'Include one sub-maximal priming effort. Keep this warm-up identical on repeat attempts.',
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
            title: '5-second maximal sprint',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'sprint-5s',
                    kind: 'exercise',
                    title: 'Maximal 5-second cycling sprint',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Cycling 5-second peak power sprint' },
                    dose: { kind: 'duration', seconds: 5 },
                    notes: 'Record the raw peak power shown by the declared source.',
                    stopConditions: [...cycling5sPeakPowerProtocol.invalidationRules],
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
    {
        id: 'sprint_10m_standing-r1',
        protocol: sprint10mStandingProtocol,
        sessionDefinition: sprint10mStandingSession,
        defaultContext: {
            start_mode: 'standing',
            test_environment: 'outdoor-track',
            timing_method: 'timing-gates',
        },
        expectedSource: 'Manual entry from the declared timing method (timing gates, radar/laser, or handheld stopwatch).',
    },
    {
        id: 'cycling_5s_peak_power-r1',
        protocol: cycling5sPeakPowerProtocol,
        sessionDefinition: cycling5sPeakPowerSession,
        defaultContext: {
            duration_seconds: 5,
            start_mode: 'rolling',
            warmup_revision: STANDARD_WARMUP,
        },
        expectedSource: 'Manual entry from the declared power meter or smart trainer summary.',
    },
];

export const PERFORMANCE_TEST_DEFINITIONS_BY_ID: ReadonlyMap<string, PerformanceTestDefinition> = new Map(
    PERFORMANCE_TEST_DEFINITIONS.map(candidate => [candidate.id, candidate])
);

export function getPerformanceTestDefinition(id: string): PerformanceTestDefinition {
    const definition = PERFORMANCE_TEST_DEFINITIONS_BY_ID.get(id);
    if (!definition) throw new Error(`Unknown performance test definition: ${id}`);
    return definition;
}
