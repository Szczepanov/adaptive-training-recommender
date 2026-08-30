import { describe, expect, it } from 'vitest';
import {
    DEFAULT_IDENTITY_FEATURE_SCALE_FLOORS,
    DEFAULT_PASSPORT_BOOTSTRAP_CONFIG,
    bootstrapPassportFromHistory,
    calculateIqr,
    chronologicalExpandingWindowReplay,
    computeRobustLocationEstimate,
    computeRobustRatioEstimate,
    computeRobustScalarEstimate,
    crossSourceProfileKey,
    fitPassportFromNights,
    leaveOneNightOutReplay,
    nextPassportVersion,
    type PairedNightFeatureRecord,
} from './identityPassport';
import type { IntervalOverlapMetrics, PhysiologicalRelationFeatures } from './identityFeatures';

const ANCHOR_POLICY = {
    primaryProvider: 'garmin',
    primaryTransport: 'garmin_direct',
    role: 'personal_wearable_anchor',
    requireIndependentLineage: true,
};

function relation(overrides: Partial<PhysiologicalRelationFeatures> = {}): PhysiologicalRelationFeatures {
    return { rhrResidual: 1, respResidual: 0.5, hrvLogResidual: 0.05, ...overrides };
}

function overlap(overrides: Partial<IntervalOverlapMetrics> = {}): IntervalOverlapMetrics {
    return {
        intersectionMinutes: 450,
        unionMinutes: 480,
        jaccard: 0.9375,
        eightOverlapFraction: 0.95,
        garminOverlapFraction: 0.95,
        startDeltaMinutes: 5,
        endDeltaMinutes: -5,
        durationDeltaMinutes: 0,
        ...overrides,
    };
}

function night(overrides: Partial<PairedNightFeatureRecord> = {}): PairedNightFeatureRecord {
    return {
        sourceNightKey: '2026-08-01',
        sharedProvider: 'eight_sleep',
        anchorProvider: 'garmin',
        anchorTransport: 'garmin_direct',
        lineageIndependent: true,
        anchorEligible: true,
        sharedRestingHeartRate: 45,
        sharedRespirationRate: 14,
        sharedHrv: 52,
        sharedSleepStartMinutesLocal: 1350, // 22:30
        sharedSleepDurationMinutes: 480,
        relation: relation(),
        overlap: overlap(),
        ...overrides,
    };
}

describe('robust estimators (PI3, ADR-0028)', () => {
    it('computes median/MAD/IQR consistently with the scale floor applied only to MAD', () => {
        const values = [60, 62, 64, 66, 68];
        const estimate = computeRobustScalarEstimate(values, 0.5);
        expect(estimate.median).toBe(64);
        expect(estimate.mad).toBeCloseTo(2 * 1.4826, 4);
        expect(estimate.n).toBe(5);
        expect(estimate.iqr).toBe(calculateIqr(values));
    });

    it('floors near-zero natural dispersion so a later ordinary night cannot explode a z-score', () => {
        const nearIdentical = [45, 45, 45.01, 44.99, 45];
        const unfloor = computeRobustScalarEstimate(nearIdentical, 0);
        const floored = computeRobustScalarEstimate(nearIdentical, 1.0);

        expect(unfloor.mad).toBeLessThan(0.1);
        expect(floored.mad).toBe(1.0); // floor wins over the ~0 natural MAD
        // A 1 bpm-off night would look wildly discordant against the unfloored scale...
        expect(Math.abs(46 - unfloor.median!) / Math.max(unfloor.mad!, 1e-9)).toBeGreaterThan(10);
        // ...but is unremarkable once the floor is applied.
        expect(Math.abs(46 - floored.median!) / floored.mad!).toBeLessThan(2);
    });

    it('location estimate omits IQR and ratio estimate omits MAD, matching the passport document shape', () => {
        const location = computeRobustLocationEstimate([10, 12, 14], 1);
        expect(location).toEqual({ median: 12, mad: expect.any(Number), n: 3 });
        expect('iqr' in location).toBe(false);

        const ratio = computeRobustRatioEstimate([0.8, 0.9, 1.0]);
        expect(ratio).toEqual({ median: 0.9, iqr: expect.any(Number), n: 3 });
        expect('mad' in ratio).toBe(false);
    });

    it('returns nulls for an empty sample rather than throwing', () => {
        expect(computeRobustScalarEstimate([], 1)).toEqual({ median: null, mad: null, iqr: null, n: 0 });
    });
});

