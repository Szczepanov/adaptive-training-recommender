import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import type { SessionDefinition, SessionExecution, ExecutionPrescription, SessionOccurrence } from '../../../src/sessions/models';
import type { ExternalPlanPlacement, NormalizedGarminActivity, ScheduleWindowManifest } from '../../../src/engine/models';
import type { PerformedTrainingOccurrence } from '../../../src/training-occurrence/models';
import { validateExternalPlanPlacement } from '../../../src/engine/validation';
import { validateScheduleWindowManifest } from '../../../src/engine/scheduleWindows';
import { parseNormalizedGarminActivity } from '../../../src/persistence/parsers/trainingHistory';
import { computeContentHash } from '../../../src/engine/externalPlanHash';
import { validateAnyExternalTrainingPlan } from '../../../src/sessions/externalPlanValidation';
import { EXTERNAL_PLAN_SCHEMA_V6, type ExternalTrainingPlanV6, type ExternalPlanSessionV6 } from '../../../src/sessions/externalPlanV6';
import { dismissOnboardingIfVisible, getAuthenticatedInspectorDb, withSecurityRulesDisabled, type E2EAthlete } from './athlete';
import { mondayOfWeek, seedExternalPlanningMode, weekdayOf } from './externalPlan';

export const strengthDefinition: SessionDefinition = JSON.parse(readFileSync(new URL('../../../src/sessions/fixtures/01-full-body-maintenance.json', import.meta.url), 'utf8'));

export function coachSession(date: string, overrides: Partial<ExternalPlanSessionV6> = {}): ExternalPlanSessionV6 {
  return {
    id: 'session-today', title: 'E2E coach strength', priority: 'key',
    placement: { week: 1, preferredDay: weekdayOf(date), flexibility: 'fixed', ifMissed: 'drop' },
    gating: { modality: 'strength', intensity: 'moderate', durationMin: 30, durationMax: 60, environment: 'either', equipment: [] },
    definition: structuredClone(strengthDefinition), ...overrides,
  };
}

export function buildV6Plan(date: string, overrides: Partial<ExternalTrainingPlanV6> = {}): ExternalTrainingPlanV6 {
  const plan: ExternalTrainingPlanV6 = {
    schema: EXTERNAL_PLAN_SCHEMA_V6, planId: `e2e-round-trip-${date}`, revision: 1,
    title: 'E2E coach round trip', startDate: mondayOfWeek(date), weekCount: 2,
    restDays: [], sessions: [coachSession(date)], ...overrides,
  };
  const parsed = validateAnyExternalTrainingPlan(plan);
  expect(parsed.errors, 'coach fixture must pass the app validator').toEqual([]);
  expect(parsed.isValid).toBe(true);
  return plan;
}

async function seed(athlete: E2EAthlete, write: (db: Firestore) => Promise<void>): Promise<void> {
  await withSecurityRulesDisabled(db => write(db));
}

/** Single-revision preconditions only; successor revisions must use the import UI. */
export async function seedExternalPlanRevision(athlete: E2EAthlete, plan: ExternalTrainingPlanV6, effectiveFrom: string): Promise<void> {
  expect(validateAnyExternalTrainingPlan(plan).isValid).toBe(true);
  expect(plan.revision).toBe(1);
  const contentHash = await computeContentHash(plan);
  const timestamp = `${effectiveFrom}T06:00:00.000Z`;
  await seed(athlete, async db => {
    await setDoc(doc(db, 'users', athlete.userId, 'external_plans', plan.planId), {
      userId: athlete.userId, planId: plan.planId, revision: 1, title: plan.title,
      startDate: plan.startDate, weekCount: plan.weekCount, contentHash,
      importedAt: timestamp, supersededFrom: null, updatedAt: timestamp,
    });
    await setDoc(doc(db, 'users', athlete.userId, 'external_plans', plan.planId, 'revisions', '1'), plan);
    await setDoc(doc(db, 'users', athlete.userId, 'external_plans', plan.planId, 'activations', '1'), {
      userId: athlete.userId, planId: plan.planId, revision: 1, contentHash, effectiveFrom, activatedAt: timestamp,
    });
  });
  await seedExternalPlanningMode(athlete);
}

export async function seedPlacement(athlete: E2EAthlete, placement: ExternalPlanPlacement): Promise<void> {
  const parsed = validateExternalPlanPlacement(placement);
  expect(parsed.errors).toEqual([]);
  expect(parsed.isValid).toBe(true);
  await seed(athlete, db => setDoc(doc(db, 'users', athlete.userId, 'external_plans', placement.planId, 'revisions', String(placement.revision), 'placement', 'current'), placement));
}

export async function seedBundleWindows(athlete: E2EAthlete, date: string): Promise<void> {
  const timestamp = `${date}T06:00:00.000Z`;
  const manifest: ScheduleWindowManifest = {
    userId: athlete.userId, date, revision: 1, createdAt: timestamp, updatedAt: timestamp,
    windows: [{ id: 'morning', userId: athlete.userId, date, revision: 1, startLocal: '00:00', endLocal: '12:00', createdAt: timestamp, updatedAt: timestamp }, { id: 'afternoon', userId: athlete.userId, date, revision: 1, startLocal: '12:00', endLocal: '23:59', createdAt: timestamp, updatedAt: timestamp }],
  };
  expect(validateScheduleWindowManifest(manifest).isValid).toBe(true);
  await seed(athlete, db => setDoc(doc(db, 'users', athlete.userId, 'schedule_window_manifests', date), manifest));
}

