import { resolvePlanningAuthorityMode, type PlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import { preferencesService } from './preferencesService';

/**
 * Resolves the user's planning authority mode from persisted preferences.
 * When preferences are missing, invalid, or unreadable, falls back to
 * `resolvePlanningAuthorityMode(null)` (`'engine'` until P2-8, `'ledger'` after).
 *
 * The write guards built on this fail toward the default: until P2-8 an unreadable
 * preferences document lets an engine write through even for a user who stored
 * `engineRecommendationsEnabled: false`. That is accepted because no UI writes that flag
 * before P2-8, and failing closed would drop every engine-mode user's recommendation on a
 * transient read error. After the P2-8 default flip the same fallback fails closed.
 */
export async function resolveUserPlanningAuthorityMode(userId: string): Promise<PlanningAuthorityMode> {
    const state = await preferencesService.getPreferencesState(userId);
    return resolvePlanningAuthorityMode(state.status === 'AVAILABLE' ? state.data : null);
}
