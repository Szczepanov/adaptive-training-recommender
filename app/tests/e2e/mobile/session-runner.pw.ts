import { expect, test } from '@playwright/test';
import { dismissOnboardingIfVisible, openFixturePicker, provisionAthlete, signInThroughUi } from '../support/athlete';
import { assertEffectiveTarget, assertNoBodyHorizontalOverflow } from '../support/mobileAssertions';

test('session runner logs both hold sides before rotating and keeps controls usable at 390px', async ({ page }) => {
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Skip to Dashboard/ }).click();
  await dismissOnboardingIfVisible(page);
  await openFixturePicker(page);
  const timedFixture = page.locator('.fixture-card').filter({ hasText: 'Timed Trunk & Tissue Preparation' });
  await timedFixture.getByRole('button', { name: 'Start Session →', exact: true }).click();

  const activeHeading = page.locator('.active-step-panel h3');
  await expect(activeHeading).toContainText(/soleus/i);
  expect(await page.locator('.active-step-panel').evaluate(panel => {
    const navigation = document.querySelector('.step-nav-ribbon');
    return navigation !== null
      && Boolean(panel.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  const sound = page.getByRole('button', { name: 'Mute sound' });
  const logLeft = page.getByRole('button', { name: 'Log left hold', exact: true });
  const finish = page.getByRole('button', { name: /Finish Session \(/ });
  await assertNoBodyHorizontalOverflow(page);
  await assertEffectiveTarget(sound);
  await sound.click();
  await assertEffectiveTarget(page.getByRole('button', { name: 'Unmute sound' }));
  await assertEffectiveTarget(logLeft);
  await assertEffectiveTarget(finish);

  const groupNext = page.locator('.group-next-button');
  if (await groupNext.isVisible()) await assertEffectiveTarget(groupNext);

  await page.getByRole('button', { name: 'Start left hold timer' }).click();
  const stopLeft = page.getByRole('button', { name: 'Stop left hold timer' });
  await expect(stopLeft).toBeVisible({ timeout: 7_000 });
  await page.waitForTimeout(1_100);
  await stopLeft.click();
  const holdTime = page.getByRole('spinbutton', { name: 'Hold duration in seconds' });
  await expect(holdTime).toHaveValue('1');

  await page.getByRole('button', { name: 'Right side', exact: true }).click();
  await expect(holdTime).toHaveValue('30');
  await page.getByRole('button', { name: 'Start right hold timer' }).click();
  const stopRight = page.getByRole('button', { name: 'Stop right hold timer' });
  await expect(stopRight).toBeVisible({ timeout: 7_000 });
  await page.waitForTimeout(1_100);
  await stopRight.click();
  await expect(holdTime).toHaveValue('1');
  await page.getByRole('button', { name: 'Left side', exact: true }).click();
  await expect(holdTime).toHaveValue('1');

  // Right-first must still resume the missing left side even though nextSide was already
  // "left" before this submission; the unlogged left stopwatch value must survive.
  await page.getByRole('button', { name: 'Right side', exact: true }).click();
  await expect(holdTime).toHaveValue('1');
  await page.getByRole('button', { name: 'Log right hold', exact: true }).click();
  await expect(activeHeading).toContainText(/soleus/i);
  await expect(page.getByRole('button', { name: 'Log left hold', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip Rest' })).toHaveCount(0);
  await expect(holdTime).toHaveValue('1');
  await page.getByRole('button', { name: 'Log left hold', exact: true }).click();
  await expect(activeHeading).toContainText(/copenhagen/i);
  await expect(activeHeading).toBeFocused();
  await expect(holdTime).toHaveValue('20');
  const skipRest = page.getByRole('button', { name: 'Skip Rest' });
  if (await skipRest.isVisible()) {
    await assertEffectiveTarget(page.getByRole('button', { name: '+30s' }));
    await assertEffectiveTarget(skipRest);
    await skipRest.click();
    await expect(skipRest).toBeHidden();
  }
  await assertNoBodyHorizontalOverflow(page);

  await finish.click();
  const completion = page.getByRole('dialog', { name: 'Complete Session' });
  await expect(completion).toBeVisible();
  await assertEffectiveTarget(completion.locator('.checkbox-label'));
  await assertEffectiveTarget(completion.getByRole('button', { name: 'Finish & Save Session' }));
  await assertNoBodyHorizontalOverflow(page);
});
