import { ASSESSMENT_REDUCER_VERSION_V1 } from './assessmentCapture';
import { COMPARISON_CANONICALIZATION_V1 } from './comparability';
import type { AssessmentTrialFieldDefinition, MeasurementProtocol } from './models';

/**
 * Issue #897 / ADR-0046 WP0.1: the October 2026 physical-capital battery as immutable
 * multi-trial protocol revisions. These objects are evidence contracts: changing any field,
 * bound, reducer or instruction requires a new revision, never an edit in place. The bundled
 * catalog (WP4) and its session definitions reference them; they carry no recommendation
 * authority.
 */

const CREATED_AT = '2026-09-30T00:00:00.000Z';
const SPRINT_WARMUP = 'cycling-sprint-warmup-r1';

const RAW_VIDEO_INSTRUCTION = {
    id: 'raw-video',
    text: 'If you film the test (for example for WL Analysis), keep the original raw video outside the app. The app stores only the numbers you enter, not the video.',
};

const strengthTrialFields: readonly AssessmentTrialFieldDefinition[] = [
    { id: 'load_kg', label: 'Load', valueKind: 'number', unit: 'kg', required: true, minimum: 1, maximum: 500 },
    { id: 'successful', label: 'Lift successful', valueKind: 'boolean', required: true },
    { id: 'rpe', label: 'RPE', valueKind: 'number', unit: 'rpe', required: false, minimum: 1, maximum: 10 },
    { id: 'mean_concentric_velocity_mps', label: 'Mean concentric velocity', valueKind: 'number', unit: 'm/s', required: false, minimum: 0, maximum: 5 },
    { id: 'peak_velocity_mps', label: 'Peak velocity', valueKind: 'number', unit: 'm/s', required: false, minimum: 0, maximum: 10 },
];

const strengthCapture = {
    plannedTrials: 6,
    maxTrials: 15,
    fields: strengthTrialFields,
    reducers: [{ kind: 'highest_successful_load', metricId: 'strength_1rm_kg', loadFieldId: 'load_kg', successFieldId: 'successful' }],
    reducerVersion: ASSESSMENT_REDUCER_VERSION_V1,
} as const satisfies MeasurementProtocol['capture'];

/** Strength 1RM comparability: rack/bench station identity defines the series; the warm-up ramp is context. */
const strengthComparison = {
    required: ['equipment_setup_id', 'warmup_revision'],
    seriesDefining: ['equipment_setup_id'],
    contextOnly: ['warmup_revision'],
    canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
} as const satisfies MeasurementProtocol['comparisonContext'];

export const BENCH_PRESS_1RM_PROTOCOL: MeasurementProtocol = {
    id: 'strength-bench-press-1rm',
    revision: 1,
    title: 'Bench press 1RM',
    intent: 'testing',
    metricIds: ['strength_1rm_kg'],
    instructions: [
        { id: 'safety', text: 'Bench inside a rack with safety arms set just below chest height, or with a competent spotter. Do not attempt maximal lifts alone without safeties.' },
        { id: 'warmup', text: 'Complete a progressive warm-up ramp. Warm-up sets may be logged as practice trials.' },
        { id: 'attempts', text: 'Choose every attempt load yourself. Rest 3-5 minutes between heavy attempts and stop after a failed lift or when technique breaks down.' },
        { id: 'standard', text: 'A valid lift touches the chest, is pressed to full lockout without bouncing or lifting the hips, and receives no spotter contact.' },
        RAW_VIDEO_INSTRUCTION,
    ],
    comparisonContext: strengthComparison,
    familiarization: { required: false, minimumExposures: 0 },
    burden: 'high',
    expectedRecoveryHours: 48,
    invalidationRules: [
        'The spotter touched the bar during the attempt.',
        'The bar bounced off the chest or the hips left the bench.',
        'The lift was not pressed to full lockout.',
        'Illness, acute pain, or equipment failure materially affected the attempt.',
    ],
    capture: strengthCapture,
    createdAt: CREATED_AT,
};

export const BACK_SQUAT_1RM_PROTOCOL: MeasurementProtocol = {
    id: 'strength-back-squat-1rm',
    revision: 1,
    title: 'Back squat 1RM',
    intent: 'testing',
    metricIds: ['strength_1rm_kg'],
    instructions: [
        { id: 'safety', text: 'Squat inside a rack with safety pins set just below the bottom position, or with competent spotters. Do not attempt maximal lifts alone without safeties.' },
        { id: 'warmup', text: 'Complete a progressive warm-up ramp. Warm-up sets may be logged as practice trials.' },
        { id: 'attempts', text: 'Choose every attempt load yourself. Rest 3-5 minutes between heavy attempts and stop after a failed lift or when technique breaks down.' },
        { id: 'standard', text: 'A valid lift reaches depth with the hip crease below the top of the knee and returns to full standing without spotter contact.' },
        RAW_VIDEO_INSTRUCTION,
    ],
    comparisonContext: strengthComparison,
    familiarization: { required: false, minimumExposures: 0 },
    burden: 'high',
    expectedRecoveryHours: 72,
    invalidationRules: [
        'A spotter touched the bar or the bar was set on the safety pins.',
        'The squat did not reach the declared depth.',
        'The lift did not return to full standing.',
        'Illness, acute pain, or equipment failure materially affected the attempt.',
    ],
    capture: strengthCapture,
    createdAt: CREATED_AT,
};

