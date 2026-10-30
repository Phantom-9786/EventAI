'use client';

import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { resendEmailVerification } from '@/lib/auth';
import { useAuth } from '@/components/auth/auth-provider';

import Link from '@/components/ui/app-link';

// Shown under the header for signed-in users whose email is not yet
// verified (Google-linked accounts are always verified server-side).
export function EmailVerificationBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.isEmailVerified !== false || dismissed) return null;

  const onResend = async () => {
    setSending(true);
    try {
      const ok = await resendEmailVerification();
      if (ok) setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="status"
      className="border-b bg-amber-500/10 text-amber-900 dark:text-amber-200"
    >
      <div className="container flex items-center gap-2 py-2 text-sm">
        <MailWarning className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">
          {sent
            ? 'Verification code sent — check your inbox.'
            : 'Please verify your email address.'}
          {' '}
          <Link
            href={`/verify-otp?email=${encodeURIComponent(user.email)}`}
            className="font-medium underline underline-offset-2 ml-1"
          >
            Enter code
          </Link>
        </span>
        {!sent && (
          <button
            type="button"
            className="font-medium underline underline-offset-2 disabled:opacity-60"
            disabled={sending}
            onClick={() => void onResend()}
          >
            {sending ? 'Sending…' : 'Resend link'}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          className="ml-2 opacity-70 hover:opacity-100"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
