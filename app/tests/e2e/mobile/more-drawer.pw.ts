import { expect, test } from '@playwright/test';
import { dismissOnboardingIfVisible, hasPersistedCheckin, provisionAthlete, seedRecoverySnapshot, signInThroughUi } from '../support/athlete';
import {
  assertDialogFocusContainment,
  assertDialogFocusEntry,
  assertDialogFocusRestoration,
  assertEffectiveTarget,
  assertFocusedElementVisibleAfterViewportReduction,
  assertNoBodyHorizontalOverflow,
} from '../support/mobileAssertions';

test('More drawer keeps focus and navigation usable on a phone', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();
  await expect.poll(() => hasPersistedCheckin(athlete, date)).toBe(true);
  await dismissOnboardingIfVisible(page);
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
  await dismissOnboardingIfVisible(page);

  const more = page.locator('.bottom-nav').getByRole('button', { name: /More/ });
  const drawer = page.getByRole('dialog', { name: 'Navigation & Settings' });
  const close = drawer.getByRole('button', { name: 'Close navigation and settings' });
  await expect(more).toBeVisible();
  await assertEffectiveTarget(more);
  await assertNoBodyHorizontalOverflow(page);

  await assertDialogFocusEntry(more, drawer);
  await assertDialogFocusContainment(page, drawer);
  await assertFocusedElementVisibleAfterViewportReduction(page, close, 500);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await assertDialogFocusRestoration(more, drawer, () => page.keyboard.press('Escape'));
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');

  await assertDialogFocusEntry(more, drawer);
  await assertDialogFocusRestoration(more, drawer, () => close.click());

  await assertDialogFocusEntry(more, drawer);
  await assertDialogFocusRestoration(more, drawer, () => page.locator('.mobile-more-overlay').click({ position: { x: 1, y: 1 } }));

  await assertDialogFocusEntry(more, drawer);
  const goals = drawer.getByRole('button', { name: /Goals/ });
  await assertEffectiveTarget(goals);
  await goals.click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  await assertNoBodyHorizontalOverflow(page);
});
