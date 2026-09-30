import type {
    AssessmentCaptureDefinition,
    AssessmentReducer,
    AssessmentTrialFieldDefinition,
    AssessmentTrialFieldUnit,
    MeasurementProtocol,
} from './models';
import { getMetricDefinition } from './registry';

/** The only reducer semantics this build can replay. A new version needs new reducer code. */
export const ASSESSMENT_REDUCER_VERSION_V1 = 'assessment-reducer-v1';

export const MAX_CAPTURE_TRIALS = 30;
export const MAX_CAPTURE_FIELDS = 16;
export const MAX_CAPTURE_REDUCERS = 8;

const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_UNITS = new Set<AssessmentTrialFieldUnit>(['W', 'kg', 'cm', 'm', 'rpm', 'pct', 'm/s', 'rpe']);

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function assertValidField(field: AssessmentTrialFieldDefinition): void {
    if (!FIELD_ID_PATTERN.test(field.id)) {
        throw new Error(`Capture field id ${field.id} must match ${FIELD_ID_PATTERN.source}`);
    }
    if (field.label.trim().length === 0 || field.label.length > 120) {
        throw new Error(`Capture field ${field.id} requires a label of at most 120 characters`);
    }
    if (typeof field.required !== 'boolean') throw new Error(`Capture field ${field.id} requires a boolean required flag`);
    if (field.valueKind === 'boolean') return;
    if (field.valueKind !== 'number') {
        throw new Error(`Capture field ${(field as { id: string }).id} has unsupported valueKind`);
    }
    if (!FIELD_UNITS.has(field.unit)) throw new Error(`Capture field ${field.id} has unsupported unit ${String(field.unit)}`);
    if (!Number.isFinite(field.minimum) || !Number.isFinite(field.maximum) || field.minimum >= field.maximum) {
        throw new Error(`Capture field ${field.id} requires finite minimum < maximum bounds`);
    }
}

function requireReducerField(
    fields: ReadonlyMap<string, AssessmentTrialFieldDefinition>,
    fieldId: string,
    valueKind: AssessmentTrialFieldDefinition['valueKind'],
    reducer: AssessmentReducer,
): AssessmentTrialFieldDefinition {
    const field = fields.get(fieldId);
    if (!field) throw new Error(`Reducer for ${reducer.metricId} references undeclared field ${fieldId}`);
    if (field.valueKind !== valueKind) {
        throw new Error(`Reducer for ${reducer.metricId} requires ${valueKind} field ${fieldId}`);
    }
    if (!field.required) throw new Error(`Reducer input field ${fieldId} must be required`);
    return field;
}

function requireMetricUnit(field: AssessmentTrialFieldDefinition, reducer: AssessmentReducer): void {
    const metric = getMetricDefinition(reducer.metricId);
    if (field.valueKind !== 'number' || field.unit !== metric.unit) {
        throw new Error(`Reducer field ${field.id} unit must equal ${reducer.metricId} unit ${metric.unit}`);
    }
}

function assertValidReducer(
    reducer: AssessmentReducer,
    fields: ReadonlyMap<string, AssessmentTrialFieldDefinition>,
): void {
    switch (reducer.kind) {
        case 'max_valid':
            requireMetricUnit(requireReducerField(fields, reducer.fieldId, 'number', reducer), reducer);
            return;
        case 'max_valid_difference': {
            if (reducer.minuendFieldId === reducer.subtrahendFieldId) {
                throw new Error(`Difference reducer for ${reducer.metricId} needs two distinct fields`);
            }
            requireMetricUnit(requireReducerField(fields, reducer.minuendFieldId, 'number', reducer), reducer);
            requireMetricUnit(requireReducerField(fields, reducer.subtrahendFieldId, 'number', reducer), reducer);
            return;
        }
        case 'highest_successful_load':
            requireMetricUnit(requireReducerField(fields, reducer.loadFieldId, 'number', reducer), reducer);
            requireReducerField(fields, reducer.successFieldId, 'boolean', reducer);
            return;
        default:
            throw new Error(`Unsupported reducer kind: ${(reducer as { kind: string }).kind}`);
    }
}

/**
 * ADR-0046 D-AT-PROTOCOL: a multi-trial capture contract is part of the immutable protocol
 * revision. Every declared protocol metric must be produced by exactly one reducer. Hand-typed
 * canonical values for such a protocol are rejected by `adaptManualObservation` and by the
 * `hasValidTrialCaptureBinding` Firestore rule.
 */
export function assertValidAssessmentCapture(protocol: MeasurementProtocol, capture: AssessmentCaptureDefinition): void {
    assertPositiveInteger(capture.plannedTrials, 'capture.plannedTrials');
    assertPositiveInteger(capture.maxTrials, 'capture.maxTrials');
    if (capture.maxTrials > MAX_CAPTURE_TRIALS) throw new Error(`capture.maxTrials cannot exceed ${MAX_CAPTURE_TRIALS}`);
    if (capture.plannedTrials > capture.maxTrials) throw new Error('capture.plannedTrials cannot exceed capture.maxTrials');
    if (capture.reducerVersion !== ASSESSMENT_REDUCER_VERSION_V1) {
        throw new Error(`Unsupported capture reducerVersion: ${capture.reducerVersion}`);
    }
    if (capture.fields.length === 0 || capture.fields.length > MAX_CAPTURE_FIELDS) {
        throw new Error(`capture.fields must declare 1-${MAX_CAPTURE_FIELDS} fields`);
    }
    if (capture.reducers.length === 0 || capture.reducers.length > MAX_CAPTURE_REDUCERS) {
        throw new Error(`capture.reducers must declare 1-${MAX_CAPTURE_REDUCERS} reducers`);
    }

    const fields = new Map<string, AssessmentTrialFieldDefinition>();
    for (const field of capture.fields) {
        assertValidField(field);
        if (fields.has(field.id)) throw new Error(`Duplicate capture field id: ${field.id}`);
        fields.set(field.id, field);
    }

    const producedMetrics = new Set<string>();
    for (const reducer of capture.reducers) {
        if (!protocol.metricIds.includes(reducer.metricId)) {
            throw new Error(`Reducer metric ${reducer.metricId} is not declared by protocol ${protocol.id}@${protocol.revision}`);
        }
        if (producedMetrics.has(reducer.metricId)) throw new Error(`Metric ${reducer.metricId} has more than one reducer`);
        producedMetrics.add(reducer.metricId);
        assertValidReducer(reducer, fields);
    }
    for (const metricId of protocol.metricIds) {
        if (!producedMetrics.has(metricId)) throw new Error(`Trial-capture protocol metric ${metricId} has no reducer`);
    }
}

export function getCaptureField(
    capture: AssessmentCaptureDefinition,
    fieldId: string,
): AssessmentTrialFieldDefinition | undefined {
    return capture.fields.find(field => field.id === fieldId);
}
