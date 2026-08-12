import {
  collection,
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
import type { LaunchpadApplication, NewApplicationInput } from '../types';
import { db } from './firebase';

const COLLECTION_NAME = 'launchpadApplications';
const LOCAL_STORAGE_KEY = 'metaphi-launchpad-applications';
const seedById = new Map(SEED_APPLICATIONS.map((application) => [application.id, application]));

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
  const seedApplication = seedById.get(application.id);
  const username = application.username || extracted.username || seedApplication?.username || undefined;
  const password = application.password || extracted.password || seedApplication?.password || undefined;
  const description =
    isCredentialOnlyDescription(application.description) && (username || password)
      ? 'No description provided'
      : application.description || 'No description provided';

  return {
    ...application,
    description,
    username,
    password,
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
    initials: String(data.initials || makeInitials(String(data.name ?? ''))),
    url: data.url ? String(data.url) : undefined,
    order: Number(data.order ?? Date.now()),
  }),
});

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const readLocalApplications = () => {
  if (!canUseStorage()) {
    return SEED_APPLICATIONS;
  }

  const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(SEED_APPLICATIONS));
    return SEED_APPLICATIONS;
  }

  try {
    const applications = sortApplications(
      (JSON.parse(stored) as LaunchpadApplication[]).map(normalizeApplication),
    );
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(applications));
    return applications;
  } catch {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(SEED_APPLICATIONS));
    return SEED_APPLICATIONS;
  }
};

const writeLocalApplications = (apps: LaunchpadApplication[]) => {
  if (canUseStorage()) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sortApplications(apps)));
  }
};

export const ensureSeedData = async () => {
  const firestore = db;

  if (!firestore) {
    readLocalApplications();
    return;
  }

  const collectionRef = collection(firestore, COLLECTION_NAME);
  const existing = await getDocs(query(collectionRef, limit(1)));

  if (!existing.empty) {
    return;
  }

  const batch = writeBatch(firestore);
  SEED_APPLICATIONS.forEach((application) => {
    batch.set(doc(firestore, COLLECTION_NAME, application.id), {
      ...application,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
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

  const collectionRef = collection(firestore, COLLECTION_NAME);
  return onSnapshot(
    query(collectionRef, orderBy('order', 'asc')),
    (snapshot) => {
      onChange(sortApplications(snapshot.docs.map((item) => mapApplication(item.id, item.data()))));
    },
    (error) => {
      onError?.(error);
      onChange(readLocalApplications());
    },
  );
};

export const createApplication = async (input: NewApplicationInput) => {
  const firestore = db;
  const name = input.name.trim();
  const description = input.description.trim() || 'No description provided';
  const url = input.url?.trim();
  const username = input.username?.trim();
  const password = input.password?.trim();
  const order = Date.now();
  const application: LaunchpadApplication = {
    id: `${slugify(name)}-${order}`,
    name,
    type: input.type,
    description,
    username: username || undefined,
    password: password || undefined,
    initials: makeInitials(name),
    url: url || undefined,
    order,
  };

  if (!firestore) {
    const current = readLocalApplications();
    writeLocalApplications([...current, application]);
    return application;
  }

  await setDoc(doc(firestore, COLLECTION_NAME, application.id), {
    ...application,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return application;
};

export const updateApplication = async (
  currentApplication: LaunchpadApplication,
  input: NewApplicationInput,
) => {
  const firestore = db;
  const name = input.name.trim();
  const description = input.description.trim() || 'No description provided';
  const url = input.url?.trim();
  const username = input.username?.trim();
  const password = input.password?.trim();
  const updatedApplication: LaunchpadApplication = {
    ...currentApplication,
    name,
    type: input.type,
    description,
    username: username || undefined,
    password: password || undefined,
    initials: makeInitials(name),
    url: url || undefined,
  };

  if (!firestore) {
    const current = readLocalApplications();
    writeLocalApplications(
      current.map((application) =>
        application.id === currentApplication.id ? updatedApplication : application,
      ),
    );
    return updatedApplication;
  }

  await setDoc(
    doc(firestore, COLLECTION_NAME, currentApplication.id),
    {
      ...updatedApplication,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return updatedApplication;
};
