/**
 * Show-or-hide rule for the PlanView follow-this-one authority banner (#487).
 *
 * Pure module (no React) so the `react-refresh/only-export-components` lint rule
 * stays satisfied alongside `PlanAuthorityBanner.tsx`. All inputs are already
 * computed by `PlanView` -- this module adds no engine logic.
 */

/** Same-day adaptive intent that seeds the tomorrow-forward week forecast. */
export type AdaptiveModeToday = 'train' | 'modify' | 'recover';

export interface AuthorityBannerInput {
    /** An imported coach plan is active for this week. */
    hasImportedPlan: boolean;
    /** Title of the coach session occupying today, or null when no session occupies today. */
    coachSessionTitleToday: string | null;
    /** True only for an explicit imported rest directive, not merely an unplanned day. */
    coachHasExplicitRestToday: boolean;
    /** Same-day adaptive mode, or null when today's adaptive recommendation is unavailable. */
    adaptiveModeToday: AdaptiveModeToday | null;
    /** Same-day adaptive template title (null when unavailable). */
    adaptiveTitleToday: string | null;
    /** The engine critique carries a finding dated today. */
    coachFlaggedToday: boolean;
}

function normalizeTitle(title: string): string {
    return title.trim().toLowerCase();
}

/**
 * Show only when both sides have an explicit today prescription and they genuinely
 * disagree. An unplanned coach day is not silently treated as a rest day, and missing
 * adaptive comparison data fails closed (no banner) rather than inventing a verdict.
 */
export function shouldShowAuthorityBanner(input: AuthorityBannerInput): boolean {
    if (!input.hasImportedPlan || input.adaptiveModeToday === null) return false;

    const coachHasSession = input.coachSessionTitleToday !== null;
    if (!coachHasSession && !input.coachHasExplicitRestToday) return false;

    // Explicit coach rest versus adaptive work is a real disagreement. If the
    // adaptive path also says recover, the two sources agree at the authority level.
    if (!coachHasSession && input.coachHasExplicitRestToday) {
        return input.adaptiveModeToday !== 'recover';
    }

    // A dated critique means the coach session itself conflicts with a rule the
    // adaptive engine applies to its own candidates, even when display titles match.
    if (input.coachFlaggedToday) return true;

    // Reduced-load/recovery modes are materially different from following the coach
    // session as authored, regardless of whether the selected template name matches.
    if (input.adaptiveModeToday === 'modify' || input.adaptiveModeToday === 'recover') return true;

    // Both sides prescribe normal work. Compare their concrete session titles when
    // available; without an adaptive title, disagreement cannot be proven.
    if (input.adaptiveTitleToday === null) return false;
    return normalizeTitle(input.coachSessionTitleToday) !== normalizeTitle(input.adaptiveTitleToday);
}
