'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Shield,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogIn,
  UserPlus,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { acceptAdminInvitation, type AdminRoleType } from '@/lib/admin';

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const token = searchParams.get('token') ?? '';

  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successRole, setSuccessRole] = useState<AdminRoleType | null>(null);

  const handleAccept = async () => {
    if (!token) {
      setError('Missing invitation token in the link.');
      return;
    }

    try {
      setAccepting(true);
      setError(null);
      const res = await acceptAdminInvitation(token);
      setSuccessRole(res.role);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to accept invitation';
      setError(msg);
    } finally {
      setAccepting(false);
    }
  };

  if (!token) {
    return (
      <div className="container max-w-md py-24 text-center">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive inline-block">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Invalid Invitation Link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No invitation token was found in the link. Please check your invitation email.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Return to Home
        </Link>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="container flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Checking authentication status...</p>
      </div>
    );
  }

  // Success view
  if (successRole) {
    return (
      <div className="container max-w-md py-24 text-center">
        <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400 inline-block">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          Welcome to the Administrative Team!
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You have successfully accepted the invitation. Your account now has{' '}
          <strong className="text-foreground">
            {successRole === 'OWNER' ? 'Platform Owner' : 'Delegated Administrator'}
          </strong>{' '}
          permissions.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => {
              // Reload page or navigate to admin dashboard
              window.location.href = '/admin';
            }}
            className="w-full gap-2"
          >
            Go to Admin Dashboard
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Unauthenticated view
  if (!user) {
    const returnUrl = encodeURIComponent(`/admin/accept-invitation?token=${token}`);
    return (
      <div className="container max-w-md py-20">
        <div className="rounded-2xl border bg-card p-8 shadow-sm text-center">
          <div className="mx-auto rounded-full bg-primary/10 p-3 text-primary inline-block">
            <Shield className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
            Administrator Invitation
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You have been invited to join the EventPoint administrative team.
          </p>

          <div className="mt-6 rounded-lg bg-muted/50 p-4 text-left border">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground font-semibold">Important:</strong> Please sign in
              or register using the exact email address to which this invitation was delivered.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <Link
              href={`/signin?redirect=${returnUrl}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              <LogIn className="h-4 w-4" />
              Sign In to Accept
            </Link>

            <Link
              href={`/signup?redirect=${returnUrl}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Create an Account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated view ready to accept
  return (
    <div className="container max-w-md py-20">
      <div className="rounded-2xl border bg-card p-8 shadow-sm text-center">
        <div className="mx-auto rounded-full bg-primary/10 p-3 text-primary inline-block">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          Accept Team Invitation
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You are currently signed in as:
        </p>
        <p className="mt-1 font-semibold text-foreground text-sm">{user.email}</p>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-destructive/20 bg-destructive/10 p-3.5 text-left text-xs text-destructive flex items-start gap-2.5"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to accept invitation</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-3">
          <Button
            type="button"
            disabled={accepting}
            onClick={handleAccept}
            className="w-full gap-2"
            size="lg"
          >
            {accepting && <Loader2 className="h-4 w-4 animate-spin" />}
            Accept Administrative Access
          </Button>

          <p className="text-[11px] text-muted-foreground">
            By accepting, your account will gain access to administrative dashboards and management tools.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="container flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm font-medium">Loading invitation details...</p>
        </div>
      }
    >
      <AcceptInvitationContent />
    </Suspense>
  );
}
