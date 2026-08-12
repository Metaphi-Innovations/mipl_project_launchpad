import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { SEED_APPLICATIONS } from '../data/seedApplications';
import type { CurrentUser, LaunchpadUser, NewUserInput, UserRole } from '../types';
import { db, ensureFirebaseAuth } from './firebase';

const COLLECTION_NAME = 'launchpadUsers';
const LOCAL_STORAGE_KEY = 'metaphi-launchpad-users';
const FIREBASE_TIMEOUT_MS = 8000;

export const DEFAULT_USERS: LaunchpadUser[] = [
  {
    id: 'demo-admin',
    name: 'Demo Admin',
    email: 'admin@metaphi.in',
    password: 'password',
    role: 'admin',
    mappedAppIds: [],
    order: 1,
  },
  {
    id: 'demo-user',
    name: 'Demo User',
    email: 'user@metaphi.in',
    password: 'password',
    role: 'user',
    mappedAppIds: SEED_APPLICATIONS.map((application) => application.id),
    order: 2,
  },
];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const sortUsers = (users: LaunchpadUser[]) =>
  [...users].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));

const normalizeRole = (value: unknown): UserRole => (value === 'admin' ? 'admin' : 'user');

const normalizeMappedAppIds = (value: unknown) =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : [];

const normalizeUser = (user: LaunchpadUser): LaunchpadUser => ({
  ...user,
  name: user.name || user.email,
  email: user.email.toLowerCase(),
  role: normalizeRole(user.role),
  mappedAppIds: normalizeMappedAppIds(user.mappedAppIds),
});

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      globalThis.setTimeout(() => reject(new Error('Firebase request timed out')), timeoutMs);
    }),
  ]);

const formatFirebaseError = (error: unknown, action: string) => {
  const message = error instanceof Error ? error.message : String(error);

  if (/permission|insufficient/i.test(message)) {
    return `Firebase permission denied while ${action}. Update Firestore rules for ${COLLECTION_NAME}.`;
  }

  if (/timed out/i.test(message)) {
    return `Firebase timed out while ${action}. Check the Firestore connection and rules.`;
  }

  return message;
};

const mapUser = (id: string, data: DocumentData): LaunchpadUser =>
  normalizeUser({
    id,
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    password: String(data.password ?? ''),
    role: normalizeRole(data.role),
    mappedAppIds: normalizeMappedAppIds(data.mappedAppIds),
    order: Number(data.order ?? Date.now()),
  });

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const readLocalUsers = () => {
  if (!canUseStorage()) {
    return DEFAULT_USERS;
  }

  const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_USERS));
    return DEFAULT_USERS;
  }

  try {
    const users = sortUsers((JSON.parse(stored) as LaunchpadUser[]).map(normalizeUser));
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(users));
    return users;
  } catch {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_USERS));
    return DEFAULT_USERS;
  }
};

const writeLocalUsers = (users: LaunchpadUser[]) => {
  if (canUseStorage()) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sortUsers(users)));
  }
};

export const toCurrentUser = (user: LaunchpadUser): CurrentUser => ({
  name: user.name,
  email: user.email,
  role: user.role,
  mappedAppIds: user.mappedAppIds,
});

