import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, setDoc, type Firestore } from 'firebase/firestore';
import type { Page } from '@playwright/test';

export const E2E_PROJECT_ID = 'demo-adaptive-training-e2e';
const EMULATOR_HOST = '127.0.0.1';
const AUTH_EMULATOR_URL = `http://${EMULATOR_HOST}:9099`;
const FIRESTORE_EMULATOR_PORT = 8080;
const password = 'E2ePassword!42';

const firebaseConfig = {
  apiKey: 'fake-api-key',
  authDomain: EMULATOR_HOST,
  projectId: E2E_PROJECT_ID,
  appId: '1:123456789012:web:e2e-inspector',
};

export interface E2EAthlete {
  email: string;
  password: string;
  userId: string;
}

export interface PersistedSessionExecution {
  executionId: string;
  state: string;
}

function warsawDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

export async function seedRecoverySnapshot(athlete: E2EAthlete): Promise<string> {
  const date = warsawDate();
  const environment = await initializeTestEnvironment({
    projectId: E2E_PROJECT_ID,
    firestore: { host: EMULATOR_HOST, port: FIRESTORE_EMULATOR_PORT },
  });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'users', athlete.userId, 'daily_recovery_snapshots', date), {
        userId: athlete.userId,
        date,
        source: { garminSyncedAt: `${date}T06:00:00.000Z`, sourceSchemaVersion: 3 },
        raw: {
          sleepScore: 85,
          sleepDurationSec: 28_800,
          restingHr: 50,
          hrvOvernightAvg: 65,
          hrvStatus: 'BALANCED',
          respirationAvg: 14,
          bodyBatteryWake: 90,
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
      });
    });
  } finally {
    await environment.cleanup();
  }
  return date;
}

export async function signInThroughUi(page: Page, athlete: E2EAthlete): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Email address').fill(athlete.email);
  await page.getByPlaceholder('Password').fill(athlete.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('heading', { name: 'Check-in', exact: true }).waitFor();
  // User initialization is intentionally backgrounded. A fresh account may reach Check-in
  // before onboarding mounts, or display onboarding above it once composition catches up.
  const skipOnboarding = page.getByRole('button', { name: 'Skip for now' });
  if (await skipOnboarding.isVisible({ timeout: 1_000 })) {
    await skipOnboarding.click();
  }
}

export async function openFixturePicker(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /Sessions$/ }).click();
  await page.getByRole('button', { name: '＋ New session', exact: true }).click();
  await page.getByRole('button', { name: 'From fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Start Session →', exact: true }).first().waitFor();
}

export async function readSessionExecutions(athlete: E2EAthlete): Promise<PersistedSessionExecution[]> {
  const app = initializeApp(firebaseConfig, `e2e-inspector-${randomUUID()}`);
  try {
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_EMULATOR_URL);
    const credential = await signInWithEmailAndPassword(auth, athlete.email, athlete.password);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    const snapshot = await getDocs(collection(db, 'users', credential.user.uid, 'session_executions'));
    return snapshot.docs.map(item => ({
      executionId: item.id,
      state: typeof item.data().state === 'string' ? item.data().state : 'invalid',
    }));
  } finally {
    await deleteApp(app);
  }
}

export async function hasPersistedCheckin(athlete: E2EAthlete, date: string): Promise<boolean> {
  const app = initializeApp(firebaseConfig, `e2e-checkin-inspector-${randomUUID()}`);
  try {
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_EMULATOR_URL);
    const credential = await signInWithEmailAndPassword(auth, athlete.email, athlete.password);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    const snapshot = await getDocs(collection(db, 'users', credential.user.uid, 'daily_subjective_checkins'));
    return snapshot.docs.some(item => item.id === date);
  } finally {
    await deleteApp(app);
  }
}
