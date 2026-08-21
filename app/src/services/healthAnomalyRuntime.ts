import { resolveHealthAnomalyPolicy } from '../engine/healthAnomaly';
import type { HealthAnomalyPolicy } from '../engine/healthAnomalyModels';
import { healthAnomalyService } from './healthAnomalyService';

export type HealthAnomalyShadowRuntimePolicy = Extract<HealthAnomalyPolicy, 'off' | 'shadow-v1'>;

/**
 * HA-D intentionally authorizes only shadow collection. `visible-v1` and `tighten-v1`
 * remain valid future policy vocabulary but are release-gated by HA7/HA9 and therefore
 * fail closed here even if someone configures them prematurely.
 */
export function resolveConfiguredHealthAnomalyShadowPolicy(value: unknown): HealthAnomalyShadowRuntimePolicy {
    return resolveHealthAnomalyPolicy(value) === 'shadow-v1' ? 'shadow-v1' : 'off';
}

export function configuredHealthAnomalyShadowPolicy(): HealthAnomalyShadowRuntimePolicy {
    return resolveConfiguredHealthAnomalyShadowPolicy(import.meta.env.VITE_HEALTH_ANOMALY_POLICY);
}

/**
 * Evidence collection seam used by the app shell. Default/off returns before the service is
 * called, preserving HA0's zero-read/zero-write invariant. The result is deliberately not
 * connected to recommendation selection or Home rendering.
 */
export async function runConfiguredHealthAnomalyShadow(
    userId: string,
    date: string,
    configuredValue: unknown = import.meta.env.VITE_HEALTH_ANOMALY_POLICY,
) {
    const policy = resolveConfiguredHealthAnomalyShadowPolicy(configuredValue);
    if (policy === 'off') return null;
    return healthAnomalyService.assessAndPersist(userId, date, policy);
}
