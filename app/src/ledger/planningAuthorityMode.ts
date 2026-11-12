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
 * Stays `engine` while ledger mode is built (P2-1…P2-7), so no default behaviour changes.
 * P2-8 flips it to `ledger`, after device acceptance. The preference service never writes a
 * default for the field, so this flip reaches every account that has not chosen explicitly.
 */
export const UNSET_PLANNING_AUTHORITY_MODE: PlanningAuthorityMode = 'engine';

export function resolvePlanningAuthorityMode(
    preferences: Pick<UserPreferences, 'engineRecommendationsEnabled'> | null | undefined,
): PlanningAuthorityMode {
    const explicit = preferences?.engineRecommendationsEnabled;
    if (explicit === true) return 'engine';
    if (explicit === false) return 'ledger';
    return UNSET_PLANNING_AUTHORITY_MODE;
}