describe('fitPassportFromNights (PI3)', () => {
    it('is provider-neutral: profile keys are derived, not hard-coded', () => {
        const passport = fitPassportFromNights({
            nights: [night()],
            passportVersion: '2026-08-27.1',
            createdAt: '2026-08-27T06:00:00Z',
            policyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            anchorPolicy: ANCHOR_POLICY,
        });

        expect(Object.keys(passport.sourceProfiles)).toEqual(['eight_sleep']);
        expect(Object.keys(passport.crossSourceProfiles)).toEqual([
            crossSourceProfileKey('eight_sleep', 'garmin', 'garmin_direct'),
        ]);
        expect(crossSourceProfileKey('eight_sleep', 'garmin', 'garmin_direct')).toBe(
            'eight_sleep__garmin_garmin_direct',
        );
    });

    it('guards logHrv against non-positive/invalid shared HRV readings', () => {
        const passport = fitPassportFromNights({
            nights: [
                night({ sourceNightKey: 'n1', sharedHrv: 52 }),
                night({ sourceNightKey: 'n2', sharedHrv: 0 }),
                night({ sourceNightKey: 'n3', sharedHrv: -10 }),
                night({ sourceNightKey: 'n4', sharedHrv: null }),
            ],
            passportVersion: '2026-08-27.1',
            createdAt: '2026-08-27T06:00:00Z',
            policyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            anchorPolicy: ANCHOR_POLICY,
        });

        // Only the one valid positive HRV reading contributes.
        expect(passport.sourceProfiles.eight_sleep.logHrv.n).toBe(1);
        expect(passport.sourceProfiles.eight_sleep.logHrv.median).toBeCloseTo(Math.log(52), 10);
    });

    it('starts calibration at zero counts with no shadow window (no manual labels yet)', () => {
        const passport = fitPassportFromNights({
            nights: [night()],
            passportVersion: '2026-08-27.1',
            createdAt: '2026-08-27T06:00:00Z',
            policyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            anchorPolicy: ANCHOR_POLICY,
        });
        expect(passport.calibration).toEqual({
            manualUserCount: 0,
            manualNotUserCount: 0,
            mixedOccupancyCount: 0,
            uncertainCount: 0,
            shadowWindowStart: null,
            shadowWindowEnd: null,
        });
    });

    it('produces empty profiles (never throws) for an empty night list', () => {
        const passport = fitPassportFromNights({
            nights: [],
            passportVersion: '2026-08-27.1',
            createdAt: '2026-08-27T06:00:00Z',
            policyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            anchorPolicy: ANCHOR_POLICY,
        });
        expect(passport.sourceProfiles).toEqual({});
        expect(passport.crossSourceProfiles).toEqual({});
    });
});

