import { collection, getDocs } from 'firebase/firestore';
import type { Page } from '@playwright/test';
import { expect, test } from './support/test';
import { inspectAthlete } from './support/emulator';
import {
  openFixturePicker,
  provisionAthlete,
  readSessionExecutions,
  readSessionRestEvents,
  signInThroughUi,
} from './support/athlete';

type ResyncSignal = 'visibilitychange' | 'focus';

/**
 * Simulates a backgrounded tab: the page's wall clock jumps `jumpMs` ahead with no interval
 * callback firing in between, then `signals` fire in order as the tab comes back. Returns a
 * restore for the real clock, to call from `finally`.
 */
async function jumpWallClock(page: Page, jumpMs: number, signals: ResyncSignal[]): Promise<() => Promise<void>> {
  await page.evaluate(({ jumpMs, signals }) => {
    const realNow = Date.now;
    Date.now = () => realNow() + jumpMs;
    (window as unknown as { __restoreDateNow908?: () => void }).__restoreDateNow908 = () => {
      Date.now = realNow;
    };
    for (const signal of signals) {
      if (signal === 'focus') window.dispatchEvent(new Event('focus'));
      else document.dispatchEvent(new Event('visibilitychange'));
    }
  }, { jumpMs, signals });
  return async () => {
    await page.evaluate(() => {
      (window as unknown as { __restoreDateNow908?: () => void }).__restoreDateNow908?.();
    });
  };
}

