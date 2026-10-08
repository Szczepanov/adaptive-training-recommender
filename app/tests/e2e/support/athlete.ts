import { randomUUID } from 'node:crypto';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { expect, type Page } from '@playwright/test';
import { getLocalDateString } from '../../../src/utils/localDate';
import { AUTH_EMULATOR_URL, inspectAthlete, seedWithRulesDisabled } from './emulator';

const password = 'E2ePassword!42';

export interface E2EAthlete {
  email: string;
  password: string;
  userId: string;
}

export interface PersistedSessionExecution {
  executionId: string;
  state: string;
  occurrenceId?: string;
  sessionSource?: { kind?: string; planId?: string; revision?: number; sessionId?: string; contentHash?: string };
  prescriptionHash?: string;
}

export interface PersistedSessionRestEvent {
  id: string;
  executionId: string;
  endReason: string;
  actualSeconds: number;
}

async function authEmulatorRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${AUTH_EMULATOR_URL}${path}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Auth Emulator request failed with ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function provisionAthlete(): Promise<E2EAthlete> {
  const email = `e2e-${randomUUID()}@example.test`;
  const created = await authEmulatorRequest<{ localId?: unknown }>('/identitytoolkit.googleapis.com/v1/accounts:signUp', {
    email,
    password,
    returnSecureToken: true,
  });
  if (typeof created.localId !== 'string' || created.localId.length === 0) {
    throw new Error('Auth Emulator did not return a user id for the test athlete.');
  }
  return { email, password, userId: created.localId };
}

export async function seedRecoverySnapshot(
  athlete: E2EAthlete,
  overrides: Partial<{ sleepScore: number; bodyBatteryWake: number; hrvOvernightAvg: number; restingHr: number }> = {},
): Promise<string> {
  const date = getLocalDateString();
  await seedWithRulesDisabled(db =>
    setDoc(doc(db, 'users', athlete.userId, 'daily_recovery_snapshots', date), {
      userId: athlete.userId,
      date,
      source: { garminSyncedAt: `${date}T06:00:00.000Z`, sourceSchemaVersion: 3 },
      raw: {
        sleepScore: overrides.sleepScore ?? 85,
        sleepDurationSec: 28_800,
        restingHr: overrides.restingHr ?? 50,
        hrvOvernightAvg: overrides.hrvOvernightAvg ?? 65,
        hrvStatus: 'BALANCED',
        respirationAvg: 14,
        bodyBatteryWake: overrides.bodyBatteryWake ?? 90,
        bodyBatteryChange: 50,
        totalSteps: 8_000,
        last3DaysHardSessionsCount: 1,
        yesterdayTraining: null,
        todayTraining: null,
      },
      derived: {
        baselineComputationVersion: 1,
        sleepScore7dAvg: 80,
        sleepScore28dAvg: 82,
        restingHr7dAvg: 51,
        restingHr28dAvg: 52,
        hrv7dAvg: 63,
        hrv28dAvg: 62,
        respiration7dAvg: 14,
        respiration28dAvg: 14,
        steps7dAvg: 8_000,
        steps28dAvg: 8_100,
        steps28dStdev: 500,
        deltas: {
          sleepScoreVs7d: 5,
          sleepScoreVs28d: 3,
          restingHrVs7d: -1,
          restingHrVs28d: -2,
          hrvVs7d: 2,
          hrvVs28d: 3,
          respirationVs7d: 0,
          respirationVs28d: 0,
          stepsVs7d: 0,
          stepsVs28d: -100,
        },
      },
      dataQuality: {
        sleepScoreAvailable: true,
        restingHrAvailable: true,
        hrvAvailable: true,
        baseline7dReady: true,
        baseline28dReady: true,
      },
      createdAt: `${date}T06:00:00.000Z`,
      updatedAt: `${date}T06:00:00.000Z`,
    }));
  return date;
}

// User initialization is intentionally backgrounded: the onboarding wizard's own visibility
// (App.tsx) is gated on the same async decision-input composition as the rest of the app, so
// it can mount well after Check-in first renders -- including, for an athlete with no goals
// yet, right as a later decisionInput refresh (e.g. after saving a check-in) makes it eligible
// to show again. Call this at any point in a test where that composition may just have settled,
// not only once at sign-in, or a still-pending wizard can intercept a click on whatever it
// happens to render over.
export async function dismissOnboardingIfVisible(page: Page, timeoutMs = 2_000): Promise<void> {
  const skipOnboarding = page.getByRole('button', { name: 'Skip for now' });
  const onboardingVisible = await skipOnboarding
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (onboardingVisible) {
    await skipOnboarding.click();
  }
}

