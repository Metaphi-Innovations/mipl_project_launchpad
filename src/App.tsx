import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  LayoutGrid,
  LogOut,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import {
  createApplication,
  deleteApplication,
  ensureApplicationData,
  makeApplicationFromInput,
  subscribeApplications,
  updateApplication,
} from './services/applications';
import {
  createJobDescription,
  deleteJobDescription,
  ensureJobDescriptionData,
  getJobDescriptionBySlug,
  makeJobDescriptionFromInput,
  subscribeJobDescriptions,
  updateJobDescription,
} from './services/jobDescriptions';
import {
  authenticateUser,
  createUser,
  deleteUser,
  ensureUserData,
  subscribeUsers,
  toCurrentUser,
  updateUser,
} from './services/users';
import type {
  ApplicationType,
  ApplicationCredential,
  CurrentUser,
  JobDescription,
  LaunchpadApplication,
  LaunchpadUser,
  NewApplicationInput,
  NewJobDescriptionInput,
  NewUserInput,
  ResumeType,
} from './types';

const AUTH_KEY = 'metaphi-launchpad-current-user';
const LEGACY_AUTH_KEY = 'metaphi-launchpad-authenticated';
const TYPES: ApplicationType[] = ['Wireframe', 'Prototype', 'Staged Application', 'Deployed'];
const APPLICATION_TABS = ['All', ...TYPES] as const;
const RESUME_TYPES: ResumeType[] = ['intern', 'fresher', 'experienced'];
const JOB_DESCRIPTION_TABS = ['All', ...RESUME_TYPES] as const;
type ActiveView = 'launcher' | 'applications' | 'users' | 'jobs';
type ApplicationTab = (typeof APPLICATION_TABS)[number];
type JobDescriptionTab = (typeof JOB_DESCRIPTION_TABS)[number];
type SharedJobStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';

const typeMeta: Record<ApplicationType, { className: string; title: string }> = {
  Wireframe: {
    className: 'wireframe',
    title: 'Wireframes',
  },
  Prototype: {
    className: 'prototype',
    title: 'Prototypes',
  },
  'Staged Application': {
    className: 'staged',
    title: 'Staged Applications',
  },
  Deployed: {
    className: 'deployed',
    title: 'Deployed Applications',
  },
};

const resumeTypeMeta: Record<ResumeType, { className: string; title: string }> = {
  intern: {
    className: 'intern',
    title: 'Intern',
  },
  fresher: {
    className: 'fresher',
    title: 'Fresher',
  },
  experienced: {
    className: 'experienced',
    title: 'Experienced',
  },
};

const resumeTypeOrder: Record<ResumeType, number> = {
  intern: 1,
  fresher: 2,
  experienced: 3,
};

const accentClasses = ['violet', 'mint', 'rose', 'cyan', 'green', 'pink', 'sky', 'amber'];

