import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const defaultFirebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyC9W8k1qz2w2ig23TuWNbTthXq_kJCpwLM',
  authDomain: 'project-4df04.firebaseapp.com',
  projectId: 'project-4df04',
  storageBucket: 'project-4df04.firebasestorage.app',
  messagingSenderId: '756164404552',
  appId: '1:756164404552:web:b29b5bf1c5588bbfec3f7d',
  measurementId: 'G-SFHZRW9QZB',
};

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || defaultFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || defaultFirebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || defaultFirebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || defaultFirebaseConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || defaultFirebaseConfig.measurementId,
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

const formatAuthError = (message: string) => {
  if (/unauthorized-domain/i.test(message)) {
    return 'Firebase auth failed. Add this Vercel domain in Firebase Authentication > Settings > Authorized domains.';
  }

  if (/operation-not-allowed|admin-restricted-operation/i.test(message)) {
    return 'Firebase auth failed. Enable Anonymous Authentication in Firebase Authentication > Sign-in method.';
  }

  if (/api-key-not-valid|invalid-api-key/i.test(message)) {
    return 'Firebase auth failed. Check the VITE_FIREBASE_API_KEY value configured for this deployment.';
  }

  return `Firebase auth failed. ${message}`;
};

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
      throw new Error(formatAuthError(error.message));
    });

  await authPromise;
};
