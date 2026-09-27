import { describe, expect, it } from 'vitest';
import type { NormalizedGarminActivity } from './models';
import {
    injectActivityTelemetryIntoContextBrief,
    renderContextBriefActivityTelemetry,
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
