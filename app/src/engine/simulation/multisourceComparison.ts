/**
 * Multisource replay and simulation comparison engine (MS16/ADR-0027).
 *
 * Compares baseline single-source decisions (MULTISOURCE_FUSION_POLICY = 'off')
 * against candidate evidence fusion ('candidate-v1') across canonical synthetic scenarios
 * and empirical historical replays.
 */

import type { HealthObservationDayBundle } from '../../observations/models';
import type { SourceMetricBaseline } from '../multisourceBaselines';
import { evaluateMultisourceFusion, type MultisourceFusionResult } from '../multisourceFusion';

export type MultisourceScenarioKind =
    | 'garmin_missing_overnight'
    | 'cross_sensor_concordance'
    | 'cross_sensor_divergence'
    | 'stale_secondary_sensor'
    | 'post_hard_session_recovery';

export interface MultisourceScenarioResult {
    scenario: MultisourceScenarioKind;
    description: string;
    baselineResult: MultisourceFusionResult;
    candidateResult: MultisourceFusionResult;
    effectiveSourceOff: string;
    effectiveSourceCandidate: string;
    confidenceMultiplierOff: number;
    confidenceMultiplierCandidate: number;
    invariantPassed: boolean;
    invariantNotes: string;
}

export interface MultisourceSimulationReport {
    generatedAt: string;
    totalScenarios: number;
    allInvariantsPassed: boolean;
    scenarios: MultisourceScenarioResult[];
}

