import { expect, type Locator, type Page } from '@playwright/test';

/** Measures the rendered control and checks that pointer hits reach it across its interior. */
export async function assertEffectiveTarget(control: Locator, minimum = 44): Promise<void> {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  const measurement = await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const samples = [0.25, 0.5, 0.75].flatMap(x =>
      [0.25, 0.5, 0.75].map(y => {
        const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
        return hit !== null && (hit === element || element.contains(hit));
      }),
    );
    return { width: rect.width, height: rect.height, samples };
  });

  expect(measurement.width, 'effective target width').toBeGreaterThanOrEqual(minimum);
  expect(measurement.height, 'effective target height').toBeGreaterThanOrEqual(minimum);
  expect(measurement.samples, 'control must receive pointer hits across its rendered area').not.toContain(false);
}

export async function assertNoBodyHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.html, 'document horizontal overflow').toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body, 'body horizontal overflow').toBeLessThanOrEqual(widths.viewport + 1);
}

export async function assertDialogCoversBottomNavigation(page: Page): Promise<void> {
  const bottomHit = await page.evaluate(() => {
    const element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 2);
    return element !== null && element.closest('.overlay-viewport') !== null;
  });
  expect(bottomHit, 'the open modal backdrop must receive hits above the fixed mobile navigation').toBe(true);
}

export async function assertFocusedElementVisibleAfterViewportReduction(
  page: Page,
  control: Locator,
  reducedHeight: number,
): Promise<void> {
  const original = page.viewportSize();
  if (!original) throw new Error('A fixed viewport is required for the mobile focus assertion.');

  await control.focus();
  await expect(control).toBeFocused();
  try {
    await page.setViewportSize({ width: original.width, height: reducedHeight });
    await expect.poll(async () => control.evaluate(element => {
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      const rect = element.getBoundingClientRect();
      const centerHit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const visible = rect.top >= top - 1 && rect.bottom <= top + height + 1
        && rect.left >= left - 1 && rect.right <= left + width + 1
        && centerHit !== null && (centerHit === element || element.contains(centerHit));
      return visible || JSON.stringify({
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        viewport: { top, bottom: top + height, left, right: left + width },
        hit: centerHit?.className ?? centerHit?.tagName ?? null,
      });
    }), { message: 'focused control remains fully visible and unobscured in the reduced viewport' }).toBe(true);
  } finally {
    await page.setViewportSize(original);
  }
}

export async function assertDialogFocusEntry(trigger: Locator, dialog: Locator): Promise<void> {
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement)), {
    message: 'opening the dialog moves focus inside it',
  }).toBe(true);
}

export async function assertDialogFocusContainment(page: Page, dialog: Locator): Promise<void> {
  const focusables = dialog.locator('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  const first = focusables.first();
  const last = focusables.last();
  await expect(first).toBeVisible();
  await expect(last).toBeVisible();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
}

export async function assertDialogFocusRestoration(
  trigger: Locator,
  dialog: Locator,
  dismiss: () => Promise<void>,
): Promise<void> {
  await dismiss();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}
