import { expect, type Page } from '@playwright/test';

/**
 * Opens the "More" overflow (desktop dropdown or mobile drawer) and clicks one destination.
 *
 * App-driven navigation (`App.tsx` `navigateToScreen`, e.g. a late decision-input reroute)
 * closes the overflow, and the desktop panel fades in (`dropdownFade`). A bare two-step
 * "More" → item click therefore races: the item detaches mid-click and Playwright waits out
 * the whole test timeout. This reopens the overflow only when it is closed — "More" is a
 * toggle, so an unconditional click would close an open panel — and retries until the item
 * click lands.
 */
export async function openMoreDestination(page: Page, name: string | RegExp): Promise<void> {
  const overflow = page.locator('#desktop-more-panel')
    .or(page.getByRole('dialog', { name: 'Navigation & Settings' }));
  const item = overflow.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name });

  await expect(async () => {
    if (!(await overflow.isVisible())) {
      await page.getByRole('button', { name: 'More' }).click({ timeout: 5_000 });
    }
    await item.click({ timeout: 5_000 });
  }).toPass({ timeout: 30_000, intervals: [250, 500, 1_000] });
}
