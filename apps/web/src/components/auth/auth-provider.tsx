'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AuthUser } from '@/lib/auth';
import { fetchCurrentUser, login, logout, register } from '@/lib/auth';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  completeSignIn: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The OAuth callback page validates the access token and commits the
    // resulting user to this context. Avoid racing it with a cookie refresh
    // before the callback's bearer token has been installed.
    if (window.location.pathname === '/auth/callback') {
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetchCurrentUser()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const me = await login(email, password);
    setUser(me);
    return me;
  }, []);

  const signUp = useCallback(
    async (input: { email: string; password: string; firstName: string; lastName: string }) => {
      const { user: me } = await register(input);
      setUser(me);
      return me;
    },
    [],
  );

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  const completeSignIn = useCallback((authenticatedUser: AuthUser) => {
    setUser(authenticatedUser);
    setLoading(false);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, completeSignIn }),
    [user, loading, signIn, signUp, signOut, completeSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
