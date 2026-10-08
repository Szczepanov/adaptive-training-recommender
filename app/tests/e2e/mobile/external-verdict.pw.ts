import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import {
  completeTypicalCheckin,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
} from '../support/athlete';
import { seedExternalPlanForToday } from '../support/externalPlan';

async function freshAthleteWithCheckin(
  page: Page,
  kind: 'proceed' | 'scale' | 'defer' | 'skip',
): Promise<string> {
  const athlete = await provisionAthlete();
  const depleted = kind === 'scale' || kind === 'defer';
  const date = await seedRecoverySnapshot(athlete, depleted ? { bodyBatteryWake: 25 } : {});
  const seed = await seedExternalPlanForToday(athlete, kind);
  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);
  return seed.planId;
}

test('an imported proceed session shows its verdict and Start path on a phone viewport', async ({ page }) => {
  const planId = await freshAthleteWithCheckin(page, 'proceed');

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Do it as written');
  await expect(verdict).toContainText(`${planId} (revision 1)`);
  await expect(page.getByRole('button', { name: /Start E2E easy spin/ })).toBeVisible();
});

test('a scaled imported session shows the reduced version on a phone viewport', async ({ page }) => {
  const planId = await freshAthleteWithCheckin(page, 'scale');

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Do the reduced version');
  await expect(verdict).toContainText(`${planId} (revision 1)`);
  await expect(verdict).toContainText('Cut it in half.');
  await expect(verdict).toContainText('Start is unavailable for this reduced form');
  await expect(page.getByText(/min · reduced/, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start E2E hard intervals/ })).toHaveCount(0);
});

test('a deferred imported session offers no Start path on a phone viewport', async ({ page }) => {
  const planId = await freshAthleteWithCheckin(page, 'defer');

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Move it to another day');
  await expect(verdict).toContainText(`${planId} (revision 1)`);
  await expect(page.getByRole('button', { name: /Start E2E hard intervals/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Resume E2E hard intervals/ })).toHaveCount(0);
});

test('an excluded imported session offers no Start path on a phone viewport', async ({ page }) => {
  await freshAthleteWithCheckin(page, 'skip');

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Not today');
  await expect(verdict).toContainText('Nothing from this session is prescribed today');
  await expect(page.getByRole('button', { name: /Start E2E overlong ride/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Resume E2E overlong ride/ })).toHaveCount(0);
});