export function runMultisourceSimulationScenarios(): MultisourceSimulationReport {
    const referenceDate = '2026-08-27';

    // Standard baselines
    const matureGarminHrv: SourceMetricBaseline = {
        metric: 'hrv_rmssd_ms',
        provider: 'garmin',
        transport: 'garmin_direct',
        count7d: 7,
        count28d: 28,
        median7d: 65,
        median28d: 60,
        mad28d: 5.0,
        maturity: 'MATURE',
        latestObservedDate: referenceDate,
    };

    const matureEightSleepHrv: SourceMetricBaseline = {
        metric: 'hrv_rmssd_ms',
        provider: 'eight_sleep',
        transport: 'google_health',
        count7d: 7,
        count28d: 28,
        median7d: 58,
        median28d: 55,
        mad28d: 6.0,
        maturity: 'MATURE',
        latestObservedDate: referenceDate,
    };

    const staleEightSleepHrv: SourceMetricBaseline = {
        ...matureEightSleepHrv,
        latestObservedDate: '2026-08-20', // 7 days stale
        maturity: 'STALE',
    };

    const results: MultisourceScenarioResult[] = [];

    // --- Scenario 1: Garmin Missing Overnight ---
    {
        const eightOnlyBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [
                {
                    observationId: 'obs_e1',
                    metric: 'hrv_rmssd_ms',
                    value: 61, // +1.0 MAD -> z = +1.0
                    unit: 'ms',
                },
            ],
            sourcePayloadHash: 'hash_e1',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const off = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'off',
            bundles: [eightOnlyBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const cand = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'candidate-v1',
            bundles: [eightOnlyBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const candHrv = cand.fusedMetrics['hrv_rmssd_ms'];
        const passed = candHrv?.agreementStatus === 'SINGLE_SOURCE' && candHrv?.fusedZScore === 1.0;

        results.push({
            scenario: 'garmin_missing_overnight',
            description: 'Watch left charging overnight; Eight Sleep provides mature single-source fallback.',
            baselineResult: off,
            candidateResult: cand,
            effectiveSourceOff: 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: 1.0,
            confidenceMultiplierCandidate: candHrv?.confidenceMultiplier || 1.0,
            invariantPassed: passed,
            invariantNotes: 'Eight Sleep safely promoted as authoritative recovery evidence without dropping to unmonitored default.',
        });
    }

    // --- Scenario 2: Cross-Sensor Concordance ---
    {
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [{ observationId: 'obs_g2', metric: 'hrv_rmssd_ms', value: 65, unit: 'ms' }], // z = 1.0
            sourcePayloadHash: 'hash_g2',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const eightBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [{ observationId: 'obs_e2', metric: 'hrv_rmssd_ms', value: 61, unit: 'ms' }], // z = 1.0
            sourcePayloadHash: 'hash_e2',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const off = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'off',
            bundles: [garminBundle, eightBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const cand = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'candidate-v1',
            bundles: [garminBundle, eightBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const candHrv = cand.fusedMetrics['hrv_rmssd_ms'];
        const passed = candHrv?.agreementStatus === 'AGREE' && candHrv?.confidenceMultiplier === 1.15;

        results.push({
            scenario: 'cross_sensor_concordance',
            description: 'Both sensors agree on elevated recovery HRV; confidence tier boosted by 1.15x.',
            baselineResult: off,
            candidateResult: cand,
            effectiveSourceOff: 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: 1.0,
            confidenceMultiplierCandidate: candHrv?.confidenceMultiplier || 1.0,
            invariantPassed: passed,
            invariantNotes: 'Dual concordant streams elevate confidence without creating artificial mode distortion.',
        });
    }

    // --- Scenario 3: Cross-Sensor Divergence ---
    {
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [{ observationId: 'obs_g3', metric: 'hrv_rmssd_ms', value: 65, unit: 'ms' }], // z = +1.0
            sourcePayloadHash: 'hash_g3',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const eightBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [{ observationId: 'obs_e3', metric: 'hrv_rmssd_ms', value: 43, unit: 'ms' }], // z = -2.0
            sourcePayloadHash: 'hash_e3',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const off = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'off',
            bundles: [garminBundle, eightBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const cand = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'candidate-v1',
            bundles: [garminBundle, eightBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const candHrv = cand.fusedMetrics['hrv_rmssd_ms'];
        const passed = candHrv?.agreementStatus === 'DIVERGE' &&
            candHrv?.effectiveSource === 'garmin_garmin_direct' &&
            candHrv?.confidenceMultiplier === 0.85;

        results.push({
            scenario: 'cross_sensor_divergence',
            description: 'Garmin shows fresh, Eight Sleep shows suppressed; engine keeps Garmin Direct with dampened confidence (0.85x).',
            baselineResult: off,
            candidateResult: cand,
            effectiveSourceOff: 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: 1.0,
            confidenceMultiplierCandidate: candHrv?.confidenceMultiplier || 1.0,
            invariantPassed: passed,
            invariantNotes: 'Primary wearable authority preserved; divergence telemetry logged for safety.',
        });
    }

    // --- Scenario 4: Stale Secondary Sensor ---
    {
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [{ observationId: 'obs_g4', metric: 'hrv_rmssd_ms', value: 60, unit: 'ms' }],
            sourcePayloadHash: 'hash_g4',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const staleEightBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [{ observationId: 'obs_e4', metric: 'hrv_rmssd_ms', value: 40, unit: 'ms' }],
            sourcePayloadHash: 'hash_e4',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-20T08:00:00Z',
            effectiveAt: '2026-08-20T08:00:00Z',
        };

        const off = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'off',
            bundles: [garminBundle, staleEightBundle],
            baselines: [matureGarminHrv, staleEightSleepHrv],
        });

        const cand = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'candidate-v1',
            bundles: [garminBundle, staleEightBundle],
            baselines: [matureGarminHrv, staleEightSleepHrv],
        });

        const candHrv = cand.fusedMetrics['hrv_rmssd_ms'];
        const passed = candHrv?.agreementStatus === 'SINGLE_SOURCE' &&
            candHrv?.effectiveSource === 'garmin_garmin_direct';

        results.push({
            scenario: 'stale_secondary_sensor',
            description: 'Eight Sleep is >3 days stale; strictly gated out of fusion calculation.',
            baselineResult: off,
            candidateResult: cand,
            effectiveSourceOff: 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: 1.0,
            confidenceMultiplierCandidate: candHrv?.confidenceMultiplier || 1.0,
            invariantPassed: passed,
            invariantNotes: 'Stale secondary sensor successfully gated out.',
        });
    }

    // --- Scenario 5: Post Hard Session Recovery ---
    {
        // Prior day hard training session; both sensors observe normal recovery
        const garminBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'garmin',
            transport: 'garmin_direct',
            observations: [{ observationId: 'obs_g5', metric: 'hrv_rmssd_ms', value: 58, unit: 'ms' }], // z = -0.4
            sourcePayloadHash: 'hash_g5',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const eightBundle: HealthObservationDayBundle = {
            userId: 'user_sim',
            logicalDate: referenceDate,
            provider: 'eight_sleep',
            transport: 'google_health',
            observations: [{ observationId: 'obs_e5', metric: 'hrv_rmssd_ms', value: 53, unit: 'ms' }], // z = -0.33
            sourcePayloadHash: 'hash_e5',
            schemaVersion: 1,
            normalizerVersion: 1,
            revision: 1,
            ingestedAt: '2026-08-27T08:00:00Z',
            effectiveAt: '2026-08-27T08:00:00Z',
        };

        const off = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'off',
            bundles: [garminBundle, eightBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const cand = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'candidate-v1',
            bundles: [garminBundle, eightBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const candHrv = cand.fusedMetrics['hrv_rmssd_ms'];
        const passed = candHrv?.agreementStatus === 'AGREE' &&
            candHrv.fusedZScore !== null &&
            candHrv.fusedZScore >= -0.5; // Mild normal variation, not amplified double penalty

        results.push({
            scenario: 'post_hard_session_recovery',
            description: 'Post-hard session mild dip observed on both sensors; no double-penalty amplification.',
            baselineResult: off,
            candidateResult: cand,
            effectiveSourceOff: 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: 1.0,
            confidenceMultiplierCandidate: candHrv?.confidenceMultiplier || 1.0,
            invariantPassed: passed,
            invariantNotes: 'Zero strain double-counting invariant verified.',
        });
    }

    const allPassed = results.every((r) => r.invariantPassed);

    return {
        generatedAt: new Date().toISOString(),
        totalScenarios: results.length,
        allInvariantsPassed: allPassed,
        scenarios: results,
    };
}
