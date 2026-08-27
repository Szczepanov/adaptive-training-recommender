/**
 * Multi-source recovery evidence fusion evaluator (MS15/ADR-0027).
 *
 * Implements candidate evidence fusion combining normalized source deviations,
 * baseline maturity state machines, and cross-source agreement telemetry.
 *
 * Governed by MULTISOURCE_FUSION_POLICY feature flag (default: 'off').
 */

import type { HealthObservationDayBundle } from '../observations/models';
import type { CrossSourceAgreementTelemetry } from './crossSourceTelemetry';
import type { SourceMetricBaseline } from './multisourceBaselines';

export type MultisourceFusionPolicy = 'off' | 'candidate-v1';

export interface FusedMetricEvidence {
    metric: string;
    fusedZScore: number | null;
    effectiveSource: string; // "garmin_direct", "eight_sleep_google_health", "fused_garmin_eight"
    confidenceMultiplier: number;
    agreementStatus: 'AGREE' | 'DIVERGE' | 'SINGLE_SOURCE' | 'NO_DATA';
    contributors: {
        provider: string;
        transport: string;
        rawZScore: number | null;
        weight: number;
    }[];
}

export interface MultisourceFusionResult {
    logicalDate: string;
    policy: MultisourceFusionPolicy;
    fusedMetrics: Record<string, FusedMetricEvidence>;
    crossSourceTelemetry: CrossSourceAgreementTelemetry | null;
}

export function evaluateMultisourceFusion(params: {
    logicalDate: string;
    policy?: MultisourceFusionPolicy;
    bundles: readonly HealthObservationDayBundle[];
    baselines: readonly SourceMetricBaseline[];
    agreementTelemetry?: CrossSourceAgreementTelemetry | null;
}): MultisourceFusionResult {
    const policy = params.policy || 'off';
    const { logicalDate, bundles, baselines } = params;

    const dayBundles = bundles.filter((b) => b.logicalDate === logicalDate);

    // If policy is off, return baseline un-fused structure
    if (policy === 'off') {
        return {
            logicalDate,
            policy: 'off',
            fusedMetrics: {},
            crossSourceTelemetry: params.agreementTelemetry || null,
        };
    }

    // Evaluate candidate-v1 fusion
    const fusedMetrics: Record<string, FusedMetricEvidence> = {};
    const targetMetrics = ['hrv_rmssd_ms', 'daily_resting_heart_rate_bpm', 'sleep_duration_seconds'];

    for (const metric of targetMetrics) {
        // Collect available mature observations for this metric on this date
        const sourceDeviations: {
            provider: string;
            transport: string;
            zScore: number;
            weight: number;
        }[] = [];

        for (const bundle of dayBundles) {
            const base = baselines.find(
                (b) =>
                    b.metric === metric &&
                    b.provider === bundle.provider &&
                    b.transport === bundle.transport,
            );

            // Gating: Only PROVISIONAL or MATURE baselines participate
            if (!base || (base.maturity !== 'MATURE' && base.maturity !== 'PROVISIONAL')) {
                continue;
            }

            for (const obs of bundle.observations) {
                if (obs.metric === metric && typeof obs.value === 'number') {
                    if (base.median28d !== null && base.mad28d && base.mad28d > 0) {
                        const z = (obs.value - base.median28d) / base.mad28d;
                        const weight = bundle.provider === 'garmin' ? 0.6 : 0.4;
                        sourceDeviations.push({
                            provider: bundle.provider,
                            transport: bundle.transport,
                            zScore: z,
                            weight,
                        });
                    }
                }
            }
        }

        if (sourceDeviations.length === 0) {
            fusedMetrics[metric] = {
                metric,
                fusedZScore: null,
                effectiveSource: 'none',
                confidenceMultiplier: 1.0,
                agreementStatus: 'NO_DATA',
                contributors: [],
            };
            continue;
        }

        if (sourceDeviations.length === 1) {
            const single = sourceDeviations[0];
            fusedMetrics[metric] = {
                metric,
                fusedZScore: single.zScore,
                effectiveSource: `${single.provider}_${single.transport}`,
                confidenceMultiplier: 1.0,
                agreementStatus: 'SINGLE_SOURCE',
                contributors: [
                    {
                        provider: single.provider,
                        transport: single.transport,
                        rawZScore: single.zScore,
                        weight: 1.0,
                    },
                ],
            };
            continue;
        }

        // Dual or multi-source present
        const garmin = sourceDeviations.find((s) => s.provider === 'garmin');
        const eight = sourceDeviations.find((s) => s.provider === 'eight_sleep');

        if (garmin && eight) {
            const agree = (garmin.zScore >= 0 && eight.zScore >= 0) || (garmin.zScore < 0 && eight.zScore < 0);
            if (agree) {
                // Directional Agreement: Weighted combination with elevated confidence
                const totalWeight = garmin.weight + eight.weight;
                const fusedZ = (garmin.zScore * garmin.weight + eight.zScore * eight.weight) / totalWeight;

                fusedMetrics[metric] = {
                    metric,
                    fusedZScore: Number(fusedZ.toFixed(3)),
                    effectiveSource: 'fused_garmin_eight',
                    confidenceMultiplier: 1.15,
                    agreementStatus: 'AGREE',
                    contributors: [
                        { provider: 'garmin', transport: garmin.transport, rawZScore: garmin.zScore, weight: garmin.weight },
                        { provider: 'eight_sleep', transport: eight.transport, rawZScore: eight.zScore, weight: eight.weight },
                    ],
                };
            } else {
                // Divergence: Conservatively default to primary Garmin Direct with dampened confidence
                fusedMetrics[metric] = {
                    metric,
                    fusedZScore: garmin.zScore,
                    effectiveSource: `${garmin.provider}_${garmin.transport}`,
                    confidenceMultiplier: 0.85,
                    agreementStatus: 'DIVERGE',
                    contributors: [
                        { provider: 'garmin', transport: garmin.transport, rawZScore: garmin.zScore, weight: 1.0 },
                        { provider: 'eight_sleep', transport: eight.transport, rawZScore: eight.zScore, weight: 0.0 },
                    ],
                };
            }
        } else {
            // General multi-source fallback
            const fusedZ = sourceDeviations.reduce((acc, s) => acc + s.zScore * s.weight, 0) /
                sourceDeviations.reduce((acc, s) => acc + s.weight, 0);

            fusedMetrics[metric] = {
                metric,
                fusedZScore: Number(fusedZ.toFixed(3)),
                effectiveSource: 'multi_source',
                confidenceMultiplier: 1.0,
                agreementStatus: 'AGREE',
                contributors: sourceDeviations.map((s) => ({
                    provider: s.provider,
                    transport: s.transport,
                    rawZScore: s.zScore,
                    weight: s.weight,
                })),
            };
        }
    }

    return {
        logicalDate,
        policy: 'candidate-v1',
        fusedMetrics,
        crossSourceTelemetry: params.agreementTelemetry || null,
    };
}
