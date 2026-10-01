import { expect, test } from '@playwright/test';
import { provisionAthlete, seedRecoverySnapshot, signInThroughUi } from './support/athlete';
import { seedExternalPlanningMode, mondayOfWeek } from './support/externalPlan';
import { buildV6Plan, coachSession, checkIn, importPlan, previewPlan, planningBrief, readDocument, seedExternalPlanRevision, seedPlacement } from './support/roundTrip';
import { addDaysToLocalDateString } from '../../src/utils/localDate';
import { validateExternalPlanPlacement } from '../../src/engine/validation';
import { validateAnyExternalTrainingPlan } from '../../src/sessions/externalPlanValidation';
import { applyConfirmedProposal, proposeReplacement } from '../../src/engine/externalPlacement';
import type { ExternalPlanPlacement } from '../../src/engine/models';

test('V1 non-advancing UI re-import preserves immutable revision and activation', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const plan = buildV6Plan(today);
  await seedExternalPlanningMode(athlete);
  await signInThroughUi(page, athlete);
  await importPlan(page, plan);
  const path = `external_plans/${plan.planId}`;
  const header = await readDocument(athlete, path);
  expect(header).toMatchObject({ planId: plan.planId, revision: 1 });
  const revision = await readDocument(athlete, `${path}/revisions/1`);
  const activation = await readDocument(athlete, `${path}/activations/1`);
  expect(revision).toEqual(plan);
  expect(activation).toMatchObject({ revision: 1, effectiveFrom: today });
  await previewPlan(page, plan);
  await expect(page.getByText(/does not advance the stored revision/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import this plan' })).toBeDisabled();
  expect(await readDocument(athlete, `${path}/revisions/1`)).toEqual(revision);
  expect(await readDocument(athlete, `${path}/activations/1`)).toEqual(activation);
  expect(await readDocument(athlete, path)).toEqual(header);
});

for (const effective of ['tomorrow', 'today'] as const) {
  test(`V2 ${effective}-effective successor preserves the revision boundary`, async ({ page }) => {
    const athlete = await provisionAthlete();
    const today = await seedRecoverySnapshot(athlete);
    const tomorrow = addDaysToLocalDateString(today, 1);
    const plan = buildV6Plan(today);
    await seedExternalPlanningMode(athlete);
    await signInThroughUi(page, athlete);
    await importPlan(page, plan);
    const successor = buildV6Plan(today, { revision: 2, sessions: [coachSession(today, { title: 'R2 today' }), coachSession(tomorrow, { id: 'session-tomorrow', title: 'R2 tomorrow', placement: { ...coachSession(tomorrow).placement, week: mondayOfWeek(tomorrow) === plan.startDate ? 1 : 2 } })] });
    await importPlan(page, successor, effective === 'tomorrow' ? tomorrow : today);
    await checkIn(page);
    const revision = effective === 'tomorrow' ? 1 : 2;
    await expect(page.getByRole('region', { name: 'Imported plan session' })).toContainText(`${plan.planId} (revision ${revision})`);
    const text = await planningBrief(page);
    expect(text).toContain(`${today} ${plan.planId} r${revision}/session-today:`);
    expect(await readDocument(athlete, `external_plans/${plan.planId}/activations/2`)).toMatchObject({ revision: 2, effectiveFrom: effective === 'tomorrow' ? tomorrow : today });
  });
}

test('V3 revision-scoped move onto today survives a future successor import', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const yesterday = addDaysToLocalDateString(today, -1);
  const plan = buildV6Plan(yesterday, { sessions: [coachSession(yesterday, { placement: { ...coachSession(yesterday).placement, flexibility: 'preferred', ifMissed: 'carry_forward' } })] });
  await seedExternalPlanRevision(athlete, plan, yesterday);
  // PlanView only renders today..today+6. Yesterday's authored row has no UI move
  // control, so the closeout plan's validated-overlay fallback is necessary.
  const proposal = proposeReplacement(plan, null, 'session-today', yesterday, {}, today);
  expect(proposal).toMatchObject({ outcome: 'rescheduled', date: today });
  const placement: ExternalPlanPlacement = applyConfirmedProposal({
    userId: athlete.userId, planId: plan.planId, revision: 1,
    assignments: [],
    updatedAt: `${today}T06:00:00.000Z`,
  }, proposal);
  await seedPlacement(athlete, placement);
  await signInThroughUi(page, athlete);
  expect(await planningBrief(page)).toContain(`- ${today} ${plan.planId} r1/session-today: placement intentionally moved; adjudication not adjudicated; athlete none; performance unknown.`);
  await importPlan(page, buildV6Plan(yesterday, { planId: plan.planId, revision: 2, sessions: plan.sessions }), addDaysToLocalDateString(today, 1));
  const stored = await readDocument(athlete, `external_plans/${plan.planId}/revisions/1/placement/current`);
  expect(validateExternalPlanPlacement(stored).isValid).toBe(true);
  expect(stored).toEqual(placement);
  expect(await planningBrief(page)).toContain(`- ${today} ${plan.planId} r1/session-today: placement intentionally moved; adjudication not adjudicated; athlete none; performance unknown.`);
});

test('concurrent successor imports converge to one deterministic latest revision', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete);
  const plan = buildV6Plan(today);
  await seedExternalPlanningMode(athlete);
  await signInThroughUi(page, athlete);
  await importPlan(page, plan);
  const successors = [2, 3].map(revision => buildV6Plan(today, { revision }));
  const results = await page.evaluate(async ({ userId, successors, today }) => {
    const modulePath = '/src/services/externalPlanService.ts';
    const { externalPlanService } = await import(/* @vite-ignore */ modulePath);
    return Promise.all(successors.map(plan => externalPlanService.import(userId, plan, today)));
  }, { userId: athlete.userId, successors, today });
  expect(results[1].status).toBe('AVAILABLE');
  expect(['AVAILABLE', 'INVALID']).toContain(results[0].status);
  if (results[0].status === 'INVALID') expect(results[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'revision-not-newer' })]));
  expect(await readDocument(athlete, `external_plans/${plan.planId}`)).toMatchObject({ revision: 3 });
  expect(await readDocument(athlete, `external_plans/${plan.planId}/revisions/3`)).toEqual(successors[1]);
  expect(await readDocument(athlete, `external_plans/${plan.planId}/activations/3`)).toMatchObject({ revision: 3, effectiveFrom: today });
});

test('invalid enum, date, full and reduced definitions fail at exact contract paths', () => {
  const plan = buildV6Plan('2026-09-30');
  for (const [mutate, field] of [
    [(p: typeof plan) => { p.startDate = '2026-02-30'; }, 'startDate'],
    [(p: typeof plan) => { p.sessions[0].gating.intensity = 'invented' as never; }, 'sessions[0].gating.intensity'],
    [(p: typeof plan) => { p.sessions[0].definition.intent = 'invented' as never; }, 'sessions[0].definition.intent'],
    [(p: typeof plan) => { p.sessions[0].scaling = { reducible: true, reducedDefinition: { ...p.sessions[0].definition, intent: 'recovery' } }; }, 'sessions[0].scaling.reducedDefinition.intent'],
  ] as const) {
    const invalid = structuredClone(plan);
    mutate(invalid);
    const result = validateAnyExternalTrainingPlan(invalid);
    expect(result.isValid).toBe(false);
    expect(result.errors.map(error => error.field)).toContain(field);
  }
});
