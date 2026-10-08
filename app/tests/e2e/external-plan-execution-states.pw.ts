import type { Page } from '@playwright/test';
import { expect, test } from './support/consoleTrap';
import { provisionAthlete, seedRecoverySnapshot, signInThroughUi, openFixturePicker } from './support/athlete';
import { mondayOfWeek, weekdayOf, seedExternalPlanForToday, seedExternalPlanningMode } from './support/externalPlan';
import { buildV6Plan, coachSession, strengthDefinition, seedExternalPlanRevision, seedPlacement, seedBundleWindows, importPlan, checkIn, planningBrief, finishStrength, terminalExecution, executionRow, readExecutionPrescription, readPerformedOccurrences, readExecutions, readOccurrences, readDocument } from './support/roundTrip';
import { addDaysToLocalDateString } from '../../src/utils/localDate';
import { hashSessionDefinition } from '../../src/sessions/sessionDefinitionHash';
import { resolvePlacement } from '../../src/engine/externalPlacement';
import type { SessionDefinition } from '../../src/sessions/models';
import { parseDailyRecommendation } from '../../src/persistence/parsers/trainingHistory';

// Fixed in #949 (Home starts the prepared exact v6 reduced binding under scale)
test('V4 scale freezes the exact reduced definition and reports app dose modified', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete, { bodyBatteryWake: 25 });
  const full: SessionDefinition = {
    schemaVersion: 1, id: 'scaled-spin', revision: 1, title: 'Scaled spin', intent: 'training', dominantModality: 'cycling', duration: { min: 45, max: 45 },
    blocks: [{ id: 'main', role: 'main', executionMode: 'sequential', steps: [{ id: 'ride', kind: 'exercise', title: 'Ride', exerciseRef: { kind: 'catalog', exerciseId: 'cycling-work' }, dose: { kind: 'duration', seconds: 2700 } }] }],
  };
  const reduced = structuredClone(full);
  reduced.duration = { min: 5, max: 5 };
  reduced.blocks[0].steps[0] = { ...reduced.blocks[0].steps[0], dose: { kind: 'duration', seconds: 300 } } as typeof reduced.blocks[0]['steps'][number];
  const plan = buildV6Plan(today, { sessions: [coachSession(today, {
    title: 'Scaled spin', definition: full,
    gating: { modality: 'cycling', intensity: 'hard', durationMin: 45, durationMax: 45, environment: 'either', equipment: [] },
    scaling: { reducible: true, reducedSummary: 'Five minutes only', minimumUsefulDurationMin: 5, reducedDefinition: reduced },
  })] });
  await seedExternalPlanningMode(athlete);
  await signInThroughUi(page, athlete);
  await importPlan(page, plan);
  await checkIn(page);
  await expect(page.getByRole('region', { name: 'Imported plan session' })).toContainText('Do the reduced version');
  await page.getByRole('button', { name: 'Start Scaled spin', exact: true }).click();
  await page.getByRole('button', { name: 'Log hold', exact: true }).click();
  await page.getByRole('button', { name: /Finish Session \(/ }).click();
  await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();
  const execution = await terminalExecution(athlete);
  const prescription = await readExecutionPrescription(athlete, execution.prescriptionHash!);
  const reducedHash = await hashSessionDefinition({ ...reduced, id: 'session-today', revision: 1 });
  const fullHash = await hashSessionDefinition({ ...full, id: 'session-today', revision: 1 });
  expect(prescription?.definitionHash).toBe(reducedHash);
  expect(prescription?.definitionHash).not.toBe(fullHash);
  const text = await planningBrief(page);
  const [performed] = await readPerformedOccurrences(athlete, today);
  expect(text).toContain(executionRow(today, plan, execution, performed.performedOccurrenceId, 'app dose modified'));
});

test('V6 authored rest records unexpected work without inventing an authored session', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const tomorrow = addDaysToLocalDateString(today, 1);
  const plan = buildV6Plan(today, { sessions: [coachSession(tomorrow, { placement: { ...coachSession(tomorrow).placement, week: mondayOfWeek(tomorrow) === mondayOfWeek(today) ? 1 : 2 } })], restDays: [{ id: 'rest-today', week: 1, day: weekdayOf(today) }] });
  await seedExternalPlanRevision(athlete, plan, today);
  await signInThroughUi(page, athlete);
  await checkIn(page);
  await expect(page.getByRole('button', { name: /^Start / })).toHaveCount(0);
  const row = `- ${today} ${plan.planId} r1 rest/rest-today: placement unknown; adjudication not adjudicated; athlete none; performance not applicable.`;
  expect(await planningBrief(page)).toContain(row);
  await openFixturePicker(page);
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().click();
  await finishStrength(page);
  await terminalExecution(athlete);
  const text = await planningBrief(page);
  const [performed] = await readPerformedOccurrences(athlete, today);
  expect(text).toContain(`${row} Authored rest/no session; observed work: ${performed.performedOccurrenceId}.`);
});

