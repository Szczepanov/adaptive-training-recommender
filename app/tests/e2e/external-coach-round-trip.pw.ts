import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  dismissOnboardingIfVisible,
  provisionAthlete,
  readSessionExecutions,
  seedRecoverySnapshot,
  signInThroughUi,
} from './support/athlete';
import { mondayOfWeek, seedExternalPlanningMode, weekdayOf } from './support/externalPlan';

const definition = JSON.parse(readFileSync(new URL('../../src/sessions/fixtures/01-full-body-maintenance.json', import.meta.url), 'utf8'));

test('a validated v6 coach plan launches, completes, and appears in the next planning brief', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const planId = `e2e-round-trip-${today}`;
  const sessionTitle = 'E2E coach strength';
  const plan = {
    schema: 'adaptive-training-recommender/external-plan@6',
    planId,
    revision: 1,
    title: 'E2E coach round trip',
    startDate: mondayOfWeek(today),
    weekCount: 1,
    restDays: [],
    sessions: [{
      id: 'session-today',
      title: sessionTitle,
      priority: 'key',
      placement: { week: 1, preferredDay: weekdayOf(today), flexibility: 'fixed', ifMissed: 'drop' },
      gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 60, environment: 'either', equipment: [] },
      definition,
  }],
  };

  await seedExternalPlanningMode(athlete);
  await signInThroughUi(page, athlete);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Export Context for AI/ }).click();
  await expect(page.getByRole('heading', { name: 'Export Context for AI' })).toBeVisible();
  const initialBlockPlanning = page.getByRole('button', { name: /Block Planning/ });
  await initialBlockPlanning.click();
  await expect(initialBlockPlanning).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => page.locator('textarea.brief-text').inputValue()).toContain('## External-plan execution round trip');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('button', { name: /Import Plan/ }).click();
  await page.getByRole('textbox', { name: 'Plan JSON' }).fill(JSON.stringify(plan));
  await page.getByRole('button', { name: 'Validate and preview' }).click();
  await expect(page.getByText('No overlap or placement consequences were found')).toBeVisible();
  await page.getByRole('button', { name: 'Import this plan' }).click();
  await expect(page.getByRole('heading', { name: 'This week in E2E coach round trip' })).toBeVisible();

  await page.getByRole('button', { name: 'Check-in', exact: true }).click();
  await dismissOnboardingIfVisible(page);
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(`Start ${sessionTitle}`) })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`Start ${sessionTitle}`) }).click();
  await page.getByLabel('Warm-up').uncheck();
  await page.getByRole('button', { name: 'Log repetition set' }).click();
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await expect(page.getByRole('dialog', { name: 'Complete Session' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();
  let executions = await readSessionExecutions(athlete);
  await expect.poll(async () => {
    executions = await readSessionExecutions(athlete);
    return executions.filter(item => item.state === 'completed').length;
  }).toBe(1);
  const execution = executions.find(item => item.state === 'completed');
  expect(execution?.sessionSource).toMatchObject({ kind: 'external_plan', planId, revision: 1, sessionId: 'session-today' });
  expect(execution?.occurrenceId).toBeTruthy();
  expect(execution?.prescriptionHash).toBeTruthy();

  await dismissOnboardingIfVisible(page);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Export Context for AI/ }).click();
  const blockPlanning = page.getByRole('button', { name: /Block Planning/ });
  await blockPlanning.click();
  await expect(blockPlanning).toHaveAttribute('aria-pressed', 'true');
  const brief = page.locator('textarea.brief-text');
  await expect.poll(() => brief.inputValue()).toContain('## External-plan execution round trip');
  const text = await brief.inputValue();
  expect(text).toContain(`${planId} r1/session-today`);
  expect(text).toContain(`occurrence ${execution?.occurrenceId}`);
  expect(text).toContain(`execution ${execution?.executionId}`);
  expect(text).toContain(`prescription ${execution?.prescriptionHash}`);
  expect(text).toContain('performance completed');
  expect(text).toMatch(/performed [a-zA-Z0-9_-]+/);
});
