/**
 * Multi-source recovery evidence fusion evaluator (MS15/ADR-0027).
 *
 * Implements candidate evidence fusion combining normalized source deviations,
 * baseline maturity state machines, and cross-source agreement telemetry.
 *
 * Governed by MULTISOURCE_FUSION_POLICY feature flag (default: 'off').
 *
 * PI9 migration (ADR-0028): shared-source bundle eligibility is decided by
 * `selectEligibleHealthObservationBundles()` -- the same ADR-0028 identity gate PI5 already
 * enforces upstream of baseline learning -- whenever a caller supplies `effectiveIdentityProjections`.
 * `coPresenceValidator.ts`'s scalar heuristic remains only as the default fallback for callers
 * (currently: the MS16 simulation/replay harness) that have not yet threaded real identity
 * evidence through; it is not used to gate anything in production, since nothing calls this
 * evaluator from `recommendationService.ts` yet. See `identityGateApplied` on the result.
 */

import type { HealthObservationDayBundle } from '../observations/models';
import {
    validateCoPresence,
    type CoPresenceValidationResult,
    type SleepSessionInterval,
} from './coPresenceValidator';
import type { CrossSourceAgreementTelemetry } from './crossSourceTelemetry';
import {
    selectEligibleHealthObservationBundles,
    type EffectiveBundleIdentityProjection,
    type IdentityEligibilityPolicy,
} from './identityEligibility';
import type { SourceMetricBaseline } from './multisourceBaselines';

/**
 * Default identity policy for the PI9 gate below: `eight_sleep`/`google_health` is the only
 * currently-known shared source this plan targets (ADR-0028). Callers with a different
 * shared-source deployment should pass their own `identityPolicy`.
 */
const DEFAULT_FUSION_IDENTITY_POLICY: IdentityEligibilityPolicy = {
    identityRequiredSources: [{ provider: 'eight_sleep', transport: 'google_health' }],
};

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
    sleepStages: false, // shadow only — 2026-08-27: no real evidence supports activation; see docs/plans/2026-08-27-real-google-health-ingestion.md
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
    /**
     * `true` when the caller supplied `effectiveIdentityProjections` and the ADR-0028 identity
     * gate (not the legacy `coPresenceVerdict` heuristic) was authoritative for shared-source
     * bundle eligibility this call (PI9). `coPresenceVerdict` is still computed either way for
     * diagnostic/back-compat display, but it only *decides* bundle inclusion when this is `false`.
     */
    identityGateApplied: boolean;
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
    /**
     * PI9 migration point (ADR-0028): when provided, `selectEligibleHealthObservationBundles()`
     * decides shared-source bundle eligibility instead of the legacy `coPresenceVerdict` scalar
     * heuristic. Omit to keep today's legacy-heuristic behaviour unchanged (existing simulation
     * snapshots/callers are unaffected until they opt in).
     */
    effectiveIdentityProjections?: readonly EffectiveBundleIdentityProjection[];
    identityPolicy?: IdentityEligibilityPolicy;
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
            identityGateApplied: false,
        };
    }

    // Step 1: Secondary-source identity & session concordance validation (D-MS-IDENTITY, D-MS-PREBASE)
    //
    // PROVISIONAL (PI0, ADR-0028): this scalar heuristic remains the *default* fallback only for
    // backward compatibility with callers that have not yet migrated to real identity evidence.
    // `coPresenceVerdict` is still computed unconditionally below for diagnostic/back-compat
    // display, but as of PI9 it decides bundle inclusion only when the caller has not supplied
    // `effectiveIdentityProjections` -- see the identity-gate branch after Step 1.
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

    // Step 2: Filter day bundles (discard shared-source bundles per D-MS-IDENTITY/ADR-0028).
    //
    // PI9 (ADR-0028): when the caller supplies real identity evidence, the ternary
    // USER/NOT_USER/UNCERTAIN gate is authoritative -- it supersedes, rather than combines with,
    // `coPresenceVerdict`'s scalar heuristic (P-PI-2: identity attribution is a separate decision
    // from technical/physiological plausibility, which is what the legacy heuristic conflates).
    const identityGateApplied = params.effectiveIdentityProjections !== undefined;
    const validDayBundles = identityGateApplied
        ? selectEligibleHealthObservationBundles({
              bundles: rawDayBundles,
              // Fusion is inherently a single-user-per-call computation (rawDayBundles is already
              // scoped to `logicalDate`/`userId` above); fall back to the bundles' own userId when
              // the caller only started passing identity evidence and has not yet also threaded
              // `userId` through every call site.
              userId: userId ?? rawDayBundles[0]?.userId ?? '',
              effectiveIdentityProjections: params.effectiveIdentityProjections ?? [],
              identityPolicy: params.identityPolicy ?? DEFAULT_FUSION_IDENTITY_POLICY,
              requireEligibility: 'recovery',
          })
        : rawDayBundles.filter((b) => {
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
        identityGateApplied,
    };
}
