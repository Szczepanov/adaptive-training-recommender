/**
 * PR 2 cutover flag, following the exact convention `services/healthAnomalyRuntime.ts`
 * established: a typed `'off' | '<version>'` union, a fail-closed `resolveConfigured...`
 * helper (any unrecognized/missing value degrades to `'off'`), and a `VITE_*` env var as
 * the single source of truth. `'off'` is the default and the only value shipped/tested in
 * CI-authorized configuration -- ADR-0034's Stage 3 (Activities cutover) requires this to
 * be reversible without deleting canonical data, which is exactly what flipping the env
 * var back to `'off'` does.
 */
export type ActivitiesReadModelPolicy = 'off' | 'canonical-v1';

export function resolveConfiguredActivitiesReadModelPolicy(value: unknown): ActivitiesReadModelPolicy {
    return value === 'canonical-v1' ? 'canonical-v1' : 'off';
}

export function configuredActivitiesReadModelPolicy(): ActivitiesReadModelPolicy {
    return resolveConfiguredActivitiesReadModelPolicy(import.meta.env.VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY);
}
