import { describe, expect, it } from 'vitest';
import type { NormalizedGarminActivity } from './models';
import {
    injectActivityTelemetryIntoContextBrief,
    renderContextBriefActivityTelemetry,
    renderMorningQualityActivityTelemetry,
} from './contextBriefActivityTelemetry';

function activity(
    overrides: Partial<NormalizedGarminActivity> = {},
): NormalizedGarminActivity {
    return {
        activityId: 'ride-1',
        date: '2026-08-19',
        type: 'road_biking',
        durationMin: 58,
        trainingEffectAerobic: 4.2,
        trainingEffectAnaerobic: 2.1,
        averageHr: 156,
        activityTrainingLoad: 186,
        intensityTag: 'hard',
        ...overrides,
    };
}

describe('renderContextBriefActivityTelemetry', () => {
    it('returns no section when the activity has only summary telemetry', () => {
        expect(renderContextBriefActivityTelemetry([activity()])).toBe('');
    });

    it('renders power, HR zones, and lap summaries for an enriched cycling activity', () => {
        const text = renderContextBriefActivityTelemetry([
            activity({
                normalizedPower: 287,
                intensityFactor: 0.93,
                variabilityIndex: 1.06,
                powerInZones: [
                    { zoneNumber: 2, secondsInZone: 900, lowBoundary: 150 },
                    { zoneNumber: 5, secondsInZone: 300, lowBoundary: 300 },
                ],
                hrInZones: [
                    { zoneNumber: 3, secondsInZone: 600, lowBoundary: 140 },
                    { zoneNumber: 4, secondsInZone: 600, lowBoundary: 156 },
                ],
                laps: [
                    {
                        lapIndex: 1,
                        durationSeconds: 600,
                        averagePowerWatts: 260,
                        averageHrBpm: 145,
                    },
                    {
                        lapIndex: 2,
                        durationSeconds: 300,
                        averagePowerWatts: 330,
                        averageHrBpm: 162,
                    },
                ],
            }),
        ]);

        expect(text).toContain('### Detailed activity telemetry');
        expect(text).toContain('#### 2026-08-19 — Road cycling — hard');
        expect(text).toContain('normalized power 287 W · IF 0.93 · VI 1.06');
        expect(text).toContain('Z2: 15:00 · 75% · low boundary 150 W');
        expect(text).toContain('Z4: 10:00 · 50% · low boundary 156 bpm');
        expect(text).toContain('| 2 | 5:00 | 330 W | 162 bpm |');
    });



    it('renders bounded multi-resolution provenance and semantic segments in diagnostic mode', () => {
        const text = renderContextBriefActivityTelemetry([
            activity({
                activityResponse: {
                    derivationVersion: 'multi-resolution-v1',
                    sourceResolution: { powerSeconds: 1, hrSeconds: 1, cadenceSeconds: 2 },
                    segmentCountTotal: 1,
                    segmentsTruncated: false,
                    powerDurationPeaks: [
                        { durationSeconds: 5, powerWatts: 710, confidence: 'high', activityHalf: 'first' },
                        { durationSeconds: 60, powerWatts: 320, confidence: 'high' },
                    ],
                    segments: [{
                        segmentIndex: 1,
                        segmentType: 'sprint',
                        identitySource: 'fit_workout_step',
                        durationSeconds: 10,
                        prescribedTarget: { kind: 'power_watts', value: 700 },
                        averagePowerWatts: 680,
                        peak5sPowerWatts: 710,
                        maxCadenceRpm: 122,
                        evidenceConfidence: 'high',
                    }],
                },
            }),
        ]);

        expect(text).toContain('Source resolution: power ~1 s · HR ~1 s · cadence ~2 s');
        expect(text).toContain('Power-duration peaks: 5s 710 W');
        expect(text).toContain('| 1 | sprint | fit_workout_step | 0:10 | 700 W |');
        expect(text).not.toContain('raw sample');
    });

    it('renders running dynamics in diagnostic detail even when no cycling power fields exist', () => {
        const text = renderContextBriefActivityTelemetry([
            activity({
                type: 'running',
                normalizedPower: undefined,
                intensityFactor: undefined,
                runningDynamics: {
                    groundContactTimeMs: 241,
                    strideLengthM: 1.28,
                    avgRunningPowerWatts: 305,
                },
            }),
        ]);

        expect(text).toContain('#### 2026-08-19 — Running — hard');
        expect(text).toContain('Running dynamics: avg running power 305 W · stride 1.28 m · GCT 241 ms');
    });

    it('renders partial telemetry without inventing missing power data', () => {
        const text = renderContextBriefActivityTelemetry([
            activity({
                type: 'cycling',
                hrInZones: [{ zoneNumber: 4, secondsInZone: 420 }],
            }),
        ]);

        expect(text).toContain('Heart-rate zones');
        expect(text).not.toContain('Power summary');
        expect(text).not.toContain('Power zones');
    });
});