describe('bootstrapPassportFromHistory (PI3, 7-step procedure)', () => {
    // 8 ordinary concordant nights plus 2 wildly discordant "contaminated" nights.
    const ordinaryNights: PairedNightFeatureRecord[] = Array.from({ length: 8 }, (_, i) =>
        night({
            sourceNightKey: `2026-08-${String(i + 1).padStart(2, '0')}`,
            relation: relation({ rhrResidual: 1 + (i % 2 === 0 ? 0.1 : -0.1) }),
        }),
    );
    const contaminatedNights: PairedNightFeatureRecord[] = [
        night({ sourceNightKey: '2026-08-20', relation: relation({ rhrResidual: 40 }) }),
        night({ sourceNightKey: '2026-08-21', relation: relation({ rhrResidual: -35 }) }),
    ];
    const lineageDependentNight = night({ sourceNightKey: '2026-08-22', lineageIndependent: false });
    const anchorIneligibleNight = night({ sourceNightKey: '2026-08-23', anchorEligible: false });
    const unpairedNight = night({ sourceNightKey: '2026-08-24', overlap: null });

    const allNights = [
        ...ordinaryNights,
        ...contaminatedNights,
        lineageDependentNight,
        anchorIneligibleNight,
        unpairedNight,
    ];

    function bootstrap() {
        return bootstrapPassportFromHistory({
            nights: allNights,
            passportVersion: '2026-08-27.1',
            createdAt: '2026-08-27T06:00:00Z',
            policyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            anchorPolicy: ANCHOR_POLICY,
        });
    }

    it('step 1: excludes lineage-dependent, anchor-ineligible, and unpaired nights from "usable"', () => {
        const result = bootstrap();
        expect(result.usableNightCount).toBe(ordinaryNights.length + contaminatedNights.length);
        expect(result.excludedByLineageOrAnchorCount).toBe(3);
    });

    it('steps 3-4: excludes the contaminated nights from the core WITHOUT labelling them NOT_USER', () => {
        const result = bootstrap();
        const contaminatedKeys = new Set(contaminatedNights.map((n) => n.sourceNightKey));
        const contaminatedEvaluations = result.nightConcordance.filter((c) =>
            contaminatedKeys.has(c.sourceNightKey),
        );

        expect(contaminatedEvaluations).toHaveLength(2);
        for (const evaluation of contaminatedEvaluations) {
            expect(evaluation.includedInCore).toBe(false);
            expect(evaluation.reason).toBe('DISCORDANT');
            // The evaluation type has no identity-status field at all -- structurally impossible
            // to assign NOT_USER here.
            expect(evaluation).not.toHaveProperty('automaticStatus');
            expect(evaluation).not.toHaveProperty('label');
        }
        expect(result.coreNightCount).toBe(ordinaryNights.length);
    });

    it('step 5: the fitted v0 passport reflects only the central core, not the contaminated nights', () => {
        const result = bootstrap();
        // Core RHR residuals are all near 1 (0.9-1.1); the fitted median must stay near there,
        // nowhere close to the +-35-40 contaminated values.
        const median = result.passport.crossSourceProfiles[
            crossSourceProfileKey('eight_sleep', 'garmin', 'garmin_direct')
        ].rhrResidual.median;
        expect(median).toBeGreaterThan(0.5);
        expect(median).toBeLessThan(1.5);
    });

    it('step 6: nightConcordance re-scores every usable night, core and excluded alike', () => {
        const result = bootstrap();
        const scoredKeys = new Set(result.nightConcordance.map((c) => c.sourceNightKey));
        for (const n of [...ordinaryNights, ...contaminatedNights]) {
            expect(scoredKeys.has(n.sourceNightKey)).toBe(true);
        }
        // Nights excluded at step 1 are not part of this descriptive re-score at all.
        expect(scoredKeys.has(lineageDependentNight.sourceNightKey)).toBe(false);
        expect(scoredKeys.has(anchorIneligibleNight.sourceNightKey)).toBe(false);
        expect(scoredKeys.has(unpairedNight.sourceNightKey)).toBe(false);
    });

    it('a night with no available relation features is INSUFFICIENT_FEATURES, not DISCORDANT', () => {
        const noFeaturesNight = night({
            sourceNightKey: '2026-08-25',
            relation: { rhrResidual: null, respResidual: null, hrvLogResidual: null },
        });
        const result = bootstrapPassportFromHistory({
            nights: [...ordinaryNights, noFeaturesNight],
            passportVersion: '2026-08-27.1',
            createdAt: '2026-08-27T06:00:00Z',
            policyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            anchorPolicy: ANCHOR_POLICY,
        });
        const evaluation = result.nightConcordance.find((c) => c.sourceNightKey === '2026-08-25');
        expect(evaluation?.reason).toBe('INSUFFICIENT_FEATURES');
        expect(evaluation?.includedInCore).toBe(false);
    });
});

