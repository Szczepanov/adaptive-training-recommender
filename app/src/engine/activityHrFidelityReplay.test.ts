import { describe, expect, it } from 'vitest';
import {
    renderActivityHrFidelityShadowReplayMarkdown,
    runActivityHrFidelityShadowReplay,
} from './activityHrFidelityReplay';
import type { HrMeasurement, NormalizedGarminActivity } from './models';

const measurement = (overrides: Partial<HrMeasurement> = {}): HrMeasurement => ({
    externalHrSensorPresent: false,
    sourceForActivity: 'wrist',
    provenanceConfidence: 'inferred',
    sensorTechnology: 'wrist_ppg',
    activityMotionRisk: 'low',
    coveragePct: 99,
    longestGapSeconds: 1,
    signalQuality: 'clean',
    measurementConfidence: 'high',
    summaryCompatibility: 'verified_same_effective_trace',
    artifactFlags: [],
    reasons: [],
    diagnosticVersion: '1.0.0',
    ...overrides,
});

const activity = (id: string, overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity => ({
    activityId: id,
    date: '2026-08-29',
    type: 'cycling',
    durationMin: 60,
    trainingEffectAerobic: 3,
    trainingEffectAnaerobic: null,
    averageHr: 145,
    activityTrainingLoad: 120,
    intensityTag: 'hard',
    hrInZones: [{ zoneNumber: 4, secondsInZone: 900 }],
    ...overrides,
});

describe('runActivityHrFidelityShadowReplay', () => {
    it('keeps absent assessment distinct from assessed unknown confidence', () => {
        const report = runActivityHrFidelityShadowReplay([
            activity('not-assessed', { hrMeasurement: undefined }),
            activity('unknown', { hrMeasurement: measurement({ measurementConfidence: 'unknown', reasons: ['FIT_DATA_INCOMPLETE'] }) }),
        ]);

        expect(report.rows.map(row => row.assessmentState)).toEqual(['NOT_ASSESSED', 'ASSESSED']);
        expect(report.summary).toMatchObject({
            totalActivities: 2,
            assessedActivities: 1,
            notAssessedActivities: 1,
            unknownAssessmentCount: 1,
            assessmentUnknownRate: 1,
            assessableCoverage: 0.5,
            assessmentUnknownReasons: {
                MEASUREMENT_UNAVAILABLE: 1,
                FIT_DATA_INCOMPLETE: 1,
            },
        });
        expect(report.rows[0].authorityByUse.DISPLAY_AVERAGE).toMatchObject({
            status: 'OBSERVATIONAL', reasons: ['MEASUREMENT_UNAVAILABLE'],
        });
        expect(report.rows[1].authorityByUse.MAX_HR_UPDATE).toMatchObject({
            status: 'BLOCKED', reasons: ['MEASUREMENT_UNKNOWN'],
        });
    });

    it('records the current vendor summary use while keeping its HRF authority fail-closed', () => {
        const report = runActivityHrFidelityShadowReplay([activity('wrist', {
            hrMeasurement: measurement({ artifactFlags: ['ISOLATED_SPIKE'] }),
        })]);
        const row = report.rows[0];

        expect(row.currentProductionUse).toEqual({
            averageHrDisplay: true,
            hrZoneDisplay: true,
            garminTrainingLoadEvidence: true,
            garminTrainingEffectEvidence: true,
        });
        expect(row.authorityByUse.DISPLAY_AVERAGE.status).toBe('ALLOWED');
        expect(row.authorityByUse.TRAINING_LOAD).toMatchObject({
            status: 'BLOCKED', reasons: ['INPUT_LINEAGE_UNVERIFIED'],
        });
        expect(row.authorityByUse.MAX_HR_UPDATE.status).toBe('BLOCKED');
        expect(row.authorityByUse.MAX_HR_UPDATE.reasons).toContain('PEAK_ARTIFACT');
        expect(report.summary).toMatchObject({
            usefulWristTraceCount: 1,
            featureSpecificBlockWithDisplayAvailableCount: 1,
            artifactPrevalence: { ISOLATED_SPIKE: 1 },
            summaryComparableCount: 1,
            summaryReconciliationRate: 1,
            summaryDiscordanceRate: 0,
        });
        expect(report.summary.candidateBlocks.garminTrainingLoad).toMatchObject({ candidateCount: 1, blocked: 1 });
        expect(report.summary.candidateBlocks.maxHrUpdate).toMatchObject({ candidateCount: 1, blocked: 1 });
    });

    it('measures chest-strap poor traces and summary discordance without claiming false precision', () => {
        const report = runActivityHrFidelityShadowReplay([activity('poor-external', {
            type: 'running',
            hrMeasurement: measurement({
                externalHrSensorPresent: true,
                sourceForActivity: 'external',
                sensorTechnology: 'electrode_chest_strap',
                signalQuality: 'poor',
                measurementConfidence: 'unreliable',
                summaryCompatibility: 'discordant',
                artifactFlags: ['REPEATED_DROPOUT'],
            }),
        })]);

        expect(report.summary.poorTraceDespiteChestStrapCount).toBe(1);
        expect(report.summary.sourceDistribution.external).toBe(1);
        expect(report.summary.summaryCompatibility.discordant).toBe(1);
        expect(report.summary.summaryComparableCount).toBe(1);
        expect(report.summary.summaryReconciliationRate).toBe(0);
        expect(report.summary.summaryDiscordanceRate).toBe(1);
        expect(report.summary.confidenceByActivityType).toEqual([expect.objectContaining({
            activityType: 'running', assessed: 1, confidence: expect.objectContaining({ unreliable: 1 }),
        })]);
        expect(renderActivityHrFidelityShadowReplayMarkdown(report)).not.toMatch(/accuracy\s*=|% accurate/i);
    });

    it('does not call every poor external sensor a chest-strap failure', () => {
        const report = runActivityHrFidelityShadowReplay([activity('poor-optical', {
            hrMeasurement: measurement({
                externalHrSensorPresent: true,
                sourceForActivity: 'external',
                sensorTechnology: 'optical_armband',
                signalQuality: 'poor',
                measurementConfidence: 'unreliable',
            }),
        })]);

        expect(report.summary.poorTraceDespiteChestStrapCount).toBe(0);
    });

    it('counts preserved wrist display only when production actually has an average-HR display candidate', () => {
        const report = runActivityHrFidelityShadowReplay([activity('wrist-no-average', {
            averageHr: null,
            hrInZones: [],
            activityTrainingLoad: null,
            trainingEffectAerobic: null,
            trainingEffectAnaerobic: null,
            hrMeasurement: measurement(),
        })]);

        expect(report.rows[0].authorityByUse.DISPLAY_AVERAGE.status).toBe('ALLOWED');
        expect(report.summary.usefulWristTraceCount).toBe(0);
        expect(report.summary.featureSpecificBlockWithDisplayAvailableCount).toBe(0);
    });

    it('records an explicit fallback reason when assessed unknown confidence has none', () => {
        const report = runActivityHrFidelityShadowReplay([activity('unknown-no-reason', {
            hrMeasurement: measurement({ measurementConfidence: 'unknown', reasons: [] }),
        })]);

        expect(report.summary.assessmentUnknownReasons).toEqual({ ASSESSMENT_REASON_UNSPECIFIED: 1 });
    });

    it('has stable zero-safe observability for an empty replay', () => {
        const report = runActivityHrFidelityShadowReplay([]);

        expect(report.summary.assessableCoverage).toBe(0);
        expect(report.summary.assessmentUnknownRate).toBe(0);
        expect(report.summary.summaryComparableCount).toBe(0);
        expect(report.summary.summaryReconciliationRate).toBe(0);
        expect(report.summary.summaryDiscordanceRate).toBe(0);
        expect(report.summary.candidateBlocks.hrZoneDistribution).toEqual({
            candidateCount: 0, allowed: 0, bounded: 0, observational: 0, blocked: 0,
        });
        expect(renderActivityHrFidelityShadowReplayMarkdown(report)).toContain('Assessed: 0/0 (0.0%)');
    });
});
