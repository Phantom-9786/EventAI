// ── User types ─────────────────────────────────────

import type { UserRole } from './auth';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  username?: string;
  bio?: string;
  profileImage?: string;
  location?: string;
  role: UserRole;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  username?: string;
  bio?: string;
  profileImage?: string;
  location?: string;
  role: UserRole;
}

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  username?: string;
  bio?: string;
  location?: string;
}

export interface UserPreferences {
  categories?: string[];
  location?: string;
  priceRange?: { min: number; max: number };
  notifications: {
    email: boolean;
    push: boolean;
  };
}
