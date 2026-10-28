'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Loader2, MailWarning, RefreshCw } from 'lucide-react';
import { ApiError, resendOtp, verifyOtp } from '@/lib/auth';
import { Button } from '@/components/ui/button';

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';
  const initialDeliveryFailed = searchParams.get('deliveryFailed') === 'true';

  const [email, setEmail] = useState(initialEmail);
  const [isEditingEmail, setIsEditingEmail] = useState(!initialEmail);
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(initialEmail ? 60 : 0);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(
    initialDeliveryFailed
      ? 'We had trouble delivering your verification code. Please check your email or click Resend.'
      : null,
  );
  const [isSuccess, setIsSuccess] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus the first empty digit on load
  useEffect(() => {
    if (!isEditingEmail && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [isEditingEmail]);

  // Resend cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleDigitChange = (index: number, value: string) => {
    // Only accept numeric characters
    const clean = value.replace(/\D/g, '');
    if (!clean) {
      const nextDigits = [...digits];
      nextDigits[index] = '';
      setDigits(nextDigits);
      return;
    }

    // If multi-character (e.g. typing fast or browser autofill)
    const char = clean.slice(-1);
    const nextDigits = [...digits];
    nextDigits[index] = char;
    setDigits(nextDigits);

    // Auto-advance to next box
    if (index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      // Focus previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const nextDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      nextDigits[i] = pasted[i] || '';
    }
    setDigits(nextDigits);

    const targetIndex = Math.min(pasted.length, 5);
    inputRefs.current[targetIndex]?.focus();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullOtp = digits.join('');
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Please provide a valid email address.');
      return;
    }
    if (fullOtp.length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    setError(null);
    setInfoMessage(null);
    setSubmitting(true);

    try {
      await verifyOtp(email.trim(), fullOtp);
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid or expired verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Please provide a valid email address first.');
      return;
    }

    setError(null);
    setInfoMessage(null);
    setResending(true);

    try {
      const res = await resendOtp(email.trim());
      setCooldown(res.cooldownSeconds ?? 60);
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      if (res.emailDeliveryFailed) {
        setError('Code was generated, but email delivery failed. Please check your inbox or try again.');
      } else {
        setInfoMessage('A fresh verification code has been sent to your email.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resend code. Please try again.');
    } finally {
      setResending(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 text-center py-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Email verified!</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your email address has been successfully verified. You can now sign in to your EventPoint account.
        </p>
        <Button
          type="button"
          className="mt-4 w-full"
          onClick={() => router.push(`/signin?email=${encodeURIComponent(email)}`)}
        >
          Sign in to your account
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {infoMessage && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
        >
          <MailWarning className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span>{infoMessage}</span>
        </div>
      )}

      {/* Target Email display / editor */}
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sent to
          </span>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => setIsEditingEmail(!isEditingEmail)}
          >
            {isEditingEmail ? 'Done' : 'Change email'}
          </button>
        </div>
        {isEditingEmail ? (
          <div className="mt-2 flex flex-col gap-1">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        ) : (
          <p className="mt-1 font-medium text-foreground truncate">{email || 'No email specified'}</p>
        )}
      </div>

      {/* 6-digit OTP input boxes */}
      <div className="flex flex-col items-center gap-2">
        <label htmlFor="otp-box-0" className="text-sm font-medium text-muted-foreground">
          6-digit verification code
        </label>
        <div className="flex items-center justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
          {digits.map((digit, index) => (
            <input
              key={index}
              id={`otp-box-${index}`}
              ref={(el) => {
                inputRefs.current[index] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigitChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              className="h-12 w-11 sm:h-14 sm:w-12 rounded-lg border border-input bg-background text-center text-xl font-bold tracking-wider shadow-sm transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:bg-zinc-950"
              aria-label={`Digit ${index + 1} of verification code`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Code expires in 10 minutes</p>
      </div>

      <Button type="submit" disabled={submitting || digits.join('').length !== 6}>
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Verify Email
      </Button>

      <div className="flex items-center justify-between border-t pt-4 text-xs">
        <span className="text-muted-foreground">Didn&apos;t receive a code?</span>
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || resending}
          className="flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {resending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
        </button>
      </div>

      <div className="flex flex-col gap-2 text-center text-xs text-muted-foreground pt-2">
        <Link href="/signup" className="hover:text-foreground hover:underline">
          Wrong email address? Back to Sign Up
        </Link>
        <Link href="/signin" className="hover:text-foreground hover:underline">
          Already verified? Sign In
        </Link>
      </div>
    </form>
  );
}

export default function VerifyOtpPage() {
  return (
    <div className="container flex max-w-md flex-col py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <KeyRound className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Verify your email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the 6-digit code sent to your email to activate your account.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Suspense fallback={<Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />}>
          <VerifyOtpForm />
        </Suspense>
      </div>
    </div>
  );
}
