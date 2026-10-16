'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/auth';
import { authReturnPath } from '@/lib/auth-redirect';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { GoogleButton } from '@/components/auth/google-button';

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

export default function SignUpPage() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function validate(): string | null {
    if (!form.firstName.trim()) return 'First name is required';
    if (!form.lastName.trim()) return 'Last name is required';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Enter a valid email address';
    if (form.password.length < 8) return 'Password must be at least 8 characters';
    if (!passwordPattern.test(form.password)) {
      return 'Password must contain an uppercase letter, a lowercase letter, and a number';
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signUp({
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
      });
      router.push(authReturnPath(new URLSearchParams(window.location.search).get('returnUrl')));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="container flex max-w-md flex-col py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Discover events, book tickets, and never miss a moment.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="firstName" className="text-sm font-medium">First name</label>
            <input id="firstName" required autoComplete="given-name" value={form.firstName} onChange={set('firstName')} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lastName" className="text-sm font-medium">Last name</label>
            <input id="lastName" required autoComplete="family-name" value={form.lastName} onChange={set('lastName')} className={inputClass} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            aria-describedby="password-hint"
            className={inputClass}
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 8 characters with an uppercase letter, a lowercase letter, and a number.
          </p>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Create Account
        </Button>
        <div className="flex items-center gap-3 py-1" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <GoogleButton redirectTo="/events" />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/signin" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
