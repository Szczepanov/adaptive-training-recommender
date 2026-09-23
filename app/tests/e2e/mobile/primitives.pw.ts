import { expect, test } from '@playwright/test';
import { assertEffectiveTarget } from '../support/mobileAssertions';

test('target assertion rejects undersized and obscured rendered hit areas', async ({ page }) => {
  await page.setContent(`
    <button id="small" style="width: 30px; height: 30px">Small</button>
    <div style="position: relative; margin-top: 20px">
      <button id="covered" style="width: 48px; height: 48px">Covered</button>
      <div style="position: absolute; inset: 0; width: 48px; height: 48px; background: black"></div>
    </div>
  `);

  await expect(assertEffectiveTarget(page.locator('#small'))).rejects.toThrow(/effective target width/);
  await expect(assertEffectiveTarget(page.locator('#covered'))).rejects.toThrow(/pointer hits/);
});
