import { expect, test } from '@playwright/test';
import { openFixturePicker, provisionAthlete, readSessionExecutions, signInThroughUi } from './support/athlete';

test('an athlete can launch and complete a reviewed session', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await expect(page.getByRole('dialog', { name: 'Complete Session' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();

  await expect.poll(async () => {
    const executions = await readSessionExecutions(athlete);
    return executions.filter(execution => execution.state === 'completed').length;
  }).toBe(1);
});

test('a rapid duplicate start leaves exactly one in-progress execution', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  const start = page.getByRole('button', { name: 'Start Session →', exact: true }).first();
  await start.evaluate(button => {
    // Session execution ids currently include Date.now(). Make every synchronous clock read
    // distinct while dispatching both clicks so a broken launch guard cannot be hidden by
    // two writes accidentally targeting the same Firestore document id.
    const realDateNow = Date.now;
    let syntheticNow = realDateNow();
    Date.now = () => ++syntheticNow;
    try {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } finally {
      Date.now = realDateNow;
    }
  });

  await expect.poll(async () => (await readSessionExecutions(athlete)).length).toBe(1);
  const [execution] = await readSessionExecutions(athlete);
  expect(execution?.state).toBe('in_progress');
});
