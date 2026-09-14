import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

type FirebaseEmulatorConfig = {
  host: string;
  authPort: number;
  firestorePort: number;
};

function configuredFirebaseEmulators(): FirebaseEmulatorConfig | null {
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS !== 'true') return null;

  const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST;
  const authPort = Number(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT);
  const firestorePort = Number(import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT);
  if (!host || !Number.isInteger(authPort) || !Number.isInteger(firestorePort)) {
    throw new Error('Firebase emulator mode requires host, Auth port, and Firestore port configuration.');
  }
  return { host, authPort, firestorePort };
}

const firebaseEmulators = configuredFirebaseEmulators();

let _app: FirebaseApp | undefined;
export function getApp(): FirebaseApp {
  return (_app ??= initializeApp(firebaseConfig));
}

let _db: Firestore | undefined;
export function getDb(): Firestore {
  if (!_db) {
    try {
      // Persistent local cache (S1.1) is a durability requirement, not a performance
      // tweak: strength set logging writes from a gym floor, frequently with no signal,
      // and a write lost mid-session is the failure that makes a logger get abandoned.
      // Writes land in IndexedDB immediately and flush when connectivity returns.
      // Multi-tab manager because the app may legitimately be open more than once.
      _db = initializeFirestore(getApp(), {
        ignoreUndefinedProperties: true,
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch (error: unknown) {
      // Reached when Firestore was already initialized for this app, and as a last
      // resort if the cache configuration is rejected outright. The fallback instance
      // has no offline durability, so say so rather than degrading silently -- the
      // whole point of the branch above is the guarantee this one cannot make.
      console.warn(
        'Firestore persistent cache unavailable; continuing without offline durability. Writes made while offline may not survive a reload.',
        error,
      );
      _db = getFirestore(getApp());
    }
    if (firebaseEmulators) {
      connectFirestoreEmulator(_db, firebaseEmulators.host, firebaseEmulators.firestorePort);
    }
  }
  return _db;
}

let _auth: Auth | undefined;
export function getAuthInstance(): Auth {
  if (!_auth) {
    _auth = getAuth(getApp());
    if (firebaseEmulators) {
      connectAuthEmulator(
        _auth,
        `http://${firebaseEmulators.host}:${firebaseEmulators.authPort}`,
        { disableWarnings: true },
      );
    }
  }
  return _auth;
}
