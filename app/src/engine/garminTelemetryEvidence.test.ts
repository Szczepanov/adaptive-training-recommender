import { describe, expect, it } from 'vitest';
import type { NormalizedGarminActivity, WorkoutStimulusProfile } from './models';
import { compareGarminZoneCredit } from './garminTelemetryComparison';
import {
    deriveMatchedIntervalFade,
    derivePowerZoneStimulusCandidate,
    extractPowerZoneFeatures,
} from './garminTelemetryEvidence';
import { reconcileCompletedTrainingEvents } from './completedTraining';

function activity(overrides: Partial<NormalizedGarminActivity> = {}): NormalizedGarminActivity {
    return {
        activityId: 'private-id', date: '2026-08-17', type: 'cycling', durationMin: 60,
        trainingEffectAerobic: 3.5, trainingEffectAnaerobic: 0.5, averageHr: 150,
        activityTrainingLoad: 100, intensityTag: 'hard',
        powerInZones: [
            { zoneNumber: 1, secondsInZone: 600 }, { zoneNumber: 2, secondsInZone: 1200 },
            { zoneNumber: 3, secondsInZone: 600 }, { zoneNumber: 4, secondsInZone: 600 },
            { zoneNumber: 5, secondsInZone: 300 }, { zoneNumber: 6, secondsInZone: 180 },
            { zoneNumber: 7, secondsInZone: 120 },
        ],
        normalizedPower: 245, intensityFactor: 0.88, variabilityIndex: 1.07,
        ...overrides,
    };
}

const TE_STIMULUS: WorkoutStimulusProfile = {
    aerobicEndurance: 0.45, thresholdPower: 0.7, vo2MaxPower: 0.5, repeatedSurges: 0.65,
    sprintPower: 0.2, fatigueResistance: 0.5, maxStrength: 0, hypertrophy: 0,
};

