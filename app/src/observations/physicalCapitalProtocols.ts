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
const SPRINT_WARMUP_V2 = 'cycling-sprint-warmup-r2';
const CREATED_AT_V2 = '2026-09-30T15:00:00.000Z';

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


/**
 * Revision 2 aligns the athlete-facing October baseline with the v1.6 execution protocol.
 * Revision 1 is intentionally preserved above because ADR-0046 makes protocol revisions
 * immutable evidence contracts once published.
 */
export const BENCH_PRESS_1RM_PROTOCOL_V2: MeasurementProtocol = {
    ...BENCH_PRESS_1RM_PROTOCOL,
    revision: 2,
    instructions: [
        { id: 'safety', text: 'Bench inside a rack with safety arms set just below chest height, or with a competent spotter. Do not attempt maximal lifts alone without safeties.' },
        { id: 'warmup', text: 'Complete the established progressive warm-up ramp. Choose later attempts from bar speed, technique and feel rather than historical peak numbers.' },
        { id: 'standard', text: 'Use the same established grip, chest touch point, approximately 1-second pause, repeatable arch, planted feet and butt-on-bench standard on every test. A valid lift finishes at full lockout without bounce or spotter contact.' },
        { id: 'attempts', text: 'Rest about 3-5 minutes before heavy attempts. End after a technically valid maximum is established or after two misses at the same or nearby load; do not chase repeated misses.' },
        RAW_VIDEO_INSTRUCTION,
    ],
    invalidationRules: [
        'The spotter touched the bar during the attempt.',
        'The bar bounced, the pause/touch standard was not met, the feet lost the declared position, or the butt left the bench.',
        'The lift was not pressed to full lockout.',
        'Chest symptoms, syncope/near-syncope, disproportionate breathlessness, sustained palpitations, acute pain, illness, or equipment failure materially affected the attempt.',
    ],
    createdAt: CREATED_AT_V2,
};

export const BACK_SQUAT_1RM_PROTOCOL_V2: MeasurementProtocol = {
    ...BACK_SQUAT_1RM_PROTOCOL,
    revision: 2,
    instructions: [
        { id: 'safety', text: 'Squat inside a rack with safety pins set just below the bottom position, or with competent spotters. Do not attempt maximal lifts alone without safeties.' },
        { id: 'warmup', text: 'Complete the established progressive warm-up ramp. Choose later attempts from bar speed, technique and feel rather than historical peak numbers.' },
        { id: 'standard', text: 'Use the same established squat style on every test: footwear, belt/sleeve policy, stance, bar position and declared depth criterion must stay consistent. A valid lift meets that declared depth and returns to full standing without spotter contact.' },
        { id: 'attempts', text: 'Rest about 3-5 minutes before heavy attempts. End after a technically valid maximum is established or after two misses at the same or nearby load; do not chase repeated misses.' },
        RAW_VIDEO_INSTRUCTION,
    ],
    invalidationRules: [
        'A spotter touched the bar or the bar was set on the safety pins.',
        'The squat did not meet the athlete\'s declared repeatable depth criterion.',
        'The lift did not return to full standing.',
        'Chest symptoms, syncope/near-syncope, disproportionate breathlessness, sustained palpitations, acute pain, illness, or equipment failure materially affected the attempt.',
    ],
    createdAt: CREATED_AT_V2,
};

