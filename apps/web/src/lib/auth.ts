'use client';

// ═══════════════════════════════════════════════════
// Browser-side auth client: bearer access token in
// localStorage, refresh via httpOnly cookie on the API.
// ═══════════════════════════════════════════════════

import { API_URL } from './api';

const TOKEN_KEY = 'eventai_access_token';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: 'CUSTOMER' | 'ORGANIZER' | 'ADMIN';
  isEmailVerified?: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (typeof body.message === 'string') message = body.message;
    else if (Array.isArray(body.message)) message = body.message.join(', ');
  } catch {
    // keep default message
  }
  return new ApiError(message, res.status);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Refreshes the access token using the httpOnly refresh cookie. */
export async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    setAccessToken(null);
    return null;
  }
  const body = (await res.json()) as { accessToken: string };
  setAccessToken(body.accessToken);
  return body.accessToken;
}

/** Authenticated fetch: attaches the bearer token, refreshes once on 401. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
    }
  }
  return res;
}

export async function register(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<{ user: AuthUser; accessToken: string }> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { user: AuthUser; accessToken: string };
  setAccessToken(body.accessToken);
  return body;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { user: AuthUser; accessToken: string };
  setAccessToken(body.accessToken);
  return body.user;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    });
  } finally {
    setAccessToken(null);
  }
}

export async function resendEmailVerification(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  const res = await fetch(`${API_URL}/auth/resend-verification`, {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  let token = getAccessToken();
  if (!token) token = await refreshAccessToken();
  if (!token) return null;

  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) return null;
    const retry = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${refreshed}` },
    });
    if (!retry.ok) return null;
    const body = (await retry.json()) as { user: AuthUser };
    return body.user;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as { user: AuthUser };
  return body.user;
}