/** Authenticated reads keep the persisted linkage assertions behind the real user rules. */
export async function inspectAthlete<T>(athlete: E2EAthlete, read: (db: Firestore) => Promise<T>): Promise<T> {
  const db = await getAuthenticatedInspectorDb(athlete);
  return await read(db);
}

export function readDocument<T>(athlete: E2EAthlete, path: string): Promise<T | undefined> {
  return inspectAthlete(athlete, async db => (await getDoc(doc(db, `users/${athlete.userId}/${path}`))).data() as T | undefined);
}

export function readCollection<T>(athlete: E2EAthlete, path: string): Promise<T[]> {
  return inspectAthlete(athlete, async db => (await getDocs(collection(db, `users/${athlete.userId}/${path}`))).docs.map(item => item.data() as T));
}

export const readExecutionPrescription = (athlete: E2EAthlete, hash: string) => readDocument<ExecutionPrescription>(athlete, `execution_prescriptions/${hash}`);
export const readExecutions = (athlete: E2EAthlete) => readCollection<SessionExecution>(athlete, 'session_executions');
export const readOccurrences = (athlete: E2EAthlete) => readCollection<SessionOccurrence>(athlete, 'session_occurrences');
export async function readPerformedOccurrences(athlete: E2EAthlete, date: string): Promise<PerformedTrainingOccurrence[]> {
  return (await readCollection<PerformedTrainingOccurrence>(athlete, 'performedTrainingOccurrences')).filter(item => item.localDate === date && item.status === 'active');
}

export async function seedActivityForExecution(athlete: E2EAthlete, execution: SessionExecution): Promise<string> {
  expect(execution.completedAt).toBeTruthy();
  const id = `garmin-${execution.executionId}`;
  const activity: NormalizedGarminActivity = {
    activityId: id, date: execution.date, startedAt: execution.startedAt, endedAt: execution.completedAt!,
    type: 'strength_training', durationMin: (Date.parse(execution.completedAt!) - Date.parse(execution.startedAt)) / 60_000,
    trainingEffectAerobic: null, trainingEffectAnaerobic: null, averageHr: null, activityTrainingLoad: null, intensityTag: 'moderate',
  };
  expect(parseNormalizedGarminActivity(activity, `users/${athlete.userId}/activities/${id}`, id).status).toBe('AVAILABLE');
  await seed(athlete, db => setDoc(doc(db, 'users', athlete.userId, 'activities', id), activity));
  return id;
}

export async function previewPlan(page: Page, plan: ExternalTrainingPlanV6, effectiveFrom?: string): Promise<void> {
  await dismissOnboardingIfVisible(page, 200);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('button', { name: /Import Plan|Revise Plan/ }).click();
  await page.getByRole('textbox', { name: 'Plan JSON' }).fill(JSON.stringify(plan));
  await page.getByRole('button', { name: 'Validate and preview' }).click();
  if (effectiveFrom) await page.getByLabel('Effective from').fill(effectiveFrom);
  await expect(page.getByRole('button', { name: 'Import this plan' })).toBeVisible();
  await expect(page.getByText('Checking current plans, fixed activities, travel blocks, and authored sessions…')).toHaveCount(0);
}

export async function importPlan(page: Page, plan: ExternalTrainingPlanV6, effectiveFrom?: string): Promise<void> {
  await previewPlan(page, plan, effectiveFrom);
  for (const checkbox of await page.getByRole('region', { name: 'Plan preview', exact: true }).getByRole('checkbox').all()) await checkbox.check();
  await expect(page.getByRole('button', { name: 'Import this plan' })).toBeEnabled();
  await page.getByRole('button', { name: 'Import this plan' }).click();
  await expect(page.getByRole('heading', { name: `This week in ${plan.title}` })).toBeVisible();
}

export async function checkIn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Check-in', exact: true }).click();
  await dismissOnboardingIfVisible(page, 200);
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();
  await dismissOnboardingIfVisible(page, 200);
}

export async function planningBrief(page: Page): Promise<string> {
  await dismissOnboardingIfVisible(page, 200);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: '📤 Export Context for AI', exact: true }).click();
  await page.getByRole('button', { name: /Block Planning/ }).click();
  const brief = page.locator('textarea.brief-text');
  await expect.poll(() => brief.inputValue()).toContain('## External-plan execution round trip');
  return brief.inputValue();
}

export async function finishStrength(page: Page, abandon = false): Promise<void> {
  await page.getByLabel('Warm-up').uncheck();
  await page.getByRole('button', { name: 'Log repetition set' }).click();
  if (abandon) {
    await page.getByRole('button', { name: 'Abandon', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Abandon Session?' })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, Abandon Session', exact: true }).click();
  } else {
    await page.getByRole('button', { name: /Finish Session \(/ }).click();
    await page.getByRole('button', { name: 'Finish & Save Session', exact: true }).click();
  }
}

export async function terminalExecution(athlete: E2EAthlete, state = 'completed'): Promise<SessionExecution> {
  await expect.poll(async () => (await readExecutions(athlete)).filter(item => item.state === state).length).toBe(1);
  return (await readExecutions(athlete)).find(item => item.state === state)!;
}

export function executionRow(date: string, plan: ExternalTrainingPlanV6, execution: SessionExecution, performedId?: string, adjudication = 'as authored'): string {
  const source = execution.sessionSource as { sessionId: string };
  return `- ${date} ${plan.planId} r${plan.revision}/${source.sessionId}: placement as authored; adjudication ${adjudication}; athlete accepted; performance ${execution.state === 'abandoned' ? 'partial or abandoned' : 'completed'}; occurrence ${execution.occurrenceId}; execution ${execution.executionId}${performedId ? `; performed ${performedId}` : ''}; prescription ${execution.prescriptionHash}.`;
}
