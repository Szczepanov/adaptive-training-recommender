import type { ExternalRestProvenance } from './models';

/**
 * ADR-0035 extension of the persisted rest-source identity.
 *
 * The base `ExternalRestProvenance` fields identify the exact authored directive. When
 * `overridden` is true, that directive was present for the date but the athlete made an
 * explicit same-day request to train, so normal safety/availability/readiness/ranking ran
 * instead of the protected-rest short circuit. The marker is intentionally absent for the
 * default protected-rest path to keep historical authored-rest audits compatible.
 */
export type ExternalRestDecisionProvenance = ExternalRestProvenance & {
    overridden?: true;
};

/** True only for an explicitly athlete-overridden authored rest directive. */
export function isExternalRestOverride(
    provenance: ExternalRestProvenance,
): provenance is ExternalRestDecisionProvenance & { overridden: true } {
    return (provenance as ExternalRestDecisionProvenance).overridden === true;
}
