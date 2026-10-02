/**
 * Home has two classes of async inputs:
 *
 * - required same-day evidence: must fail closed before a recommendation is shown;
 * - secondary projections: may disappear without taking down today's dashboard.
 *
 * Keep that boundary explicit so a transient forecast failure cannot be mistaken for a
 * failure of the same-day decision itself.
 */
export type DashboardRequiredSource = 'performed-training-facts';

export class DashboardRequiredSourceError extends Error {
    readonly source: DashboardRequiredSource;
    readonly originalError: unknown;

    constructor(source: DashboardRequiredSource, originalError: unknown) {
        super(`Required dashboard source '${source}' could not be loaded.`);
        this.name = 'DashboardRequiredSourceError';
        this.source = source;
        this.originalError = originalError;
    }
}

/** Wrap a required same-day source so Home can preserve fail-closed semantics and identify the blocker. */
export async function loadRequiredDashboardSource<T>(
    source: DashboardRequiredSource,
    load: () => Promise<T>,
): Promise<T> {
    try {
        return await load();
    } catch (error: unknown) {
        throw new DashboardRequiredSourceError(source, error);
    }
}

/** Load non-authoritative dashboard data without allowing its failure to replace today's valid decision. */
export async function loadSecondaryDashboardData<T>(
    label: string,
    load: () => Promise<T>,
    onFailure: (error: unknown) => void = (error) => {
        console.warn(`Failed to load ${label}; keeping primary dashboard data available:`, error);
    },
): Promise<T | null> {
    try {
        return await load();
    } catch (error: unknown) {
        onFailure(error);
        return null;
    }
}