const createCredential = (): ApplicationCredential => ({
  id: `credential-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  username: '',
  password: '',
});

const createEmptyApplicationForm = (): NewApplicationInput => ({
  name: '',
  url: '',
  type: 'Wireframe',
  username: '',
  password: '',
  credentials: [createCredential()],
  description: '',
});

const emptyUserForm: NewUserInput = {
  name: '',
  email: '',
  password: '',
  role: 'user',
  mappedAppIds: [],
};

const createEmptyJobDescriptionForm = (): NewJobDescriptionInput => ({
  title: '',
  resumeType: 'intern',
  content: '',
});

const getSharedJobSlugFromPath = () => {
  const match = window.location.pathname.match(/^\/jobs\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
};

const getStoredUser = (): CurrentUser | null => {
  const stored = sessionStorage.getItem(AUTH_KEY);

  if (stored) {
    try {
      return JSON.parse(stored) as CurrentUser;
    } catch {
      sessionStorage.removeItem(AUTH_KEY);
    }
  }

  if (sessionStorage.getItem(LEGACY_AUTH_KEY) === 'true') {
    sessionStorage.removeItem(LEGACY_AUTH_KEY);
  }

  return null;
};

const toFormInput = (application: LaunchpadApplication): NewApplicationInput => ({
  name: application.name,
  url: application.url || '',
  type: application.type,
  username: application.username || '',
  password: application.password || '',
  credentials:
    application.credentials && application.credentials.length > 0
      ? application.credentials.map((credential) => ({
          id: credential.id || createCredential().id,
          username: credential.username || '',
          password: credential.password || '',
        }))
      : [
          {
            id: createCredential().id,
            username: application.username || '',
            password: application.password || '',
          },
        ],
  description:
    application.description === 'No description provided' ? '' : application.description,
});

const toJobDescriptionFormInput = (job: JobDescription): NewJobDescriptionInput => ({
  title: job.title,
  resumeType: job.resumeType,
  content: job.content,
});

const mergeApplication = (
  applications: LaunchpadApplication[],
  nextApplication: LaunchpadApplication,
) => {
  const exists = applications.some((application) => application.id === nextApplication.id);
  const nextApplications = exists
    ? applications.map((application) =>
        application.id === nextApplication.id ? nextApplication : application,
      )
    : [...applications, nextApplication];

  return nextApplications.sort(
    (left, right) => left.order - right.order || left.name.localeCompare(right.name),
  );
};

const removeApplication = (applications: LaunchpadApplication[], applicationId: string) =>
  applications.filter((application) => application.id !== applicationId);

const sortJobDescriptions = (jobs: JobDescription[]) =>
  [...jobs].sort(
    (left, right) =>
      resumeTypeOrder[left.resumeType] - resumeTypeOrder[right.resumeType] ||
      left.order - right.order ||
      left.title.localeCompare(right.title),
  );

const mergeJobDescription = (
  jobs: JobDescription[],
  nextJob: JobDescription,
) => {
  const exists = jobs.some((job) => job.id === nextJob.id);
  const nextJobs = exists
    ? jobs.map((job) => (job.id === nextJob.id ? nextJob : job))
    : [...jobs, nextJob];

  return sortJobDescriptions(nextJobs);
};

const removeJobDescription = (jobs: JobDescription[], jobId: string) =>
  jobs.filter((job) => job.id !== jobId);

const getJobShareUrl = (job: JobDescription) =>
  `${window.location.origin}/jobs/${encodeURIComponent(job.slug)}`;

const getExternalUrl = (url?: string) => {
  const trimmed = url?.trim();
  if (!trimmed) {
    return '';
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const openProjectInNewTab = (url?: string) => {
  const externalUrl = getExternalUrl(url);
  if (externalUrl) {
    window.open(externalUrl, '_blank', 'noopener,noreferrer');
  }
};

const getApplicationCredentials = (application: LaunchpadApplication): ApplicationCredential[] => {
  if (application.credentials && application.credentials.length > 0) {
    return application.credentials;
  }

  return [
    {
      id: 'credential-1',
      username: application.username || '',
      password: application.password || '',
    },
  ];
};

function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => getStoredUser());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [applications, setApplications] = useState<LaunchpadApplication[]>([]);
  const [users, setUsers] = useState<LaunchpadUser[]>([]);
  const [jobDescriptions, setJobDescriptions] = useState<JobDescription[]>([]);
  const [dataError, setDataError] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState<NewApplicationInput>(() => createEmptyApplicationForm());
  const [editingApplication, setEditingApplication] = useState<LaunchpadApplication | null>(null);
  const [editForm, setEditForm] = useState<NewApplicationInput>(() => createEmptyApplicationForm());
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<LaunchpadUser | null>(null);
  const [userForm, setUserForm] = useState<NewUserInput>(emptyUserForm);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [editingJobDescription, setEditingJobDescription] = useState<JobDescription | null>(null);
  const [jobDescriptionForm, setJobDescriptionForm] = useState<NewJobDescriptionInput>(() =>
    createEmptyJobDescriptionForm(),
  );
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [isEditSelectOpen, setIsEditSelectOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [notification, setNotification] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<LaunchpadApplication | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('launcher');
  const [activeApplicationTab, setActiveApplicationTab] = useState<ApplicationTab>('All');
  const [activeJobDescriptionTab, setActiveJobDescriptionTab] = useState<JobDescriptionTab>('All');
  const [projectSearch, setProjectSearch] = useState('');
  const [sharedJobSlug, setSharedJobSlug] = useState(() => getSharedJobSlugFromPath());
  const [sharedJobDescription, setSharedJobDescription] = useState<JobDescription | null>(null);
  const [sharedJobStatus, setSharedJobStatus] = useState<SharedJobStatus>('idle');
  const [sharedJobError, setSharedJobError] = useState('');
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const isAuthenticated = Boolean(currentUser);
  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    const handlePopState = () => setSharedJobSlug(getSharedJobSlugFromPath());

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!sharedJobSlug) {
      setSharedJobDescription(null);
      setSharedJobStatus('idle');
      setSharedJobError('');
      return undefined;
    }

    let isCancelled = false;
    setSharedJobStatus('loading');
    setSharedJobError('');

    getJobDescriptionBySlug(sharedJobSlug)
      .then((job) => {
        if (isCancelled) {
          return;
        }

        setSharedJobDescription(job);
        setSharedJobStatus(job ? 'ready' : 'not-found');
      })
      .catch((error: Error) => {
        if (isCancelled) {
          return;
        }

        setSharedJobDescription(null);
        setSharedJobStatus('error');
        setSharedJobError(error.message);
      });

    return () => {
      isCancelled = true;
    };
  }, [sharedJobSlug]);

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    let unsubscribeApplications: undefined | (() => void);
    let unsubscribeUsers: undefined | (() => void);
    let unsubscribeJobDescriptions: undefined | (() => void);
    let isCancelled = false;

    Promise.allSettled([ensureApplicationData(), ensureUserData(), ensureJobDescriptionData()])
      .then((results) => {
        if (isCancelled) {
          return;
        }

        const failedSetup = results.find((result) => result.status === 'rejected');
        if (failedSetup?.status === 'rejected') {
          setDataError(
            failedSetup.reason instanceof Error
              ? failedSetup.reason.message
              : 'Unable to prepare Firebase data',
          );
        }

        unsubscribeApplications = subscribeApplications(
          (items) => {
            setApplications(items);
          },
          (error) => {
            setDataError(error.message);
          },
        );

        unsubscribeUsers = subscribeUsers(
          (items) => {
            setUsers(items);
            setCurrentUser((current) => {
              if (!current) {
                return current;
              }

              const matchedUser = items.find(
                (item) => item.email.toLowerCase() === current.email.toLowerCase(),
              );

              if (!matchedUser) {
                return current;
              }

              const nextUser = toCurrentUser(matchedUser);
              sessionStorage.setItem(AUTH_KEY, JSON.stringify(nextUser));
              return nextUser;
            });
          },
          (error) => {
            setDataError(error.message);
          },
        );

        unsubscribeJobDescriptions = subscribeJobDescriptions(
          (items) => {
            setJobDescriptions(items);
          },
          (error) => {
            setDataError(error.message);
          },
        );
      })
      .catch((error: Error) => {
        setDataError(error.message);
      });

    return () => {
      isCancelled = true;
      unsubscribeApplications?.();
      unsubscribeUsers?.();
      unsubscribeJobDescriptions?.();
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!notification) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotification(''), 2800);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    if (!isAdmin && activeView !== 'launcher') {
      setActiveView('launcher');
    }
  }, [activeView, isAdmin]);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  const visibleApplications = useMemo(() => {
    if (isAdmin || !currentUser?.mappedAppIds) {
      return applications;
    }

    const allowedAppIds = new Set(currentUser.mappedAppIds);
    return applications.filter((application) => allowedAppIds.has(application.id));
  }, [applications, currentUser?.mappedAppIds, isAdmin]);

  const searchedApplications = useMemo(() => {
    const queryText = projectSearch.trim().toLowerCase();
    if (!queryText) {
      return visibleApplications;
    }

    return visibleApplications.filter((application) =>
      [
        application.name,
        application.description,
        application.type,
        application.url || '',
        ...(application.credentials || []).flatMap((credential) => [
          credential.username,
          credential.password,
        ]),
      ]
        .join(' ')
        .toLowerCase()
        .includes(queryText),
    );
  }, [projectSearch, visibleApplications]);

  const tabApplications = useMemo(() => {
    if (activeApplicationTab === 'All') {
      return searchedApplications;
    }

    return searchedApplications.filter((application) => application.type === activeApplicationTab);
  }, [activeApplicationTab, searchedApplications]);

  const tabJobDescriptions = useMemo(() => {
    if (activeJobDescriptionTab === 'All') {
      return jobDescriptions;
    }

    return jobDescriptions.filter((job) => job.resumeType === activeJobDescriptionTab);
  }, [activeJobDescriptionTab, jobDescriptions]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsLoginLoading(true);
    try {
      const matchedUser = await authenticateUser(loginEmail, loginPassword);

      if (matchedUser) {
        const nextUser = toCurrentUser(matchedUser);

        sessionStorage.setItem(AUTH_KEY, JSON.stringify(nextUser));
        sessionStorage.removeItem(LEGACY_AUTH_KEY);
        setCurrentUser(nextUser);
        setUsers((current) => {
          const exists = current.some((user) => user.id === matchedUser.id);
          return exists
            ? current.map((user) => (user.id === matchedUser.id ? matchedUser : user))
            : [...current, matchedUser];
        });
        setActiveView('launcher');
        setActiveApplicationTab('All');
        setLoginError('');
        return;
      }

      setLoginError('Invalid email or password');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to connect to Firebase');
    } finally {
      setIsLoginLoading(false);
    }
  };

  const resetUserForm = () => {
    setUserForm(emptyUserForm);
    setEditingUser(null);
  };

  const openAddUserModal = () => {
    if (!isAdmin) {
      setNotification('Only admins can add users');
      return;
    }

    setUserForm(emptyUserForm);
    setEditingUser(null);
    setIsUserModalOpen(true);
  };

  const openEditUserModal = (user: LaunchpadUser) => {
    if (!isAdmin) {
      setNotification('Only admins can edit users');
      return;
    }

    setEditingUser(user);
    setUserForm({
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
      mappedAppIds: user.mappedAppIds,
    });
    setIsUserModalOpen(true);
  };

  const closeUserModal = () => {
    setIsUserModalOpen(false);
    resetUserForm();
  };

  const handleSaveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) {
      setNotification('Only admins can manage users');
      return;
    }

    setIsSaving(true);
    try {
      if (editingUser) {
        const updated = await updateUser(editingUser, userForm);
        setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));
        setNotification('User updated successfully');
      } else {
        const created = await createUser(userForm);
        setUsers((current) => [...current, created]);
        setNotification('User added successfully');
      }

      closeUserModal();
    } catch (error) {
      setNotification(error instanceof Error ? error.message : 'Unable to save user');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async (user: LaunchpadUser) => {
    if (!isAdmin) {
      setNotification('Only admins can delete users');
      return;
    }

    if (currentUser?.email.toLowerCase() === user.email.toLowerCase()) {
      setNotification('You cannot delete your own user');
      return;
    }

    setIsSaving(true);
    try {
      await deleteUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setNotification('User deleted successfully');
    } catch (error) {
      setNotification(error instanceof Error ? error.message : 'Unable to delete user');
    } finally {
      setIsSaving(false);
    }
  };

  const openAddJobDescriptionModal = () => {
    if (!isAdmin) {
      setNotification('Only admins can create job descriptions');
      return;
    }

    setJobDescriptionForm(createEmptyJobDescriptionForm());
    setEditingJobDescription(null);
    setIsJobModalOpen(true);
  };

  const openEditJobDescriptionModal = (job: JobDescription) => {
    if (!isAdmin) {
      setNotification('Only admins can edit job descriptions');
      return;
    }

    setEditingJobDescription(job);
    setJobDescriptionForm(toJobDescriptionFormInput(job));
    setIsJobModalOpen(true);
  };

  const closeJobDescriptionModal = () => {
    setIsJobModalOpen(false);
    setEditingJobDescription(null);
    setJobDescriptionForm(createEmptyJobDescriptionForm());
  };

  const handleSaveJobDescription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) {
      setNotification('Only admins can manage job descriptions');
      return;
    }

    if (!jobDescriptionForm.title.trim() || !jobDescriptionForm.content.trim()) {
      return;
    }

    setIsSaving(true);
    let createdJob: JobDescription | null = null;
    try {
      if (editingJobDescription) {
        const updated = await updateJobDescription(editingJobDescription, jobDescriptionForm);
        setJobDescriptions((current) => mergeJobDescription(current, updated));
        setActiveJobDescriptionTab(updated.resumeType);
        setNotification('Job description updated successfully');
      } else {
        const created = makeJobDescriptionFromInput(jobDescriptionForm);
        createdJob = created;
        setJobDescriptions((current) => mergeJobDescription(current, created));
        setActiveJobDescriptionTab(created.resumeType);
        setNotification('Saving job description...');
        await createJobDescription(jobDescriptionForm, created);
        setNotification('Job description added successfully');
      }

      closeJobDescriptionModal();
    } catch (error) {
      if (createdJob) {
        const failedJobId = createdJob.id;
        setJobDescriptions((current) => removeJobDescription(current, failedJobId));
      }
      setNotification(error instanceof Error ? error.message : 'Unable to save job description');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteJobDescription = async (job: JobDescription) => {
    if (!isAdmin) {
      setNotification('Only admins can delete job descriptions');
      return;
    }

    const shouldDelete = window.confirm(`Delete ${job.title}?`);
    if (!shouldDelete) {
      return;
    }

    const previousJobDescriptions = jobDescriptions;
    setJobDescriptions((current) => removeJobDescription(current, job.id));
    setNotification('Deleting job description...');

    try {
      await deleteJobDescription(job);
      setNotification('Job description deleted successfully');
    } catch (error) {
      setJobDescriptions(previousJobDescriptions);
      setNotification(error instanceof Error ? error.message : 'Unable to delete job description');
    }
  };

  const openJobDescriptionShareLink = (job: JobDescription) => {
    window.open(getJobShareUrl(job), '_blank', 'noopener,noreferrer');
  };

  const handleMenuSelect = (view: ActiveView) => {
    if (view !== 'launcher' && !isAdmin) {
      setNotification('Only admins can access this section');
      setActiveView('launcher');
      setIsProfileMenuOpen(false);
      return;
    }

    setActiveView(view);
    setIsProfileMenuOpen(false);
    setSelectedApplication(null);
    closeEditModal();
    closeUserModal();
    closeJobDescriptionModal();
  };

  const handleLogout = () => {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(LEGACY_AUTH_KEY);
    setCurrentUser(null);
    setLoginEmail('');
    setLoginPassword('');
    setIsProfileMenuOpen(false);
    setIsAddOpen(false);
    setIsUserModalOpen(false);
    setIsJobModalOpen(false);
    setSelectedApplication(null);
    setEditingApplication(null);
    setEditingJobDescription(null);
    setActiveView('launcher');
    setActiveApplicationTab('All');
    setActiveJobDescriptionTab('All');
  };

  const resetAddForm = () => {
    setForm(createEmptyApplicationForm());
    setIsSelectOpen(false);
  };

  const closeAddModal = () => {
    setIsAddOpen(false);
    resetAddForm();
  };

  const closeEditModal = () => {
    setEditingApplication(null);
    setEditForm(createEmptyApplicationForm());
    setIsEditSelectOpen(false);
  };

  const startEditApplication = (application: LaunchpadApplication) => {
    if (!isAdmin) {
      return;
    }

    setSelectedApplication(null);
    setEditingApplication(application);
    setEditForm(toFormInput(application));
  };

  const handleCreateApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) {
      setNotification('Only admins can create applications');
      return;
    }

    if (!form.name.trim()) {
      return;
    }

    setIsSaving(true);
    const created = makeApplicationFromInput(form);
    setApplications((current) => mergeApplication(current, created));
    setActiveApplicationTab(created.type);
    closeAddModal();
    setNotification('Saving application...');

    try {
      await createApplication(form, created);
      setNotification('Application added successfully');
    } catch (error) {
      setApplications((current) => removeApplication(current, created.id));
      setNotification(error instanceof Error ? error.message : 'Unable to save application');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin || !editingApplication) {
      setNotification('Only admins can edit applications');
      return;
    }

    if (!editForm.name.trim()) {
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateApplication(editingApplication, editForm);
      setApplications((current) => mergeApplication(current, updated));
      closeEditModal();
      setSelectedApplication(updated);
      setNotification('Application updated successfully');
    } catch (error) {
      setNotification(error instanceof Error ? error.message : 'Unable to update application');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteApplication = async (application: LaunchpadApplication) => {
    if (!isAdmin) {
      setNotification('Only admins can delete applications');
      return;
    }

    const shouldDelete = window.confirm(`Delete ${application.name}?`);
    if (!shouldDelete) {
      return;
    }

    const previousApplications = applications;
    setApplications((current) => removeApplication(current, application.id));
    setSelectedApplication(null);
    setNotification('Deleting application...');

    try {
      await deleteApplication(application.id);
      setNotification('Application deleted successfully');
    } catch (error) {
      setApplications(previousApplications);
      setNotification(error instanceof Error ? error.message : 'Unable to delete application');
    }
  };

  const handleCopy = async (label: string, value?: string) => {
    const text = value?.trim();

    if (!text) {
      setNotification(`${label} is empty`);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setNotification(`${label} copied`);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setNotification(`${label} copied`);
    }
  };

  if (sharedJobSlug) {
    return (
      <SharedJobDescriptionPage
        error={sharedJobError}
        job={sharedJobDescription}
        status={sharedJobStatus}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <img className="login-logo" src="/metaphi-logo.png" alt="Metaphi" />
          <h1>Launchpad Portal</h1>
          <p>Enter your credentials to access the workspace</p>

          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input-control"
            placeholder="name@metaphi.in"
            value={loginEmail}
            onChange={(event) => setLoginEmail(event.target.value)}
          />

          <label className="field-label" htmlFor="password">
            Password
          </label>
          <div className="password-shell">
            <input
              id="password"
              className="input-control password-input"
              type={showPassword ? 'text' : 'password'}
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
            />
            <button
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="icon-button password-toggle"
              type="button"
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          {loginError ? <div className="login-error">{loginError}</div> : null}

          <button className="primary-button login-button" type="submit" disabled={isLoginLoading}>
            {isLoginLoading ? 'Logging in...' : 'Login'}
          </button>

          <p className="login-helper">Use the admin account configured in Firebase.</p>
        </form>
        <Notifications message={notification} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand-lockup brand-button" type="button" onClick={() => handleMenuSelect('launcher')}>
            <img src="/metaphi-logo.png" alt="Metaphi" />
            <div className="brand-divider" />
            <div className="brand-copy">
              <span>Launchpad</span>
              <small>Unified Workspace</small>
            </div>
          </button>

          <div className="profile-menu-shell" ref={profileMenuRef}>
            <button
              aria-expanded={isProfileMenuOpen}
              aria-haspopup="menu"
              className={`profile-button ${isProfileMenuOpen ? 'active' : ''}`}
              type="button"
              onClick={() => setIsProfileMenuOpen((current) => !current)}
            >
              <span className="profile-copy">
                <strong>{currentUser?.name}</strong>
                <small>{currentUser?.role}</small>
              </span>
              <span className="avatar">{currentUser?.role === 'admin' ? 'A' : 'U'}</span>
            </button>

            {isProfileMenuOpen ? (
              <div className="profile-menu" role="menu" aria-label="Profile menu">
                <span className="profile-menu-title">MANAGEMENT</span>
                <button
                  className={`profile-menu-item ${activeView === 'launcher' ? 'active' : ''}`}
                  type="button"
                  role="menuitem"
                  onClick={() => handleMenuSelect('launcher')}
                >
                  <LayoutGrid size={16} />
                  Launcher
                </button>
                {isAdmin ? (
                  <>
                    <button
                      className={`profile-menu-item ${activeView === 'applications' ? 'active' : ''}`}
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuSelect('applications')}
                    >
                      <Settings size={16} />
                      Applications
                    </button>
                    <button
                      className={`profile-menu-item ${activeView === 'users' ? 'active' : ''}`}
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuSelect('users')}
                    >
                      <Users size={16} />
                      Users & Access
                    </button>
                    <button
                      className={`profile-menu-item ${activeView === 'jobs' ? 'active' : ''}`}
                      type="button"
                      role="menuitem"
                      onClick={() => handleMenuSelect('jobs')}
                    >
                      <FileText size={16} />
                      Job Descriptions
                    </button>
                  </>
                ) : null}
                <div className="profile-menu-divider" />
                <button
                  className="profile-menu-item logout"
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="board-shell">
        {activeView === 'launcher' ? (
          <>
            <div className="board-header">
              <div>
                <h2>Applications Board</h2>
                <p>Manage and access your projects by stage</p>
              </div>
              {isAdmin ? (
                <button className="primary-button add-button" type="button" onClick={() => setIsAddOpen(true)}>
                  <Plus size={17} />
                  Add Application
                </button>
              ) : null}
            </div>

            {dataError ? <div className="data-error">{dataError}</div> : null}

            <div className="project-search-shell">
              <Search size={17} />
              <input
                aria-label="Search projects"
                className="project-search-input"
                placeholder="Search projects..."
                value={projectSearch}
                onChange={(event) => {
                  setProjectSearch(event.target.value);
                  setActiveApplicationTab('All');
                }}
              />
            </div>

            <div className="application-tabs" role="tablist" aria-label="Application stages">
              {APPLICATION_TABS.map((tab) => {
                const tabCount =
                  tab === 'All'
                    ? searchedApplications.length
                    : searchedApplications.filter((application) => application.type === tab).length;
                const tabClass = tab === 'All' ? 'all' : typeMeta[tab].className;

                return (
                  <button
                    key={tab}
                    className={`application-tab ${tabClass} ${activeApplicationTab === tab ? 'active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={activeApplicationTab === tab}
                    onClick={() => setActiveApplicationTab(tab)}
                  >
                    <span>{tab === 'All' ? 'All' : typeMeta[tab].title}</span>
                    <strong>{tabCount}</strong>
                  </button>
                );
              })}
            </div>

            {tabApplications.length > 0 ? (
              <section className="tabbed-cards-grid">
                {tabApplications.map((application, index) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    index={index}
                    onOpen={setSelectedApplication}
                  />
                ))}
              </section>
            ) : (
              <div className="empty-state">
                {projectSearch.trim() ? 'No projects match your search.' : 'No projects added yet.'}
              </div>
            )}
          </>
        ) : null}

        {activeView === 'applications' && isAdmin ? (
          <ApplicationsManagementView
            applications={applications}
            onAdd={() => setIsAddOpen(true)}
            onDelete={handleDeleteApplication}
            onEdit={startEditApplication}
            onView={setSelectedApplication}
          />
        ) : null}

        {activeView === 'users' && isAdmin ? (
          <UsersAccessView
            applications={applications}
            currentUser={currentUser}
            onAdd={openAddUserModal}
            onDelete={handleDeleteUser}
            onEdit={openEditUserModal}
            users={users}
          />
        ) : null}

        {activeView === 'jobs' && isAdmin ? (
          <JobDescriptionsManagementView
            activeTab={activeJobDescriptionTab}
            jobDescriptions={jobDescriptions}
            tabJobDescriptions={tabJobDescriptions}
            onAdd={openAddJobDescriptionModal}
            onCopyLink={(job) => handleCopy('Job description link', getJobShareUrl(job))}
            onDelete={handleDeleteJobDescription}
            onEdit={openEditJobDescriptionModal}
            onOpen={openJobDescriptionShareLink}
            onTabChange={setActiveJobDescriptionTab}
          />
        ) : null}
      </main>

      {isAddOpen ? (
        <AddApplicationModal
          form={form}
          isSaving={isSaving}
          isSelectOpen={isSelectOpen}
          onClose={closeAddModal}
          onSubmit={handleCreateApplication}
          setForm={setForm}
          setIsSelectOpen={setIsSelectOpen}
          onCopy={handleCopy}
        />
      ) : null}

      {editingApplication ? (
        <ApplicationFormModal
          form={editForm}
          isSaving={isSaving}
          isSelectOpen={isEditSelectOpen}
          mode="edit"
          onClose={closeEditModal}
          onSubmit={handleUpdateApplication}
          setForm={setEditForm}
          setIsSelectOpen={setIsEditSelectOpen}
          onCopy={handleCopy}
        />
      ) : null}

      {selectedApplication ? (
        <ProjectDetailsModal
          application={selectedApplication}
          canEdit={isAdmin}
          onClose={() => setSelectedApplication(null)}
          onCopy={handleCopy}
          onDelete={handleDeleteApplication}
          onEdit={startEditApplication}
        />
      ) : null}

      {isUserModalOpen ? (
        <UserFormModal
          applications={applications}
          form={userForm}
          isSaving={isSaving}
          mode={editingUser ? 'edit' : 'create'}
          onClose={closeUserModal}
          onSubmit={handleSaveUser}
          setForm={setUserForm}
        />
      ) : null}

      {isJobModalOpen ? (
        <JobDescriptionFormModal
          form={jobDescriptionForm}
          isSaving={isSaving}
          mode={editingJobDescription ? 'edit' : 'create'}
          onClose={closeJobDescriptionModal}
          onSubmit={handleSaveJobDescription}
          setForm={setJobDescriptionForm}
        />
      ) : null}

      <Notifications message={notification} />
    </div>
  );
}

