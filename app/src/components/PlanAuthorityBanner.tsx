import { SCREEN_LABELS } from '../types/navigation';
import { shouldShowAuthorityBanner, type AuthorityBannerInput } from './planAuthorityBannerRule';

/**
 * Follow-this-one authority banner for `PlanView` (#487).
 *
 * Verdict copy plus a link only: `PlanView` compares the imported coach prescription
 * with the same-day adaptive recommendation that seeds the tomorrow-forward forecast.
 * Nothing in this component changes decision logic or safety envelopes. When those
 * sources disagree, Home remains the place to resolve the final today decision.
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
                ⚖️ Coach plan and adaptive guidance differ today. Follow the decision on {SCREEN_LABELS.home}; safety
                limits still apply.
            </p>
            {onViewHome && (
                <button type="button" className="plan-retry-btn" onClick={onViewHome}>
                    View {SCREEN_LABELS.home} →
                </button>
            )}
        </div>
    );
};
