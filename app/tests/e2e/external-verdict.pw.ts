import { expect, test } from './support/test';
import {
  completeTypicalCheckin,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
} from './support/athlete';
import { seedExternalPlanForToday } from './support/externalPlan';

test('an imported proceed session shows its verdict, source and Start path on Home', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  const seed = await seedExternalPlanForToday(athlete, 'proceed');

  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Do it as written');
  await expect(verdict).toContainText(`${seed.planId} (revision 1)`);
  await expect(verdict).toContainText('Easy spin, nothing over 60% FTP.');
  await expect(page.getByRole('button', { name: /Start E2E easy spin/ })).toBeVisible();
});

test('a scaled imported session shows the reduced version without launching the full structured dose', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete, { bodyBatteryWake: 25 });
  const seed = await seedExternalPlanForToday(athlete, 'scale');

  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Do the reduced version');
  await expect(verdict).toContainText(`${seed.planId} (revision 1)`);
  await expect(verdict).toContainText('Cut it in half.');
  await expect(verdict).toContainText('Start is unavailable for this reduced form');
  await expect(page.getByText(/min · reduced/, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start E2E hard intervals/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Resume E2E hard intervals/ })).toHaveCount(0);
});
test('a deferred imported session names its verdict and offers no Start path', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete, { bodyBatteryWake: 25 });
  const seed = await seedExternalPlanForToday(athlete, 'defer');

  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Move it to another day');
  await expect(verdict).toContainText(`${seed.planId} (revision 1)`);
  await expect(verdict).toContainText('Nothing from this session is prescribed today');
  await expect(page.getByRole('button', { name: /Start E2E hard intervals/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Resume E2E hard intervals/ })).toHaveCount(0);
});

test('an excluded imported session names its verdict and offers no Start path as written', async ({ page }) => {
  const athlete = await provisionAthlete();
  const date = await seedRecoverySnapshot(athlete);
  const seed = await seedExternalPlanForToday(athlete, 'skip');

  await signInThroughUi(page, athlete);
  await completeTypicalCheckin(page, athlete, date);

  const verdict = page.getByRole('region', { name: 'Imported plan session' });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('Not today');
  await expect(verdict).toContainText(`${seed.planId} (revision 1)`);
  await expect(verdict).toContainText('Nothing from this session is prescribed today');
  // The imported prescription must not be launchable as written.
  await expect(page.getByRole('button', { name: /Start E2E overlong ride/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Resume E2E overlong ride/ })).toHaveCount(0);
});