function ApplicationCard({
  application,
  index,
  onOpen,
}: {
  application: LaunchpadApplication;
  index: number;
  onOpen: (application: LaunchpadApplication) => void;
}) {
  const typeClass = typeMeta[application.type].className;
  const accentClass = accentClasses[index % accentClasses.length];
  const externalUrl = getExternalUrl(application.url);

  return (
    <article
      className="application-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(application)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(application);
        }
      }}
    >
      <div className="card-topline">
        <div className={`initials-badge ${accentClass}`}>{application.initials}</div>
        {externalUrl ? (
          <button
            className="external-button"
            type="button"
            aria-label={`Open ${application.name}`}
            onClick={(event) => {
              event.stopPropagation();
              openProjectInNewTab(application.url);
            }}
          >
            <ExternalLink size={14} />
          </button>
        ) : null}
      </div>
      <h3 title={application.name}>{application.name}</h3>
      <p title={application.description}>{application.description}</p>
      <div className="card-divider" />
      <span className={`type-pill ${typeClass}`}>{application.type.toUpperCase()}</span>
    </article>
  );
}

function ApplicationsManagementView({
  applications,
  onAdd,
  onDelete,
  onEdit,
  onView,
}: {
  applications: LaunchpadApplication[];
  onAdd: () => void;
  onDelete: (application: LaunchpadApplication) => void;
  onEdit: (application: LaunchpadApplication) => void;
  onView: (application: LaunchpadApplication) => void;
}) {
  return (
    <section className="management-view">
      <div className="board-header management-header">
        <div>
          <h2>Applications</h2>
          <p>Create, review, and edit launchpad applications</p>
        </div>
        <button className="primary-button add-button" type="button" onClick={onAdd}>
          <Plus size={17} />
          Add Application
        </button>
      </div>

      <div className="management-table-shell">
        <table className="management-table">
          <thead>
            <tr>
              <th>Application</th>
              <th>Type</th>
              <th>URL</th>
              <th>Credentials</th>
              <th className="actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application, index) => (
              <tr key={application.id}>
                <td>
                  <div className="app-cell">
                    <span className={`initials-badge small ${accentClasses[index % accentClasses.length]}`}>
                      {application.initials}
                    </span>
                    <div>
                      <strong>{application.name}</strong>
                      <span>{application.description}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`type-pill ${typeMeta[application.type].className}`}>
                    {application.type.toUpperCase()}
                  </span>
                </td>
                <td>
                  {getExternalUrl(application.url) ? (
                    <span className="table-url">{getExternalUrl(application.url)}</span>
                  ) : (
                    <span className="muted-text">No URL</span>
                  )}
                </td>
                <td>
                  <span className="credentials-summary">
                    {getApplicationCredentials(application).filter(
                      (credential) => credential.username || credential.password,
                    ).length || 'No'} credential
                    {getApplicationCredentials(application).filter(
                      (credential) => credential.username || credential.password,
                    ).length === 1
                      ? ''
                      : 's'}
                    <span>
                      {getApplicationCredentials(application)[0]?.username || 'No username'}
                    </span>
                  </span>
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      className="table-action-button"
                      type="button"
                      aria-label={`View ${application.name}`}
                      title="View Application"
                      onClick={() => onView(application)}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      className="table-action-button"
                      type="button"
                      aria-label={`Edit ${application.name}`}
                      title="Edit Application"
                      onClick={() => onEdit(application)}
                    >
                      <Pencil size={16} />
                    </button>
                    {application.url ? (
                      <button
                        className="table-action-button"
                        type="button"
                        aria-label={`Open ${application.name}`}
                        title="Open Project"
                        onClick={() => openProjectInNewTab(application.url)}
                      >
                        <ExternalLink size={16} />
                      </button>
                    ) : null}
                    <button
                      className="table-action-button danger"
                      type="button"
                      aria-label={`Delete ${application.name}`}
                      title="Delete Application"
                      onClick={() => onDelete(application)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {applications.length === 0 ? (
          <div className="empty-state">No applications added yet.</div>
        ) : null}
      </div>
    </section>
  );
}

