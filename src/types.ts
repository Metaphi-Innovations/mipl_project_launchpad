export type ApplicationType = 'Wireframe' | 'Prototype' | 'Staged Application' | 'Deployed';
export type UserRole = 'admin' | 'user';

export interface ApplicationCredential {
  id: string;
  username: string;
  password: string;
}

export interface LaunchpadApplication {
  id: string;
  name: string;
  type: ApplicationType;
  description: string;
  username?: string;
  password?: string;
  credentials?: ApplicationCredential[];
  initials: string;
  url?: string;
  order: number;
}

export interface NewApplicationInput {
  name: string;
  type: ApplicationType;
  description: string;
  username?: string;
  password?: string;
  credentials: ApplicationCredential[];
  url?: string;
}

export interface CurrentUser {
  name: string;
  email: string;
  role: UserRole;
  mappedAppIds?: string[];
}

export interface LaunchpadUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  mappedAppIds: string[];
  order: number;
}

export interface NewUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  mappedAppIds: string[];
}
