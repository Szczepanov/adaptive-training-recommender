import {
    HEALTH_ANOMALY_POLICIES,
    type HealthAnomalyInput,
    type HealthAnomalyPolicy,
    type PhysiologicalAnomalyAssessment,
} from './healthAnomalyModels';

export const HEALTH_ANOMALY_POLICY_VERSION = 'health-anomaly/ha0-v1';

/**
 * Fail-closed parser for runtime configuration. Only the four exact policy strings are
 * accepted. Missing, malformed, differently-cased, or otherwise unrecognized values are off.
 */
export function resolveHealthAnomalyPolicy(value: unknown): HealthAnomalyPolicy {
    return typeof value === 'string'
        && (HEALTH_ANOMALY_POLICIES as readonly string[]).includes(value)
        ? value as HealthAnomalyPolicy
        : 'off';
}

/**
 * Reads policy configuration through a boundary that may fail (remote config, feature flag,
 * environment adapter). A read failure must never implicitly opt the athlete into health
 * anomaly collection or visibility.
 */
export function readHealthAnomalyPolicy(readConfiguredValue: () => unknown): HealthAnomalyPolicy {
    try {
        return resolveHealthAnomalyPolicy(readConfiguredValue());
    } catch {
        return 'off';
    }
}

/**
 * HA0 inert evaluator boundary. HA3 will implement deterministic anomaly classification.
 * Until then every mode returns null so this scaffolding cannot alter recommendations, show a
 * health warning, or persist an assessment merely because a future-facing flag was configured.
 */
export function evaluatePhysiologicalAnomaly(
    input: HealthAnomalyInput,
    policy: HealthAnomalyPolicy = 'off',
): PhysiologicalAnomalyAssessment | null {
    // Reference both boundary arguments explicitly so the scaffolding remains lint-clean while
    // preserving its intentionally inert behavior until HA3 lands.
    void input;
    void policy;
    return null;
}
