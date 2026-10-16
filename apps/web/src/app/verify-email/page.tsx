'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api';

function VerifyEmailPanel() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    fetch(`${API_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        if (res.ok) {
          setState('success');
        } else {
          setState('error');
          setMessage(body.message ?? 'Invalid or expired verification link.');
        }
      })
      .catch(() => {
        setState('error');
        setMessage('Something went wrong. Please try the link again.');
      });
  }, [token]);

  if (!token) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p role="alert" className="text-sm text-muted-foreground">
          This verification link is missing its token. Please use the 6-digit code sent to your email.
        </p>
        <Link href="/verify-otp" className="text-sm font-medium text-primary hover:underline">
          Verify with 6-digit code &rarr;
        </Link>
        <Link href="/signin" className="text-xs text-muted-foreground hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (state === 'verifying') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Verifying your email…</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <p className="text-sm">Your email has been verified. Everything is ready to go.</p>
        <Link href="/signin" className="text-sm font-medium text-primary hover:underline">
          Sign in to your account
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p role="alert" className="text-sm text-destructive">{message}</p>
      <p className="text-sm text-muted-foreground">
        You can request or enter a fresh verification code.
      </p>
      <Link href="/verify-otp" className="text-sm font-medium text-primary hover:underline">
        Verify with 6-digit code &rarr;
      </Link>
      <Link href="/signin" className="text-xs text-muted-foreground hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="container flex max-w-md flex-col py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Email verification</h1>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Suspense fallback={<Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}>
          <VerifyEmailPanel />
        </Suspense>
      </div>
    </div>
  );
}
