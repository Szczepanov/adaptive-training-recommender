import { expect, test } from '@playwright/test';
import { provisionAthlete, signInThroughUi } from './support/athlete';

test('an existing athlete can sign in through the rendered login form', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);

  await expect(page.getByRole('heading', { name: 'Check-in', exact: true })).toBeVisible();
});
