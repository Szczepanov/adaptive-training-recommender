import { describe, expect, it } from 'vitest';
import type { ComparisonContext, ComparisonSeries, MeasurementProtocol } from './models';
import {
    areComparisonSeriesComparable,
    buildComparisonSeries,
    COMPARISON_CANONICALIZATION_V1,
} from './comparability';
import { assertValidMeasurementProtocol } from './protocols';

function protocol(overrides: Partial<MeasurementProtocol> = {}): MeasurementProtocol {
    return {
        id: 'cycling-20m-tt',
        revision: 1,
        title: 'Cycling 20-minute TT',
        intent: 'testing',
        metricIds: ['cycling_tt_20m_mean_power_w'],
        instructions: [{ id: 'main', text: 'Complete the declared 20-minute protocol.' }],
        comparisonContext: {
            required: ['power_source_id', 'bike_setup_id', 'duration_seconds', 'warmup_revision', 'feedback_rule', 'weather_note'],
            seriesDefining: ['power_source_id', 'bike_setup_id', 'duration_seconds', 'warmup_revision', 'feedback_rule'],
            contextOnly: ['weather_note'],
            canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
        },
        familiarization: { required: true, minimumExposures: 1 },
        burden: 'high',
        expectedRecoveryHours: 24,
        invalidationRules: ['Interrupted effort'],
        createdAt: '2026-08-21T00:00:00.000Z',
        ...overrides,
    };
}

const baseContext: ComparisonContext = {
    power_source_id: 'Favero-Assioma-Duo',
    bike_setup_id: 'Road Bike A',
    duration_seconds: 1200,
    warmup_revision: 'WU-1',
    feedback_rule: 'Power Visible',
    weather_note: 'Indoor, fan on',
};

describe('OV1 protocol validation and comparable series', () => {
    it('canonicalizes equivalent repeats identically regardless of input key order or identifier case/whitespace', async () => {
        const a = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), baseContext);
        const b = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), {
            weather_note: 'Different contextual wording is allowed',
            feedback_rule: ' power visible ',
            warmup_revision: 'wu-1',
            duration_seconds: 1200,
            bike_setup_id: ' road bike a ',
            power_source_id: 'FAVERO-ASSIOMA-DUO',
        });
        expect(a.key).toBe(b.key);
        expect(a.key).toMatch(/^[0-9a-f]{64}$/);
        expect(areComparisonSeriesComparable(a, b)).toBe(true);
    });

    it('creates a new series when a series-defining device/setup dimension changes', async () => {
        const baseline = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), baseContext);
        const changedDevice = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), {
            ...baseContext,
            power_source_id: 'Kickr-v7',
        });
        expect(changedDevice.key).not.toBe(baseline.key);
        expect(areComparisonSeriesComparable(baseline, changedDevice)).toBe(false);
    });

    it('creates a new series when a material warm-up revision changes', async () => {
        const baseline = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), baseContext);
        const changedWarmup = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), {
            ...baseContext,
            warmup_revision: 'WU-2',
        });
        expect(changedWarmup.key).not.toBe(baseline.key);
    });

    it('does not split a series for context-only note changes', async () => {
        const baseline = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), baseContext);
        const differentWeather = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), {
            ...baseContext,
            weather_note: 'Rain outside; test remained indoors',
        });
        expect(differentWeather.key).toBe(baseline.key);
    });

    it('keeps protocol revision and canonicalization version explicit in comparability', async () => {
        const revision1 = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), baseContext);
        const revision2 = await buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol({ revision: 2 }), baseContext);
        expect(revision2.key).not.toBe(revision1.key);

        const sameKeyOldPolicy: ComparisonSeries = {
            ...revision1,
            canonicalizationVersion: 'comparison-series-v0',
        };
        expect(areComparisonSeriesComparable(revision1, sameKeyOldPolicy)).toBe(false);
    });

    it('fails on unit mismatch, undeclared metrics and missing required context', async () => {
        await expect(buildComparisonSeries('cycling_tt_20m_mean_power_w', 'kW', protocol(), baseContext))
            .rejects.toThrow(/requires unit W/);
        await expect(buildComparisonSeries('cycling_tt_4m_mean_power_w', 'W', protocol(), baseContext))
            .rejects.toThrow(/not declared by protocol/);
        const missingDevice: ComparisonContext = {
            bike_setup_id: 'Road Bike A',
            duration_seconds: 1200,
            warmup_revision: 'WU-1',
            feedback_rule: 'Power Visible',
            weather_note: 'Indoor, fan on',
        };
        await expect(buildComparisonSeries('cycling_tt_20m_mean_power_w', 'W', protocol(), missingDevice))
            .rejects.toThrow(/Missing required comparison dimension: power_source_id/);
    });

    it('rejects malformed comparison partitions', () => {
        const overlap = protocol({
            comparisonContext: {
                required: ['power_source_id'],
                seriesDefining: ['power_source_id'],
                contextOnly: ['power_source_id'],
                canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
            },
        });
        expect(() => assertValidMeasurementProtocol(overlap)).toThrow(/cannot be both series-defining and context-only/);

        const unclassifiedRequired = protocol({
            comparisonContext: {
                required: ['power_source_id', 'weather_note'],
                seriesDefining: ['power_source_id'],
                contextOnly: [],
                canonicalizationVersion: COMPARISON_CANONICALIZATION_V1,
            },
        });
        expect(() => assertValidMeasurementProtocol(unclassifiedRequired)).toThrow(/must be classified/);
    });

    it('rejects unsupported canonicalization versions rather than silently re-keying old evidence', async () => {
        await expect(buildComparisonSeries(
            'cycling_tt_20m_mean_power_w',
            'W',
            protocol({
                comparisonContext: {
                    ...protocol().comparisonContext,
                    canonicalizationVersion: 'comparison-series-v2',
                },
            }),
            baseContext,
        )).rejects.toThrow(/Unsupported comparison canonicalization version/);
    });
});