test('V6 an active plan with no authored session today renders no row for today', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const tomorrow = addDaysToLocalDateString(today, 1);
  const plan = buildV6Plan(today, { sessions: [coachSession(tomorrow, { placement: { ...coachSession(tomorrow).placement, week: mondayOfWeek(tomorrow) === mondayOfWeek(today) ? 1 : 2 } })] });
  await seedExternalPlanRevision(athlete, plan, today);
  await signInThroughUi(page, athlete);
  expect((await planningBrief(page)).split('\n').filter(row => row.startsWith(`- ${today} ${plan.planId} r`))).toEqual([]);
});

// Fixed in #953 (D1 catalog fingerprint binding in recommendation write)
test('V7 a gate replacement has exact labels and creates no external occurrence', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const seed = await seedExternalPlanForToday(athlete, 'skip');
  await signInThroughUi(page, athlete);
  await checkIn(page);
  await expect(page.getByRole('button', { name: /Start E2E overlong ride/ })).toHaveCount(0);
  await expect.poll(() => readDocument(athlete, `daily_recommendations/${today}`)).toBeDefined();
  expect(await planningBrief(page)).toContain(`- ${today} ${seed.planId} r1/today-session: placement unknown; adjudication gate replaced; athlete none; performance unknown.`);
  expect(await readOccurrences(athlete)).toEqual([]);
});

async function importManualDefinition(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Sessions/ }).click();
  await page.getByRole('button', { name: '＋ New session', exact: true }).click();
  await page.getByRole('button', { name: /Import JSON/ }).click();
  await page.getByLabel('Session definition or Workout Export JSON').fill(JSON.stringify(strengthDefinition));
  await page.getByRole('button', { name: 'Validate & preview', exact: true }).click();
  await page.getByRole('button', { name: 'Save / Schedule / Replace...', exact: true }).click();
}

test('V8 UI manual replacement names its exact replacement occurrence', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const plan = buildV6Plan(today);
  await seedExternalPlanRevision(athlete, plan, today);
  // Replacement attribution requires a readable, exact singleton placement,
  // independently of the occurrence lifecycle and same-date authored placement.
  await seedPlacement(athlete, {
    userId: athlete.userId, planId: plan.planId, revision: plan.revision,
    assignments: resolvePlacement(plan, null).map(item => ({ sessionId: item.session.id, date: item.date, status: item.status })),
    updatedAt: `${today}T06:00:00.000Z`,
  });
  await signInThroughUi(page, athlete);
  await checkIn(page);
  await expect(page.getByRole('button', { name: `Start ${plan.sessions[0].title}`, exact: true })).toBeVisible();
  // JSON import is the current UI route to SessionDestinationSheet; fixture and
  // catalog direct-Start previews do not expose this sheet.
  await importManualDefinition(page);
  await page.getByRole('radio', { name: /Replace today’s recommendation/ }).check();
  await page.getByRole('button', { name: 'Save & replace today', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: `Start ${strengthDefinition.title}`, exact: true })).toBeVisible();
  const occurrences = await readOccurrences(athlete);
  const replacement = occurrences.find(item => item.authority === 'replace_recommendation');
  const displaced = occurrences.find(item => item.authority === 'external_plan');
  expect(replacement).toBeTruthy();
  expect(displaced).toMatchObject({ state: 'superseded' });
  await page.getByRole('button', { name: `Start ${strengthDefinition.title}`, exact: true }).click();
  await finishStrength(page);
  await terminalExecution(athlete);
  const replacementRows = (await planningBrief(page)).split('\n').filter(row => row.startsWith(`- ${today} ${plan.planId} r1/session-today:`));
  expect(replacementRows).toEqual([`- ${today} ${plan.planId} r1/session-today: placement as authored; adjudication unknown; athlete manually replaced; performance unknown; occurrence ${displaced!.occurrenceId}; replaced by occurrence ${replacement!.occurrenceId}.`]);
  expect((await readExecutions(athlete)).filter(item => item.sessionSource.kind === 'external_plan')).toEqual([]);
});

