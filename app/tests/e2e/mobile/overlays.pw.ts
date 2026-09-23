import { expect, test } from '@playwright/test';
import { dismissOnboardingIfVisible, provisionAthlete, signInThroughUi } from '../support/athlete';
import {
  assertDialogFocusContainment,
  assertDialogCoversBottomNavigation,
  assertDialogFocusEntry,
  assertDialogFocusRestoration,
  assertEffectiveTarget,
  assertFocusedElementVisibleAfterViewportReduction,
  assertNoBodyHorizontalOverflow,
} from '../support/mobileAssertions';

test('Goals dialog keeps focus, controls, and dismissal usable on a phone', async ({ page }) => {
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Skip to Dashboard/ }).click();
  await dismissOnboardingIfVisible(page);
  await page.locator('.bottom-nav').getByRole('button', { name: /More/ }).click();
  await page.getByRole('dialog', { name: 'Navigation & Settings' }).getByRole('button', { name: /Goals/ }).click();

  const open = page.getByRole('button', { name: '+ Add Goal' });
  const dialog = page.getByRole('dialog', { name: 'Add New Goal' });
  await assertEffectiveTarget(open);
  await assertDialogFocusEntry(open, dialog);
  await assertDialogCoversBottomNavigation(page);
  await assertNoBodyHorizontalOverflow(page);
  await assertDialogFocusContainment(page, dialog);
  await assertEffectiveTarget(dialog.getByRole('button', { name: 'Close goal dialog' }));
  await assertFocusedElementVisibleAfterViewportReduction(page, dialog.locator('input[type="text"]').first(), 500);
  await assertDialogFocusRestoration(open, dialog, () => page.keyboard.press('Escape'));
});

test('training window dialog preserves mobile focus and reachable actions', async ({ page }) => {
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Skip to Dashboard/ }).click();
  await dismissOnboardingIfVisible(page);
  await page.locator('.bottom-nav').getByRole('button', { name: /Plan/ }).click();
  await expect(page.getByRole('heading', { name: 'Training Windows' })).toBeVisible();

  const open = page.getByRole('button', { name: '+ Add Window' });
  const dialog = page.getByRole('dialog', { name: 'Add Training Window' });
  await assertDialogFocusEntry(open, dialog);
  await assertNoBodyHorizontalOverflow(page);
  await assertDialogFocusContainment(page, dialog);
  await assertEffectiveTarget(dialog.getByRole('button', { name: 'Add Window', exact: true }));
  await assertFocusedElementVisibleAfterViewportReduction(page, dialog.getByLabel('Label (optional)'), 500);
  await assertDialogFocusRestoration(open, dialog, () => dialog.getByRole('button', { name: 'Cancel' }).click());
});

test('new athlete onboarding keeps its choices and dismissal reachable on a phone', async ({ page }) => {
  const athlete = await provisionAthlete();
  await page.goto('/');
  await page.getByPlaceholder('Email address').fill(athlete.email);
  await page.getByPlaceholder('Password').fill(athlete.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Rapid Onboarding Setup' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await assertNoBodyHorizontalOverflow(page);
  await assertEffectiveTarget(dialog.getByRole('button', { name: /Let's Set Up Your Profile/ }));
  await dialog.getByRole('button', { name: /Let's Set Up Your Profile/ }).click();
  await expect(dialog.getByRole('heading', { name: 'What is your primary focus?' })).toBeVisible();
  await assertEffectiveTarget(dialog.getByRole('button', { name: /Strength & Muscle/ }));
  await assertNoBodyHorizontalOverflow(page);
  await assertDialogFocusContainment(page, dialog);
  await assertFocusedElementVisibleAfterViewportReduction(page, dialog.getByRole('button', { name: /Next: Equipment & Days/ }), 500);
  await dialog.getByRole('button', { name: 'Skip for now' }).click();
  await expect(dialog).toBeHidden();
});

test('manual session destination sheet keeps choices and close action reachable', async ({ page }) => {
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Skip to Dashboard/ }).click();
  await dismissOnboardingIfVisible(page);
  await page.locator('.bottom-nav').getByRole('button', { name: /More/ }).click();
  await page.getByRole('dialog', { name: 'Navigation & Settings' }).getByRole('button', { name: /Sessions/ }).click();
  await page.getByRole('button', { name: '＋ New session', exact: true }).click();
  await page.getByRole('button', { name: 'Build manually', exact: true }).click();
  await page.getByRole('button', { name: 'Review session' }).click();

  const open = page.getByRole('button', { name: 'Save / Schedule / Replace...' });
  const dialog = page.getByRole('dialog', { name: 'Save or start session' });
  await assertDialogFocusEntry(open, dialog);
  await assertNoBodyHorizontalOverflow(page);
  await assertDialogFocusContainment(page, dialog);
  await dialog.getByRole('radio', { name: /Schedule for a date/ }).check();
  await assertEffectiveTarget(dialog.getByRole('button', { name: 'Save & schedule' }));
  await assertFocusedElementVisibleAfterViewportReduction(page, dialog.locator('input[type="date"]'), 500);
  await assertDialogFocusRestoration(open, dialog, () => dialog.getByRole('button', { name: 'Cancel' }).click());
});
