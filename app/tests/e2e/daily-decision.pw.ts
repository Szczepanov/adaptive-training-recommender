import { expect, test } from '@playwright/test';
import { hasPersistedCheckin, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';

test('a complete check-in produces a visible daily recommendation', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);

  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();

  await expect.poll(() => hasPersistedCheckin(athlete, date)).toBe(true);
  const reveal = page.getByRole('button', { name: /Reveal today's recommendation/ });
  await expect(reveal).toBeVisible();
  await reveal.click();
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
});
