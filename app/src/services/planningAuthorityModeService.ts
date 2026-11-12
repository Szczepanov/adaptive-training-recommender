import { resolvePlanningAuthorityMode, type PlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import { preferencesService } from './preferencesService';

/**
 * Resolves the user's planning authority mode from persisted preferences.
 * When preferences are missing, invalid, or unreadable, falls back to
 * `resolvePlanningAuthorityMode(null)` (`'engine'` until P2-8, `'ledger'` after).
 */
export async function resolveUserPlanningAuthorityMode(userId: string): Promise<PlanningAuthorityMode> {
    const state = await preferencesService.getPreferencesState(userId);
    return resolvePlanningAuthorityMode(state.status === 'AVAILABLE' ? state.data : null);
}
