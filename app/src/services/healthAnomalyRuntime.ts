import {
    resolveHealthAnomalyPolicy,
    SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS,
    VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS,
} from '../derived/flags/illnessAnomaly/healthAnomaly';
import type { HealthAnomalyPolicy } from '../derived/flags/illnessAnomaly/healthAnomalyModels';
import { healthAnomalyService } from './healthAnomalyService';

export type HealthAnomalyActiveRuntimePolicy = Extract<HealthAnomalyPolicy, 'off' | 'shadow-v1' | 'visible-v1'>;
/** @deprecated Prefer HealthAnomalyActiveRuntimePolicy. */
export type HealthAnomalyShadowRuntimePolicy = HealthAnomalyActiveRuntimePolicy;

/**
 * Resolves the active health anomaly runtime policy. Defaults to `visible-v1` when omitted or
 * empty so athletes receive non-diagnostic early warnings by default; `tighten-v1` maps to
 * `visible-v1` while HA9 automatic training tightening remains separately gated. Any malformed
 * value fails closed to `off`.
 */
export function resolveConfiguredHealthAnomalyRuntimePolicy(value: unknown): HealthAnomalyActiveRuntimePolicy {
    if (value === undefined || value === null || value === '') return 'visible-v1';
    const parsed = resolveHealthAnomalyPolicy(value);
    if (parsed === 'shadow-v1') return 'shadow-v1';
    if (parsed === 'visible-v1' || parsed === 'tighten-v1') return 'visible-v1';
    return 'off';
}

export function resolveConfiguredHealthAnomalyShadowPolicy(value: unknown): HealthAnomalyActiveRuntimePolicy {
    return resolveConfiguredHealthAnomalyRuntimePolicy(value);
}

export function configuredHealthAnomalyRuntimePolicy(): HealthAnomalyActiveRuntimePolicy {
    return resolveConfiguredHealthAnomalyRuntimePolicy(import.meta.env.VITE_HEALTH_ANOMALY_POLICY);
}

export function configuredHealthAnomalyShadowPolicy(): HealthAnomalyActiveRuntimePolicy {
    return configuredHealthAnomalyRuntimePolicy();
}

/**
 * Assessment collection seam used by the app shell. `off` returns before the service is called,
 * preserving HA0's zero-read/zero-write invariant. `visible-v1` persists early-warning
 * assessments for Home and D-FLAGS without touching training recommendation selection (HA9).
 */
export async function runConfiguredHealthAnomalyShadow(
    userId: string,
    date: string,
    configuredValue: unknown = import.meta.env.VITE_HEALTH_ANOMALY_POLICY,
) {
    const policy = resolveConfiguredHealthAnomalyRuntimePolicy(configuredValue);
    if (policy === 'off') return null;
    const thresholds = policy === 'visible-v1'
        ? VISIBLE_V1_HEALTH_ANOMALY_THRESHOLDS
        : SHADOW_V1_HEALTH_ANOMALY_THRESHOLDS;
    return healthAnomalyService.assessAndPersist(userId, date, policy, thresholds);
}
