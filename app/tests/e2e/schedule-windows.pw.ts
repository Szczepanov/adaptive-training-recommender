import { expect, test } from '@playwright/test';
import { provisionAthlete, signInThroughUi } from './support/athlete';

function localDateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Overlapping schedule windows');

  // Restore a valid edit, clear the optional label, and confirm both changes persist.
  await page.getByLabel('End Time').fill('09:00');
  await page.getByLabel('Label (optional)').fill('');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('07:00–09:00')).toBeVisible();
  await expect(page.getByText('AM ride')).toBeHidden();

  // Delete the edited window and confirm only the remaining window is left.
  await page.getByText('07:00–09:00').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('07:00–09:00')).toBeHidden();
  await expect(page.getByText('PM strength')).toBeVisible();
});

test('an athlete can add several recurring weekday time blocks at once', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('heading', { name: 'Training Windows' }).waitFor();

  await page.getByRole('button', { name: '+ Repeat Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Repeat Training Schedule' })).toBeVisible();
  await page.getByLabel('Repeat from').fill(localDateAfter(7));
  await page.getByLabel('Repeat until').fill(localDateAfter(13));

  const firstBlock = page.getByRole('group', { name: 'Time block 1' });
  await firstBlock.getByLabel('Start time').fill('06:00');
  await firstBlock.getByLabel('End time').fill('09:00');

  await page.getByRole('button', { name: '+ Add time block' }).click();
  const secondBlock = page.getByRole('group', { name: 'Time block 2' });
  await secondBlock.getByLabel('Start time').fill('12:00');
  await secondBlock.getByLabel('End time').fill('16:00');

  await page.getByRole('button', { name: '+ Add time block' }).click();
  const thirdBlock = page.getByRole('group', { name: 'Time block 3' });
  await thirdBlock.getByLabel('Start time').fill('17:30');
  await thirdBlock.getByLabel('End time').fill('18:30');
  await thirdBlock.getByRole('button', { name: 'Tuesday' }).click();
  await thirdBlock.getByRole('button', { name: 'Thursday' }).click();

  await expect(page.getByText('13 windows across 5 days')).toBeVisible();
  await page.getByRole('button', { name: 'Apply Schedule', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Repeat Training Schedule' })).toBeHidden();
  await expect(page.getByText('06:00–09:00')).toHaveCount(5);
  await expect(page.getByText('12:00–16:00')).toHaveCount(5);
  await expect(page.getByText('17:30–18:30')).toHaveCount(3);
});
