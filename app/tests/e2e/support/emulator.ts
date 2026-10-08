import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

// The harness launcher injects a per-run project id and leased ports so the app and these
// helpers agree on them; the defaults only apply to a manual run against `firebase.json`.
const E2E_PROJECT_ID = process.env.E2E_PROJECT_ID ?? 'demo-adaptive-training-e2e';
const E2E_EMULATOR_HOST = process.env.E2E_EMULATOR_HOST ?? '127.0.0.1';
const E2E_AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 9099);
const E2E_FIRESTORE_PORT = Number(process.env.E2E_FIRESTORE_PORT ?? 8080);
export const AUTH_EMULATOR_URL = `http://${E2E_EMULATOR_HOST}:${E2E_AUTH_PORT}`;

/** Every browser request to the Firestore Emulator, for `page.route` connectivity faults. */
export const FIRESTORE_EMULATOR_ROUTE = `http://${E2E_EMULATOR_HOST}:${E2E_FIRESTORE_PORT}/**`;

/** The sign-in credentials an authenticated inspector needs; `E2EAthlete` satisfies it. */
export interface EmulatorAccount {
  email: string;
  password: string;
}

/**
 * Writes test preconditions with security rules disabled. Each call builds and tears down its
 * own environment: a worker-scoped one was measured and dropped (P4 in
 * docs/plans/2026-10-concurrent-test-harness-port-isolation.md) because the browser app's own
 * emulator traffic, not these helpers, dominates the connection count.
 */
export async function seedWithRulesDisabled(write: (db: Firestore) => Promise<unknown>): Promise<void> {
  const environment = await initializeTestEnvironment({
    projectId: E2E_PROJECT_ID,
    firestore: { host: E2E_EMULATOR_HOST, port: E2E_FIRESTORE_PORT },
  });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      await write(context.firestore() as unknown as Firestore);
    });
  } finally {
    await environment.cleanup();
  }
}

/**
 * Runs `inspect` as the signed-in athlete through an independent client, so persisted-state
 * assertions stay behind the real user security rules rather than reading the app's local
 * cache. A fresh app per call keeps every read a server read.
 */
export async function inspectAthlete<T>(account: EmulatorAccount, inspect: (db: Firestore) => Promise<T>): Promise<T> {
  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: E2E_EMULATOR_HOST,
    projectId: E2E_PROJECT_ID,
    appId: '1:123456789012:web:e2e-inspector',
  }, `e2e-inspector-${randomUUID()}`);
  try {
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
    await signInWithEmailAndPassword(auth, account.email, account.password);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, E2E_EMULATOR_HOST, E2E_FIRESTORE_PORT);
    return await inspect(db);
  } finally {
    await deleteApp(app);
  }
}