export const STANDING_BROAD_JUMP_PROTOCOL: MeasurementProtocol = {
    id: 'field-standing-broad-jump',
    revision: 1,
    title: 'Standing broad jump',
    intent: 'testing',
    metricIds: ['standing_broad_jump_distance_cm'],
    instructions: [
        { id: 'warmup', text: 'Complete a dynamic warm-up and 2-3 sub-maximal practice jumps (log them as practice trials if you want them kept).' },
        { id: 'stance', text: 'Start with both feet behind the line and jump forward from a static two-foot stance; arm swing is allowed.' },
        { id: 'measure', text: 'Measure from the take-off line to the back of the rearmost heel on landing.' },
        { id: 'attempts', text: 'Perform three maximal attempts with about 60 seconds of rest between them.' },
    ],
    comparisonContext: {
        required: ['test_environment'],
        seriesDefining: ['test_environment'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'low',
    expectedRecoveryHours: 24,
    invalidationRules: [
        'Take-off was not from a static two-foot stance (a step or hop before take-off).',
        'The athlete fell or stepped backward on landing.',
        'Illness, acute pain, or a surface/footwear change materially affected the attempt.',
    ],
    capture: {
        plannedTrials: 3,
        maxTrials: 6,
        fields: [
            { id: 'distance_cm', label: 'Distance', valueKind: 'number', unit: 'cm', required: true, minimum: 1, maximum: 400 },
        ],
        reducers: [{ kind: 'max_valid', metricId: 'standing_broad_jump_distance_cm', fieldId: 'distance_cm' }],
        reducerVersion: ASSESSMENT_REDUCER_VERSION_V1,
    },
    createdAt: CREATED_AT,
};

/**
 * Standing reach is raw trial context, not a canonical metric: it is recorded on every trial
 * (the capture UI can pre-fill it) so each trial's jump height is reconstructible from that
 * trial's own immutable record.
 */
export const WALL_TOUCH_CMJ_PROTOCOL: MeasurementProtocol = {
    id: 'field-wall-touch-cmj',
    revision: 1,
    title: 'Wall-touch countermovement jump',
    intent: 'testing',
    metricIds: ['wall_touch_cmj_height_cm'],
    instructions: [
        { id: 'warmup', text: 'Complete a dynamic warm-up and 2-3 sub-maximal practice jumps.' },
        { id: 'reach', text: 'Standing side-on to the wall with feet flat, reach as high as possible with one hand and record the standing reach height.' },
        { id: 'jump', text: 'From a static stance, perform a countermovement jump without a step and touch the wall at the highest point with the same hand.' },
        { id: 'attempts', text: 'Perform three maximal jumps with about 60 seconds of rest; record the touch height of each.' },
    ],
    comparisonContext: {
        required: ['measurement_method_id'],
        seriesDefining: ['measurement_method_id'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'low',
    expectedRecoveryHours: 24,
    invalidationRules: [
        'A step, hop or run-up was used before the jump.',
        'The touch was made with the other hand or the reach was not measured under the same conditions.',
        'Illness, acute pain, or a footwear change materially affected the attempt.',
    ],
    capture: {
        plannedTrials: 3,
        maxTrials: 6,
        fields: [
            { id: 'standing_reach_cm', label: 'Standing reach', valueKind: 'number', unit: 'cm', required: true, minimum: 100, maximum: 300 },
            { id: 'touch_height_cm', label: 'Touch height', valueKind: 'number', unit: 'cm', required: true, minimum: 100, maximum: 450 },
        ],
        reducers: [{
            kind: 'max_valid_difference',
            metricId: 'wall_touch_cmj_height_cm',
            minuendFieldId: 'touch_height_cm',
            subtrahendFieldId: 'standing_reach_cm',
        }],
        reducerVersion: ASSESSMENT_REDUCER_VERSION_V1,
    },
    createdAt: CREATED_AT,
};

/** The 3 kg ball mass is part of this protocol revision, not a comparison dimension. */
export const SEATED_MEDBALL_THROW_PROTOCOL: MeasurementProtocol = {
    id: 'field-seated-medball-chest-throw-3kg',
    revision: 1,
    title: 'Seated 3 kg medicine-ball chest throw',
    intent: 'testing',
    metricIds: ['seated_medball_throw_distance_m'],
    instructions: [
        { id: 'warmup', text: 'Complete an upper-body warm-up and 2-3 sub-maximal practice throws.' },
        { id: 'position', text: 'Sit with the back and head against a wall, legs extended, holding the 3 kg ball at chest height.' },
        { id: 'throw', text: 'Push the ball forward as far as possible with both hands, keeping the back against the wall.' },
        { id: 'measure', text: 'Measure from the wall to the first point of ball contact. Perform three maximal throws with about 60 seconds of rest.' },
    ],
    comparisonContext: {
        required: ['equipment_setup_id'],
        seriesDefining: ['equipment_setup_id'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'low',
    expectedRecoveryHours: 24,
    invalidationRules: [
        'The back or head left the wall during the throw.',
        'A ball other than the declared 3 kg ball was used.',
        'Illness, acute pain, or equipment failure materially affected the attempt.',
    ],
    capture: {
        plannedTrials: 3,
        maxTrials: 6,
        fields: [
            { id: 'distance_m', label: 'Distance', valueKind: 'number', unit: 'm', required: true, minimum: 0.5, maximum: 15 },
        ],
        reducers: [{ kind: 'max_valid', metricId: 'seated_medball_throw_distance_m', fieldId: 'distance_m' }],
        reducerVersion: ASSESSMENT_REDUCER_VERSION_V1,
    },
    createdAt: CREATED_AT,
};

/**
 * A new protocol, not a revision of `cycling-5s-peak-power`@1 (WP0.3): the 1 s peak and 5 s
 * mean are separate canonical metrics and may come from different trials. Left/right balance
 * is descriptive raw context only, never a corrective target.
 */
export const CYCLING_6S_SEATED_SPRINT_PROTOCOL: MeasurementProtocol = {
    id: 'cycling-6s-seated-sprint',
    revision: 1,
    title: 'Cycling 3 x 6-second seated sprint',
    intent: 'testing',
    metricIds: ['cycling_sprint_1s_peak_power_w', 'cycling_sprint_5s_mean_power_w'],
    instructions: [
        { id: 'warmup', text: 'Complete the standard sprint warm-up including at least one sub-maximal priming effort.' },
        { id: 'calibrate', text: 'Use and calibrate (zero offset) the declared power source.' },
        { id: 'effort', text: 'From the declared start, sprint maximally for 6 seconds while staying seated throughout.' },
        { id: 'recovery', text: 'Spin easily for at least 4 minutes between efforts. Perform three efforts.' },
        { id: 'record', text: 'For each effort record the best 1-second power and the best 5-second mean power from the declared source; cadence and left/right balance are optional.' },
    ],
    warmupRef: SPRINT_WARMUP,
    comparisonContext: {
        required: ['power_source_id', 'bike_setup_id', 'test_environment', 'start_mode', 'warmup_revision'],
        seriesDefining: ['power_source_id', 'bike_setup_id', 'test_environment', 'start_mode', 'warmup_revision'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'moderate',
    expectedRecoveryHours: 24,
    invalidationRules: [
        'The athlete stood up out of the saddle during the effort.',
        'The effort was interrupted or materially shorter than 6 seconds.',
        'The declared power source or bike setup changed during the test.',
        'Illness, acute pain, or equipment failure materially affected the effort.',
    ],
    capture: {
        plannedTrials: 3,
        maxTrials: 5,
        fields: [
            { id: 'peak_power_1s_w', label: '1 s peak power', valueKind: 'number', unit: 'W', required: true, minimum: 50, maximum: 3000 },
            { id: 'mean_power_5s_w', label: '5 s mean power', valueKind: 'number', unit: 'W', required: true, minimum: 50, maximum: 3000 },
            { id: 'start_cadence_rpm', label: 'Start cadence', valueKind: 'number', unit: 'rpm', required: false, minimum: 0, maximum: 250 },
            { id: 'peak_cadence_rpm', label: 'Peak cadence', valueKind: 'number', unit: 'rpm', required: false, minimum: 0, maximum: 250 },
            { id: 'left_balance_pct', label: 'Left power balance', valueKind: 'number', unit: 'pct', required: false, minimum: 0, maximum: 100 },
        ],
        reducers: [
            { kind: 'max_valid', metricId: 'cycling_sprint_1s_peak_power_w', fieldId: 'peak_power_1s_w' },
            { kind: 'max_valid', metricId: 'cycling_sprint_5s_mean_power_w', fieldId: 'mean_power_5s_w' },
        ],
        reducerVersion: ASSESSMENT_REDUCER_VERSION_V1,
    },
    createdAt: CREATED_AT,
};

export const PHYSICAL_CAPITAL_PROTOCOLS: readonly MeasurementProtocol[] = [
    BENCH_PRESS_1RM_PROTOCOL,
    BACK_SQUAT_1RM_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
    WALL_TOUCH_CMJ_PROTOCOL,
    SEATED_MEDBALL_THROW_PROTOCOL,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
];
