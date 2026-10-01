import { expect, test } from './support/consoleTrap';
import {
  dismissOnboardingIfVisible,
  hasPersistedCheckin,
  provisionAthlete,
  readPersistedRecommendation,
  seedRecoverySnapshot,
  signInThroughUi,
} from './support/athlete';
import { parseDailyRecommendation } from '../../src/persistence/parsers/trainingHistory';

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

  // WP5 (issue #953): verify recommendation persistence and shape under security rules
  await expect.poll(async () => {
    const raw = await readPersistedRecommendation(athlete, date);
    if (!raw) return null;
    const parsed = parseDailyRecommendation(raw, `users/${athlete.userId}/daily_recommendations/${date}`);
    return parsed.status === 'AVAILABLE' ? { status: parsed.status, revision: parsed.data.revision } : null;
  }).toEqual({ status: 'AVAILABLE', revision: 1 });
});
