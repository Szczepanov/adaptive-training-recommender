import { describe, expect, it } from 'vitest';
import type { AssessmentCaptureDefinition, MeasurementProtocol } from './models';
import { CYCLING_6S_SEATED_SPRINT_PROTOCOL, STANDING_BROAD_JUMP_PROTOCOL } from './physicalCapitalProtocols';
import { assertValidMeasurementProtocol } from './protocols';

function withCapture(capture: Partial<AssessmentCaptureDefinition>, base: MeasurementProtocol = STANDING_BROAD_JUMP_PROTOCOL): MeasurementProtocol {
    return { ...base, capture: { ...base.capture!, ...capture } };
}

describe('ADR-0046 D-AT-PROTOCOL capture contract validation', () => {
    it('accepts summary-only protocols with no capture contract', () => {
        const summaryOnly: MeasurementProtocol = { ...STANDING_BROAD_JUMP_PROTOCOL, capture: undefined };
        expect(() => assertValidMeasurementProtocol(summaryOnly)).not.toThrow();
    });

    it('bounds trial counts', () => {
        expect(() => assertValidMeasurementProtocol(withCapture({ plannedTrials: 0 }))).toThrow(/plannedTrials must be a positive integer/);
        expect(() => assertValidMeasurementProtocol(withCapture({ plannedTrials: 7, maxTrials: 6 }))).toThrow(/cannot exceed capture.maxTrials/);
        expect(() => assertValidMeasurementProtocol(withCapture({ maxTrials: 31 }))).toThrow(/cannot exceed 30/);
    });

    it('rejects an unsupported reducer version rather than reinterpreting history', () => {
        expect(() => assertValidMeasurementProtocol(withCapture({ reducerVersion: 'assessment-reducer-v2' })))
            .toThrow(/Unsupported capture reducerVersion/);
    });

    it('rejects malformed or duplicate field declarations', () => {
        const distance = STANDING_BROAD_JUMP_PROTOCOL.capture!.fields[0];
        expect(() => assertValidMeasurementProtocol(withCapture({ fields: [distance, distance] }))).toThrow(/Duplicate capture field id/);
        expect(() => assertValidMeasurementProtocol(withCapture({ fields: [{ ...distance, id: 'Distance CM' }] }))).toThrow(/must match/);
        expect(() => assertValidMeasurementProtocol(withCapture({
            fields: [{ id: 'distance_cm', label: 'Distance', valueKind: 'number', unit: 'in' as never, required: true, minimum: 1, maximum: 400 }],
        }))).toThrow(/unsupported unit/);
        expect(() => assertValidMeasurementProtocol(withCapture({
            fields: [{ id: 'distance_cm', label: 'Distance', valueKind: 'number', unit: 'cm', required: true, minimum: 400, maximum: 1 }],
        }))).toThrow(/minimum < maximum/);
    });

    it('requires reducer inputs to be declared, required and in the canonical metric unit', () => {
        expect(() => assertValidMeasurementProtocol(withCapture({
            reducers: [{ kind: 'max_valid', metricId: 'standing_broad_jump_distance_cm', fieldId: 'missing_cm' }],
        }))).toThrow(/undeclared field missing_cm/);
        expect(() => assertValidMeasurementProtocol(withCapture({
            fields: [{ id: 'distance_cm', label: 'Distance', valueKind: 'number', unit: 'cm', required: false, minimum: 1, maximum: 400 }],
        }))).toThrow(/must be required/);
        expect(() => assertValidMeasurementProtocol(withCapture({
            fields: [{ id: 'distance_cm', label: 'Distance', valueKind: 'number', unit: 'm', required: true, minimum: 0.1, maximum: 4 }],
        }))).toThrow(/unit must equal standing_broad_jump_distance_cm unit cm/);
    });

    it('requires every protocol metric to have exactly one reducer', () => {
        const [peak] = CYCLING_6S_SEATED_SPRINT_PROTOCOL.capture!.reducers;
        expect(() => assertValidMeasurementProtocol(withCapture({ reducers: [peak] }, CYCLING_6S_SEATED_SPRINT_PROTOCOL)))
            .toThrow(/cycling_sprint_5s_mean_power_w has no reducer/);
        expect(() => assertValidMeasurementProtocol(withCapture({ reducers: [peak, peak] }, CYCLING_6S_SEATED_SPRINT_PROTOCOL)))
            .toThrow(/more than one reducer/);
        expect(() => assertValidMeasurementProtocol(withCapture({
            reducers: [{ kind: 'max_valid', metricId: 'strength_1rm_kg', fieldId: 'distance_cm' }],
        }))).toThrow(/is not declared by protocol/);
    });

    it('requires a boolean success field for the 1RM reducer and distinct fields for a difference', () => {
        expect(() => assertValidMeasurementProtocol(withCapture({
            reducers: [{ kind: 'max_valid_difference', metricId: 'standing_broad_jump_distance_cm', minuendFieldId: 'distance_cm', subtrahendFieldId: 'distance_cm' }],
        }))).toThrow(/two distinct fields/);
        expect(() => assertValidMeasurementProtocol({
            ...STANDING_BROAD_JUMP_PROTOCOL,
            metricIds: ['strength_1rm_kg'],
            capture: {
                ...STANDING_BROAD_JUMP_PROTOCOL.capture!,
                fields: [
                    { id: 'load_kg', label: 'Load', valueKind: 'number', unit: 'kg', required: true, minimum: 1, maximum: 500 },
                    { id: 'successful', label: 'Success', valueKind: 'number', unit: 'kg', required: true, minimum: 0, maximum: 1 },
                ],
                reducers: [{ kind: 'highest_successful_load', metricId: 'strength_1rm_kg', loadFieldId: 'load_kg', successFieldId: 'successful' }],
            },
        })).toThrow(/requires boolean field successful/);
    });
});