export const STANDING_BROAD_JUMP_PROTOCOL_V2: MeasurementProtocol = {
    ...STANDING_BROAD_JUMP_PROTOCOL,
    revision: 2,
    instructions: [
        { id: 'warmup', text: 'Complete a brief general warm-up plus 1-2 progressive jumps; the separate familiarization exposure should already have established the setup.' },
        { id: 'setup', text: 'Use the same fixed start line, floor, footwear and free arm-swing standard used for the baseline.' },
        { id: 'stance', text: 'Start with both feet behind the line and jump forward from a static two-foot stance with free arm swing.' },
        { id: 'measure', text: 'Measure from the fixed start line to the back of the rearmost heel.' },
        { id: 'attempts', text: 'Perform three maximal valid jumps with a controlled two-foot landing and about 60-90 seconds of rest.' },
    ],
    comparisonContext: {
        required: ['test_environment', 'equipment_setup_id'],
        seriesDefining: ['test_environment', 'equipment_setup_id'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    invalidationRules: [
        'Take-off was not from a static two-foot stance.',
        'The landing was not controlled on two feet, or the athlete fell/stepped backward.',
        'The fixed start line, floor, footwear or measurement setup differed materially from the declared setup.',
        'Illness or acute pain materially affected the attempt.',
    ],
    createdAt: CREATED_AT_V2,
};

export const WALL_TOUCH_CMJ_PROTOCOL_V2: MeasurementProtocol = {
    ...WALL_TOUCH_CMJ_PROTOCOL,
    revision: 2,
    instructions: [
        { id: 'warmup', text: 'Complete the same brief warm-up and two progressive practice jumps used for repeat testing.' },
        { id: 'reach', text: 'On the same wall/floor and in the same shoes, measure standing reach three times with the same marking hand and use the median.' },
        { id: 'jump', text: 'Use a normal arm swing. From a static stance, perform a countermovement jump without a step and touch the wall at the apex with the same marking hand.' },
        { id: 'attempts', text: 'Perform three maximal valid jumps 60-90 seconds apart. Replace only clearly invalid attempts and cap the session at five maximal attempts.' },
    ],
    comparisonContext: {
        required: ['measurement_method_id', 'equipment_setup_id'],
        seriesDefining: ['measurement_method_id', 'equipment_setup_id'],
        contextOnly: [],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: false, minimumExposures: 0 },
    invalidationRules: [
        'A step, hop or run-up was used before the jump.',
        'The marking hand or standing-reach method differed from the declared setup.',
        'The wall/floor, footwear or measurement setup differed materially from the declared setup.',
        'Illness or acute pain materially affected the attempt.',
    ],
    createdAt: CREATED_AT_V2,
};

export const SEATED_MEDBALL_THROW_PROTOCOL_V2: MeasurementProtocol = {
    ...SEATED_MEDBALL_THROW_PROTOCOL,
    revision: 2,
    instructions: [
        { id: 'warmup', text: 'Complete a brief upper-body warm-up and 2 progressive throws; the separate familiarization exposure should already have established the setup.' },
        { id: 'position', text: 'Sit on the floor with legs extended, head and upper back against the wall, holding the same 3 kg ball at the chest.' },
        { id: 'throw', text: 'Perform an explosive two-hand chest pass while keeping the torso against the wall.' },
        { id: 'measure', text: 'Measure from the wall to the first point of ball contact. Perform three maximal valid throws with about 60-90 seconds of rest.' },
    ],
    invalidationRules: [
        'The head/upper back or torso left the wall during the throw.',
        'A ball other than the declared 3 kg ball or a materially different station/setup was used.',
        'Illness, acute pain, or equipment failure materially affected the attempt.',
    ],
    createdAt: CREATED_AT_V2,
};

export const CYCLING_6S_SEATED_SPRINT_PROTOCOL_V2: MeasurementProtocol = {
    ...CYCLING_6S_SEATED_SPRINT_PROTOCOL,
    revision: 2,
    instructions: [
        { id: 'warmup', text: 'Complete 15-20 minutes of easy progressive cycling, then 2-3 short progressive cadence/torque activations with full recovery.' },
        { id: 'calibrate', text: 'Use the same bicycle and declared power source; calibrate/zero-offset it using the normal procedure.' },
        { id: 'effort', text: 'From the same seated rolling start (about 85-90 rpm when practical), sprint maximally for 6 seconds while staying seated throughout.' },
        { id: 'recovery', text: 'Recover about 5 minutes very easily between efforts. Perform three maximal seated efforts and stop after three valid trials.' },
        { id: 'mode', text: 'Use resistance, slope or free-ride mode; do not use ERG mode for the sprint.' },
        { id: 'record', text: 'For each effort record 1-second peak power and best 5-second mean power from the declared source. Peak cadence and left/right balance are descriptive context only.' },
    ],
    warmupRef: SPRINT_WARMUP_V2,
    familiarization: { required: false, minimumExposures: 0 },
    invalidationRules: [
        'The athlete stood up out of the saddle during the effort.',
        'The effort was interrupted or materially shorter than 6 seconds.',
        'The declared bicycle, power source, start convention or resistance/free-ride mode changed materially during the test.',
        'ERG mode was used for the maximal sprint.',
        'Chest symptoms, syncope/near-syncope, disproportionate breathlessness, sustained palpitations, acute pain, illness, or equipment failure materially affected the effort.',
    ],
    createdAt: CREATED_AT_V2,
};

export const PHYSICAL_CAPITAL_PROTOCOLS_V2: readonly MeasurementProtocol[] = [
    BENCH_PRESS_1RM_PROTOCOL_V2,
    BACK_SQUAT_1RM_PROTOCOL_V2,
    STANDING_BROAD_JUMP_PROTOCOL_V2,
    WALL_TOUCH_CMJ_PROTOCOL_V2,
    SEATED_MEDBALL_THROW_PROTOCOL_V2,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL_V2,
];

export const PHYSICAL_CAPITAL_PROTOCOLS: readonly MeasurementProtocol[] = [
    BENCH_PRESS_1RM_PROTOCOL,
    BACK_SQUAT_1RM_PROTOCOL,
    STANDING_BROAD_JUMP_PROTOCOL,
    WALL_TOUCH_CMJ_PROTOCOL,
    SEATED_MEDBALL_THROW_PROTOCOL,
    CYCLING_6S_SEATED_SPRINT_PROTOCOL,
];

const fixedLoadComparison = {
    required: ['test_load_kg', 'measurement_method_id', 'equipment_setup_id'],
    seriesDefining: ['test_load_kg', 'measurement_method_id', 'equipment_setup_id'],
    contextOnly: [],
    canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
} as const satisfies MeasurementProtocol['comparisonContext'];

const fixedLoadCapture = {
    plannedTrials: 3,
    maxTrials: 6,
    fields: strengthTrialFields.map(field => field.id === 'mean_concentric_velocity_mps' ? { ...field, required: true } : { ...field }),
    reducers: [{ kind: 'max_valid', metricId: 'strength_fixed_load_mean_velocity_mps', fieldId: 'mean_concentric_velocity_mps' }],
    reducerVersion: ASSESSMENT_REDUCER_VERSION_V1,
} as const satisfies MeasurementProtocol['capture'];

export const BENCH_PRESS_FIXED_LOAD_VELOCITY_PROTOCOL: MeasurementProtocol = {
    id: 'strength-bench-press-fixed-load-velocity', revision: 1, title: 'Bench press fixed-load velocity', intent: 'testing',
    metricIds: ['strength_fixed_load_mean_velocity_mps'],
    comparisonContext: fixedLoadComparison, capture: fixedLoadCapture,
    familiarization: { required: false, minimumExposures: 0 }, burden: 'low', expectedRecoveryHours: 24,
    instructions: [
        { id: 'safety', text: 'Bench inside a rack with safety arms just below chest height or with a competent spotter. Stop for pain, chest symptoms, near-syncope or unusual breathlessness.' },
        { id: 'warmup', text: 'Complete three progressive warm-up sets without fatigue. Choose a comfortable submaximal absolute load and lock that exact load for this test; log warm-ups as practice.' },
        { id: 'standard', text: 'Keep the same grip, arch, planted feet and chest touch point; pause approximately one second, then press with maximal concentric intent to full lockout. Do not bounce or lift the hips.' },
        { id: 'attempts', text: 'Perform 2-3 single repetitions at the locked load, resting 2-3 minutes between repetitions. Record successful execution and mean concentric velocity; peak velocity is optional. Mark failed or off-load repetitions as practice or invalid.' },
        { id: 'method', text: 'Keep the measurement method, parser and rack/camera setup identical. Imported velocity uses its actual method; changing the load, method or setup starts a separate comparison series.' },
        RAW_VIDEO_INSTRUCTION,
    ],
    invalidationRules: ['Spotter contact, bounce, missing pause, lifted hips or incomplete lockout.', 'A failed repetition or a repetition at a different load is not benchmark evidence.', 'Pain, illness or a material equipment/camera change affected the repetition.'],
    createdAt: '2026-10-08T00:00:00.000Z',
};

export const BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL: MeasurementProtocol = {
    ...BENCH_PRESS_FIXED_LOAD_VELOCITY_PROTOCOL,
    id: 'strength-back-squat-fixed-load-velocity', title: 'Back squat fixed-load velocity',
    instructions: [
        { id: 'safety', text: 'Squat inside a rack with safety pins just below the bottom position or with competent spotters. Stop for pain, chest symptoms, near-syncope or unusual breathlessness.' },
        { id: 'warmup', text: 'Complete three progressive warm-up sets without fatigue. Choose a comfortable submaximal absolute load and lock that exact load for this test; log warm-ups as practice.' },
        { id: 'standard', text: 'Keep footwear, stance, bar position and belt/sleeve policy identical. Reach depth with the hip crease below the top of the knee, then stand fully with maximal concentric intent and no spotter contact.' },
        { id: 'attempts', text: 'Perform 2-3 single repetitions at the locked load, resting 2-3 minutes between repetitions. Record successful execution and mean concentric velocity; peak velocity is optional. Mark failed or off-load repetitions as practice or invalid.' },
        { id: 'method', text: 'Keep the measurement method, parser and rack/camera setup identical. Imported velocity uses its actual method; changing the load, method or setup starts a separate comparison series.' },
        RAW_VIDEO_INSTRUCTION,
    ],
    invalidationRules: ['Missing declared depth, incomplete standing, spotter contact or bar resting on the safety pins.', 'A failed repetition or a repetition at a different load is not benchmark evidence.', 'Pain, illness or a material equipment/camera change affected the repetition.'],
};

/** All immutable revisions that diagnostic export must continue to understand. */
export const PHYSICAL_CAPITAL_PROTOCOL_REVISIONS: readonly MeasurementProtocol[] = [
    ...PHYSICAL_CAPITAL_PROTOCOLS,
    ...PHYSICAL_CAPITAL_PROTOCOLS_V2,
    BENCH_PRESS_FIXED_LOAD_VELOCITY_PROTOCOL,
    BACK_SQUAT_FIXED_LOAD_VELOCITY_PROTOCOL,
];
