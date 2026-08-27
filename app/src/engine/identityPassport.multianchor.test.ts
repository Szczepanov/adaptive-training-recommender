import { describe, expect, it } from 'vitest';
import { fitPassportFromNights, type PairedNightFeatureRecord } from './identityPassport';

function night(overrides: Partial<PairedNightFeatureRecord> = {}): PairedNightFeatureRecord {
    return {
        sourceNightKey: '2026-08-01',
        sharedProvider: 'shared_bed',
        anchorProvider: 'garmin',
        anchorTransport: 'garmin_direct',
        lineageIndependent: true,
        anchorEligible: true,
        sharedRestingHeartRate: 45,
        sharedRespirationRate: 14,
        sharedHrv: 52,
        sharedSleepStartMinutesLocal: 1350,
        sharedSleepDurationMinutes: 480,
        relation: { rhrResidual: 1, respResidual: 0.5, hrvLogResidual: 0.05 },
        overlap: {
            intersectionMinutes: 450,
            unionMinutes: 480,
            jaccard: 0.9375,
            eightOverlapFraction: 0.95,
            garminOverlapFraction: 0.95,
            startDeltaMinutes: 5,
            endDeltaMinutes: -5,
            durationDeltaMinutes: 0,
        },
        ...overrides,
    };
}

describe('fitPassportFromNights source profile aggregation', () => {
    it('aggregates one shared source across every configured anchor relationship', () => {
        const passport = fitPassportFromNights({
            nights: [
                night({ sourceNightKey: '2026-08-01', sharedRestingHeartRate: 44 }),
                night({
                    sourceNightKey: '2026-08-02',
                    sharedRestingHeartRate: 46,
                    anchorProvider: 'oura',
                    anchorTransport: 'oura_direct',
                }),
            ],
            passportVersion: '2026-08-27.1',
            createdAt: '2026-08-27T06:00:00Z',
            policyVersion: 'identity-v1-shadow',
            featureSchemaVersion: 'identity-features-v1',
            anchorPolicy: {
                primaryProvider: 'garmin',
                primaryTransport: 'garmin_direct',
                role: 'personal_wearable_anchor',
                requireIndependentLineage: true,
            },
        });

        expect(passport.sourceProfiles.shared_bed.trustedNightCount).toBe(2);
        expect(passport.sourceProfiles.shared_bed.restingHeartRate.n).toBe(2);
        expect(passport.sourceProfiles.shared_bed.restingHeartRate.median).toBe(45);
        expect(Object.keys(passport.crossSourceProfiles).sort()).toEqual([
            'shared_bed__garmin_garmin_direct',
            'shared_bed__oura_oura_direct',
        ]);
    });
});
