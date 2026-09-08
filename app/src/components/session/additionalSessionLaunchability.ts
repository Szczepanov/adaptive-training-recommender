import type { IntradayBundleMemberStatus } from '../../services/intradayBundleMemberAdjudication';

/**
 * ADR-0036 (H4) plan step 10: the single rule deciding whether an adjudicated intraday
 * bundle member may show a Start control.
 *
 * A member is launchable **only** on a `proceed` verdict that actually received a binding.
 * `scale`, `pending` and `reject` never are -- D-REASSESS treats a capacity-reduced or
 * unconfirmed member as not yet approved, and offering a launch for one would route around
 * the very verdict that produced it. Neither is a `proceed` the adjudication loop declined
 * to bind: the 4-additional-session cap emits exactly that shape.
 *
 * Its own module rather than a second export from `AdditionalSessionsCard.tsx` so the rule
 * can be asserted directly instead of only inferred from rendered markup (and so the card
 * file keeps a single component export, which React Fast Refresh requires).
 */
export function isMemberLaunchable(member: IntradayBundleMemberStatus): boolean {
    return member.status === 'proceed' && !!member.binding;
}
