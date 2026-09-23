import { expect, test } from '@playwright/test';
import { dismissOnboardingIfVisible, openFixturePicker, provisionAthlete, signInThroughUi } from '../support/athlete';
import { assertEffectiveTarget, assertNoBodyHorizontalOverflow } from '../support/mobileAssertions';

test('session runner keeps logging, rest, sound, and finish controls usable at 390px', async ({ page }) => {
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: /Skip to Dashboard/ }).click();
  await dismissOnboardingIfVisible(page);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();

  const sound = page.getByRole('button', { name: 'Mute sound' });
  const logSet = page.getByRole('button', { name: /Log Set/ });
  const finish = page.getByRole('button', { name: /Finish Session \(/ });
  await assertNoBodyHorizontalOverflow(page);
  await assertEffectiveTarget(sound);
  await sound.click();
  await assertEffectiveTarget(page.getByRole('button', { name: 'Unmute sound' }));
  await assertEffectiveTarget(logSet);
  await assertEffectiveTarget(finish);

  const groupNext = page.locator('.group-next-button');
  if (await groupNext.isVisible()) await assertEffectiveTarget(groupNext);

  await logSet.click();
  await expect(page.getByText('Performed for this step (1)')).toBeVisible();
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
