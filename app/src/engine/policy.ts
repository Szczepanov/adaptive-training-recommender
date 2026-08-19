/** Increment whenever a change can alter a persisted recommendation decision. (Refactoring does not require a bump) */
export const POLICY_VERSION = '2026-08-authored-session-authority-v3';

/** Historical versions are intentionally not re-executed by this build. Their compact
 * audits remain readable evidence, but replay is rejected explicitly because the old
 * decision function is not bundled alongside the current policy. */
export const HISTORICAL_POLICY_VERSIONS = [
    '2026-08-authored-session-authority-v2',
    '2026-08-authored-session-authority-v1',
    '2026-08-session-adjustment-cost-tiering-v2',
    '2026-08-session-adjustment-cost-tiering-v1',
    '2026-08-acute-step-surge-fatigue-v1',
    '2026-08-external-plan-provenance-v1',
    '2026-08-externally-planned-mode-v1',
    '2026-08-session-packing-tiebreaker-v1',
    '2026-08-planning-overlays-v1',
    '2026-08-evergreen-packing-v1',
    '2026-08-training-intent-safety-v1',
    '2026-08-training-intent-modes-v1',
    '2026-08-weekly-role-reservations-v1',
    '2026-08-authored-travel-blocks-v1',
    '2026-08-weekly-coverage-v3',
    '2026-08-weekly-coverage-v2',
    '2026-08-weekly-coverage-v1',
    '2026-08-single-ranking-path-v1',
    '2026-08-objective-credit-v2-v2',
    '2026-08-phase5-sequence-planning-v1',
    '2026-08-phase6-correctness-carryovers-v1',
] as const;

export function isHistoricalPolicyVersion(version: string): boolean {
    return (HISTORICAL_POLICY_VERSIONS as readonly string[]).includes(version);
}
