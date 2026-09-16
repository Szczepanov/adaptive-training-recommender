import { expect, test } from '@playwright/test';
import { dismissOnboardingIfVisible, hasPersistedCheckin, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';

test('a complete check-in produces a visible daily recommendation without shadow-mode opt-in', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);

  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();

  await expect.poll(() => hasPersistedCheckin(athlete, date)).toBe(true);
  // Saving the check-in triggers a fresh decisionInput composition (App.tsx's
  // onCheckinSaved), the same async work that makes the onboarding wizard eligible to show
  // again for a goal-less athlete -- dismiss it here too, or it can intercept assertions.
  await dismissOnboardingIfVisible(page);

  // Decision Journal / shadow mode is opt-in. A fresh athlete has no preference document yet,
  // so Home must fail closed: no reveal gate and the recommendation is immediately visible.
  await expect(page.getByRole('button', { name: /Reveal today's recommendation/ })).toHaveCount(0);
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
});
