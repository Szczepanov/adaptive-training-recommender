import type {
    ComparisonContextValue,
    ComparisonDimension,
    MeasurementProtocol,
} from './models';
import { assertValidAssessmentCapture } from './assessmentCapture';
import { getMetricDefinition } from './registry';

export type ComparisonDimensionValueKind = 'identifier' | 'number' | 'boolean' | 'text';

export interface ComparisonDimensionPreset {
    id: string;
    label: string;
}

export interface ComparisonDimensionDefinition {
    id: ComparisonDimension;
    valueKind: ComparisonDimensionValueKind;
    description: string;
    displayName: string;
    athleteGuidance?: string;
    presets?: readonly ComparisonDimensionPreset[];
}

const DIMENSIONS: readonly ComparisonDimensionDefinition[] = [
    {
        id: 'power_source_id',
        valueKind: 'identifier',
        displayName: 'Power Meter / Trainer',
        description: 'Primary power meter or trainer identity.',
        athleteGuidance: 'Primary calibrated power meter or smart trainer reporting power.',
        presets: [
            { id: 'primary-power-meter', label: 'Primary Power Meter' },
            { id: 'smart-trainer', label: 'Smart Trainer' },
            { id: 'pedal-power-meter', label: 'Pedal Power Meter' },
            { id: 'crank-power-meter', label: 'Crank Power Meter' },
        ],
    },
    {
        id: 'bike_setup_id',
        valueKind: 'identifier',
        displayName: 'Bicycle Setup',
        description: 'Bike/setup identity when material to the protocol.',
        athleteGuidance: 'Bicycle geometry and setup used for testing.',
        presets: [
            { id: 'primary-road-bike', label: 'Primary Road Bike' },
            { id: 'smart-bike', label: 'Smart Bike' },
            { id: 'tt-bike', label: 'Time Trial / Tri Bike' },
        ],
    },
    {
        id: 'test_environment',
        valueKind: 'identifier',
        displayName: 'Test Environment',
        description: 'Indoor/outdoor or another protocol-declared environment identity.',
        athleteGuidance: 'Surface and environment where the test is conducted.',
        presets: [
            { id: 'indoor-gym-floor', label: 'Indoor Gym Floor' },
            { id: 'indoor-trainer', label: 'Indoor Trainer' },
            { id: 'outdoor-track', label: 'Outdoor Track / Turf' },
            { id: 'home-gym', label: 'Home Gym' },
        ],
    },
    {
        id: 'course_or_trainer_id',
        valueKind: 'identifier',
        displayName: 'Course / Trainer Station',
        description: 'Controlled course or indoor trainer/setup identity.',
    },
    {
        id: 'duration_seconds',
        valueKind: 'number',
        displayName: 'Test Duration (seconds)',
        description: 'Protocol effort duration in seconds.',
    },
    {
        id: 'start_mode',
        valueKind: 'identifier',
        displayName: 'Start Convention',
        description: 'Declared start rule such as standing or rolling.',
        athleteGuidance: 'Start rule (standing motionless vs seated rolling).',
        presets: [
            { id: 'seated-rolling', label: 'Seated Rolling Start' },
            { id: 'rolling', label: 'Rolling Start' },
            { id: 'standing', label: 'Standing Motionless Start' },
        ],
    },
    {
        id: 'warmup_revision',
        valueKind: 'identifier',
        displayName: 'Warm-Up Protocol',
        description: 'Warm-up prescription revision.',
        athleteGuidance: 'Prescribed warm-up routine completed before attempts.',
        presets: [
            { id: 'standard-strength-warmup-r1', label: 'Standard Strength Warm-Up' },
            { id: 'cycling-sprint-warmup-r2', label: 'Cycling Sprint Warm-Up' },
            { id: 'standard-warmup-r1', label: 'General Dynamic Warm-Up' },
        ],
    },
    {
        id: 'feedback_rule',
        valueKind: 'identifier',
        displayName: 'Feedback & Pacing Rule',
        description: 'Feedback/pacing information allowed during the test.',
    },
    {
        id: 'weather_note',
        valueKind: 'text',
        displayName: 'Weather Note',
        description: 'Contextual weather note when weather is not series-defining.',
    },
    {
        id: 'timing_method',
        valueKind: 'identifier',
        displayName: 'Timing Method',
        description: 'Timing method used to capture an elapsed-time result (e.g. timing gates, radar/laser, handheld stopwatch); method materially affects comparability.',
        athleteGuidance: 'Timing equipment used to record elapsed duration.',
        presets: [
            { id: 'timing-gates', label: 'Electronic Timing Gates' },
            { id: 'laser-radar', label: 'Laser / Radar' },
            { id: 'handheld-stopwatch', label: 'Handheld Stopwatch' },
        ],
    },
    {
        id: 'measurement_method_id',
        valueKind: 'identifier',
        displayName: 'Measurement Method',
        description: 'Measurement method identity when it materially changes the result (e.g. wall-touch vs contact-mat jump height, bar-velocity app/camera method).',
        athleteGuidance: 'How performance was measured (different methods cannot be compared directly).',
    },
    {
        id: 'equipment_setup_id',
        valueKind: 'identifier',
        displayName: 'Equipment & Station Setup',
        description: 'Test station or equipment setup identity when material to the protocol (e.g. rack/bench setup, throw station).',
        athleteGuidance: 'Choose or name your station (e.g. rack-1, standard-power-rack, floor-line) so future tests on the same setup compare together.',
        presets: [
            { id: 'standard-power-rack', label: 'Standard Power Rack' },
            { id: 'standard-floor-line', label: 'Floor Line & Tape' },
            { id: 'standard-jump-mat', label: 'Jump Mat' },
            { id: 'standard-wall-station', label: 'Wall Station' },
            { id: 'standard-throw-station', label: 'Throw Station' },
        ],
    },
    {
        id: 'test_load_kg',
        valueKind: 'number',
        displayName: 'Fixed Test Load (kg)',
        description: 'Exact fixed test load in kilograms; use the same absolute load on every benchmark repetition.',
        athleteGuidance: 'Barbell load locked for this velocity series (e.g. 80 kg).',
    },
];