for (const feedback of ['untouched', 'answered', 'cleared'] as const) {
  test(`completion preserves ${feedback} subjective evidence after reload (#896)`, async ({ page }) => {
    const athlete = await provisionAthlete();
    await signInThroughUi(page, athlete);
    await openFixturePicker(page);
    await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();
    await page.getByRole('button', { name: /Finish Session \(/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Complete Session' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Incomplete Required Steps/)).toBeVisible();
    await expect(sheet.locator('option[value="1"]')).toBeDisabled();
    const effort = sheet.getByRole('group', { name: 'Whole-session effort' }).getByRole('button', { name: '3', exact: true });
    const fatigue = sheet.getByRole('group', { name: /Unexpected fatigue/ }).getByRole('button', { name: 'No', exact: true });
    const fraction = sheet.getByLabel('How much of the planned session did you complete?');
    if (feedback !== 'untouched') {
      await effort.click();
      await fatigue.click();
      await fraction.selectOption('0.75');
    }
    if (feedback === 'cleared') {
      await effort.click();
      await fatigue.click();
      await fraction.selectOption('');
    }
    await sheet.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();
    await expect.poll(async () => (await readSessionExecutions(athlete)).filter(execution => execution.state === 'completed').length).toBe(1);

    const readStored = () => inspectAthlete(athlete, async db => {
      const [executions, responses] = await Promise.all([
        getDocs(collection(db, 'users', athlete.userId, 'session_executions')),
        getDocs(collection(db, 'users', athlete.userId, 'session_responses')),
      ]);
      return { executions: executions.docs.map(item => item.data()), responses: responses.docs.map(item => item.data()) };
    });
    if (feedback === 'answered') await expect.poll(async () => (await readStored()).responses.length).toBe(1);
    await page.reload();
    const stored = await readStored();
    expect(stored.executions).toHaveLength(1);
    const [execution] = stored.executions;
    expect(execution.completionEvidence.submittedAt).toEqual(expect.any(String));
    if (feedback === 'answered') {
      expect(execution.sessionRpe).toBe(3);
      expect(execution.completionEvidence).toMatchObject({ sessionRpe: 3, completedFraction: 0.75, unexpectedFatigue: false });
      expect(stored.responses).toHaveLength(1);
      expect(stored.responses[0]).toMatchObject({ sessionRpe: 3, completedFraction: 0.75, unexpectedFatigue: false });
    } else {
      expect(execution).not.toHaveProperty('sessionRpe');
      expect(Object.keys(execution.completionEvidence)).toEqual(['submittedAt']);
      expect(stored.responses).toEqual([]);
    }
  });
}

test('completion actions preserve the live workout until abandonment is confirmed', async ({ page }) => {
  const athlete = await provisionAthlete();
  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();
  await page.getByRole('button', { name: 'Log repetition set' }).click();

  const finish = page.getByRole('button', { name: /Finish Session \(/ });
  const sheet = page.getByRole('dialog', { name: 'Complete Session' });
  const notes = sheet.getByRole('textbox', { name: /Session Notes/ });
  const abandon = page.getByRole('dialog', { name: 'Abandon Session?' });
  const template = page.getByRole('dialog', { name: 'Save as Custom Template' });
  const openTemplate = sheet.getByRole('button', { name: 'Save as template' });
  const templateTitle = 'Completion wiring template';

  await finish.click();
  await sheet.getByRole('button', { name: 'Keep Training' }).click();
  await expect(finish).toBeFocused();
  await finish.click();
  await notes.fill('Keep this draft through the dialogs.');

  await openTemplate.click();
  await expect(sheet).toBeHidden();
  await expect(template.getByRole('textbox', { name: 'Template Title' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(template).toBeHidden();
  await expect(openTemplate).toBeFocused();
  await expect(notes).toHaveValue('Keep this draft through the dialogs.');

  await openTemplate.click();
  await template.getByRole('textbox', { name: 'Template Title' }).fill(templateTitle);
  await template.getByRole('button', { name: 'Save Template', exact: true }).click();
  await expect(template.getByRole('status')).toContainText(templateTitle);
  await expect(notes).toHaveValue('Keep this draft through the dialogs.');
  const savedTitles = await inspectAthlete(athlete, async db => {
    const definitions = await getDocs(collection(db, 'users', athlete.userId, 'session_definitions'));
    return definitions.docs.map(definition => definition.data().title);
  });
  expect(savedTitles).toContain(templateTitle);

  await sheet.getByRole('button', { name: 'Abandon Session...' }).click();
  await abandon.getByRole('button', { name: 'Go Back' }).click();
  await expect(notes).toHaveValue('Keep this draft through the dialogs.');
  const [active] = await readSessionExecutions(athlete);
  expect(active.state).toBe('in_progress');

  await sheet.getByRole('button', { name: 'Abandon Session...' }).click();
  await abandon.getByRole('button', { name: 'Yes, Abandon Session' }).click();
  await expect(abandon).toBeHidden();
  await expect.poll(async () => (await readSessionExecutions(athlete))[0]?.state).toBe('abandoned');
  const retainedEntryCount = await inspectAthlete(athlete, async db => {
    const entries = await getDocs(collection(db, 'users', athlete.userId, 'session_executions', active.executionId, 'entries'));
    return entries.size;
  });
  expect(retainedEntryCount).toBe(1);
});

test('the live session clock is wall-clock correct after a background-style time jump (#908)', async ({ page }) => {
  const athlete = await provisionAthlete();

  await signInThroughUi(page, athlete);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();

  const timer = page.locator('.session-timer');
  await expect(timer).toBeVisible();

  // The wall clock jumps five minutes, then the tab becomes visible again. The wall-clock
  // runner must show the jumped value on resync; a callback-counting clock would still read
  // near zero.
  const restoreClock = await jumpWallClock(page, 5 * 60 * 1000, ['visibilitychange']);
  try {
    await expect(timer).toContainText('5:', { timeout: 10_000 });
  } finally {
    await restoreClock();
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

  // Real browsers commonly deliver visibilitychange and focus close together. Repeating both
  // signals within one synchronous turn proves the first expired-rest resync consumes the
  // active rest synchronously and later resyncs cannot persist it again.
  const restoreClock = await jumpWallClock(page, 5 * 60 * 1000, ['visibilitychange', 'focus', 'visibilitychange']);
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
    await restoreClock();
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
