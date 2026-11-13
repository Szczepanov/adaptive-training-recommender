import { useEffect, useState } from 'react';
import { resolvePlanningAuthorityMode, type PlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import { resolveUserPlanningAuthorityMode } from '../services/planningAuthorityModeService';

export interface PlanningAuthorityModeView {
    /** The mode to render with. Before the stored preferences settle it is the resolver default. */
    mode: PlanningAuthorityMode;
    /** True once the mode is known: supplied by the caller, or read from stored preferences. */
    resolved: boolean;
}

export interface TrackedPlanningAuthorityMode {
    userId: string;
    mode: PlanningAuthorityMode;
}

/**
 * Pure view-state resolution for {@link usePlanningAuthorityMode}. A tracked mode read for a
 * different user is stale on the render where `userId` changes, so it is masked until the
 * read for the current user lands.
 */
export function resolvePlanningAuthorityModeView(
    override: PlanningAuthorityMode | undefined,
    tracked: TrackedPlanningAuthorityMode | null,
    userId: string,
): PlanningAuthorityModeView {
    if (override !== undefined) return { mode: override, resolved: true };
    if (tracked && tracked.userId === userId) return { mode: tracked.mode, resolved: true };
    return { mode: resolvePlanningAuthorityMode(null), resolved: false };
}

/**
 * The planning-authority mode for a component that may be rendered without one. A caller
 * that already holds the user's preferences should pass `override`; otherwise the hook
 * reads them once per user while `enabled`.
 */
export function usePlanningAuthorityMode(
    userId: string,
    override?: PlanningAuthorityMode,
    enabled = true,
): PlanningAuthorityModeView {
    const [tracked, setTracked] = useState<TrackedPlanningAuthorityMode | null>(null);

    useEffect(() => {
        if (!enabled || override !== undefined) return;
        let cancelled = false;
        resolveUserPlanningAuthorityMode(userId)
            .catch(() => resolvePlanningAuthorityMode(null))
            .then(mode => {
                if (!cancelled) setTracked({ userId, mode });
            });
        return () => { cancelled = true; };
    }, [enabled, override, userId]);

    return resolvePlanningAuthorityModeView(override, tracked, userId);
}