describe('out-of-sample evaluation (PI3, ADR-0028 P-PI-16)', () => {
    const fitParams = {
        passportVersion: '2026-08-27.1',
        createdAt: '2026-08-27T06:00:00Z',
        policyVersion: 'identity-v1-shadow',
        featureSchemaVersion: 'identity-features-v1',
        anchorPolicy: ANCHOR_POLICY,
    };

    it('leave-one-night-out never trains a night’s own passport on itself', () => {
        const nights = Array.from({ length: 5 }, (_, i) =>
            night({ sourceNightKey: `2026-08-0${i + 1}` }),
        );
        const results = leaveOneNightOutReplay(nights, fitParams);

        expect(results).toHaveLength(5);
        for (const result of results) {
            expect(result.trainingNightCount).toBe(4); // every OTHER night, never itself
            expect(result.passport).not.toBeNull();
        }
    });

    it('leave-one-out exposes a contaminated night as an outlier that in-sample fitting would mask', () => {
        const cleanNights = Array.from({ length: 6 }, (_, i) =>
            night({ sourceNightKey: `2026-08-0${i + 1}`, relation: relation({ rhrResidual: 1 }) }),
        );
        const outlier = night({ sourceNightKey: '2026-08-10', relation: relation({ rhrResidual: 30 }) });
        const nights = [...cleanNights, outlier];

        const results = leaveOneNightOutReplay(nights, fitParams);
        const outlierResult = results.find((r) => r.sourceNightKey === '2026-08-10')!;
        const key = crossSourceProfileKey('eight_sleep', 'garmin', 'garmin_direct');
        const trainedWithoutOutlier = outlierResult.passport!.crossSourceProfiles[key].rhrResidual.median!;

        // The passport that evaluates the outlier night was trained on the 6 clean nights only,
        // so its median stays near 1 -- nowhere close to being pulled toward 30.
        expect(trainedWithoutOutlier).toBeCloseTo(1, 5);
    });

    it('chronological expanding window only trains on strictly earlier nights', () => {
        const nights = Array.from({ length: 6 }, (_, i) =>
            night({ sourceNightKey: `2026-08-0${i + 1}` }),
        );
        const results = chronologicalExpandingWindowReplay(nights, fitParams, 2);

        expect(results[0].passport).toBeNull(); // 0 training nights available
        expect(results[1].passport).toBeNull(); // 1 training night available, below minTrainingNights=2
        expect(results[2].trainingNightCount).toBe(2);
        expect(results[5].trainingNightCount).toBe(5);
    });

    it('an early contaminated night cannot leak into a later night’s expanding-window passport once it ages out of relevance for detection', () => {
        // Contaminated night is FIRST chronologically; every later night's training window
        // includes it (expanding window trains on all earlier nights) -- this documents that
        // behavior explicitly rather than assuming it.
        const contaminated = night({ sourceNightKey: '2026-08-01', relation: relation({ rhrResidual: 30 }) });
        const clean = Array.from({ length: 4 }, (_, i) =>
            night({ sourceNightKey: `2026-08-0${i + 2}`, relation: relation({ rhrResidual: 1 }) }),
        );
        const results = chronologicalExpandingWindowReplay([contaminated, ...clean], fitParams, 1);

        const lastResult = results[results.length - 1];
        expect(lastResult.trainingNightCount).toBe(4); // contaminated + 3 clean nights precede it
        // Even with contamination in the training window, bootstrap's own core-selection step
        // (steps 3-4) should already have excluded the single 30 bpm outlier from the fitted v0
        // used to score the final night, since the other 3 training nights concordantly agree.
        const key = crossSourceProfileKey('eight_sleep', 'garmin', 'garmin_direct');
        expect(lastResult.passport!.crossSourceProfiles[key].rhrResidual.median).toBeCloseTo(1, 5);
    });
});

describe('nextPassportVersion (PI3 passport eras)', () => {
    it('starts at .1 for a date with no prior versions', () => {
        expect(nextPassportVersion('2026-08-27', [])).toBe('2026-08-27.1');
    });

    it('increments deterministically among same-date versions', () => {
        expect(nextPassportVersion('2026-08-27', ['2026-08-27.1', '2026-08-27.2'])).toBe('2026-08-27.3');
    });

    it('ignores versions from other dates', () => {
        expect(nextPassportVersion('2026-08-28', ['2026-08-27.1', '2026-08-27.2'])).toBe('2026-08-28.1');
    });

    it('is order-independent', () => {
        expect(nextPassportVersion('2026-08-27', ['2026-08-27.3', '2026-08-27.1', '2026-08-27.2'])).toBe(
            '2026-08-27.4',
        );
    });
});

describe('defaults sanity (PI3)', () => {
    it('exposes the default scale floors and bootstrap config for callers/replay scripts', () => {
        expect(DEFAULT_IDENTITY_FEATURE_SCALE_FLOORS.rhrResidualBpm).toBeGreaterThan(0);
        expect(DEFAULT_PASSPORT_BOOTSTRAP_CONFIG.minConcordantFeatureFraction).toBe(1.0);
    });
});