const DIMENSION_BY_ID = new Map<ComparisonDimension, ComparisonDimensionDefinition>(
    DIMENSIONS.map(dimension => [dimension.id, dimension] as const),
);

export function listComparisonDimensionIds(): readonly ComparisonDimension[] {
    return DIMENSIONS.map(dimension => dimension.id);
}

export function getComparisonDimensionDefinition(id: ComparisonDimension): ComparisonDimensionDefinition {
    const dimension = DIMENSION_BY_ID.get(id);
    if (!dimension) throw new Error(`Unsupported comparison dimension: ${id}`);
    return dimension;
}

export function assertComparisonDimensionValue(id: ComparisonDimension, value: ComparisonContextValue): void {
    const definition = getComparisonDimensionDefinition(id);
    switch (definition.valueKind) {
        case 'identifier':
        case 'text':
            if (typeof value !== 'string' || value.trim().length === 0) {
                throw new Error(`Comparison dimension ${id} requires a non-empty string`);
            }
            return;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new Error(`Comparison dimension ${id} requires a finite number`);
            }
            if (id === 'test_load_kg' && (value < 1 || value > 500)) {
                throw new Error('Fixed test load must be within 1-500 kg');
            }
            return;
        case 'boolean':
            if (typeof value !== 'boolean') {
                throw new Error(`Comparison dimension ${id} requires a boolean`);
            }
            return;
    }
}

function assertUniqueDimensions(label: string, dimensions: readonly ComparisonDimension[]): void {
    if (new Set(dimensions).size !== dimensions.length) {
        throw new Error(`${label} contains duplicate comparison dimensions`);
    }
}

function assertUniqueStrings(label: string, values: readonly string[]): void {
    if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate values`);
}

/**
 * Runtime contract validation for immutable protocol revisions. Persistence immutability lands
 * in OV2; this validator pins the revision shape and comparison partition before any storage
 * path exists.
 */
export function assertValidMeasurementProtocol(protocol: MeasurementProtocol): void {
    if (protocol.id.trim().length === 0) throw new Error('Measurement protocol id is required');
    if (!Number.isInteger(protocol.revision) || protocol.revision < 1) {
        throw new Error('Measurement protocol revision must be a positive integer');
    }
    if (protocol.title.trim().length === 0) throw new Error('Measurement protocol title is required');
    if (protocol.intent !== 'testing') throw new Error('Measurement protocol intent must be testing');
    if (protocol.metricIds.length === 0) throw new Error('Measurement protocol must declare at least one metric');
    assertUniqueStrings('Measurement protocol metricIds', protocol.metricIds);
    protocol.metricIds.forEach(getMetricDefinition);

    const instructionIds = protocol.instructions.map(instruction => instruction.id);
    assertUniqueStrings('Measurement protocol instruction ids', instructionIds);
    for (const instruction of protocol.instructions) {
        if (instruction.id.trim().length === 0 || instruction.text.trim().length === 0) {
            throw new Error('Protocol instructions require non-empty id and text');
        }
    }

    const { required, seriesDefining, contextOnly, canonicalizationVersion } = protocol.comparisonContext;
    assertUniqueDimensions('required', required);
    assertUniqueDimensions('seriesDefining', seriesDefining);
    assertUniqueDimensions('contextOnly', contextOnly);
    if (canonicalizationVersion.trim().length === 0) throw new Error('canonicalizationVersion is required');

    const requiredSet = new Set(required);
    const seriesSet = new Set(seriesDefining);
    const contextSet = new Set(contextOnly);

    for (const dimension of [...required, ...seriesDefining, ...contextOnly]) {
        getComparisonDimensionDefinition(dimension);
    }
    for (const dimension of seriesDefining) {
        if (!requiredSet.has(dimension)) {
            throw new Error(`Series-defining dimension ${dimension} must also be required`);
        }
        if (contextSet.has(dimension)) {
            throw new Error(`Comparison dimension ${dimension} cannot be both series-defining and context-only`);
        }
    }
    for (const dimension of contextOnly) {
        if (!requiredSet.has(dimension)) {
            throw new Error(`Context-only dimension ${dimension} must also be required`);
        }
    }
    for (const dimension of required) {
        if (!seriesSet.has(dimension) && !contextSet.has(dimension)) {
            throw new Error(`Required comparison dimension ${dimension} must be classified as series-defining or context-only`);
        }
    }

    if (!Number.isInteger(protocol.familiarization.minimumExposures) || protocol.familiarization.minimumExposures < 0) {
        throw new Error('Familiarization minimumExposures must be a non-negative integer');
    }
    if (protocol.familiarization.required && protocol.familiarization.minimumExposures < 1) {
        throw new Error('A required familiarization needs at least one minimum exposure');
    }
    if (protocol.expectedRecoveryHours !== undefined
        && (!Number.isFinite(protocol.expectedRecoveryHours) || protocol.expectedRecoveryHours < 0)) {
        throw new Error('expectedRecoveryHours must be a finite non-negative number');
    }
    if (protocol.capture !== undefined) assertValidAssessmentCapture(protocol, protocol.capture);
}

export function measurementProtocolRef(protocol: MeasurementProtocol): { id: string; revision: number } {
    return { id: protocol.id, revision: protocol.revision };
}
