import type { UserPreferences } from './models';

/**
 * Who has planning authority on the athlete's surfaces (ADR-0052 Phase 2, #1167).
 *
 * - `engine`: today's behaviour. Home, Plan and the week-ahead strip render `rules.ts` /
 *   `planner.ts` / `trainingIntent.ts` output and adjudicate imported sessions.
 * - `ledger`: imported sessions are shown and run as authored, with D-FLAGS beside them;
 *   the engine is not evaluated and `daily_recommendations` is not written.
 */
export type PlanningAuthorityMode = 'engine' | 'ledger';

/**
 * The mode for an athlete who has never set `engineRecommendationsEnabled`.
 *
 * Flipped to `ledger` in P2-8 (ADR-0052 Phase 2, #1167). The preference service never writes a
 * default for the field, so this flip reaches every account that has not chosen explicitly.
 * Setting `engineRecommendationsEnabled: true` restores legacy engine behaviour as a rollback.
 */
export const UNSET_PLANNING_AUTHORITY_MODE: PlanningAuthorityMode = 'ledger';

export function resolvePlanningAuthorityMode(
    preferences: Pick<UserPreferences, 'engineRecommendationsEnabled'> | null | undefined,
): PlanningAuthorityMode {
    const explicit = preferences?.engineRecommendationsEnabled;
    if (explicit === true) return 'engine';
    if (explicit === false) return 'ledger';
    return UNSET_PLANNING_AUTHORITY_MODE;
}
