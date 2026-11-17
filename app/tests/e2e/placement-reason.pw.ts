import { expect, test } from './support/test';
import { provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { buildV6Plan, checkInLedgerMode, importPlan, readCollection, readDocument, seedLedgerModePreferences } from './support/roundTrip';
import type { ExternalPlanPlacement } from '../../src/engine/models';
import type { PlacementEvent } from '../../src/ledger/placementHistory';

// Ledger export Phase 3C: rescheduling an imported session can carry an optional reason, saved with
// the overlay and its immutable history event in the same write. Phone width is the primary context.
test('a reschedule records the chosen reason on the placement and its history event at 390px', async ({ page }, testInfo) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  await seedLedgerModePreferences(athlete, today);
  const plan = buildV6Plan(today);
  await signInThroughUi(page, athlete);
  await checkInLedgerMode(page);
  await importPlan(page, plan);
  await page.setViewportSize({ width: 390, height: 900 });

  await page.getByRole('button', { name: 'Reschedule', exact: true }).first().click();
  const panel = page.getByRole('region', { name: 'Missed session proposal' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('Reason (optional)').selectOption('fatigue');
  await panel.getByLabel('Note (optional)').fill('Legs heavy after the ride');
  // The picker fits the phone width with 44px controls (docs/standards/ui-ux.md).
  for (const control of [panel.getByLabel('Reason (optional)'), panel.getByLabel('Note (optional)')]) {
    const box = await control.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390 && box.height >= 44).toBe(true);
  }
  await panel.screenshot({ path: testInfo.outputPath('placement-reason-390.png') });
  await panel.getByRole('button', { name: 'Choose another day' }).click();
  const target = panel.getByRole('group', { name: 'Pick a day' }).getByRole('button').first();
  await expect(target).toBeVisible();
  await target.click();
  await expect(panel).toHaveCount(0);

  const base = `external_plans/${plan.planId}/revisions/1`;
  const reason = { code: 'fatigue', note: 'Legs heavy after the ride' };
  await expect.poll(async () => (await readDocument<ExternalPlanPlacement>(athlete, `${base}/placement/current`))
    ?.assignments.find(item => item.sessionId === plan.sessions[0].id)?.reason).toEqual(reason);
  const events = await readCollection<PlacementEvent>(athlete, `${base}/placement_history`);
  expect(events.at(-1)?.assignments.find(item => item.sessionId === plan.sessions[0].id)).toMatchObject({ status: 'moved', reason });
});
