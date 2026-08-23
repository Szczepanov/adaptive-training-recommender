import type { Screen } from '../types/navigation';

/** An actionable next step surfaced on a load-error screen: either a specific screen that
 * owns the flagged document (re-saving there re-runs validation), or a forced Garmin
 * resync (re-ingesting overwrites a malformed recovery snapshot). Shared between Home and
 * PlanView, which hit the same decision-input/recovery-snapshot failure modes. */
export type ErrorRepairAction =
    | { kind: 'navigate'; screen: Screen; label: string }
    | { kind: 'resync' };
