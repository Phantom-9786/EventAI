'use client';

import { useState } from 'react';
import Link from '@/components/ui/app-link';
import { CalendarDays, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { Button } from '@/components/ui/button';

// POST /api/auth/forgot-password always answers generically to avoid
// leaking whether an account exists; the UI reflects that.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
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
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        {submitted ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p role="status" className="text-sm">
              If an account with that email exists, a reset link has been sent. It expires in
              1&nbsp;hour.
            </p>
            <Link href="/signin" className="text-sm font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Remembered it?{' '}
              <Link href="/signin" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
