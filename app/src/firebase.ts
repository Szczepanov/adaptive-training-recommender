import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

let _app: FirebaseApp | undefined;
export function getApp(): FirebaseApp {
  return (_app ??= initializeApp(firebaseConfig));
}

let _db: Firestore | undefined;
export function getDb(): Firestore {
  if (!_db) {
    try {
      _db = initializeFirestore(getApp(), { ignoreUndefinedProperties: true });
    } catch {
      _db = getFirestore(getApp());
    }
  }
  return _db;
}

let _auth: Auth | undefined;
export function getAuthInstance(): Auth {
  return (_auth ??= getAuth(getApp()));
}
