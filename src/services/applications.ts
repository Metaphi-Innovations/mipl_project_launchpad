import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { ApplicationCredential, LaunchpadApplication, NewApplicationInput } from '../types';
import { db, ensureFirebaseAuth } from './firebase';

const COLLECTION_NAME = 'launchpadApplications';
const LOCAL_STORAGE_KEY = 'metaphi-launchpad-applications';
const FIREBASE_TIMEOUT_MS = 8000;

const sortApplications = (apps: LaunchpadApplication[]) =>
  [...apps].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const cleanCredentialValue = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^[-:=\s]+/, '')
    .replace(/\s+(?:password|pass|username|user name|id|phone number)\s*[:=-].*$/i, '')
    .trim();

const normalizeUrl = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const normalizeCredentials = (
  credentials: unknown,
  fallbackUsername?: string,
  fallbackPassword?: string,
): ApplicationCredential[] => {
  if (Array.isArray(credentials)) {
    const normalized = credentials
      .map((credential, index) => {
        if (!credential || typeof credential !== 'object') {
          return null;
        }

        const item = credential as Partial<ApplicationCredential>;
        const username = String(item.username || '').trim();
        const password = String(item.password || '').trim();

        if (!username && !password) {
          return null;
        }

        return {
          id: String(item.id || `credential-${index + 1}`),
          username,
          password,
        };
      })
      .filter(Boolean) as ApplicationCredential[];

    if (normalized.length > 0) {
      return normalized;
    }
  }

  const username = fallbackUsername?.trim() || '';
  const password = fallbackPassword?.trim() || '';

  return username || password
    ? [
        {
          id: 'credential-1',
          username,
          password,
        },
      ]
    : [];
};

const firstCredential = (credentials: ApplicationCredential[]) => credentials[0];

export const extractCredentials = (description: string) => {
  const text = description.replace(/\s+/g, ' ').trim();
  const usernameMatch =
    text.match(/(?:user\s*name|username|id|phone\s*number)\s*[:=-]+\s*(.+?)(?=\s+(?:password|pass)\s*[:=-]+|$)/i) ||
    text.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+password\b/i);
  const passwordMatch =
    text.match(/(?:password|pass)\s*[:=-]+\s*(.+)$/i) ||
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s+(password)$/i);

  return {
    username: usernameMatch ? cleanCredentialValue(usernameMatch[1]) : '',
    password: passwordMatch ? cleanCredentialValue(passwordMatch[1]) : '',
  };
};

const isCredentialOnlyDescription = (description: string) => {
  const text = description.trim();

  return Boolean(
    text.match(/^(credentials[:\s]*)?(?:user\s*name|username|id|phone\s*number)\s*[:=-]/i) ||
      text.match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s+password\b/i),
  );
};

const normalizeApplication = (application: LaunchpadApplication): LaunchpadApplication => {
  const extracted = extractCredentials(application.description);
  const credentials = normalizeCredentials(
    application.credentials,
    application.username || extracted.username,
    application.password || extracted.password,
  );
  const primaryCredential = firstCredential(credentials);
  const username = primaryCredential?.username || undefined;
  const password = primaryCredential?.password || undefined;
  const description =
    isCredentialOnlyDescription(application.description) && (username || password)
      ? 'No description provided'
      : application.description || 'No description provided';

  return {
    ...application,
    description,
    username,
    password,
    credentials,
  };
};

export const makeInitials = (name: string) => {
  const numberPrefix = name.match(/^\d+/)?.[0];
  if (numberPrefix) {
    return numberPrefix.slice(0, 2);
  }

  const words = name
    .replace(/\([^)]*\)/g, '')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return 'AP';
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

const mapApplication = (id: string, data: DocumentData): LaunchpadApplication => ({
  ...normalizeApplication({
    id,
    name: String(data.name ?? ''),
    type: data.type,
    description: String(data.description || 'No description provided'),
    username: data.username ? String(data.username) : undefined,
    password: data.password ? String(data.password) : undefined,
    credentials: normalizeCredentials(data.credentials, data.username, data.password),
    initials: String(data.initials || makeInitials(String(data.name ?? ''))),
    url: data.url ? normalizeUrl(String(data.url)) : undefined,
    order: Number(data.order ?? Date.now()),
  }),
});

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

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

