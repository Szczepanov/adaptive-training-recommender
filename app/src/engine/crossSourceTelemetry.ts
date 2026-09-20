/**
 * Cross-source agreement and data-quality telemetry (MS13/ADR-0027).
 *
 * Evaluates agreement between heterogeneous sensors on normalized deviations,
 * stage distribution deltas, and coverage without affecting production recommendation authority.
 */

import type { HealthObservationDayBundle } from '../observations/models';
import { sourceMetricBaselineKey, type SourceMetricBaseline } from './multisourceBaselines';

export interface CrossSourceAgreementTelemetry {
    logicalDate: string;
    hrvDirectionAgreement: boolean | null;
    rhrDirectionAgreement: boolean | null;
    respirationDirectionAgreement: boolean | null;
    sleepDurationDifferenceMinutes: number | null;
    stageDistributionDifferencePct: number | null;
    sourceCoverage28d: Record<string, number>;
}

export function computeCrossSourceTelemetry(
    logicalDate: string,
    bundles: readonly HealthObservationDayBundle[],
    baselines: readonly SourceMetricBaseline[],
): CrossSourceAgreementTelemetry {
    const dayBundles = bundles.filter((b) => b.logicalDate === logicalDate);

    // Compute coverage from baselines
    // ⚡ Bolt: Build O(1) map for baselines by metric + provider + transport to avoid O(N) lookup in the inner loop
    const coverageMap: Record<string, number> = {};
    const baselineMap = new Map<string, SourceMetricBaseline>();
    for (const b of baselines) {
        const providerKey = `${b.provider}_${b.transport}`;
        coverageMap[providerKey] = Math.max(coverageMap[providerKey] || 0, b.count28d);
        const key = sourceMetricBaselineKey(b.metric, b.provider, b.transport);
        // Preserve the old Array.find() first-match behavior for malformed duplicate input.
        if (!baselineMap.has(key)) baselineMap.set(key, b);
    }

    // Extract observations by source
    const hrvDeviations: { source: string; z: number }[] = [];
    const rhrDeviations: { source: string; z: number }[] = [];
    const sleepDurations: { source: string; minutes: number }[] = [];

    for (const bundle of dayBundles) {
        const sourceKey = `${bundle.provider}_${bundle.transport}`;
        for (const obs of bundle.observations) {
            if (obs.metric === 'hrv_rmssd_ms' && typeof obs.value === 'number') {
                const base = baselineMap.get(sourceMetricBaselineKey('hrv_rmssd_ms', bundle.provider, bundle.transport));
                if (base && base.median28d !== null && base.mad28d && base.mad28d > 0) {
                    const z = (obs.value - base.median28d) / base.mad28d;
                    hrvDeviations.push({ source: sourceKey, z });
                }
            }

            if (obs.metric === 'daily_resting_heart_rate_bpm' && typeof obs.value === 'number') {
                const base = baselineMap.get(sourceMetricBaselineKey('daily_resting_heart_rate_bpm', bundle.provider, bundle.transport));
                if (base && base.median28d !== null && base.mad28d && base.mad28d > 0) {
                    const z = (obs.value - base.median28d) / base.mad28d;
                    rhrDeviations.push({ source: sourceKey, z });
                }
            }

            if (obs.metric === 'sleep_duration_seconds' && typeof obs.value === 'number') {
                sleepDurations.push({ source: sourceKey, minutes: obs.value / 60 });
            }
        }
    }

    // Evaluate HRV direction agreement (both z > 0 or both z < 0)
    let hrvAgreement: boolean | null = null;
    if (hrvDeviations.length >= 2) {
        const firstPositive = hrvDeviations[0].z >= 0;
        const allAgree = hrvDeviations.every((d) => (d.z >= 0) === firstPositive);
        hrvAgreement = allAgree;
    }

    // Evaluate RHR direction agreement
    let rhrAgreement: boolean | null = null;
    if (rhrDeviations.length >= 2) {
        const firstPositive = rhrDeviations[0].z >= 0;
        const allAgree = rhrDeviations.every((d) => (d.z >= 0) === firstPositive);
        rhrAgreement = allAgree;
    }

    // Evaluate sleep duration delta
    let sleepDurationDiff: number | null = null;
    if (sleepDurations.length >= 2) {
        sleepDurationDiff = Math.abs(sleepDurations[0].minutes - sleepDurations[1].minutes);
    }

    return {
        logicalDate,
        hrvDirectionAgreement: hrvAgreement,
        rhrDirectionAgreement: rhrAgreement,
        respirationDirectionAgreement: null,
        sleepDurationDifferenceMinutes: sleepDurationDiff,
        stageDistributionDifferencePct: null,
        sourceCoverage28d: coverageMap,
    };
}
