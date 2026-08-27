/**
 * Multisource replay and simulation comparison engine (MS16/ADR-0027).
 *
 * Compares baseline single-source decisions (MULTISOURCE_FUSION_POLICY = 'off')
 * against candidate evidence fusion ('candidate-v1') across canonical synthetic scenarios
 * and empirical historical replays.
 */

import type { DailyReadiness } from '../models';
import type { HealthObservationDayBundle } from '../../observations/models';
import { computeInternalResponseStrain } from '../fatigue';
import type { SourceMetricBaseline } from '../multisourceBaselines';
import { evaluateMultisourceFusion, type MultisourceFusionResult } from '../multisourceFusion';

/**
 * Computes the real single-source (Garmin-only) baseline by running the fusion engine's
 * candidate-v1 evaluation restricted to Garmin bundles only. Garmin Direct is the sole
 * production authority when MULTISOURCE_FUSION_POLICY is 'off' (ADR-0027); policy 'off'
 * itself always returns an empty fusedMetrics (see multisourceFusion.ts), so it cannot
 * stand in for "what would the single-source decision path see". Restricting the actual
 * fusion evaluator to Garmin-only bundles reproduces that decision path's real output
 * (the SINGLE_SOURCE branch is a pure passthrough of Garmin's own z-score) instead of
 * asserting hard-coded literals chosen to agree with the candidate result.
 */
function evaluateGarminOnlyBaseline(
    logicalDate: string,
    bundles: readonly HealthObservationDayBundle[],
    baselines: readonly SourceMetricBaseline[],
): MultisourceFusionResult {
    return evaluateMultisourceFusion({
        logicalDate,
        policy: 'candidate-v1',
        bundles: bundles.filter((b) => b.provider === 'garmin'),
        baselines,
    });
}

/** Fixture DailyReadiness varying only hrv_delta_ms, everything else held neutral/constant,
 * so computeInternalResponseStrain's output isolates the effect of the HRV evidence alone. */