export const ensureUserData = async () => {
  const firestore = db;

  if (!firestore) {
    readLocalUsers();
    return;
  }

  await ensureFirebaseAuth();
  const collectionRef = collection(firestore, COLLECTION_NAME);
  const existing = await withTimeout(getDocs(query(collectionRef, limit(1))), FIREBASE_TIMEOUT_MS);

  if (!existing.empty) {
    return;
  }

  const batch = writeBatch(firestore);
  DEFAULT_USERS.forEach((user) => {
    batch.set(doc(firestore, COLLECTION_NAME, user.id), {
      ...user,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await withTimeout(batch.commit(), FIREBASE_TIMEOUT_MS);
};

export const subscribeUsers = (
  onChange: (users: LaunchpadUser[]) => void,
  onError?: (error: Error) => void,
) => {
  const firestore = db;

  if (!firestore) {
    onChange(readLocalUsers());

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_STORAGE_KEY) {
        onChange(readLocalUsers());
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }

  void ensureFirebaseAuth().catch((error: Error) => {
    onError?.(error);
    onChange(readLocalUsers());
  });

  const collectionRef = collection(firestore, COLLECTION_NAME);
  return onSnapshot(
    query(collectionRef, orderBy('order', 'asc')),
    (snapshot) => {
      onChange(sortUsers(snapshot.docs.map((item) => mapUser(item.id, item.data()))));
    },
    (error) => {
      onError?.(error);
      onChange(readLocalUsers());
    },
  );
};

export const authenticateUser = async (email: string, password: string) => {
  const firestore = db;
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPassword = password;
  let users = readLocalUsers();

  if (firestore) {
    try {
      users = await withTimeout(
        (async () => {
          await ensureFirebaseAuth();
          await ensureUserData();
          return sortUsers(
            (await getDocs(query(collection(firestore, COLLECTION_NAME)))).docs.map((item) =>
              mapUser(item.id, item.data()),
            ),
          );
        })(),
        4500,
      );
    } catch {
      users = readLocalUsers();
    }
  }

  return (
    users.find(
      (user) => user.email.toLowerCase() === normalizedEmail && user.password === normalizedPassword,
    ) || null
  );
};

const makeUserFromInput = (input: NewUserInput, existing?: LaunchpadUser): LaunchpadUser => {
  const email = input.email.trim().toLowerCase();
  return {
    id: existing?.id || `${slugify(email)}-${Date.now()}`,
    name: input.name.trim(),
    email,
    password: input.password,
    role: input.role,
    mappedAppIds: input.role === 'admin' ? [] : input.mappedAppIds,
    order: existing?.order || Date.now(),
  };
};

export const createUser = async (input: NewUserInput) => {
  const firestore = db;
  const user = makeUserFromInput(input);

  if (!user.name || !user.email || !user.password) {
    throw new Error('Name, email, and password are required');
  }

  let currentUsers = readLocalUsers();

  if (firestore) {
    await ensureFirebaseAuth();
    currentUsers = (
      await withTimeout(getDocs(query(collection(firestore, COLLECTION_NAME))), FIREBASE_TIMEOUT_MS)
    ).docs.map((item) => mapUser(item.id, item.data()));
  }

  if (currentUsers.some((item) => item.email.toLowerCase() === user.email)) {
    throw new Error('User email already exists');
  }

  if (!firestore) {
    writeLocalUsers([...currentUsers, user]);
    return user;
  }

  try {
    await withTimeout(
      setDoc(doc(firestore, COLLECTION_NAME, user.id), {
        ...user,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      FIREBASE_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'saving user'));
  }

  return user;
};

export const updateUser = async (currentUser: LaunchpadUser, input: NewUserInput) => {
  const firestore = db;
  const user = makeUserFromInput(input, currentUser);

  if (!user.name || !user.email || !user.password) {
    throw new Error('Name, email, and password are required');
  }

  let currentUsers = readLocalUsers();

  if (firestore) {
    await ensureFirebaseAuth();
    currentUsers = (
      await withTimeout(getDocs(query(collection(firestore, COLLECTION_NAME))), FIREBASE_TIMEOUT_MS)
    ).docs.map((item) => mapUser(item.id, item.data()));
  }

  if (
    currentUsers.some(
      (item) => item.id !== currentUser.id && item.email.toLowerCase() === user.email,
    )
  ) {
    throw new Error('User email already exists');
  }

  if (!firestore) {
    writeLocalUsers(currentUsers.map((item) => (item.id === currentUser.id ? user : item)));
    return user;
  }

  try {
    await withTimeout(
      setDoc(
        doc(firestore, COLLECTION_NAME, currentUser.id),
        {
          ...user,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
      FIREBASE_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'updating user'));
  }

  return user;
};

export const deleteUser = async (userId: string) => {
  const firestore = db;

  if (!firestore) {
    writeLocalUsers(readLocalUsers().filter((user) => user.id !== userId));
    return;
  }

  await ensureFirebaseAuth();
  try {
    await withTimeout(deleteDoc(doc(firestore, COLLECTION_NAME, userId)), FIREBASE_TIMEOUT_MS);
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'deleting user'));
  }
};
