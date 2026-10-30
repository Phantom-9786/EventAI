'use client';

// ═══════════════════════════════════════════════════
// Landing page after the Google OAuth callback.
//
// The API redirects here with the access token in the
// URL fragment (#access_token=...&redirect=...) — the
// fragment is never sent to any server. This page
// stores the token, loads the profile via the existing
// session (refresh cookie was set by the API), and
// continues to the original destination.
// ═══════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import Link from '@/components/ui/app-link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2 } from 'lucide-react';
import { fetchCurrentUser, setAccessToken } from '@/lib/auth';
import { useAuth } from '@/components/auth/auth-provider';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { completeSignIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');
    const redirect = fragment.get('redirect');
    // Strip the token from the address bar immediately
    window.history.replaceState(null, '', window.location.pathname);

    const target =
      redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/events';

    if (!accessToken) {
      setError('Google sign-in did not return an access token. Please try again.');
      return;
    }

    setAccessToken(accessToken);
    fetchCurrentUser()
      .then((user) => {
        if (!user) {
          setAccessToken(null);
          setError('Signed in with Google, but the session could not be verified.');
          return;
        }
        completeSignIn(user);
        router.replace(target);
        router.refresh();
      })
      .catch(() => {
        setAccessToken(null);
        setError('Something went wrong while completing Google sign-in.');
      });
  }, [completeSignIn, router]);

  return (
    <div className="container flex max-w-md flex-col items-center py-24 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <CalendarDays className="h-6 w-6" />
      </span>
      {error ? (
        <>
          <h1 className="mt-4 text-xl font-bold tracking-tight">Sign-in failed</h1>
          <p role="alert" className="mt-2 text-sm text-muted-foreground">
            {error}
          </p>
          <Link
            href="/signin"
            className="mt-6 text-sm font-medium text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="mt-6 h-6 w-6 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Completing Google sign-in…</p>
        </>
      )}
    </div>
  );
}
