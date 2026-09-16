import { expect, test } from '@playwright/test';
import { provisionAthlete, signInThroughUi } from './support/athlete';

test('an athlete can manage same-day training windows from the Plan screen', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('heading', { name: 'Training Windows' }).waitFor();

  // No windows exist yet -- the empty state, not a placement error, is what should show.
  await expect(page.getByText('No upcoming training windows.')).toBeVisible();

  // The modal is a real keyboard-modal dialog: focus enters it, Escape closes it, and
  // focus returns to the control that opened it.
  const addWindowButton = page.getByRole('button', { name: '+ Add Window' });
  await addWindowButton.click();
  await expect(page.getByRole('heading', { name: 'Add Training Window' })).toBeVisible();
  await expect(page.getByLabel('Date')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Add Training Window' })).toBeHidden();
  await expect(addWindowButton).toBeFocused();

  await addWindowButton.click();
  await page.getByLabel('Start Time').fill('07:00');
  await page.getByLabel('End Time').fill('08:30');
  await page.getByLabel('Label (optional)').fill('AM ride');
  await page.getByRole('button', { name: 'Add Window', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Add Training Window' })).toBeHidden();
  await expect(page.getByText('07:00–08:30')).toBeVisible();
  await expect(page.getByText('AM ride')).toBeVisible();

  // A second, later window on the same day is the whole point of this feature -- it must
  // not be rejected as an overlap with the first.
  await page.getByRole('button', { name: '+ window' }).click();
  await page.getByLabel('Start Time').fill('17:00');
  await page.getByLabel('End Time').fill('18:00');
  await page.getByLabel('Label (optional)').fill('PM strength');
  await page.getByRole('button', { name: 'Add Window', exact: true }).click();
  await expect(page.getByText('17:00–18:00')).toBeVisible();

  // Cross-window overlap is an authoritative manifest invariant, not just a visual hint.
  await page.getByText('AM ride').click();
  await expect(page.getByRole('heading', { name: 'Edit Training Window' })).toBeVisible();
  await page.getByLabel('End Time').fill('17:30');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Overlapping schedule windows');

  // Restore a valid edit and confirm the change persists and re-renders.
  await page.getByLabel('End Time').fill('09:00');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('07:00–09:00')).toBeVisible();

  // Delete it and confirm only the remaining window is left.
  await page.getByText('AM ride').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('AM ride')).toBeHidden();
  await expect(page.getByText('PM strength')).toBeVisible();
});
