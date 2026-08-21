import { describe, expect, it } from 'vitest';
import type { MeasurementProtocol } from './models';
import { COMPARISON_CANONICALIZATION_V1 } from './comparability';
import {
    buildComparisonContextFromStrings,
    buildTestingSessionDefinition,
    createAssessmentAttemptId,
} from './testingWorkflow';

const protocol: MeasurementProtocol = {
    id: 'cycling-20m-tt',
    revision: 2,
    title: '20-minute cycling TT',
    intent: 'testing',
    metricIds: ['cycling_tt_20m_mean_power_w'],
    instructions: [
        { id: 'settle', text: 'Settle on the prescribed setup.' },
        { id: 'effort', text: 'Ride 20 minutes as hard as sustainably possible.' },
    ],
    warmupRef: 'cycling-tt-warmup-r1',
    comparisonContext: {
        required: ['power_source_id', 'duration_seconds', 'weather_note'],
        seriesDefining: ['power_source_id', 'duration_seconds'],
        contextOnly: ['weather_note'],
        canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
    },
    familiarization: { required: true, minimumExposures: 1 },
    burden: 'high',
    expectedRecoveryHours: 24,
    invalidationRules: ['Interrupted effort'],
    createdAt: '2026-08-21T08:00:00.000Z',
};

describe('OV3 protocol testing workflow helpers', () => {
    it('adapts an immutable protocol into the existing session runner contract with testing intent', () => {
        const definition = buildTestingSessionDefinition(protocol);
        expect(definition.intent).toBe('testing');
        expect(definition.id).toBe('testing-cycling-20m-tt-r2');
        expect(definition.blocks.map(block => block.role)).toEqual(['warmup', 'test']);
        expect(definition.blocks[1]?.steps.map(step => step.title)).toEqual(protocol.instructions.map(item => item.text));
        expect(definition.blocks.flatMap(block => block.steps).every(step => step.dose?.kind === 'checkoff')).toBe(true);
    });

    it('parses required comparison dimensions using the registered dimension types', () => {
        const context = buildComparisonContextFromStrings(protocol, {
            power_source_id: '  Assioma Duo  ',
            duration_seconds: '1200',
            weather_note: 'dry, still',
        });
        expect(context).toEqual({
            power_source_id: 'Assioma Duo',
            duration_seconds: 1200,
            weather_note: 'dry, still',
        });
    });

    it('fails closed when required comparison context is missing or invalid', () => {
        expect(() => buildComparisonContextFromStrings(protocol, {
            power_source_id: 'assioma-duo',
            duration_seconds: 'not-a-number',
            weather_note: 'dry',
        })).toThrow(/finite number/);
        expect(() => buildComparisonContextFromStrings(protocol, {
            power_source_id: 'assioma-duo',
            duration_seconds: '1200',
        })).toThrow(/weather_note/);
    });

    it('creates a stable attempt identity once entropy is fixed by the caller', () => {
        expect(createAssessmentAttemptId(protocol, 'offline-retry-token')).toBe(
            'assessment-cycling-20m-tt-r2-offline-retry-token',
        );
    });
});
