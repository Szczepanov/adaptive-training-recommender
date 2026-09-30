import type { ComparisonContext, MeasurementProtocol } from './models';
import { COMPARISON_CANONICALIZATION_V1 } from './comparability';
import type { TestingSessionDefinition } from './testingWorkflow';
import {
    BACK_SQUAT_1RM_PROTOCOL,
    BENCH_PRESS_1RM_PROTOCOL,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
    SEATED_MEDBALL_THROW_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
    WALL_TOUCH_CMJ_PROTOCOL,
} from './physicalCapitalProtocols';

export type PerformanceTestFamily = 'cycling' | 'strength' | 'field';

export interface PerformanceTestPresentationHints {
    carryForwardFieldIds?: readonly string[];
}

export interface PerformanceTestDefinition {
    id: string;
    family?: PerformanceTestFamily;
    protocol: MeasurementProtocol;
    sessionDefinition: TestingSessionDefinition & { summary: string };
    defaultContext: ComparisonContext;
    expectedSource: string;
    presentationHints?: PerformanceTestPresentationHints;
}

export function getPerformanceTestFamily(definition: PerformanceTestDefinition): PerformanceTestFamily {
    if (definition.family) return definition.family;
    if (definition.sessionDefinition.dominantModality === 'cycling') return 'cycling';
    if (definition.sessionDefinition.dominantModality === 'strength') return 'strength';
    return 'field';
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

const benchPressSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-strength-bench-press-1rm',
    revision: 1,
    title: 'Bench press 1RM test',
    summary: 'Standardized bench press 1RM protocol. Athlete-selected attempt loads; requires rack safeties or a competent spotter.',
    intent: 'testing',
    modalities: ['strength'],
    dominantModality: 'strength',
    duration: { min: 25, max: 45 },
    prohibitedAdditions: ['Heavy assistance exercises before 1RM attempts', 'Maximal sets to failure during the warm-up ramp'],
    blocks: [
        {
            id: 'warmup',
            title: 'Progressive warm-up ramp',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'bench-warmup-ramp',
                    kind: 'exercise',
                    title: 'Progressive bench press ramp sets',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Bench press warm-up ramp' },
                    dose: { kind: 'checkoff' },
                    notes: 'Perform light progressive sets (e.g. bar, 40%, 60%, 80%) to prepare for maximal attempts. May be logged as practice trials.',
                },
            ],
        },
        {
            id: 'test',
            title: '1RM test attempts',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'bench-1rm-attempts',
                    kind: 'exercise',
                    title: 'Maximal 1RM attempts',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Bench press 1RM attempt' },
                    dose: { kind: 'repetition', sets: 5, reps: 1 },
                    notes: 'Choose attempt loads yourself. Rest 3-5 minutes between heavy attempts. Touch chest, press to lockout without bouncing or hip rise.',
                    stopConditions: [...BENCH_PRESS_1RM_PROTOCOL.invalidationRules],
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
                    id: 'bench-cooldown',
                    kind: 'exercise',
                    title: 'Easy mobility / cool-down',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Upper-body cool-down' },
                    dose: { kind: 'duration', seconds: { min: 180, max: 360 } },
                    optional: true,
                },
            ],
        },
    ],
};

const backSquatSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-strength-back-squat-1rm',
    revision: 1,
    title: 'Back squat 1RM test',
    summary: 'Standardized back squat 1RM protocol. Athlete-selected attempt loads; requires rack safety pins or competent spotters.',
    intent: 'testing',
    modalities: ['strength'],
    dominantModality: 'strength',
    duration: { min: 30, max: 50 },
    prohibitedAdditions: ['Heavy leg exercises before 1RM attempts', 'Maximal sets to failure during the warm-up ramp'],
    blocks: [
        {
            id: 'warmup',
            title: 'Progressive warm-up ramp',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'squat-warmup-ramp',
                    kind: 'exercise',
                    title: 'Progressive back squat ramp sets',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Back squat warm-up ramp' },
                    dose: { kind: 'checkoff' },
                    notes: 'Perform light progressive sets (e.g. bodyweight, empty bar, 40%, 60%, 80%) to prepare for maximal attempts. May be logged as practice trials.',
                },
            ],
        },
        {
            id: 'test',
            title: '1RM test attempts',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'squat-1rm-attempts',
                    kind: 'exercise',
                    title: 'Maximal 1RM attempts',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Back squat 1RM attempt' },
                    dose: { kind: 'repetition', sets: 5, reps: 1 },
                    notes: 'Choose attempt loads yourself. Rest 3-5 minutes between heavy attempts. Hip crease must pass below top of the knee; return to standing without spotter contact.',
                    stopConditions: [...BACK_SQUAT_1RM_PROTOCOL.invalidationRules],
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
                    id: 'squat-cooldown',
                    kind: 'exercise',
                    title: 'Easy walk / mobility',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Lower-body cool-down' },
                    dose: { kind: 'duration', seconds: { min: 180, max: 360 } },
                    optional: true,
                },
            ],
        },
    ],
};

const standingBroadJumpSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-field-standing-broad-jump',
    revision: 1,
    title: 'Standing broad jump test',
    summary: 'Standardized standing broad jump test. Three maximal two-foot jumps for horizontal power assessment.',
    intent: 'testing',
    modalities: ['field'],
    dominantModality: 'field',
    duration: { min: 15, max: 25 },
    prohibitedAdditions: ['Fatiguing lower-body intervals before jump testing'],
    blocks: [
        {
            id: 'warmup',
            title: 'Dynamic warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'broad-jump-warmup',
                    kind: 'exercise',
                    title: 'Dynamic warm-up and practice jumps',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Dynamic jump warm-up' },
                    dose: { kind: 'duration', seconds: 480 },
                    notes: 'Perform dynamic leg warm-up followed by 2-3 submaximal practice jumps.',
                },
            ],
        },
        {
            id: 'test',
            title: 'Maximal broad jump attempts',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'broad-jump-attempts',
                    kind: 'exercise',
                    title: '3 maximal standing broad jumps',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Standing broad jump' },
                    dose: { kind: 'repetition', sets: 3, reps: 1 },
                    rest: 60,
                    notes: 'Static two-foot stance take-off, measure from take-off line to rearmost heel. Rest ~60 seconds between attempts.',
                    stopConditions: [...STANDING_BROAD_JUMP_PROTOCOL.invalidationRules],
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
                    id: 'broad-jump-cooldown',
                    kind: 'exercise',
                    title: 'Easy walk cool-down',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Easy walk' },
                    dose: { kind: 'duration', seconds: { min: 180, max: 300 } },
                    optional: true,
                },
            ],
        },
    ],
};

const wallTouchCmjSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-field-wall-touch-cmj',
    revision: 1,
    title: 'Wall-touch CMJ test',
    summary: 'Standardized wall-touch countermovement jump test. Records standing reach and three maximal vertical touches.',
    intent: 'testing',
    modalities: ['field'],
    dominantModality: 'field',
    duration: { min: 15, max: 25 },
    prohibitedAdditions: ['Fatiguing lower-body intervals before jump testing'],
    blocks: [
        {
            id: 'warmup',
            title: 'Dynamic warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'cmj-warmup',
                    kind: 'exercise',
                    title: 'Dynamic warm-up and practice jumps',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Dynamic CMJ warm-up' },
                    dose: { kind: 'duration', seconds: 480 },
                    notes: 'Perform dynamic leg warm-up and 2-3 submaximal practice jumps.',
                },
            ],
        },
        {
            id: 'test',
            title: 'Standing reach and jump touches',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'cmj-reach',
                    kind: 'exercise',
                    title: 'Standing reach measurement',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Standing reach' },
                    dose: { kind: 'checkoff' },
                    notes: 'Stand side-on to the wall with feet flat. Reach as high as possible with one hand and record standing reach height.',
                },
                {
                    id: 'cmj-jumps',
                    kind: 'exercise',
                    title: '3 maximal wall-touch countermovement jumps',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Countermovement jump' },
                    dose: { kind: 'repetition', sets: 3, reps: 1 },
                    rest: 60,
                    notes: 'Static stance, no step. Touch wall at apex with the same hand. Rest ~60 seconds between jumps.',
                    stopConditions: [...WALL_TOUCH_CMJ_PROTOCOL.invalidationRules],
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
                    id: 'cmj-cooldown',
                    kind: 'exercise',
                    title: 'Easy walk cool-down',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Easy walk' },
                    dose: { kind: 'duration', seconds: { min: 180, max: 300 } },
                    optional: true,
                },
            ],
        },
    ],
};

const seatedMedballThrowSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-field-seated-medball-chest-throw-3kg',
    revision: 1,
    title: 'Seated 3 kg medicine-ball chest throw test',
    summary: 'Standardized seated medicine-ball chest throw test. Three maximal two-hand chest passes with a 3 kg medicine ball.',
    intent: 'testing',
    modalities: ['field'],
    dominantModality: 'field',
    duration: { min: 15, max: 25 },
    prohibitedAdditions: ['Fatiguing upper-body pressing before throw testing'],
    blocks: [
        {
            id: 'warmup',
            title: 'Upper-body warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'medball-warmup',
                    kind: 'exercise',
                    title: 'Dynamic upper-body warm-up and practice throws',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Upper-body throw warm-up' },
                    dose: { kind: 'duration', seconds: 480 },
                    notes: 'Complete shoulder and chest dynamic warm-up followed by 2-3 submaximal practice throws.',
                },
            ],
        },
        {
            id: 'test',
            title: 'Maximal 3 kg chest throws',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'medball-throws',
                    kind: 'exercise',
                    title: '3 maximal seated 3 kg chest throws',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Seated medicine-ball chest throw' },
                    dose: { kind: 'repetition', sets: 3, reps: 1 },
                    rest: 60,
                    notes: 'Sit with back and head against wall, legs extended. Push 3 kg ball vigorously from chest with both hands without head/back leaving wall. Rest ~60 seconds.',
                    stopConditions: [...SEATED_MEDBALL_THROW_PROTOCOL.invalidationRules],
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
                    id: 'medball-cooldown',
                    kind: 'exercise',
                    title: 'Easy arm / shoulder mobility',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Upper-body mobility' },
                    dose: { kind: 'duration', seconds: { min: 180, max: 300 } },
                    optional: true,
                },
            ],
        },
    ],
};

