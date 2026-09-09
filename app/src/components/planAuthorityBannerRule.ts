/**
 * Show-or-hide rule for the PlanView follow-this-one authority banner (#487).
 *
 * Pure module (no React) so the `react-refresh/only-export-components` lint rule
 * stays satisfied alongside `PlanAuthorityBanner.tsx`. All inputs are already
 * computed by `PlanView` -- this module adds no engine logic.
 */

/** Forecast intent for today. `train` means the forecast prescribes work. */
export type ForecastModeToday = 'train' | 'recover';

export interface AuthorityBannerInput {
    /** An imported coach plan is active for this week. */
    hasImportedPlan: boolean;
    /** Title of the coach session occupying today, or null when the plan rests today. */
    coachSessionTitleToday: string | null;
    /** Forecast mode for today, or null when the forecast has no day for today. */
    forecastModeToday: ForecastModeToday | null;
    /** Forecast template title for today (null when unknown). */
    forecastTitleToday: string | null;
    /** The engine critique carries a finding dated today. */
    coachFlaggedToday: boolean;
}

function normalizeTitle(title: string): string {
    return title.trim().toLowerCase();
}

/**
 * Shown only on genuine disagreement for today; hidden whenever either side is
 * missing or both sides agree.
 */
export function shouldShowAuthorityBanner(input: AuthorityBannerInput): boolean {
    if (!input.hasImportedPlan) return false;
    if (input.coachSessionTitleToday === null) return false;
    if (input.forecastModeToday === null) return false;
    // The coach prescribes work while the adaptive forecast prescribes recovery:
    // genuine disagreement for today.
    if (input.forecastModeToday === 'recover') return true;
    // Both prescribe work: disagree only when the engine's own critique flags
    // today's coach session or the two sides name different sessions. Agreement
    // cannot be confirmed without a forecast title, so stay visible toward Home.
    if (input.coachFlaggedToday) return true;
    if (input.forecastTitleToday === null) return true;
    return normalizeTitle(input.coachSessionTitleToday) !== normalizeTitle(input.forecastTitleToday);
}
