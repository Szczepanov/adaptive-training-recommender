import { doc, setDoc } from 'firebase/firestore';
import { expect, test } from './support/test';
import {
  dismissOnboardingIfVisible,
  provisionAthlete,
  seedRecoverySnapshot,
  signInThroughUi,
  submitTypicalCheckin,
  type E2EAthlete,
} from './support/athlete';
import { seedWithRulesDisabled } from './support/emulator';
import {
  buildV6Plan,
  coachSession,
  finishStrength,
  readExecutions,
  seedExternalPlanRevision,
  strengthDefinition,
} from './support/roundTrip';

async function seedLedgerModePreferences(athlete: E2EAthlete, date: string): Promise<void> {
  const timestamp = `${date}T06:00:00.000Z`;
  await seedWithRulesDisabled(db =>
    setDoc(doc(db, 'users', athlete.userId, 'preferences', 'profile'), {
      userId: athlete.userId,
      preferredRecoveryStyle: 'mixed',
      defaultWeekdayTimeMin: 45,
      defaultWeekendTimeMin: 60,
      preferredTimeOfDay: 'flexible',
      preferredModalities: [],
      deprioritizedModalities: [],
      avoidedModalities: [],
      unavailableModalities: [],
      explanationVerbosity: 'detailed',
      conservativeBias: false,
      shadowModeEnabled: false,
      engineRecommendationsEnabled: false,
      preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' },
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
}

test('ledger mode launches authored definition by default and reducedDefinition only on explicit choice, recording executedDefinition', async ({ page }) => {
  const athlete = await provisionAthlete();
  // Low readiness values prove LedgerTodayCard never auto-selects reducedDefinition from readiness.
  const today = await seedRecoverySnapshot(athlete, { sleepScore: 40, bodyBatteryWake: 20, hrvOvernightAvg: 35 });
  await seedLedgerModePreferences(athlete, today);

  const reducedDefinition = {
    ...structuredClone(strengthDefinition),
    title: 'E2E coach strength (Reduced)',
    summary: 'Reduced maintenance strength.',
    duration: { min: 15, max: 25 },
    blocks: structuredClone(strengthDefinition.blocks.slice(0, 2)),
  };
  const session = coachSession(today, {
    scaling: {
      reducible: true,
      reducedSummary: 'Cut volume in half.',
      reducedDefinition,
    },
  });
  const plan = buildV6Plan(today, { sessions: [session] });
  await seedExternalPlanRevision(athlete, plan, today);

  await signInThroughUi(page, athlete);
  await dismissOnboardingIfVisible(page, 200);
  await submitTypicalCheckin(page);
  await dismissOnboardingIfVisible(page, 200);

  // Positive LedgerTodayCard anchor, and MorningDecisionCard must not render in ledger mode.
  await expect(page.getByRole('region', { name: "Today's training plan" })).toBeVisible();
  await expect(page.getByLabel("Today's Morning Training Decision")).toHaveCount(0);

  // 1. Default Start launches authored definition and records executedDefinition: 'authored'.
  await page.getByRole('button', { name: `Start ${session.title}`, exact: true }).click();
  await finishStrength(page);

  await expect.poll(async () => (await readExecutions(athlete)).filter(e => e.state === 'completed').length).toBe(1);
  const firstExecs = await readExecutions(athlete);
  expect(firstExecs[0].executedDefinition).toBe('authored');

  // 2. Explicit Start reduced version launches reducedDefinition and records executedDefinition: 'reduced'.
  await expect(page.getByRole('region', { name: "Today's training plan" })).toBeVisible();
  await expect(page.getByRole('button', { name: `Redo ${session.title}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Start reduced version of ${session.title}`, exact: true }).click();
  await expect(page).toHaveURL(/\?screen=sessions$/);
  await finishStrength(page);

  await expect.poll(async () => (await readExecutions(athlete)).filter(e => e.state === 'completed').length).toBe(2);
  const allExecs = await readExecutions(athlete);
  const definitions = allExecs.map(e => e.executedDefinition).sort();
  expect(definitions).toEqual(['authored', 'reduced']);
});

test('ledger mode displays active injury_constraint_touches_session flag on LedgerTodayCard and still starts as authored', async ({ page }) => {
  const athlete = await provisionAthlete();
  const today = await seedRecoverySnapshot(athlete, { sleepScore: 78, bodyBatteryWake: 72, hrvOvernightAvg: 55 });
  await seedLedgerModePreferences(athlete, today);

  const timestamp = `${today}T06:00:00.000Z`;
  await seedWithRulesDisabled(db =>
    setDoc(doc(db, 'users', athlete.userId, 'trainingSettings', 'profile'), {
      userId: athlete.userId,
      schemaVersion: 3,
      equipment: { free_weights: true, cable_machine: false, treadmill: false, indoor_bike: false, pullup_bar: false, outdoor_bike: false, swim_access: false },
      guardrails: { avoid_high_impact: false, avoid_heavy_lower_body: false, avoid_overhead_pressing: false, avoid_heavy_spinal_loading: false },
      injuries: [
        {
          region: 'knee',
          severity: 'limit',
          restrictedModalities: ['Strength'],
          notes: 'E2E knee constraint',
        },
      ],
      defaults: { weekdayMaxMinutes: null, weekendMaxMinutes: null, environment: 'either' },
      preferences: { preferActiveRecovery: false },
      migration: { legacyReviewed: true, migratedAt: null },
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );

  const session = coachSession(today);
  const plan = buildV6Plan(today, { sessions: [session] });
  await seedExternalPlanRevision(athlete, plan, today);

  await signInThroughUi(page, athlete);
  await dismissOnboardingIfVisible(page, 200);
  await submitTypicalCheckin(page);
  await dismissOnboardingIfVisible(page, 200);

  const flagStrip = page.getByRole('region', { name: 'Safety & readiness flags' });
  await expect(flagStrip).toBeVisible();
  await expect(flagStrip).toContainText('Injury constraint touches session');
  await expect(flagStrip).toContainText('Active (true)');
  await expect(flagStrip).toContainText('Not yet supported (HA7 withheld)');

  // D-FLAGS: active injury flag never blocks or re-doses the authored session.
  await page.getByRole('button', { name: `Start ${session.title}`, exact: true }).click();
  await finishStrength(page);

  await expect.poll(async () => (await readExecutions(athlete)).filter(e => e.state === 'completed').length).toBe(1);
  const execs = await readExecutions(athlete);
  expect(execs[0].executedDefinition).toBe('authored');
});
