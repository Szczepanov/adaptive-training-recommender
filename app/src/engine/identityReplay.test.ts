import { describe, expect, it } from 'vitest';
import type { ObservationBundleRef } from '../observations/identityModels';
import type { SessionInterval } from './identityFeatures';
import {
    deriveNightFeatures,
    runIdentityReplay,
    renderIdentityReplayMarkdown,
    toPairedNightFeatureRecord,
    type IdentityReplayConfig,
    type IdentityReplayNightInput,
} from './identityReplay';

const ANCHOR_POLICY = {
    primaryProvider: 'garmin',
    primaryTransport: 'garmin_direct',
    role: 'personal_wearable_anchor',
    requireIndependentLineage: true,
};

const BASE_CONFIG: IdentityReplayConfig = {
    method: 'leaveOneOut',
    policyVersion: 'identity-v1-shadow',
    featureSchemaVersion: 'identity-features-v1',
    anchorPolicy: ANCHOR_POLICY,
};

function dateAt(offsetDays: number): string {
    const d = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

function sessionAt(date: string, startHour: number, startMinuteOffset: number, durationMinutes: number): SessionInterval {
    const start = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00Z`);
    start.setUTCMinutes(start.getUTCMinutes() + startMinuteOffset);
    const end = new Date(start);
    end.setUTCMinutes(end.getUTCMinutes() + durationMinutes);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function ref(overrides: Partial<ObservationBundleRef> = {}): ObservationBundleRef {
    return {
        id: 'shared-bundle',
        provider: 'eight_sleep',
        transport: 'google_health',
        revision: 1,
        sourcePayloadHash: 'sha256:shared',
        lineageKey: 'eight_sleep:pod-side:a',
        ...overrides,
    };
}

function anchorRef(overrides: Partial<ObservationBundleRef> = {}): ObservationBundleRef {
    return {
        id: 'anchor-bundle',
        provider: 'garmin',
        transport: 'garmin_direct',
        revision: 1,
        sourcePayloadHash: 'sha256:anchor',
        lineageKey: 'garmin:device:athlete',
        ...overrides,
    };
}

/** An ordinary, mutually-concordant athlete night. */
function ordinaryNight(offsetDays: number, overrides: Partial<IdentityReplayNightInput> = {}): IdentityReplayNightInput {
    const date = dateAt(offsetDays);
    return {
        sourceNightKey: date,
        sharedBundleRef: ref({ id: `${date}_eight_sleep_google_health` }),
        anchorBundleRefs: [anchorRef({ id: `${date}_garmin_garmin_direct` })],
        anchorPresent: true,
        anchorTechnicallyEligible: true,
        garminSessions: [sessionAt(date, 22, 0, 480)],
        eightSleepSessions: [sessionAt(date, 22, 5, 470)],
        sharedRestingHeartRate: 47,
        garminRestingHeartRate: 45,
        sharedRespirationRate: 14.2,
        garminRespirationRate: 14,
        sharedHrv: 55,
        garminHrv: 50,
        sharedSleepStartMinutesLocal: 1325,
        sharedSleepDurationMinutes: 470,
        ...overrides,
    };
}

function buildOrdinaryHistory(count: number): IdentityReplayNightInput[] {
    return Array.from({ length: count }, (_, i) => ordinaryNight(i));
}

describe('runIdentityReplay (PI8, ADR-0028)', () => {
    it('reaches automatic USER coverage on a large ordinary-night history and keeps counts consistent', () => {
        const nights = buildOrdinaryHistory(24);
        const report = runIdentityReplay(nights, BASE_CONFIG);

        expect(report.pairedNightCount).toBe(24);
        expect(report.automaticUserCount + report.uncertainCount).toBe(24);
        expect(report.automaticUserCount).toBeGreaterThan(0);
        // Every reported night is out-of-sample: none can train on more than n-1 other nights.
        for (const night of report.nights) {
            expect(night.trainingNightCount).toBeLessThanOrEqual(23);
        }
    });

    it('never lets a night contribute to its own evaluating passport (P-PI-16)', () => {
        const nights = buildOrdinaryHistory(20);
        const report = runIdentityReplay(nights, BASE_CONFIG);
        // Leave-one-out: with 20 total nights, every training set has at most 19 nights.
        for (const night of report.nights) {
            expect(night.trainingNightCount).toBeLessThanOrEqual(19);
        }
    });

    it('supports chronologicalExpandingWindow and abstains before minTrainingNights history exists', () => {
        const nights = buildOrdinaryHistory(20);
        const report = runIdentityReplay(nights, {
            ...BASE_CONFIG,
            method: 'chronologicalExpandingWindow',
            minTrainingNights: 5,
        });
        // The first 5 nights (index 0-4) have fewer than 5 strictly-earlier training nights.
        const early = report.nights.slice(0, 5);
        for (const night of early) {
            expect(night.passportVersion).toBeNull();
            expect(night.automaticStatus).toBe('UNCERTAIN');
        }
    });

    it('never emits an automatic NOT_USER (P-PI-8) and abstains a missing-anchor night', () => {
        const nights = buildOrdinaryHistory(20);
        nights[10] = ordinaryNight(10, { anchorPresent: false });
        const report = runIdentityReplay(nights, BASE_CONFIG);

        for (const night of report.nights) {
            expect(night.automaticStatus).not.toBe('NOT_USER');
        }
        const missingAnchorNight = report.nights.find((n) => n.sourceNightKey === dateAt(10));
        expect(missingAnchorNight?.automaticStatus).toBe('UNCERTAIN');
        expect(missingAnchorNight?.reasonCodes).toContain('ANCHOR_MISSING');
        expect(report.lineageOrAnchorQualityAbstentionCount).toBeGreaterThanOrEqual(1);
    });

    it('toPairedNightFeatureRecord only treats a night as lineage-independent for the configured anchor policy, not for any independent ref of any provider', () => {
        // A genuinely independent anchor (different lineage from the shared bundle) but from a
        // provider/transport that does NOT match config.anchorPolicy must not be treated as
        // corroborating evidence for *this* anchor policy's passport fit -- otherwise it would
        // silently join crossSourceProfiles[key]'s median/MAD/IQR fit under the wrong anchor
        // identity and skew every other night's out-of-sample scoring against it.
        const mismatchedProviderAnchor = {
            id: 'other-wearable',
            provider: 'fitbit',
            transport: 'fitbit_direct',
            revision: 1,
            sourcePayloadHash: 'sha256:fitbit',
            lineageKey: 'fitbit:device:athlete', // independent of the shared bundle's lineage
        };
        const night = ordinaryNight(0, { anchorBundleRefs: [mismatchedProviderAnchor] });
        const record = toPairedNightFeatureRecord(deriveNightFeatures(night), ANCHOR_POLICY);

        expect(record.lineageIndependent).toBe(false);
    });

    it('toPairedNightFeatureRecord treats a night as lineage-independent when the matching-policy anchor is present alongside an unrelated one', () => {
        const matchingAnchor = anchorRef({ id: 'garmin-anchor' });
        const unrelatedAnchor = {
            id: 'other-wearable',
            provider: 'fitbit',
            transport: 'fitbit_direct',
            revision: 1,
            sourcePayloadHash: 'sha256:fitbit',
            lineageKey: 'fitbit:device:athlete',
        };
        const night = ordinaryNight(0, { anchorBundleRefs: [matchingAnchor, unrelatedAnchor] });
        const record = toPairedNightFeatureRecord(deriveNightFeatures(night), ANCHOR_POLICY);

        expect(record.lineageIndependent).toBe(true);
    });

    it('counts dependent-lineage evidence as an abstention, not corroboration', () => {
        const nights = buildOrdinaryHistory(20);
        const dependentAnchor = anchorRef({
            id: 'mirrored',
            provider: 'eight_sleep',
            transport: 'health_aggregator',
            lineageKey: 'eight_sleep:pod-side:a', // same lineage as the shared bundle -- mirrored copy
        });
        nights[5] = ordinaryNight(5, { anchorBundleRefs: [dependentAnchor] });
        const report = runIdentityReplay(nights, BASE_CONFIG);

        const dependentNight = report.nights.find((n) => n.sourceNightKey === dateAt(5));
        expect(dependentNight?.reasonCodes).toContain('EVIDENCE_LINEAGE_DEPENDENT');
        expect(dependentNight?.automaticStatus).toBe('UNCERTAIN');
    });

    it('classifies single- vs multi-feature disagreement nights separately', () => {
        const nights = buildOrdinaryHistory(20);
        // Night A: only respiration is wildly off; RHR/HRV/timing remain concordant.
        nights[6] = ordinaryNight(6, { sharedRespirationRate: 25 });
        // Night B: RHR and respiration both wildly off.
        nights[12] = ordinaryNight(12, { sharedRestingHeartRate: 90, sharedRespirationRate: 25 });
        const report = runIdentityReplay(nights, BASE_CONFIG);

        const singleFeatureNight = report.nights.find((n) => n.sourceNightKey === dateAt(6));
        const multiFeatureNight = report.nights.find((n) => n.sourceNightKey === dateAt(12));
        expect(singleFeatureNight?.discordantFeatureCount).toBe(1);
        expect(multiFeatureNight?.discordantFeatureCount).toBeGreaterThanOrEqual(2);
        expect(report.singleFeatureDisagreementCount).toBeGreaterThanOrEqual(1);
        expect(report.multiFeatureDisagreementCount).toBeGreaterThanOrEqual(1);
    });

    it('excludes non-USER nights from the after-gating baseline and reports the exclusion count', () => {
        const nights = buildOrdinaryHistory(20);
        nights[8] = ordinaryNight(8, { anchorPresent: false }); // forced UNCERTAIN, has a value
        const report = runIdentityReplay(nights, BASE_CONFIG);

        const rhr = report.baselineComparisons.find((c) => c.metric === 'restingHeartRate');
        expect(rhr).toBeDefined();
        expect(rhr!.beforeGating.n).toBe(20);
        expect(rhr!.afterGating.n).toBeLessThan(rhr!.beforeGating.n);
        expect(rhr!.nightsExcludedByGating).toBe(rhr!.beforeGating.n - rhr!.afterGating.n);
        expect(rhr!.nightsExcludedByGating).toBeGreaterThanOrEqual(1);
    });

    it('reports non-increasing coverage as the candidate minUserScore threshold rises', () => {
        const nights = buildOrdinaryHistory(20);
        const report = runIdentityReplay(nights, {
            ...BASE_CONFIG,
            candidateMinUserScores: [0.3, 0.5, 0.7, 0.9, 0.99],
        });
        for (let i = 1; i < report.thresholdSensitivity.length; i++) {
            expect(report.thresholdSensitivity[i].coverageCount).toBeLessThanOrEqual(
                report.thresholdSensitivity[i - 1].coverageCount,
            );
        }
    });

    it('never reports an in-sample coverage figure as unbiased by fabricating negative labels', () => {
        const nights = buildOrdinaryHistory(20);
        const report = runIdentityReplay(nights, BASE_CONFIG);
        expect(report.limitations.join(' ')).toMatch(/out-of-sample/i);
        expect(report.limitations.join(' ')).toMatch(/NOT_USER/);
        expect(report.limitations.join(' ')).toMatch(/false-acceptance/i);
    });

    it('renders a markdown report containing the key evidence sections', () => {
        const nights = buildOrdinaryHistory(20);
        const report = runIdentityReplay(nights, BASE_CONFIG);
        const markdown = renderIdentityReplayMarkdown(report);

        expect(markdown).toContain('# Physiological identity passport -- historical out-of-sample replay');
        expect(markdown).toContain('## Reason-code distribution');
        expect(markdown).toContain('## Baseline before/after identity gating');
        expect(markdown).toContain('## Threshold sensitivity');
        expect(markdown).toContain('## Nights');
        expect(markdown).toContain(dateAt(0));
    });

    it('handles an empty history without dividing by zero', () => {
        const report = runIdentityReplay([], BASE_CONFIG);
        expect(report.pairedNightCount).toBe(0);
        expect(report.automaticUserCoverage).toBe(0);
        expect(report.baselineComparisons.every((c) => c.beforeGating.n === 0)).toBe(true);
        expect(() => renderIdentityReplayMarkdown(report)).not.toThrow();
    });
});