const cycling6sSeatedSprintSession: TestingSessionDefinition & { summary: string } = {
    schemaVersion: 1,
    id: 'ov-cycling-6s-seated-sprint',
    revision: 1,
    title: 'Cycling 3 x 6-second seated sprint test',
    summary: 'Standardized 3 x 6-second seated cycling sprint benchmark. Captures 1 s peak power and 5 s mean power from calibrated power source.',
    intent: 'testing',
    modalities: ['cycling'],
    dominantModality: 'cycling',
    duration: { min: 25, max: 40 },
    prohibitedAdditions: ['Additional maximal sprint efforts before or between test attempts'],
    blocks: [
        {
            id: 'warmup',
            title: 'Standard sprint warm-up',
            role: 'warmup',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'sprint-warmup-spin',
                    kind: 'exercise',
                    title: 'Progressive cycling warm-up with priming',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Cycling warm-up with priming' },
                    dose: { kind: 'duration', seconds: 600 },
                    notes: 'Include 1-2 progressive acceleration efforts up to submaximal sprint cadence.',
                },
                {
                    id: 'sprint-power-calibration',
                    kind: 'exercise',
                    title: 'Power meter calibration / zero offset',
                    exerciseRef: { kind: 'unresolved_free_text', name: 'Power source calibration' },
                    dose: { kind: 'checkoff' },
                },
            ],
        },
        {
            id: 'test',
            title: '3 x 6-second seated sprints',
            role: 'test',
            executionMode: 'sequential',
            steps: [
                {
                    id: 'sprint-efforts',
                    kind: 'exercise',
                    title: 'Maximal 6-second seated sprint efforts',
                    exerciseRef: { kind: 'unresolved_free_text', name: '6-second seated sprint' },
                    dose: { kind: 'duration', sets: 3, seconds: 6 },
                    rest: 240,
                    notes: 'Three 6-second maximal seated sprints with at least 4 minutes easy recovery spinning between efforts. Stay seated throughout.',
                    stopConditions: [...CYCLING_6S_SEATED_SPRINT_PROTOCOL.invalidationRules],
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
                    id: 'sprint-cooldown-spin',
                    kind: 'exercise',
                    title: 'Easy recovery spin',
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
    {
        id: 'strength-bench-press-1rm-r1',
        family: 'strength',
        protocol: BENCH_PRESS_1RM_PROTOCOL,
        sessionDefinition: benchPressSession,
        defaultContext: {
            equipment_setup_id: 'standard-bench-rack',
            warmup_revision: 'standard-strength-warmup-r1',
        },
        expectedSource: 'Manual entry of athlete-selected attempt loads and success/miss outcome (optional WL Analysis velocity).',
    },
    {
        id: 'strength-back-squat-1rm-r1',
        family: 'strength',
        protocol: BACK_SQUAT_1RM_PROTOCOL,
        sessionDefinition: backSquatSession,
        defaultContext: {
            equipment_setup_id: 'standard-squat-rack',
            warmup_revision: 'standard-strength-warmup-r1',
        },
        expectedSource: 'Manual entry of athlete-selected attempt loads and success/miss outcome (optional WL Analysis velocity).',
    },
    {
        id: 'field-standing-broad-jump-r1',
        family: 'field',
        protocol: STANDING_BROAD_JUMP_PROTOCOL,
        sessionDefinition: standingBroadJumpSession,
        defaultContext: {
            test_environment: 'indoor-gym-floor',
        },
        expectedSource: 'Manual entry of measured distance from take-off line to rearmost heel.',
    },
    {
        id: 'field-wall-touch-cmj-r1',
        family: 'field',
        protocol: WALL_TOUCH_CMJ_PROTOCOL,
        sessionDefinition: wallTouchCmjSession,
        defaultContext: {
            measurement_method_id: 'wall-chalk-tape',
        },
        expectedSource: 'Manual entry of standing reach and jump touch heights.',
        presentationHints: {
            carryForwardFieldIds: ['standing_reach_cm'],
        },
    },
    {
        id: 'field-seated-medball-chest-throw-3kg-r1',
        family: 'field',
        protocol: SEATED_MEDBALL_THROW_PROTOCOL,
        sessionDefinition: seatedMedballThrowSession,
        defaultContext: {
            equipment_setup_id: 'standard-seated-station',
        },
        expectedSource: 'Manual entry of measured distance from wall to initial ball contact point.',
    },
    {
        id: 'cycling_6s_seated_sprint-r1',
        family: 'cycling',
        protocol: CYCLING_6S_SEATED_SPRINT_PROTOCOL,
        sessionDefinition: cycling6sSeatedSprintSession,
        defaultContext: {
            test_environment: 'indoor-trainer',
            start_mode: 'seated-rolling',
            warmup_revision: 'cycling-sprint-warmup-r1',
        },
        expectedSource: 'Manual entry of 1 s peak and 5 s mean power from calibrated power meter.',
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
