/**
 * Multi-source recovery evidence fusion evaluator (MS15/ADR-0027).
 *
 * Implements candidate evidence fusion combining normalized source deviations,
 * baseline maturity state machines, and cross-source agreement telemetry.
 *
 * Governed by MULTISOURCE_FUSION_POLICY feature flag (default: 'off').
 */

import type { HealthObservationDayBundle } from '../observations/models';
import {
    validateCoPresence,
    type CoPresenceValidationResult,
    type SleepSessionInterval,
} from './coPresenceValidator';
import type { CrossSourceAgreementTelemetry } from './crossSourceTelemetry';
import type { SourceMetricBaseline } from './multisourceBaselines';

export type MultisourceFusionPolicy = 'off' | 'candidate-v1';

export interface MultisourceMetricActivationConfig {
    hrv: boolean;
    restingHeartRate: boolean;
    respiration: boolean;
    sleepDuration: boolean;
    sleepStages: boolean;
    proprietaryScores: boolean;
}

export const DEFAULT_METRIC_ACTIVATION_CONFIG: MultisourceMetricActivationConfig = {
    hrv: true,
    restingHeartRate: true,
    respiration: true,
    sleepDuration: true,
    sleepStages: true, // Activated: Eight Sleep BCG is primary for sleep architecture
    proprietaryScores: false, // blocked
};

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
    coPresenceVerdict: CoPresenceValidationResult | null;
    crossSourceTelemetry: CrossSourceAgreementTelemetry | null;
}

export function evaluateMultisourceFusion(params: {
    logicalDate: string;
    userId?: string;
    policy?: MultisourceFusionPolicy;
    metricActivation?: Partial<MultisourceMetricActivationConfig>;
    athleteRhr28dMedian?: number | null;
    bundles: readonly HealthObservationDayBundle[];
    baselines: readonly SourceMetricBaseline[];
    agreementTelemetry?: CrossSourceAgreementTelemetry | null;
}): MultisourceFusionResult {
    const policy = params.policy || 'off';
    const metricActivation: MultisourceMetricActivationConfig = {
        ...DEFAULT_METRIC_ACTIVATION_CONFIG,
        ...(params.metricActivation || {}),
    };
    const { logicalDate, bundles, baselines, userId } = params;

    // Enforce single-user isolation: filter by date and userId (or verify single user)
    const rawDayBundles = userId
        ? bundles.filter((b) => b.logicalDate === logicalDate && b.userId === userId)
        : bundles.filter((b) => b.logicalDate === logicalDate);

    // If policy is off, return baseline un-fused structure
    if (policy === 'off') {
        return {
            logicalDate,
            policy: 'off',
            fusedMetrics: {},
            coPresenceVerdict: null,
            crossSourceTelemetry: params.agreementTelemetry || null,
        };
    }

    // Step 1: Secondary-source identity & session concordance validation (D-MS-IDENTITY, D-MS-PREBASE)
    //
    // PROVISIONAL (PI0/PI9, ADR-0028): PI5 now protects baseline accumulation upstream through
    // explicit EffectiveIdentityDecision eligibility. This downstream call remains only as a
    // legacy candidate-fusion compatibility guard; PI9 must replace it with the same effective
    // decision projection rather than extend its fixed thresholds.
    let garminRhr: number | null = null;
    let eightSleepRhr: number | null = null;
    let garminSleepInterval: SleepSessionInterval | null = null;
    let eightSleepInterval: SleepSessionInterval | null = null;

    for (const bundle of rawDayBundles) {
        for (const obs of bundle.observations) {
            if (obs.metric === 'daily_resting_heart_rate_bpm' && typeof obs.value === 'number') {
                if (bundle.provider === 'garmin') {
                    garminRhr = obs.value;
                } else if (bundle.provider === 'eight_sleep') {
                    eightSleepRhr = obs.value;
                }
            }
            if (obs.metric === 'sleep_duration_seconds' && obs.observedStart && obs.observedEnd) {
                if (bundle.provider === 'garmin') {
                    garminSleepInterval = { startIso: obs.observedStart, endIso: obs.observedEnd };
                } else if (bundle.provider === 'eight_sleep') {
                    eightSleepInterval = { startIso: obs.observedStart, endIso: obs.observedEnd };
                }
            }
        }
    }

    const coPresenceVerdict = validateCoPresence({
        garminRhr,
        eightSleepRhr,
        athleteRhr28dMedian: params.athleteRhr28dMedian,
        garminSleepInterval,
        eightSleepInterval,
    });

    // Step 2: Filter day bundles (discard Eight Sleep if discordant/mismatched per D-MS-IDENTITY)
    const validDayBundles = rawDayBundles.filter((b) => {
        if (b.provider === 'eight_sleep') {
            if (
                coPresenceVerdict.status === 'DISCORDANT_SECONDARY' ||
                coPresenceVerdict.status === 'IMPOSTER_REJECTED'
            ) {
                return false; // Quarantined from fusion & baselines
            }
        }
        return true;
    });

    // Step 3: Evaluate candidate-v1 fusion across active metric streams
    const fusedMetrics: Record<string, FusedMetricEvidence> = {};
    const candidateMetricConfigs: { metric: string; enabled: boolean }[] = [
        { metric: 'hrv_rmssd_ms', enabled: metricActivation.hrv },
        { metric: 'daily_resting_heart_rate_bpm', enabled: metricActivation.restingHeartRate },
        { metric: 'daily_respiration_rate_brpm', enabled: metricActivation.respiration },
        { metric: 'sleep_duration_seconds', enabled: metricActivation.sleepDuration },
        { metric: 'sleep_stage_deep_seconds', enabled: metricActivation.sleepStages },
        { metric: 'sleep_stage_rem_seconds', enabled: metricActivation.sleepStages },
        { metric: 'proprietary_recovery_score', enabled: metricActivation.proprietaryScores },
    ];

    for (const { metric, enabled } of candidateMetricConfigs) {
        if (!enabled) {
            continue;
        }
        // Collect available mature observations for this metric on this date
        const sourceDeviations: {
            provider: string;
            transport: string;
            zScore: number;
            weight: number;
        }[] = [];

        for (const bundle of validDayBundles) {
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
                        // Sleep stages and respiration prioritize Eight Sleep BCG (0.7 weight)
                        // HRV and RHR prioritize Garmin Direct primary (0.6 weight)
                        const weight =
                            metric.startsWith('sleep_stage_') || metric === 'daily_respiration_rate_brpm'
                                ? bundle.provider === 'eight_sleep'
                                    ? 0.7
                                    : 0.3
                                : bundle.provider === 'garmin'
                                  ? 0.6
                                  : 0.4;

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
        coPresenceVerdict,
        crossSourceTelemetry: params.agreementTelemetry || null,
    };
}
