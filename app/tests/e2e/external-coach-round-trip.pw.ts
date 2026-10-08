import { expect, test } from './support/test';
import { provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { seedExternalPlanningMode } from './support/externalPlan';
import { buildV6Plan, checkIn, previewPlan, planningBrief, finishStrength, terminalExecution, executionRow, awaitPerformedOccurrences, readPerformedOccurrences, seedActivityForExecution, readCollection, readDocument } from './support/roundTrip';
import type { SessionEntry } from '../../src/sessions/models';
import { addDaysToLocalDateString } from '../../src/utils/localDate';
import { parseDailyRecommendation } from '../../src/persistence/parsers/trainingHistory';

test('a validated v6 coach plan completes and Garmin enriches the same next-brief occurrence (V10)', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const plan = buildV6Plan(today);
  await seedExternalPlanningMode(athlete);
  await signInThroughUi(page, athlete);
  expect(await planningBrief(page)).toContain('## External-plan execution round trip');
  await previewPlan(page, plan);
  await page.getByText('Need the prompt template for your AI?').click();
  await expect(page.locator('.external-import-prompt-text')).toContainText('adaptive-training-recommender/external-plan@6');
  await page.getByRole('button', { name: 'Import this plan' }).click();
  await expect(page.getByRole('heading', { name: `This week in ${plan.title}` })).toBeVisible();
  await checkIn(page);
  await page.getByRole('button', { name: `Start ${plan.sessions[0].title}`, exact: true }).click();
  await finishStrength(page);
  const execution = await terminalExecution(athlete);
  expect(execution.sessionSource).toMatchObject({ kind: 'external_plan', planId: plan.planId, revision: 1, sessionId: 'session-today' });
  let text = await planningBrief(page);
  const [performed] = await awaitPerformedOccurrences(athlete, today, 1);
  expect(text).toContain(executionRow(today, plan, execution, performed.performedOccurrenceId));
  const activityId = await seedActivityForExecution(athlete, execution);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Data/ }).click();
  await page.getByRole('button', { name: 'Activities', exact: true }).click();
  // The canonical Activities read model is off by default in .env.e2e. Its
  // service-level fallback exercises real reconciliation without fabricating linkage.
  await page.evaluate(async ({ userId, today, through }) => {
    const modulePath = '/src/training-occurrence/canonicalActivitiesWindow.ts';
    const { loadCanonicalActivitiesWindow } = await import(/* @vite-ignore */ modulePath);
    await loadCanonicalActivitiesWindow(userId, today, through);
  }, { userId: athlete.userId, today, through: addDaysToLocalDateString(today, 1) });
  await expect.poll(async () => (await readPerformedOccurrences(athlete, today)).map(item => ({ id: item.performedOccurrenceId, refs: item.sourceRefs }))).toEqual([
    { id: performed.performedOccurrenceId, refs: expect.arrayContaining([
      expect.objectContaining({ kind: 'structured_execution', executionId: execution.executionId }),
      expect.objectContaining({ kind: 'provider_activity', activityId }),
    ]) },
  ]);
  text = await planningBrief(page);
  expect(text).toContain(executionRow(today, plan, execution, performed.performedOccurrenceId));
  const completedSection = text.split('Completed training (canonical performed occurrences)')[1]?.split('\n## ')[0];
  expect(completedSection).toBeDefined();
  expect(completedSection?.split('\n').filter(row => row.startsWith('| ') && row.includes(today))).toHaveLength(1);
});

test('V12 abandoned external execution retains logged evidence and exact next-brief ids', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const plan = buildV6Plan(today);
  await seedExternalPlanningMode(athlete);
  await signInThroughUi(page, athlete);
  await previewPlan(page, plan);
  await page.getByRole('button', { name: 'Import this plan' }).click();
  await expect(page.getByRole('heading', { name: `This week in ${plan.title}` })).toBeVisible();
  await checkIn(page);
  await page.getByRole('button', { name: `Start ${plan.sessions[0].title}`, exact: true }).click();
  await finishStrength(page, true);
  const execution = await terminalExecution(athlete, 'abandoned');
  const entries = await readCollection<SessionEntry>(athlete, `session_executions/${execution.executionId}/entries`);
  expect(entries).toHaveLength(1);
  expect(entries[0].payload).toMatchObject({ kind: 'repetition', isWarmup: false });
  const recommendation = await readDocument(athlete, `daily_recommendations/${today}`);
  expect(parseDailyRecommendation(recommendation, `users/${athlete.userId}/daily_recommendations/${today}`)).toMatchObject({ status: 'AVAILABLE' });
  expect(await planningBrief(page)).toContain(executionRow(today, plan, execution));
});
