/**
 * Pure presentation helpers shared between `ActivityTelemetry` (raw Garmin activity
 * cards) and `CompletedWorkoutList` (PR 2, ADR-0034's canonical-occurrence cards) --
 * extracted rather than duplicated so Garmin telemetry renders identically in both. Split
 * from `ZoneBars.tsx` (a component) purely to satisfy `react-refresh/only-export-components`
 * -- a fast-refresh boundary rule, not a functional split.
 */
import type { NormalizedGarminActivity, RunningDynamics } from '../engine/models';

export function formatDuration(seconds: number): string {
    const totalSeconds = Math.round(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainder = totalSeconds % 60;
    return remainder > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${minutes}:00`;
}

export function hasRunningDynamics(dynamics: RunningDynamics | undefined): dynamics is RunningDynamics {
    return dynamics !== undefined && Object.values(dynamics).some((value) => value != null);
}

export function formatRunningPower(dynamics: RunningDynamics): string | null {
    const parts: string[] = [];
    if (dynamics.avgRunningPowerWatts != null) parts.push(`${Math.round(dynamics.avgRunningPowerWatts)} W avg`);
    if (dynamics.maxRunningPowerWatts != null) parts.push(`${Math.round(dynamics.maxRunningPowerWatts)} W max`);
    return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatTrainingEffectDescriptor(value: string): string {
    return value.replaceAll('_', ' ');
}

export function humanizeHrReason(value: string): string {
    const known: Record<string, string> = {
        ISOLATED_SPIKE: 'isolated spikes',
        REPEATED_DROPOUT: 'repeated dropouts',
        LONG_GAP: 'long gaps',
        CADENCE_LOCK_SUSPECTED: 'possible cadence lock',
        PROVENANCE_AMBIGUOUS: 'ambiguous source provenance',
        SUMMARY_TRACE_DISCORDANCE: 'summary/trace mismatch',
    };
    return known[value] ?? value.replaceAll('_', ' ').toLowerCase();
}

export function hrMeasurementDetail(activity: NormalizedGarminActivity): { status: string; reason: string } | null {
    const hasHrSummary = activity.averageHr !== null
        || (activity.hrInZones?.length ?? 0) > 0
        || activity.activityTrainingLoad !== null
        || activity.trainingEffectAerobic !== null
        || activity.trainingEffectAnaerobic !== null;
    const measurement = activity.hrMeasurement;
    if (!measurement) {
        return hasHrSummary
            ? { status: 'Not assessed', reason: 'No fidelity assessment is available for this activity.' }
            : null;
    }

    const status = {
        high: 'High confidence',
        moderate: 'Moderate confidence',
        low: 'Low confidence',
        unreliable: 'Unreliable',
        unknown: 'Assessment incomplete',
    }[measurement.measurementConfidence];
    const evidence: string[] = [];
    if (measurement.sourceForActivity === 'wrist') evidence.push('wrist optical HR');
    if (measurement.sourceForActivity === 'external') evidence.push('external HR source');
    if (measurement.sourceForActivity === 'mixed_possible') evidence.push('possibly mixed HR source');
    if (measurement.activityMotionRisk === 'high') evidence.push('high arm-motion risk');
    evidence.push(...measurement.artifactFlags.map(humanizeHrReason));
    evidence.push(...measurement.reasons.map(humanizeHrReason));
    const reason = [...new Set(evidence)].slice(0, 3).join(' + ');
    return { status, reason: reason || 'Compact trace-quality assessment is available.' };
}
