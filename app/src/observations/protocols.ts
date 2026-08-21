import type {
    ComparisonContextValue,
    ComparisonDimension,
    MeasurementProtocol,
} from './models';
import { getMetricDefinition } from './registry';

export type ComparisonDimensionValueKind = 'identifier' | 'number' | 'boolean' | 'text';

export interface ComparisonDimensionDefinition {
    id: ComparisonDimension;
    valueKind: ComparisonDimensionValueKind;
    description: string;
}

const DIMENSIONS = [
    { id: 'power_source_id', valueKind: 'identifier', description: 'Primary power meter or trainer identity.' },
    { id: 'bike_setup_id', valueKind: 'identifier', description: 'Bike/setup identity when material to the protocol.' },
    { id: 'test_environment', valueKind: 'identifier', description: 'Indoor/outdoor or another protocol-declared environment identity.' },
    { id: 'course_or_trainer_id', valueKind: 'identifier', description: 'Controlled course or indoor trainer/setup identity.' },
    { id: 'duration_seconds', valueKind: 'number', description: 'Protocol effort duration in seconds.' },
    { id: 'start_mode', valueKind: 'identifier', description: 'Declared start rule such as standing or rolling.' },
    { id: 'warmup_revision', valueKind: 'identifier', description: 'Warm-up prescription revision.' },
    { id: 'feedback_rule', valueKind: 'identifier', description: 'Feedback/pacing information allowed during the test.' },
    { id: 'weather_note', valueKind: 'text', description: 'Contextual weather note when weather is not series-defining.' },
] as const satisfies readonly ComparisonDimensionDefinition[];

const DIMENSION_BY_ID = new Map<ComparisonDimension, ComparisonDimensionDefinition>(
    DIMENSIONS.map(dimension => [dimension.id, dimension] as const),
);

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
}

export function measurementProtocolRef(protocol: MeasurementProtocol): { id: string; revision: number } {
    return { id: protocol.id, revision: protocol.revision };
}
