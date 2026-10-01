import { expect, test } from './support/consoleTrap';

test('withheld authored adjustment resets to the executable original and restores keyboard focus', async ({ page }) => {
  await page.goto('/visual.html?scenario=morning-card-authored-adjustment-withheld');
  await expect(page.locator('[data-visual-scenario="morning-card-authored-adjustment-withheld"]')).toBeVisible();

  const note = page.getByRole('note', { name: 'Start is unavailable while this adjustment is applied' });
  await expect(note).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start My Tempo Run' })).toHaveCount(0);

  const reset = page.getByRole('button', { name: 'Reset to Original Session' });
  await reset.focus();
  await expect(reset).toBeFocused();
  await reset.click();

  const start = page.getByRole('button', { name: 'Start My Tempo Run' });
  await expect(start).toBeVisible();
  await expect(start).toBeFocused();
  await expect(note).toHaveCount(0);
});
