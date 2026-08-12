import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const configuredFirebaseValues = Object.fromEntries(
  Object.entries(firebaseConfig).filter(([, value]) => Boolean(value)),
) as FirebaseOptions;

export const isFirebaseConfigured = Boolean(
  configuredFirebaseValues.apiKey &&
    configuredFirebaseValues.authDomain &&
    configuredFirebaseValues.projectId &&
    configuredFirebaseValues.appId,
);

export const firebaseApp = isFirebaseConfigured ? initializeApp(configuredFirebaseValues) : null;
export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;

let authPromise: Promise<void> | null = null;

export const ensureFirebaseAuth = async () => {
  if (!auth) {
    return;
  }

  if (auth.currentUser) {
    return;
  }

  authPromise ??= signInAnonymously(auth)
    .then(() => undefined)
    .catch((error: Error) => {
      authPromise = null;
      throw new Error(
        `Firebase auth failed. Enable Anonymous Authentication in Firebase Auth providers. ${error.message}`,
      );
    });

  await authPromise;
};
