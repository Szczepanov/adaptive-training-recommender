import { expect, test } from '@playwright/test';
import {
  openFixturePicker,
  provisionAthlete,
  readSessionExecutions,
  readSessionRestEvents,
  signInThroughUi,
} from './support/athlete';

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

test('the live session clock is wall-clock correct after a background-style time jump (#908)', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();

  const timer = page.locator('.session-timer');
  await expect(timer).toBeVisible();

  // Simulate a backgrounded tab: the wall clock jumps five minutes with no
  // interval callback firing in between, then the tab becomes visible again.
  // The wall-clock runner must show the jumped value on resync; a
  // callback-counting clock would still read near zero.
  await timer.evaluate(() => {
    const realNow = Date.now;
    const jumpMs = 5 * 60 * 1000;
    Date.now = () => realNow() + jumpMs;
    (window as unknown as { __restoreDateNow908?: () => void }).__restoreDateNow908 = () => {
      Date.now = realNow;
    };
    document.dispatchEvent(new Event('visibilitychange'));
  });

  try {
    await expect(timer).toContainText('5:', { timeout: 10_000 });
  } finally {
    await page.evaluate(() => {
      (window as unknown as { __restoreDateNow908?: () => void }).__restoreDateNow908?.();
    });
  }
});

test('a background-expired rest closes once even when multiple resync signals fire (#908)', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();

  // The first reviewed fixture begins with an authored-rest repetition warm-up.
  // Mark this one entry as a work set so it counts toward prescribed sets and
  // starts the real durable rest path rather than only exercising display state.
  await page.getByLabel('Warm-up').uncheck();
  await page.getByRole('button', { name: 'Log repetition set' }).click();

  const restBanner = page.locator('.rest-timer-banner');
  await expect(restBanner).toBeVisible();

  let executionId = '';
  await expect.poll(async () => {
    const executions = await readSessionExecutions(athlete);
    executionId = executions[0]?.executionId ?? '';
    return executions.length;
  }).toBe(1);
  expect(executionId).not.toBe('');

  await page.evaluate(() => {
    const realNow = Date.now;
    const jumpMs = 5 * 60 * 1000;
    Date.now = () => realNow() + jumpMs;
    (window as unknown as { __restoreDateNow908?: () => void }).__restoreDateNow908 = () => {
      Date.now = realNow;
    };

    // Real browsers commonly deliver visibilitychange and focus close together.
    // Repeating both signals proves the first expired-rest resync consumes the
    // active rest synchronously and later resyncs cannot persist it again.
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });

  try {
    await expect(restBanner).toBeHidden({ timeout: 10_000 });
    await expect.poll(async () => (await readSessionRestEvents(athlete, executionId)).length).toBe(1);

    const [restEvent] = await readSessionRestEvents(athlete, executionId);
    expect(restEvent).toMatchObject({
      executionId,
      endReason: 'timer_elapsed',
    });
    expect(restEvent?.actualSeconds).toBeGreaterThanOrEqual(300);

    // Give any racing interval/focus callback time to run, then assert the
    // durable invariant rather than only the transient UI state.
    await page.waitForTimeout(500);
    expect(await readSessionRestEvents(athlete, executionId)).toHaveLength(1);
  } finally {
    await page.evaluate(() => {
      (window as unknown as { __restoreDateNow908?: () => void }).__restoreDateNow908?.();
    });
  }
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
  // The first write can become visible before a broken second concurrent write. Give the
  // local emulator a short quiescence window, then assert the complete durable invariant.
  await page.waitForTimeout(500);
  const executions = await readSessionExecutions(athlete);
  expect(executions).toHaveLength(1);
  expect(executions[0]?.state).toBe('in_progress');
});
