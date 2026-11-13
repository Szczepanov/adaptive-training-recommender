import { resolvePlanningAuthorityMode, type PlanningAuthorityMode } from '../ledger/planningAuthorityMode';
import { preferencesService } from '../services/preferencesService';

/**
 * Resolves the planning-authority mode that selects the prompt's travel instruction (OQ4)
 * from the stored preferences. An unreadable preferences document falls back to the
 * resolver's default, the same fail-safe direction as every other mode consumer.
 */
export async function loadPromptPlanningAuthorityMode(userId: string): Promise<PlanningAuthorityMode> {
    try {
        const result = await preferencesService.getPreferencesState(userId);
        return resolvePlanningAuthorityMode(result.status === 'AVAILABLE' ? result.data : null);
    } catch {
        return resolvePlanningAuthorityMode(null);
    }
}
