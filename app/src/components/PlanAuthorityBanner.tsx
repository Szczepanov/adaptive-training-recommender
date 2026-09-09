import { SCREEN_LABELS } from '../types/navigation';
import { shouldShowAuthorityBanner, type AuthorityBannerInput } from './planAuthorityBannerRule';

/**
 * Follow-this-one authority banner for `PlanView` (#487).
 *
 * Verdict copy plus a link only: every input here is already computed by
 * `PlanView` (`ExternalPlanWeek` placements, `WeekAheadStrip` forecast days,
 * `ExternalWeekCritique` findings), and nothing in this module touches engine
 * decision logic. The copy never overrules safety envelopes -- it points at
 * Home, whose recommendation already passed them, and says safety limits still
 * apply.
 */
interface PlanAuthorityBannerProps extends AuthorityBannerInput {
    onViewHome?: () => void;
}

export const PlanAuthorityBanner: React.FC<PlanAuthorityBannerProps> = (props) => {
    const { onViewHome, ...input } = props;
    if (!shouldShowAuthorityBanner(input)) return null;
    return (
        <div className="plan-authority-banner" role="status" aria-label="Authoritative source for today">
            <p className="plan-authority-text">
                ⚖️ Coach plan and AI forecast differ today — follow {SCREEN_LABELS.home} for today; safety limits
                still apply.
            </p>
            {onViewHome && (
                <button type="button" className="plan-retry-btn" onClick={onViewHome}>
                    View {SCREEN_LABELS.home} →
                </button>
            )}
        </div>
    );
};
