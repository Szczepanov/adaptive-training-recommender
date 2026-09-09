import { clearOnboardingDismissalForUser } from '../../utils/onboardingStorage';

interface OnboardingRelaunchSectionProps {
  userId: string;
  disabled?: boolean;
}

export function OnboardingRelaunchSection({ userId, disabled = false }: OnboardingRelaunchSectionProps) {
  const handleRelaunch = () => {
    if (disabled) return;
    // Clearing the dismissal lets a goal-less account see the wizard again on
    // reload. Accounts with an active goal stay on the normal dashboard: the
    // overlay gate suppresses the wizard once onboarding has produced a goal.
    clearOnboardingDismissalForUser(userId);
    window.location.reload();
  };

  return (
    <section className="preference-section">
      <h2>Setup wizard</h2>
      <p className="preference-desc">
        Re-run the rapid setup wizard to configure training setup and goals from
        scratch. The wizard appears when your account has no active goal; if you
        skipped setup earlier, this is how you get it back.
      </p>
      {disabled && (
        <p className="preference-warning-note" role="status">
          Save or reset your pending Coach Preferences changes before re-running setup.
        </p>
      )}
      <button type="button" className="login-btn" onClick={handleRelaunch} disabled={disabled}>
        Re-run setup wizard
      </button>
    </section>
  );
}