describe('renderMorningQualityActivityTelemetry', () => {
    it('expands moderate tempo cycling with bounded multi-resolution power evidence', () => {
        const lines = renderMorningQualityActivityTelemetry(activity({
            intensityTag: 'moderate',
            stimulusDomain: 'tempo',
            variabilityIndex: 1.04,
            powerInZones: [
                { zoneNumber: 2, secondsInZone: 1200, lowBoundary: 150 },
                { zoneNumber: 3, secondsInZone: 1800, lowBoundary: 193 },
            ],
            activityResponse: {
                derivationVersion: 'multi-resolution-v1',
                sourceResolution: { powerSeconds: 1, hrSeconds: 1, cadenceSeconds: 1 },
                segmentCountTotal: 2,
                segmentsTruncated: false,
                powerDurationPeaks: [
                    { durationSeconds: 5, powerWatts: 640, confidence: 'high' },
                    { durationSeconds: 300, powerWatts: 255, confidence: 'high' },
                ],
                steadyHalves: {
                    firstPowerWatts: 201,
                    secondPowerWatts: 205,
                    firstHrBpm: 137,
                    secondHrBpm: 143,
                    firstCadenceRpm: 88,
                    secondCadenceRpm: 90,
                },
                segments: [
                    {
                        segmentIndex: 1,
                        segmentType: 'work',
                        identitySource: 'fit_workout_step',
                        durationSeconds: 900,
                        prescribedTarget: { kind: 'power_range_watts', low: 193, high: 229 },
                        averagePowerWatts: 211,
                        averageHrBpm: 145,
                        endHrBpm: 151,
                        averageCadenceRpm: 89,
                        firstThirdPowerWatts: 209,
                        middleThirdPowerWatts: 212,
                        lastThirdPowerWatts: 212,
                        evidenceConfidence: 'high',
                    },
                    {
                        segmentIndex: 2,
                        segmentType: 'recovery',
                        identitySource: 'fit_workout_step',
                        durationSeconds: 300,
                        averagePowerWatts: 130,
                        evidenceConfidence: 'high',
                    },
                ],
            },
        }));

        const text = lines.join('\n');
        expect(text).toContain('Quality-session detail (display-only)');
        expect(text).toContain('Session detail: VI 1.04');
        expect(text).toContain('Power zones:');
        expect(text).toContain('Power-duration peaks: 5s 640 W');
        expect(text).toContain('5m 255 W');
        expect(text).toContain('Deterministic halves: power 201→205 W');
        expect(text).toContain('| 1 | work | fit_workout_step | 15:00 | 193–229 W |');
    });

    it('exports running interval pace, HR/power laps and running dynamics', () => {
        const lines = renderMorningQualityActivityTelemetry(activity({
            type: 'running',
            intensityTag: 'hard',
            stimulusDomain: 'vo2',
            normalizedPower: undefined,
            intensityFactor: undefined,
            runningDynamics: {
                groundContactTimeMs: 238,
                groundContactBalanceLeftPct: 49.2,
                verticalOscillationCm: 8.1,
                verticalRatioPct: 7.4,
                strideLengthM: 1.31,
                avgRunningPowerWatts: 318,
                maxRunningPowerWatts: 472,
            },
            laps: [
                {
                    lapIndex: 1,
                    durationSeconds: 240,
                    distanceMeters: 1000,
                    averageSpeedMps: 1000 / 240,
                    averagePowerWatts: 352,
                    averageHrBpm: 166,
                },
                {
                    lapIndex: 2,
                    durationSeconds: 180,
                    distanceMeters: 600,
                    averageSpeedMps: 600 / 180,
                    averagePowerWatts: 268,
                    averageHrBpm: 148,
                },
            ],
        }));

        const text = lines.join('\n');
        expect(text).toContain('Running dynamics: avg running power 318 W · max running power 472 W');
        expect(text).toContain('GCT balance 49.2/50.8 L/R');
        expect(text).toContain('Interval/lap detail:');
        expect(text).toContain('| 1 | 4:00 | 1 km | 4:00/km | 352 W | 166 bpm |');
    });

    it('keeps ordinary endurance sessions compact even when detailed telemetry exists', () => {
        expect(renderMorningQualityActivityTelemetry(activity({
            // Canonical #809 domain wins over an inconsistent tag on modern records.
            intensityTag: 'hard',
            stimulusDomain: 'endurance',
            variabilityIndex: 1.02,
            powerInZones: [{ zoneNumber: 2, secondsInZone: 3000, lowBoundary: 150 }],
        }))).toEqual([]);
    });
});

describe('injectActivityTelemetryIntoContextBrief', () => {
    it('keeps section 4 after the detailed telemetry subsection', () => {
        const brief = '# Training context brief\n\n## 3. Completed training (recorded by the wearable)\n\nSummary\n\n## 4. Subjective check-ins';
        const text = injectActivityTelemetryIntoContextBrief(
            brief,
            [activity({ normalizedPower: 287 })],
        );

        const telemetryIndex = text.indexOf('### Detailed activity telemetry');
        const subjectiveIndex = text.indexOf('## 4. Subjective check-ins');
        expect(telemetryIndex).toBeGreaterThan(-1);
        expect(subjectiveIndex).toBeGreaterThan(telemetryIndex);
    });

    it('leaves an ordinary brief byte-for-byte unchanged when no detail exists', () => {
        const brief = '# Training context brief\n\n## 4. Subjective check-ins';
        expect(injectActivityTelemetryIntoContextBrief(brief, [activity()])).toBe(brief);
    });
});