test('V9 plain fixed same-day sessions retain two distinct next-brief rows', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const plan = buildV6Plan(today, { sessions: [coachSession(today, { id: 'primary' }), coachSession(today, { id: 'second', priority: 'supporting' })] });
  expect(resolvePlacement(plan, null).map(item => item.date)).toEqual([today, today]);
  await seedExternalPlanRevision(athlete, plan, today);
  await signInThroughUi(page, athlete);
  const text = await planningBrief(page);
  for (const session of plan.sessions) {
    expect(text).toContain(`- ${today} ${plan.planId} r1/${session.id}: placement unknown; adjudication not adjudicated; athlete none; performance unknown.`);
  }
  expect(text.split('\n').filter(row => row.startsWith(`- ${today} ${plan.planId} r1/`))).toHaveLength(2);
  expect(await readExecutions(athlete)).toEqual([]);
});

test('V9 an intraday bundle retains two session rows and two genuine workouts', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const shortDefinition = structuredClone(strengthDefinition);
  shortDefinition.duration = { min: 10, max: 15 };
  shortDefinition.blocks = [{ ...shortDefinition.blocks[0], executionMode: 'sequential', steps: [shortDefinition.blocks[0].steps[0]] }];
  const sessions = [coachSession(today, { id: 'primary', title: 'Bundle primary', definition: shortDefinition }), coachSession(today, { id: 'second', title: 'Bundle second', priority: 'supporting', definition: shortDefinition })];
  // Fixed sessions already share the date; the bundle supplies the supported
  // secondary launch path, which two unrelated fixed sessions do not provide.
  const plain = buildV6Plan(today, { sessions });
  expect(resolvePlacement(plain, null).map(item => item.date)).toEqual([today, today]);
  const plan = buildV6Plan(today, { sessions: sessions.map((session, order) => ({
    ...session, gating: { ...session.gating, intensity: 'easy', durationMin: 10, durationMax: 15 },
    intraday: { bundleId: 'two-sessions', order, window: order === 0 ? { startLocal: '00:00', endLocal: '12:00' } : { startLocal: '12:00', endLocal: '23:59' } },
  })) });
  await seedExternalPlanRevision(athlete, plan, today);
  await seedBundleWindows(athlete, today);
  await signInThroughUi(page, athlete);
  await checkIn(page);
  await expect.poll(() => readDocument(athlete, `daily_recommendations/${today}`)).toBeDefined();
  const persisted = await readDocument(athlete, `daily_recommendations/${today}`);
  const parsed = parseDailyRecommendation(persisted, `users/${athlete.userId}/daily_recommendations/${today}`);
  expect(parsed, 'the app must read back its own bundle recommendation').toMatchObject({ status: 'AVAILABLE' });
  expect(await readDocument(athlete, `intraday_bundle_placements/${today}`), 'bundle placement must be feasible before either member starts')
    .toMatchObject({ outcome: 'placed' });
  expect((await readOccurrences(athlete)).find(item => item.authority === 'external_plan' && item.externalPlanRef.sessionId === 'primary'))
    .toMatchObject({ placementOrder: 0, windowBinding: { bundleId: 'two-sessions', order: 0 } });
  await page.getByRole('button', { name: 'Start Bundle primary', exact: true }).click();
  await finishStrength(page);
  const primary = await terminalExecution(athlete);
  const text = await planningBrief(page);
  expect(text).toContain(`${today} ${plan.planId} r1/primary:`);
  expect(text).toContain(`- ${today} ${plan.planId} r1/second: placement as authored; adjudication not adjudicated; athlete none; performance unknown; occurrence `);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('region', { name: 'Additional sessions today' }).getByRole('button', { name: 'Start', exact: true }).click();
  await finishStrength(page);
  await expect.poll(async () => (await readExecutions(athlete)).filter(item => item.state === 'completed').length).toBe(2);
  const finalBrief = await planningBrief(page);
  const executions = await readExecutions(athlete);
  expect(executions.map(item => item.sessionSource)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'external_plan', planId: plan.planId, revision: 1, sessionId: 'primary' }),
    expect.objectContaining({ kind: 'external_plan', planId: plan.planId, revision: 1, sessionId: 'second' }),
  ]));
  expect(new Set(executions.map(item => item.occurrenceId)).size).toBe(2);
  const performed = await readPerformedOccurrences(athlete, today);
  expect(performed).toHaveLength(2);
  expect(new Set(performed.map(item => item.performedOccurrenceId)).size).toBe(2);
  for (const execution of executions) {
    const item = performed.find(item => item.sourceRefs.some(ref => ref.kind === 'structured_execution' && ref.executionId === execution.executionId));
    expect(item).toBeTruthy();
    const source = execution.sessionSource as { sessionId: string };
    expect(finalBrief).toContain(executionRow(today, plan, execution, item!.performedOccurrenceId, source.sessionId === 'primary' ? 'as authored' : 'not adjudicated'));
  }
  expect(executions.map(item => item.executionId)).toContain(primary.executionId);
});