const readLocalApplications = () => {
  if (!canUseStorage()) {
    return [];
  }

  const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
    return [];
  }

  try {
    const applications = sortApplications(
      (JSON.parse(stored) as LaunchpadApplication[]).map(normalizeApplication),
    );
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(applications));
    return applications;
  } catch {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
    return [];
  }
};

const writeLocalApplications = (apps: LaunchpadApplication[]) => {
  if (canUseStorage()) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sortApplications(apps)));
  }
};

export const makeApplicationFromInput = (input: NewApplicationInput): LaunchpadApplication => {
  const name = input.name.trim();
  const description = input.description.trim() || 'No description provided';
  const credentials = normalizeCredentials(input.credentials, input.username, input.password);
  const primaryCredential = firstCredential(credentials);
  const order = Date.now();

  return {
    id: `${slugify(name)}-${order}`,
    name,
    type: input.type,
    description,
    username: primaryCredential?.username || undefined,
    password: primaryCredential?.password || undefined,
    credentials,
    initials: makeInitials(name),
    url: normalizeUrl(input.url),
    order,
  };
};

const makeUpdatedApplication = (
  currentApplication: LaunchpadApplication,
  input: NewApplicationInput,
): LaunchpadApplication => {
  const name = input.name.trim();
  const description = input.description.trim() || 'No description provided';
  const credentials = normalizeCredentials(input.credentials, input.username, input.password);
  const primaryCredential = firstCredential(credentials);

  return {
    ...currentApplication,
    name,
    type: input.type,
    description,
    username: primaryCredential?.username || undefined,
    password: primaryCredential?.password || undefined,
    credentials,
    initials: makeInitials(name),
    url: normalizeUrl(input.url),
  };
};

export const ensureApplicationData = async () => {
  const firestore = db;

  if (!firestore) {
    readLocalApplications();
    return;
  }

  await ensureFirebaseAuth();
};

export const subscribeApplications = (
  onChange: (applications: LaunchpadApplication[]) => void,
  onError?: (error: Error) => void,
) => {
  const firestore = db;

  if (!firestore) {
    onChange(readLocalApplications());

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_STORAGE_KEY) {
        onChange(readLocalApplications());
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }

  void ensureFirebaseAuth().catch((error: Error) => {
    onError?.(error);
    onChange([]);
  });

  const collectionRef = collection(firestore, COLLECTION_NAME);
  return onSnapshot(
    query(collectionRef, orderBy('order', 'asc')),
    (snapshot) => {
      onChange(sortApplications(snapshot.docs.map((item) => mapApplication(item.id, item.data()))));
    },
    (error) => {
      onError?.(error);
      onChange([]);
    },
  );
};

export const createApplication = async (
  input: NewApplicationInput,
  preparedApplication?: LaunchpadApplication,
) => {
  const firestore = db;
  const application = preparedApplication || makeApplicationFromInput(input);

  if (!firestore) {
    const current = readLocalApplications();
    writeLocalApplications([...current, application]);
    return application;
  }

  await ensureFirebaseAuth();
  try {
    await withTimeout(
      setDoc(doc(firestore, COLLECTION_NAME, application.id), {
        ...application,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      FIREBASE_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'saving application'));
  }

  return application;
};

export const updateApplication = async (
  currentApplication: LaunchpadApplication,
  input: NewApplicationInput,
) => {
  const firestore = db;
  const updatedApplication = makeUpdatedApplication(currentApplication, input);

  if (!firestore) {
    const current = readLocalApplications();
    writeLocalApplications(
      current.map((application) =>
        application.id === currentApplication.id ? updatedApplication : application,
      ),
    );
    return updatedApplication;
  }

  await ensureFirebaseAuth();
  try {
    await withTimeout(
      setDoc(
        doc(firestore, COLLECTION_NAME, currentApplication.id),
        {
          ...updatedApplication,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
      FIREBASE_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'updating application'));
  }

  return updatedApplication;
};

export const deleteApplication = async (applicationId: string) => {
  const firestore = db;

  if (!firestore) {
    writeLocalApplications(readLocalApplications().filter((application) => application.id !== applicationId));
    return;
  }

  await ensureFirebaseAuth();
  try {
    await withTimeout(deleteDoc(doc(firestore, COLLECTION_NAME, applicationId)), FIREBASE_TIMEOUT_MS);
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'deleting application'));
  }
};