describe('Garmin power-zone evidence', () => {
    it('extracts full evidence and an auditable direct-share candidate', () => {
        const features = extractPowerZoneFeatures(activity());
        expect(features).toMatchObject({
            coverage: 'full', candidateEligible: true, totalPowerZoneSeconds: 3600,
            durationCoverageRatio: 1, normalizedPower: 245, intensityFactor: 0.88, variabilityIndex: 1.07,
        });
        expect(features.secondsByZone).toEqual([600, 1200, 600, 600, 300, 180, 120]);
        expect(derivePowerZoneStimulusCandidate(features, TE_STIMULUS)).toEqual({
            aerobicEndurance: 0.5, thresholdPower: 0.166667, vo2MaxPower: 0.083333,
            repeatedSurges: 0.05, sprintPower: 0.033333, fatigueResistance: 0.5,
            maxStrength: 0, hypertrophy: 0,
        });
    });

    it('reports partial telemetry but refuses to derive a candidate', () => {
        const features = extractPowerZoneFeatures(activity({ powerInZones: [{ zoneNumber: 2, secondsInZone: 1200 }] }));
        expect(features).toMatchObject({ coverage: 'partial', candidateEligible: false, fallbackReason: 'missing_zone' });
        expect(derivePowerZoneStimulusCandidate(features, TE_STIMULUS)).toBeNull();
    });

    it('reports absent telemetry and preserves the TE path', () => {
        const withoutZones = activity({ powerInZones: undefined });
        expect(extractPowerZoneFeatures(withoutZones)).toMatchObject({
            coverage: 'absent', candidateEligible: false, fallbackReason: 'no_power_zones',
        });
        const baseline = reconcileCompletedTrainingEvents([withoutZones], []);
        const candidate = reconcileCompletedTrainingEvents([withoutZones], [], { garminStimulusPolicy: 'power_zones_direct_share_v1' });
        expect(candidate).toEqual(baseline);
    });

    it('keeps the selector-off output byte-for-byte equivalent and refines within measuredEffort only when enabled', () => {
        const implicitOff = reconcileCompletedTrainingEvents([activity()], []);
        const explicitOff = reconcileCompletedTrainingEvents([activity()], [], { garminStimulusPolicy: 'training_effect' });
        const candidate = reconcileCompletedTrainingEvents([activity()], [], { garminStimulusPolicy: 'power_zones_direct_share_v1' });
        expect(explicitOff).toEqual(implicitOff);
        expect(candidate[0].evidenceTier).toBe('measuredEffort');
        expect(candidate[0].estimatedCost).toEqual(implicitOff[0].estimatedCost);
        expect(candidate[0].estimatedStimulus).not.toEqual(implicitOff[0].estimatedStimulus);
    });

    it('falls back for a non-cycling activity even when zone-shaped data exists', () => {
        const running = activity({ type: 'running' });
        const baseline = reconcileCompletedTrainingEvents([running], []);
        const candidate = reconcileCompletedTrainingEvents([running], [], { garminStimulusPolicy: 'power_zones_direct_share_v1' });
        expect(candidate).toEqual(baseline);
    });

    it('recognizes Garmin road-biking type keys only inside the enabled candidate', () => {
        const roadRide = activity({ type: 'road_biking' });
        const baseline = reconcileCompletedTrainingEvents([roadRide], []);
        const candidate = reconcileCompletedTrainingEvents([roadRide], [], { garminStimulusPolicy: 'power_zones_direct_share_v1' });
        expect(baseline[0].modality).toBe('Unknown');
        expect(candidate[0].modality).toBe('Cycling');
        expect(candidate[0].estimatedCost).toEqual(baseline[0].estimatedCost);
        expect(candidate[0].estimatedStimulus).not.toEqual(baseline[0].estimatedStimulus);
    });

    it('does not apply the candidate below the measuredEffort tier', () => {
        const noTrainingLoad = activity({ activityTrainingLoad: null });
        const baseline = reconcileCompletedTrainingEvents([noTrainingLoad], []);
        const candidate = reconcileCompletedTrainingEvents([noTrainingLoad], [], { garminStimulusPolicy: 'power_zones_direct_share_v1' });
        expect(baseline[0].evidenceTier).toBe('garminTrainingEffect');
        expect(candidate).toEqual(baseline);
    });

    it('produces a de-identified credit comparison with fallback rows unchanged', () => {
        const report = compareGarminZoneCredit([activity(), activity({ powerInZones: undefined })]);
        expect(report).toMatchObject({ activityCount: 2, eligibleActivityCount: 1, fallbackActivityCount: 1, disagreementActivityCount: 1 });
        expect(report.rows[0]).not.toHaveProperty('activityId');
        expect(report.rows[0]).not.toHaveProperty('date');
        expect(Object.values(report.rows[1].creditDelta)).toEqual([0, 0, 0, 0, 0]);
    });
});

describe('matched interval fade', () => {
    const laps = [
        { lapIndex: 1, durationSeconds: 900, averagePowerWatts: 280 },
        { lapIndex: 2, durationSeconds: 900, averagePowerWatts: 270 },
        { lapIndex: 3, durationSeconds: 900, averagePowerWatts: 252 },
    ];

    it('detects fade across an explicitly matched 3x15 set', () => {
        expect(deriveMatchedIntervalFade(activity({ laps }), [1, 2, 3])).toMatchObject({
            status: 'available', attributedDate: '2026-08-17', signedPowerChangePct: -10,
            fadePct: 10, negativeSplit: false,
        });
    });

    it('detects a negative split', () => {
        const negativeSplit = laps.map((lap, index) => ({ ...lap, averagePowerWatts: 250 + index * 15 }));
        expect(deriveMatchedIntervalFade(activity({ laps: negativeSplit }), [1, 2, 3])).toMatchObject({
            status: 'available', signedPowerChangePct: 12, fadePct: 0, negativeSplit: true,
        });
    });

    it('attributes a crossing-midnight set to the Warsaw-local activity start date', () => {
        const longLaps = laps.map(lap => ({ ...lap, durationSeconds: 1800 }));
        expect(deriveMatchedIntervalFade(activity({ date: '2026-10-24', laps: longLaps }), [1, 2, 3])).toMatchObject({
            status: 'available', attributedDate: '2026-10-24',
        });
    });
});
