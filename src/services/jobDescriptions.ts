import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { JobDescription, NewJobDescriptionInput, ResumeType } from '../types';
import { db, ensureFirebaseAuth } from './firebase';

const COLLECTION_NAME = 'launchpadJobDescriptions';
const LOCAL_STORAGE_KEY = 'metaphi-launchpad-job-descriptions';
const FIREBASE_TIMEOUT_MS = 8000;

const RESUME_TYPE_ORDER: Record<ResumeType, number> = {
  intern: 1,
  fresher: 2,
  experienced: 3,
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const normalizeResumeType = (value: unknown): ResumeType => {
  if (value === 'fresher' || value === 'experienced') {
    return value;
  }

  return 'intern';
};

const sortJobDescriptions = (jobs: JobDescription[]) =>
  [...jobs].sort(
    (left, right) =>
      RESUME_TYPE_ORDER[left.resumeType] - RESUME_TYPE_ORDER[right.resumeType] ||
      left.order - right.order ||
      left.title.localeCompare(right.title),
  );

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

const mapJobDescription = (id: string, data: DocumentData): JobDescription => ({
  id,
  title: String(data.title || 'Untitled Job Description'),
  slug: String(data.slug || id),
  resumeType: normalizeResumeType(data.resumeType),
  content: String(data.content || ''),
  order: Number(data.order ?? Date.now()),
});

const readLocalJobDescriptions = () => {
  if (!canUseStorage()) {
    return [];
  }

  const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
    return [];
  }

  try {
    const jobs = sortJobDescriptions(
      (JSON.parse(stored) as JobDescription[]).map((job) =>
        mapJobDescription(job.id || job.slug, job as unknown as DocumentData),
      ),
    );
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(jobs));
    return jobs;
  } catch {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([]));
    return [];
  }
};

const writeLocalJobDescriptions = (jobs: JobDescription[]) => {
  if (canUseStorage()) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sortJobDescriptions(jobs)));
  }
};

export const makeJobDescriptionFromInput = (input: NewJobDescriptionInput): JobDescription => {
  const title = input.title.trim();
  const order = Date.now();
  const slugBase = slugify(title) || 'job-description';
  const slug = `${slugBase}-${order}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: slug,
    title,
    slug,
    resumeType: input.resumeType,
    content: input.content.trim(),
    order,
  };
};

const makeUpdatedJobDescription = (
  currentJob: JobDescription,
  input: NewJobDescriptionInput,
): JobDescription => ({
  ...currentJob,
  title: input.title.trim(),
  resumeType: input.resumeType,
  content: input.content.trim(),
});

export const ensureJobDescriptionData = async () => {
  const firestore = db;

  if (!firestore) {
    readLocalJobDescriptions();
    return;
  }

  await ensureFirebaseAuth();
};

export const subscribeJobDescriptions = (
  onChange: (jobs: JobDescription[]) => void,
  onError?: (error: Error) => void,
) => {
  const firestore = db;

  if (!firestore) {
    onChange(readLocalJobDescriptions());

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_STORAGE_KEY) {
        onChange(readLocalJobDescriptions());
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
      onChange(sortJobDescriptions(snapshot.docs.map((item) => mapJobDescription(item.id, item.data()))));
    },
    (error) => {
      onError?.(error);
      onChange([]);
    },
  );
};

export const getJobDescriptionBySlug = async (slug: string) => {
  const firestore = db;

  if (!firestore) {
    return readLocalJobDescriptions().find((job) => job.slug === slug) || null;
  }

  try {
    const snapshot = await withTimeout(getDoc(doc(firestore, COLLECTION_NAME, slug)), FIREBASE_TIMEOUT_MS);
    return snapshot.exists() ? mapJobDescription(snapshot.id, snapshot.data()) : null;
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'loading job description'));
  }
};

export const createJobDescription = async (
  input: NewJobDescriptionInput,
  preparedJob?: JobDescription,
) => {
  const firestore = db;
  const job = preparedJob || makeJobDescriptionFromInput(input);

  if (!job.title) {
    throw new Error('Job title is required');
  }

  if (!job.content.trim()) {
    throw new Error('Job description is required');
  }

  if (!firestore) {
    writeLocalJobDescriptions([...readLocalJobDescriptions(), job]);
    return job;
  }

  await ensureFirebaseAuth();
  try {
    await withTimeout(
      setDoc(doc(firestore, COLLECTION_NAME, job.slug), {
        ...job,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      FIREBASE_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'saving job description'));
  }

  return job;
};

export const updateJobDescription = async (
  currentJob: JobDescription,
  input: NewJobDescriptionInput,
) => {
  const firestore = db;
  const updatedJob = makeUpdatedJobDescription(currentJob, input);

  if (!updatedJob.title) {
    throw new Error('Job title is required');
  }

  if (!updatedJob.content.trim()) {
    throw new Error('Job description is required');
  }

  if (!firestore) {
    writeLocalJobDescriptions(
      readLocalJobDescriptions().map((job) => (job.id === currentJob.id ? updatedJob : job)),
    );
    return updatedJob;
  }

  await ensureFirebaseAuth();
  try {
    await withTimeout(
      setDoc(
        doc(firestore, COLLECTION_NAME, currentJob.slug),
        {
          ...updatedJob,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
      FIREBASE_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'updating job description'));
  }

  return updatedJob;
};

export const deleteJobDescription = async (job: JobDescription) => {
  const firestore = db;

  if (!firestore) {
    writeLocalJobDescriptions(readLocalJobDescriptions().filter((item) => item.id !== job.id));
    return;
  }

  await ensureFirebaseAuth();
  try {
    await withTimeout(deleteDoc(doc(firestore, COLLECTION_NAME, job.slug)), FIREBASE_TIMEOUT_MS);
  } catch (error) {
    throw new Error(formatFirebaseError(error, 'deleting job description'));
  }
};