function readinessForHrvDelta(hrvDeltaMs: number): DailyReadiness {
    return {
        subjective: {
            readiness: 6, sleepQuality: 6, fatigue: 4, soreness: 3, stress: 4, motivation: 6,
            timeAvailable: 60, painFlag: false, alreadyTrainedToday: false, preferredModalityToday: null,
        },
        objective: {
            total_steps: null, sleep_score: 80, sleep_duration_min: 420,
            rhr: 50, rhr_7d_avg: 50, rhr_delta: 0,
            hrv_weekly_avg: 60, hrv_last_night: 60, hrv_delta: hrvDeltaMs,
            respiration: 14, body_battery_wake: 70,
            last_3_days_hard_sessions_count: 1,
            yesterday_training: { type: 'running', duration_min: 60, training_effect: 3.8, intensity_tag: 'hard' },
            today_training: null,
            sleep_score_delta_7d: 0, rhr_delta_28d: 0, hrv_delta_28d: 0, sleep_score_delta_28d: 0,
            hrv_stdev_28d: 8, rhr_stdev_28d: 3, sleep_score_stdev_28d: 7,
        },
    };
}

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

        const garminBaseline = evaluateGarminOnlyBaseline(
            referenceDate,
            [eightOnlyBundle],
            [matureGarminHrv, matureEightSleepHrv],
        );
        const garminBaselineHrv = garminBaseline.fusedMetrics['hrv_rmssd_ms'];

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
            effectiveSourceOff: garminBaselineHrv?.effectiveSource ?? 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: garminBaselineHrv?.confidenceMultiplier ?? 1.0,
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

        const garminBaseline = evaluateGarminOnlyBaseline(
            referenceDate,
            [garminBundle, eightBundle],
            [matureGarminHrv, matureEightSleepHrv],
        );
        const garminBaselineHrv = garminBaseline.fusedMetrics['hrv_rmssd_ms'];

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
            effectiveSourceOff: garminBaselineHrv?.effectiveSource ?? 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: garminBaselineHrv?.confidenceMultiplier ?? 1.0,
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

        const garminBaseline = evaluateGarminOnlyBaseline(
            referenceDate,
            [garminBundle, eightBundle],
            [matureGarminHrv, matureEightSleepHrv],
        );
        const garminBaselineHrv = garminBaseline.fusedMetrics['hrv_rmssd_ms'];

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
            effectiveSourceOff: garminBaselineHrv?.effectiveSource ?? 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: garminBaselineHrv?.confidenceMultiplier ?? 1.0,
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

        const garminBaseline = evaluateGarminOnlyBaseline(
            referenceDate,
            [garminBundle, staleEightBundle],
            [matureGarminHrv, staleEightSleepHrv],
        );
        const garminBaselineHrv = garminBaseline.fusedMetrics['hrv_rmssd_ms'];

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
            effectiveSourceOff: garminBaselineHrv?.effectiveSource ?? 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: garminBaselineHrv?.confidenceMultiplier ?? 1.0,
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

        const garminBaseline = evaluateGarminOnlyBaseline(
            referenceDate,
            [garminBundle, eightBundle],
            [matureGarminHrv, matureEightSleepHrv],
        );
        const garminBaselineHrv = garminBaseline.fusedMetrics['hrv_rmssd_ms'];

        const cand = evaluateMultisourceFusion({
            logicalDate: referenceDate,
            policy: 'candidate-v1',
            bundles: [garminBundle, eightBundle],
            baselines: [matureGarminHrv, matureEightSleepHrv],
        });

        const candHrv = cand.fusedMetrics['hrv_rmssd_ms'];
        const basicInvariantsPassed = candHrv?.agreementStatus === 'AGREE' &&
            candHrv.fusedZScore !== null &&
            candHrv.fusedZScore >= -0.5; // Mild normal variation, not amplified double penalty

        // D-MS-STRAIN: run the *actual* strain computation (fatigue.ts, the real
        // consumer of HRV evidence in the decision path) on three deltas -- Garmin-only,
        // the fusion engine's real weighted output, and a naive double-count where both
        // sources' own deviations are summed as if fed in independently -- and assert
        // the fused evidence never produces more strain than Garmin alone and stays
        // strictly below the double-counted counterfactual. Asserting only on
        // fusedZScore (as before) could pass even if a production caller fed the fused
        // evidence into strain twice; this exercises the same computation the decision
        // path would run.
        const garminObsValue = Number(garminBundle.observations[0].value);
        const eightObsValue = Number(eightBundle.observations[0].value);
        const garminDeltaMs = garminObsValue - (matureGarminHrv.median28d ?? garminObsValue);
        const eightDeltaMs = eightObsValue - (matureEightSleepHrv.median28d ?? eightObsValue);
        const naiveDoubleCountedDeltaMs = garminDeltaMs + eightDeltaMs;
        const fusedDeltaMs =
            candHrv?.fusedZScore != null && matureGarminHrv.mad28d
                ? candHrv.fusedZScore * matureGarminHrv.mad28d
                : garminDeltaMs;

        const garminOnlyStrain = computeInternalResponseStrain(readinessForHrvDelta(garminDeltaMs));
        const fusedStrain = computeInternalResponseStrain(readinessForHrvDelta(fusedDeltaMs));
        const naiveDoubleCountedStrain = computeInternalResponseStrain(
            readinessForHrvDelta(naiveDoubleCountedDeltaMs),
        );
        const strainNotAmplified =
            fusedStrain.systemic <= garminOnlyStrain.systemic + 1e-6 &&
            fusedStrain.systemic < naiveDoubleCountedStrain.systemic &&
            fusedStrain.cardiovascular < naiveDoubleCountedStrain.cardiovascular;

        const passed = basicInvariantsPassed && strainNotAmplified;

        results.push({
            scenario: 'post_hard_session_recovery',
            description: 'Post-hard session mild dip observed on both sensors; no double-penalty amplification.',
            baselineResult: off,
            candidateResult: cand,
            effectiveSourceOff: garminBaselineHrv?.effectiveSource ?? 'none',
            effectiveSourceCandidate: candHrv?.effectiveSource || 'none',
            confidenceMultiplierOff: garminBaselineHrv?.confidenceMultiplier ?? 1.0,
            confidenceMultiplierCandidate: candHrv?.confidenceMultiplier || 1.0,
            invariantPassed: passed,
            invariantNotes: `Zero strain double-counting invariant verified against computeInternalResponseStrain: ` +
                `fused systemic strain ${fusedStrain.systemic.toFixed(3)} <= Garmin-only ${garminOnlyStrain.systemic.toFixed(3)} ` +
                `and < naive double-counted ${naiveDoubleCountedStrain.systemic.toFixed(3)}.`,
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
