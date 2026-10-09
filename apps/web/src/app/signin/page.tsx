'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/auth';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { GoogleButton } from '@/components/auth/google-button';

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled. Please try again.',
  google_state_mismatch: 'Google sign-in could not be verified. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_email_unverified:
    'Your Google account email is not verified, so it cannot be used to sign in.',
  google_account_disabled: 'This account has been disabled.',
  google_not_configured: 'Google sign-in is not available right now.',
};

export default function SignInPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // OAuth callback errors arrive as ?error=google_* query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('error');
    if (googleError) {
      setError(
        GOOGLE_ERROR_MESSAGES[googleError] ?? 'Google sign-in failed. Please try again.',
      );
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.push('/events');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container flex max-w-md flex-col py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to book tickets and manage your events.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Sign In
        </Button>
        <div className="flex items-center gap-3 py-1" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <GoogleButton redirectTo="/events" />
        <p className="text-center text-sm text-muted-foreground">
          New to EventAI?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