/** Fills and submits the rendered login form on whatever page is already loaded. */
export async function submitSignInForm(page: Page, athlete: E2EAthlete): Promise<void> {
  await page.getByPlaceholder('Email address').fill(athlete.email);
  await page.getByPlaceholder('Password').fill(athlete.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

export async function signInThroughUi(page: Page, athlete: E2EAthlete): Promise<void> {
  await page.goto('/');
  await submitSignInForm(page, athlete);
  await page.getByRole('heading', { name: 'Check-in', exact: true }).waitFor();
  await dismissOnboardingIfVisible(page);
}

// Drives the real Create Account form rather than provisioning through the Auth Emulator's
// REST API, so this exercises emailAuthService.signUp (including its password-policy check)
// exactly as a brand-new user would.
export async function signUpThroughUi(page: Page): Promise<{ email: string; password: string }> {
  const email = `e2e-${randomUUID()}@example.test`;
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create Account' }).click();
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByPlaceholder('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await page.getByRole('heading', { name: 'Check-in', exact: true }).waitFor();
  await dismissOnboardingIfVisible(page);
  return { email, password };
}

export async function openFixturePicker(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Sessions/ }).click();
  await page.getByRole('button', { name: '＋ New session', exact: true }).click();
  await page.getByRole('button', { name: 'From fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().waitFor();
}

/** Submits the open check-in screen with its typical-values shortcut. */
export async function submitTypicalCheckin(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Feeling normal today\? Use typical values/ }).click();
  await page.getByRole('button', { name: "Save & see today's plan", exact: true }).click();
}

/**
 * Submits the typical check-in and waits until it is persisted and Home shows today's
 * decision -- a positive anchor, so a following "absent" assertion cannot pass against a
 * screen that has not rendered yet.
 */
export async function completeTypicalCheckin(page: Page, athlete: E2EAthlete, date: string): Promise<void> {
  await submitTypicalCheckin(page);
  await expect.poll(() => hasPersistedCheckin(athlete, date)).toBe(true);
  // Saving the check-in triggers a fresh decisionInput composition (App.tsx's
  // onCheckinSaved), the same async work that makes the onboarding wizard eligible to show
  // again for a goal-less athlete -- dismiss it here too, or it can intercept assertions.
  await dismissOnboardingIfVisible(page);
  await expect(page.getByLabel("Today's Morning Training Decision")).toBeVisible();
}

export async function readSessionExecutions(athlete: E2EAthlete): Promise<PersistedSessionExecution[]> {
  return inspectAthlete(athlete, async db => {
    const snapshot = await getDocs(collection(db, 'users', athlete.userId, 'session_executions'));
    return snapshot.docs.map(item => ({
      executionId: item.id,
      state: typeof item.data().state === 'string' ? item.data().state : 'invalid',
      ...(typeof item.data().occurrenceId === 'string' ? { occurrenceId: item.data().occurrenceId } : {}),
      ...(item.data().sessionSource && typeof item.data().sessionSource === 'object' ? { sessionSource: item.data().sessionSource } : {}),
      ...(typeof item.data().prescriptionHash === 'string' ? { prescriptionHash: item.data().prescriptionHash } : {}),
    }));
  });
}

export async function readSessionRestEvents(
  athlete: E2EAthlete,
  executionId: string,
): Promise<PersistedSessionRestEvent[]> {
  return inspectAthlete(athlete, async db => {
    const snapshot = await getDocs(collection(
      db,
      'users',
      athlete.userId,
      'session_executions',
      executionId,
      'restEvents',
    ));
    return snapshot.docs.map(item => {
      const data = item.data();
      return {
        id: item.id,
        executionId: typeof data.executionId === 'string' ? data.executionId : 'invalid',
        endReason: typeof data.endReason === 'string' ? data.endReason : 'invalid',
        actualSeconds: typeof data.actualSeconds === 'number' ? data.actualSeconds : Number.NaN,
      };
    });
  });
}

export async function hasPersistedCheckin(athlete: E2EAthlete, date: string): Promise<boolean> {
  return inspectAthlete(athlete, async db => {
    const snapshot = await getDocs(collection(db, 'users', athlete.userId, 'daily_subjective_checkins'));
    return snapshot.docs.some(item => item.id === date);
  });
}

export async function readPersistedRecommendation(
  athlete: E2EAthlete,
  date: string,
): Promise<Record<string, unknown> | null> {
  return inspectAthlete(athlete, async db => {
    const snapshot = await getDoc(doc(db, 'users', athlete.userId, 'daily_recommendations', date));
    return snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null;
  });
}
