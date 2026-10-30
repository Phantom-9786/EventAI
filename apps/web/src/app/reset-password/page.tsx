'use client';

import { Suspense, useState } from 'react';
import Link from '@/components/ui/app-link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { Button } from '@/components/ui/button';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Invalid or expired reset link. Please request a new one.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const newPasswordSchemaHint =
    'At least 8 characters with an uppercase letter, a lowercase letter, and a number.';

  if (!token) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p role="alert" className="text-sm text-muted-foreground">
          This reset link is missing its token. Please request a new one.
        </p>
        <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
          Request a reset link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p role="status" className="text-sm">
          Your password has been reset. Please log in with your new password — all previous
          sessions were signed out.
        </p>
        <Button onClick={() => router.push('/signin')}>Go to sign in</Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">New password</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">{newPasswordSchemaHint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">Confirm new password</label>
        <input
          id="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Reset password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="container flex max-w-md flex-col py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reset links expire 1 hour after they are requested.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Suspense fallback={<Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