function UsersAccessView({
  applications,
  currentUser,
  onAdd,
  onDelete,
  onEdit,
  users,
}: {
  applications: LaunchpadApplication[];
  currentUser: CurrentUser | null;
  onAdd: () => void;
  onDelete: (user: LaunchpadUser) => void;
  onEdit: (user: LaunchpadUser) => void;
  users: LaunchpadUser[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const appNameById = useMemo(
    () => new Map(applications.map((application) => [application.id, application.name])),
    [applications],
  );
  const filteredUsers = useMemo(() => {
    const queryText = searchTerm.trim().toLowerCase();
    if (!queryText) {
      return users;
    }

    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(queryText) ||
        user.email.toLowerCase().includes(queryText) ||
        user.role.toLowerCase().includes(queryText),
    );
  }, [searchTerm, users]);

  return (
    <section className="management-view">
      <div className="board-header management-header">
        <div>
          <h2>User Management</h2>
          <p>Manage team members and their application access permissions.</p>
        </div>
        <button className="primary-button add-button" type="button" onClick={onAdd}>
          <Plus size={17} />
          Add New User
        </button>
      </div>

      <div className="user-search-shell">
        <Search size={16} />
        <input
          className="user-search-input"
          placeholder="Search users by name or email..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      <div className="management-table-shell">
        <table className="management-table users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Mapped Applications</th>
              <th className="actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => {
              const mappedApplicationNames = user.mappedAppIds
                .map((appId) => appNameById.get(appId))
                .filter(Boolean) as string[];
              const visibleMappedNames = mappedApplicationNames.slice(0, 3);
              const hiddenCount = mappedApplicationNames.length - visibleMappedNames.length;
              const isCurrentUser = currentUser?.email.toLowerCase() === user.email.toLowerCase();

              return (
                <tr key={user.email}>
                  <td>
                    <div className="app-cell">
                      <span className={`avatar table-avatar ${user.role === 'admin' ? 'admin' : 'user'}`}>
                        {user.name.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`role-pill ${user.role}`}>{user.role}</span>
                  </td>
                  <td>
                    {user.role === 'admin' ? (
                      <span className="muted-text italic-text">No apps mapped</span>
                    ) : mappedApplicationNames.length > 0 ? (
                      <div className="mapped-apps-list">
                        {visibleMappedNames.map((name) => (
                          <span key={name}>{name}</span>
                        ))}
                        {hiddenCount > 0 ? <span>+{hiddenCount}</span> : null}
                      </div>
                    ) : (
                      <span className="muted-text italic-text">No apps mapped</span>
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="table-action-button"
                        type="button"
                        aria-label={`Edit ${user.name}`}
                        title="Edit User"
                        onClick={() => onEdit(user)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="table-action-button danger"
                        type="button"
                        aria-label={`Delete ${user.name}`}
                        title={isCurrentUser ? 'Cannot delete current user' : 'Delete User'}
                        disabled={isCurrentUser}
                        onClick={() => onDelete(user)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredUsers.length === 0 ? <div className="empty-state">No users found.</div> : null}
      </div>
    </section>
  );
}

function JobDescriptionsManagementView({
  activeTab,
  jobDescriptions,
  tabJobDescriptions,
  onAdd,
  onCopyLink,
  onDelete,
  onEdit,
  onOpen,
  onTabChange,
}: {
  activeTab: JobDescriptionTab;
  jobDescriptions: JobDescription[];
  tabJobDescriptions: JobDescription[];
  onAdd: () => void;
  onCopyLink: (job: JobDescription) => void;
  onDelete: (job: JobDescription) => void;
  onEdit: (job: JobDescription) => void;
  onOpen: (job: JobDescription) => void;
  onTabChange: (tab: JobDescriptionTab) => void;
}) {
  return (
    <section className="management-view">
      <div className="board-header management-header">
        <div>
          <h2>Job Descriptions</h2>
          <p>Create shareable job descriptions for intern, fresher, and experienced resumes.</p>
        </div>
        <button className="primary-button add-button" type="button" onClick={onAdd}>
          <Plus size={17} />
          Add Job Description
        </button>
      </div>

      <div className="application-tabs" role="tablist" aria-label="Resume type filters">
        {JOB_DESCRIPTION_TABS.map((tab) => {
          const tabCount =
            tab === 'All'
              ? jobDescriptions.length
              : jobDescriptions.filter((job) => job.resumeType === tab).length;
          const tabClass = tab === 'All' ? 'all' : resumeTypeMeta[tab].className;

          return (
            <button
              key={tab}
              className={`application-tab ${tabClass} ${activeTab === tab ? 'active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => onTabChange(tab)}
            >
              <span>{tab === 'All' ? 'All' : resumeTypeMeta[tab].title}</span>
              <strong>{tabCount}</strong>
            </button>
          );
        })}
      </div>

      <div className="management-table-shell">
        <table className="management-table job-table">
          <thead>
            <tr>
              <th>Job Description</th>
              <th>Resume Type</th>
              <th>Share Link</th>
              <th className="actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tabJobDescriptions.map((job, index) => (
              <tr key={job.id}>
                <td>
                  <div className="app-cell">
                    <span className={`initials-badge small ${accentClasses[index % accentClasses.length]}`}>
                      {job.title.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <strong>{job.title}</strong>
                      <span>{job.content || 'No description added'}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`resume-pill ${resumeTypeMeta[job.resumeType].className}`}>
                    {resumeTypeMeta[job.resumeType].title}
                  </span>
                </td>
                <td>
                  <span className="table-url">{getJobShareUrl(job)}</span>
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      className="table-action-button"
                      type="button"
                      aria-label={`Open ${job.title}`}
                      title="Open Share Link"
                      onClick={() => onOpen(job)}
                    >
                      <ExternalLink size={16} />
                    </button>
                    <button
                      className="table-action-button"
                      type="button"
                      aria-label={`Copy link for ${job.title}`}
                      title="Copy Share Link"
                      onClick={() => onCopyLink(job)}
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      className="table-action-button"
                      type="button"
                      aria-label={`Edit ${job.title}`}
                      title="Edit Job Description"
                      onClick={() => onEdit(job)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="table-action-button danger"
                      type="button"
                      aria-label={`Delete ${job.title}`}
                      title="Delete Job Description"
                      onClick={() => onDelete(job)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {tabJobDescriptions.length === 0 ? (
          <div className="empty-state">No job descriptions added yet.</div>
        ) : null}
      </div>
    </section>
  );
}

function JobDescriptionFormModal({
  form,
  isSaving,
  mode,
  onClose,
  onSubmit,
  setForm,
}: {
  form: NewJobDescriptionInput;
  isSaving: boolean;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setForm: Dispatch<SetStateAction<NewJobDescriptionInput>>;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = mode === 'create' ? 'Add Job Description' : 'Edit Job Description';
  const actionLabel = mode === 'create' ? 'Save Job Description' : 'Update Job Description';

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="add-modal job-modal" aria-label={title} onSubmit={onSubmit}>
        <button className="modal-close icon-button" type="button" aria-label="Close" onClick={onClose}>
          <X size={21} />
        </button>
        <h2>{title}</h2>
        <p>Write the job description text and choose the resume type.</p>

        <div className="form-grid">
          <label className="field-block">
            <span>Job Title</span>
            <input
              autoFocus
              className="input-control"
              placeholder="e.g. Frontend Developer"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
            />
          </label>

          <label className="field-block">
            <span>Resume Type</span>
            <select
              className="input-control native-select"
              value={form.resumeType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  resumeType: event.target.value as ResumeType,
                }))
              }
            >
              {RESUME_TYPES.map((type) => (
                <option key={type} value={type}>
                  {resumeTypeMeta[type].title}
                </option>
              ))}
            </select>
          </label>

          <label className="field-block description-field">
            <span>Job Description</span>
            <textarea
              className="textarea-control job-description-textarea"
              placeholder="Enter the job description..."
              value={form.content}
              onChange={(event) =>
                setForm((current) => ({ ...current, content: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="save-button"
            type="submit"
            disabled={!form.title.trim() || !form.content.trim() || isSaving}
          >
            {isSaving ? 'Saving...' : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function UserFormModal({
  applications,
  form,
  isSaving,
  mode,
  onClose,
  onSubmit,
  setForm,
}: {
  applications: LaunchpadApplication[];
  form: NewUserInput;
  isSaving: boolean;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setForm: Dispatch<SetStateAction<NewUserInput>>;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = mode === 'create' ? 'Add New User' : 'Edit User';
  const actionLabel = mode === 'create' ? 'Save User' : 'Update User';
  const mappedAppIds = new Set(form.mappedAppIds);

  const toggleMappedApp = (applicationId: string) => {
    setForm((current) => {
      const currentIds = new Set(current.mappedAppIds);
      if (currentIds.has(applicationId)) {
        currentIds.delete(applicationId);
      } else {
        currentIds.add(applicationId);
      }

      return {
        ...current,
        mappedAppIds: Array.from(currentIds),
      };
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="add-modal user-modal" aria-label={title} onSubmit={onSubmit}>
        <button className="modal-close icon-button" type="button" aria-label="Close" onClick={onClose}>
          <X size={21} />
        </button>
        <h2>{title}</h2>
        <p>{mode === 'create' ? 'Create a team member account.' : 'Update user access details.'}</p>

        <div className="form-grid">
          <label className="field-block">
            <span>Name</span>
            <input
              autoFocus
              className="input-control"
              placeholder="e.g. Avnish"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="field-block">
            <span>Email</span>
            <input
              className="input-control"
              placeholder="name@metaphi.in"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </label>

          <label className="field-block">
            <span>Password</span>
            <input
              className="input-control"
              placeholder="Password"
              type="text"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>

          <label className="field-block">
            <span>Role</span>
            <select
              className="input-control native-select"
              value={form.role}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  role: event.target.value === 'admin' ? 'admin' : 'user',
                  mappedAppIds: event.target.value === 'admin' ? [] : current.mappedAppIds,
                }))
              }
            >
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
          </label>

          <div className="field-block mapped-apps-field">
            <div className="mapped-apps-heading">
              <span>Mapped Applications</span>
              {form.role === 'user' ? (
                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      mappedAppIds:
                        current.mappedAppIds.length === applications.length
                          ? []
                          : applications.map((application) => application.id),
                    }))
                  }
                >
                  {form.mappedAppIds.length === applications.length ? 'Clear All' : 'Select All'}
                </button>
              ) : null}
            </div>

            {form.role === 'admin' ? (
              <div className="mapped-apps-note">Admins can access all applications.</div>
            ) : (
              <div className="mapped-apps-picker">
                {applications.map((application) => (
                  <label key={application.id} className="mapped-app-option">
                    <input
                      type="checkbox"
                      checked={mappedAppIds.has(application.id)}
                      onChange={() => toggleMappedApp(application.id)}
                    />
                    <span>{application.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="save-button"
            type="submit"
            disabled={!form.name.trim() || !form.email.trim() || !form.password.trim() || isSaving}
          >
            {isSaving ? 'Saving...' : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddApplicationModal({
  form,
  isSaving,
  isSelectOpen,
  onClose,
  onSubmit,
  setForm,
  setIsSelectOpen,
  onCopy,
}: {
  form: NewApplicationInput;
  isSaving: boolean;
  isSelectOpen: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setForm: Dispatch<SetStateAction<NewApplicationInput>>;
  setIsSelectOpen: Dispatch<SetStateAction<boolean>>;
  onCopy: (label: string, value?: string) => void;
}) {
  return (
    <ApplicationFormModal
      form={form}
      isSaving={isSaving}
      isSelectOpen={isSelectOpen}
      mode="create"
      onClose={onClose}
      onSubmit={onSubmit}
      setForm={setForm}
      setIsSelectOpen={setIsSelectOpen}
      onCopy={onCopy}
    />
  );
}

function ApplicationFormModal({
  form,
  isSaving,
  isSelectOpen,
  mode,
  onClose,
  onSubmit,
  setForm,
  setIsSelectOpen,
  onCopy,
}: {
  form: NewApplicationInput;
  isSaving: boolean;
  isSelectOpen: boolean;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setForm: Dispatch<SetStateAction<NewApplicationInput>>;
  setIsSelectOpen: Dispatch<SetStateAction<boolean>>;
  onCopy: (label: string, value?: string) => void;
}) {
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsSelectOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [setIsSelectOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = mode === 'create' ? 'Add Application' : 'Edit Application';
  const actionLabel = mode === 'create' ? 'Save Application' : 'Update Application';
  const credentials = form.credentials && form.credentials.length > 0 ? form.credentials : [createCredential()];

  const updateCredential = (
    credentialId: string,
    field: keyof Pick<ApplicationCredential, 'username' | 'password'>,
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      credentials: (current.credentials || []).map((credential) =>
        credential.id === credentialId ? { ...credential, [field]: value } : credential,
      ),
    }));
  };

  const addCredential = () => {
    setForm((current) => ({
      ...current,
      credentials: [...(current.credentials || []), createCredential()],
    }));
  };

  const removeCredential = (credentialId: string) => {
    setForm((current) => {
      const nextCredentials = (current.credentials || []).filter(
        (credential) => credential.id !== credentialId,
      );

      return {
        ...current,
        credentials: nextCredentials.length > 0 ? nextCredentials : [createCredential()],
      };
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="add-modal" aria-label={title} onSubmit={onSubmit}>
        <button className="modal-close icon-button" type="button" aria-label="Close" onClick={onClose}>
          <X size={21} />
        </button>
        <h2>{title}</h2>
        <p>Fill in the details below to {mode === 'create' ? 'add a new' : 'update this'} application.</p>

        <div className="form-grid">
          <label className="field-block">
            <span>Application Name</span>
            <input
              autoFocus
              className="input-control"
              placeholder="e.g. CRM Prototype"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>

          <label className="field-block">
            <span>Application URL</span>
            <input
              className="input-control"
              placeholder="https://..."
              value={form.url}
              onChange={(event) =>
                setForm((current) => ({ ...current, url: event.target.value }))
              }
            />
          </label>

          <div className="field-block select-field" ref={selectRef}>
            <span>Type</span>
            <button
              aria-expanded={isSelectOpen}
              className="select-trigger"
              role="combobox"
              type="button"
              onClick={() => setIsSelectOpen((current) => !current)}
            >
              {form.type}
              <ChevronDown size={18} />
            </button>

            {isSelectOpen ? (
              <div className="select-menu" role="listbox">
                {TYPES.map((type) => (
                  <button
                    key={type}
                    className={type === form.type ? 'selected' : ''}
                    role="option"
                    type="button"
                    aria-selected={type === form.type}
                    onClick={() => {
                      setForm((current) => ({ ...current, type }));
                      setIsSelectOpen(false);
                    }}
                  >
                    {type}
                    {type === form.type ? <Check size={18} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="credentials-section">
            <div className="credentials-section-heading">
              <span>Credentials</span>
              <button type="button" onClick={addCredential}>
                <Plus size={14} />
                Add
              </button>
            </div>

            {credentials.map((credential, index) => (
              <div className="credentials-row" key={credential.id}>
                <label className="field-block credential-field">
                  <span>User Name {credentials.length > 1 ? index + 1 : ''}</span>
                  <CredentialInput
                    ariaLabel="User Name"
                    value={credential.username}
                    onChange={(value) => updateCredential(credential.id, 'username', value)}
                    onCopy={() => onCopy('User name', credential.username)}
                  />
                </label>

                <label className="field-block credential-field">
                  <span>Password {credentials.length > 1 ? index + 1 : ''}</span>
                  <CredentialInput
                    ariaLabel="Password"
                    value={credential.password}
                    onChange={(value) => updateCredential(credential.id, 'password', value)}
                    onCopy={() => onCopy('Password', credential.password)}
                  />
                </label>

                {credentials.length > 1 ? (
                  <button
                    className="credential-remove-button"
                    type="button"
                    aria-label={`Remove credential ${index + 1}`}
                    onClick={() => removeCredential(credential.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <label className="field-block description-field">
            <span>Description</span>
            <textarea
              className="textarea-control"
              placeholder="Brief description of the app..."
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="save-button" type="submit" disabled={!form.name.trim() || isSaving}>
            {isSaving ? 'Saving...' : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function CredentialInput({
  ariaLabel,
  value,
  onChange,
  onCopy,
}: {
  ariaLabel: string;
  value: string;
  onChange?: (value: string) => void;
  onCopy: () => void;
}) {
  return (
    <div className="copy-field">
      <input
        aria-label={ariaLabel}
        className="input-control"
        readOnly={!onChange}
        value={value}
        placeholder={ariaLabel}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <button
        className="copy-button"
        type="button"
        aria-label={`Copy ${ariaLabel}`}
        disabled={!value.trim()}
        onClick={onCopy}
      >
        <Copy size={15} />
      </button>
    </div>
  );
}

function ProjectDetailsModal({
  application,
  canEdit,
  onClose,
  onCopy,
  onDelete,
  onEdit,
}: {
  application: LaunchpadApplication;
  canEdit: boolean;
  onClose: () => void;
  onCopy: (label: string, value?: string) => void;
  onDelete: (application: LaunchpadApplication) => void;
  onEdit: (application: LaunchpadApplication) => void;
}) {
  const credentials = getApplicationCredentials(application);
  const externalUrl = getExternalUrl(application.url);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="add-modal project-modal" role="dialog" aria-modal="true" aria-label={application.name}>
        <button className="modal-close icon-button" type="button" aria-label="Close" onClick={onClose}>
          <X size={21} />
        </button>

        <div className="project-heading">
          <div className={`initials-badge ${accentClasses[0]}`}>{application.initials}</div>
          <div>
            <h2>{application.name}</h2>
            <span className={`type-pill ${typeMeta[application.type].className}`}>
              {application.type.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="form-grid project-grid">
          <label className="field-block">
            <span>Application URL</span>
            <input
              className="input-control"
              readOnly
              value={application.url || ''}
              placeholder="No URL provided"
            />
          </label>

          <label className="field-block">
            <span>Type</span>
            <input className="input-control" readOnly value={application.type} />
          </label>

          <div className="credentials-section readonly-credentials">
            <div className="credentials-section-heading">
              <span>Credentials</span>
            </div>
            {credentials.map((credential, index) => (
              <div className="credentials-row" key={credential.id}>
                <label className="field-block credential-field">
                  <span>User Name {credentials.length > 1 ? index + 1 : ''}</span>
                  <CredentialInput
                    ariaLabel="User Name"
                    value={credential.username}
                    onCopy={() => onCopy('User name', credential.username)}
                  />
                </label>

                <label className="field-block credential-field">
                  <span>Password {credentials.length > 1 ? index + 1 : ''}</span>
                  <CredentialInput
                    ariaLabel="Password"
                    value={credential.password}
                    onCopy={() => onCopy('Password', credential.password)}
                  />
                </label>
              </div>
            ))}
          </div>

          <label className="field-block description-field">
            <span>Description</span>
            <textarea className="textarea-control" readOnly value={application.description} />
          </label>
        </div>

        <div className="modal-actions">
          {canEdit ? (
            <>
              <button className="danger-button" type="button" onClick={() => onDelete(application)}>
                Delete
              </button>
              <button className="secondary-button" type="button" onClick={() => onEdit(application)}>
                Edit Application
              </button>
            </>
          ) : null}
          {externalUrl ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => openProjectInNewTab(application.url)}
            >
              Open Project
            </button>
          ) : null}
          <button className="save-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SharedJobDescriptionPage({
  error,
  job,
  status,
}: {
  error: string;
  job: JobDescription | null;
  status: SharedJobStatus;
}) {
  const renderContent = () => {
    if (status === 'loading' || status === 'idle') {
      return <div className="empty-state">Loading job description...</div>;
    }

    if (status === 'not-found') {
      return <div className="empty-state">Job description not found.</div>;
    }

    if (status === 'error') {
      return <div className="data-error">{error || 'Unable to load job description.'}</div>;
    }

    if (!job) {
      return <div className="empty-state">Job description not found.</div>;
    }

    return (
      <>
        <div className="shared-job-heading">
          <span className={`resume-pill ${resumeTypeMeta[job.resumeType].className}`}>
            {resumeTypeMeta[job.resumeType].title}
          </span>
          <h1>{job.title}</h1>
        </div>
        <article className="shared-job-content">{job.content}</article>
      </>
    );
  };

  return (
    <div className="shared-job-screen">
      <header className="shared-job-topbar">
        <img src="/metaphi-logo.png" alt="Metaphi" />
        <span>Job Description</span>
      </header>
      <main className="shared-job-shell">{renderContent()}</main>
    </div>
  );
}

function Notifications({ message }: { message: string }) {
  return (
    <div className="notifications" aria-live="polite" aria-label="Notifications alt+T">
      {message ? <div className="toast">{message}</div> : null}
    </div>
  );
}

export default App;