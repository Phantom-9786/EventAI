'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/components/ui/app-link';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Phone,
  Save,
  Shield,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatPrice } from '@/lib/api';
import { authFetch } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface OwnProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  username: string | null;
  bio: string | null;
  location: string | null;
  role: string;
  adminRole?: string | null;
  isEmailVerified: boolean;
  preferences?: {
    phoneNumber?: string;
    theme?: string;
    [key: string]: unknown;
  } | null;
}

type ProfileForm = {
  firstName: string;
  lastName: string;
  username: string;
  bio: string;
  location: string;
  phoneNumber: string;
};

interface DeletionBlockers {
  events?: Array<{ id: string; title: string; status: string; link: string }>;
  refunds?: Array<{
    bookingId: string;
    amount: number;
    status: string;
    refundRequestStatus?: string;
    eventTitle: string;
    link: string;
  }>;
}

export default function AccountPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    firstName: '',
    lastName: '',
    username: '',
    bio: '',
    location: '',
    phoneNumber: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [blockers, setBlockers] = useState<DeletionBlockers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setError(null);
    try {
      const response = await authFetch('/users/me');
      if (!response.ok) throw new Error(`Profile request failed (${response.status})`);
      const body = (await response.json()) as { user: OwnProfile };
      setProfile(body.user);
      setForm({
        firstName: body.user.firstName,
        lastName: body.user.lastName,
        username: body.user.username ?? '',
        bio: body.user.bio ?? '',
        location: body.user.location ?? '',
        phoneNumber: String(body.user.preferences?.phoneNumber ?? ''),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadProfile();
  }, [user, loadProfile]);

  function validatePhoneNumber(phone: string): boolean {
    if (!phone.trim()) return true; // optional
    const phonePattern = /^\+?[0-9\s-]{10,16}$/;
    return phonePattern.test(phone.trim());
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setPhoneError(null);

    const trimmedPhone = form.phoneNumber.trim();
    if (trimmedPhone && !validatePhoneNumber(trimmedPhone)) {
      setPhoneError('Enter a valid mobile phone number (10 to 15 digits, e.g. +91 9876543210).');
      return;
    }

    setSaving(true);
    try {
      // 1. Update basic profile fields
      const profileResponse = await authFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          username: form.username.trim() || null,
          bio: form.bio.trim() || null,
          location: form.location.trim() || null,
        }),
      });

      if (!profileResponse.ok) {
        const body = (await profileResponse.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        throw new Error(
          Array.isArray(body.message)
            ? body.message.join(', ')
            : body.message ?? `Profile update failed (${profileResponse.status})`,
        );
      }

      // 2. Update preferences including mobile number
      const prefResponse = await authFetch('/users/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          preferences: {
            phoneNumber: trimmedPhone,
          },
        }),
      });

      if (!prefResponse.ok) {
        const body = (await prefResponse.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        throw new Error(
          Array.isArray(body.message)
            ? body.message.join(', ')
            : body.message ?? `Preferences update failed (${prefResponse.status})`,
        );
      }

      const body = (await profileResponse.json()) as { user: OwnProfile };
      setProfile({
        ...body.user,
        preferences: {
          ...body.user.preferences,
          phoneNumber: trimmedPhone,
        },
      });
      setMessage('Profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  async function deactivateAccount() {
    if (
      !window.confirm(
        'Deactivate your account? You will be signed out and unable to log in until reactivated by support.',
      )
    )
      return;
    setDeactivating(true);
    setError(null);
    try {
      const response = await authFetch('/users/me', { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          body.message
            ? `Account deactivation failed (${response.status}): ${body.message}`
            : `Account deactivation failed (${response.status})`,
        );
      }
      await signOut();
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not deactivate your account.');
      setDeactivating(false);
    }
  }

  const [loadingBlockers, setLoadingBlockers] = useState(false);

  const openDeleteDialog = async () => {
    setShowDeleteDialog(true);
    setError(null);
    setLoadingBlockers(true);
    try {
      const res = await authFetch('/users/me/deletion-blockers');
      if (res.ok) {
        const body = (await res.json()) as { blockers?: DeletionBlockers };
        if (body.blockers) {
          setBlockers(body.blockers);
        }
      }
    } catch {
      // Best-effort check; submission will enforce
    } finally {
      setLoadingBlockers(false);
    }
  };

  async function permanentDeleteAccount() {
    if (deleteConfirmation !== 'DELETE') {
      setError('You must type DELETE to confirm permanent account deletion.');
      return;
    }
    setDeleting(true);
    setError(null);
    setBlockers(null);
    try {
      const response = await authFetch('/users/me/delete', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          blockers?: DeletionBlockers;
        };
        if (body.blockers) {
          setBlockers(body.blockers);
        }
        throw new Error(body.message ?? `Account deletion failed (${response.status})`);
      }
      await signOut();
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not permanently delete account.');
      setDeleting(false);
    }
  }

  if (authLoading || (user && loading)) {
    return (
      <div className="container flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <UserRound className="h-10 w-10 text-muted-foreground/50" />
        <h1 className="mt-4 text-xl font-semibold">Sign in to manage your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          View your profile details, manage theme, and adjust contact settings.
        </p>
        <Link href="/signin" className={cn(buttonVariants(), 'mt-6')}>
          Sign in
        </Link>
      </div>
    );
  }

  const inputClass =
    'mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const textareaClass =
    'mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="container max-w-3xl py-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your personal profile, verified contact channels, and preferences.
          </p>
        </div>
        {user.role === 'ORGANIZER' && (
          <Link
            href="/dashboard"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'gap-1.5 self-start border-primary/30 bg-primary/5 text-primary',
            )}
          >
            <Briefcase className="h-4 w-4" />
            Organizer Dashboard
          </Link>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {message && (
        <div
          role="status"
          className="mt-6 rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-3 text-sm text-green-700 dark:text-green-300"
        >
          {message}
        </div>
      )}

      {/* Account Profile Form */}
      <form
        onSubmit={(event) => void saveProfile(event)}
        className="mt-8 space-y-5 rounded-xl border bg-card p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold tracking-tight">Profile Details</h2>

        {/* Read-only Auth Email */}
        <div>
          <label htmlFor="account-email" className="text-sm font-medium">
            Account Email
          </label>
          <input
            id="account-email"
            value={profile?.email ?? user.email}
            readOnly
            className={cn(inputClass, 'bg-muted/50 cursor-not-allowed')}
          />
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {profile?.isEmailVerified ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span>Verified email. Used for ticket delivery and notifications.</span>
              </>
            ) : (
              <span>Verification pending. Check your inbox to verify your email.</span>
            )}
          </p>
        </div>

        {/* Name inputs */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor="account-first-name" className="text-sm font-medium">
            First name <span className="text-destructive">*</span>
            <input
              id="account-first-name"
              required
              maxLength={50}
              value={form.firstName}
              onChange={(event) => setForm({ ...form, firstName: event.target.value })}
              className={inputClass}
            />
          </label>
          <label htmlFor="account-last-name" className="text-sm font-medium">
            Last name <span className="text-destructive">*</span>
            <input
              id="account-last-name"
              required
              maxLength={50}
              value={form.lastName}
              onChange={(event) => setForm({ ...form, lastName: event.target.value })}
              className={inputClass}
            />
          </label>
        </div>

        {/* Mobile Number with validation */}
        <div>
          <label htmlFor="account-phone" className="text-sm font-medium flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            Mobile Number
          </label>
          <input
            id="account-phone"
            type="tel"
            maxLength={20}
            placeholder="+91 9876543210"
            value={form.phoneNumber}
            onChange={(event) => {
              setPhoneError(null);
              setForm({ ...form, phoneNumber: event.target.value });
            }}
            className={inputClass}
          />
          {phoneError ? (
            <p className="mt-1 text-xs text-destructive">{phoneError}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Used for booking alerts and gate admission verification.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor="account-username" className="block text-sm font-medium">
            Username
            <input
              id="account-username"
              maxLength={30}
              placeholder="e.g. rahul_k"
              pattern="[A-Za-z0-9_]{3,30}"
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              3–30 characters (letters, numbers, underscores).
            </span>
          </label>
          <label htmlFor="account-location" className="block text-sm font-medium">
            Location / City
            <input
              id="account-location"
              maxLength={100}
              placeholder="e.g. Bengaluru, India"
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
              className={inputClass}
            />
          </label>
        </div>

        <label htmlFor="account-bio" className="block text-sm font-medium">
          About you
          <textarea
            id="account-bio"
            maxLength={500}
            placeholder="A short bio about yourself or your event interests…"
            value={form.bio}
            onChange={(event) => setForm({ ...form, bio: event.target.value })}
            className={textareaClass}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {form.bio.length}/500 characters.
          </span>
        </label>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving changes…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save profile
            </>
          )}
        </Button>
      </form>

      {/* Account Actions / Danger Zone */}
      {profile?.adminRole !== 'OWNER' && user.adminRole !== 'OWNER' && <section className="mt-10 space-y-4 rounded-xl border border-destructive/20 bg-destructive/5 p-6">
        <div>
          <h2 className="text-base font-semibold text-destructive flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Account Management & Privacy
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Options to temporarily deactivate or permanently delete and anonymize your account.
          </p>
        </div>

        <div className="flex flex-col gap-4 divide-y border-t pt-4">
          {/* Deactivation */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Deactivate account</p>
              <p className="text-xs text-muted-foreground">
                Revokes all sessions and blocks logins. Your events and tickets remain recorded.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deactivating}
              onClick={() => void deactivateAccount()}
            >
              {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deactivate my account
            </Button>
          </div>

          {/* Permanent Deletion */}
          <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Permanently removes personal data, anonymizes identity, and revokes access. Financial records are preserved for compliance.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void openDeleteDialog()}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete account
            </Button>
          </div>
        </div>

        {/* Delete Confirmation Modal / Dialog */}
        {showDeleteDialog && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-background p-4 shadow-sm space-y-3">
            <div className="flex items-start gap-2.5 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Confirm Permanent Account Deletion</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  This action cannot be undone. To prevent accidental deletion, type{' '}
                  <strong className="text-foreground">DELETE</strong> below. Organizers must cancel all active events and resolve pending refunds before deleting their account.
                </p>
              </div>
            </div>

            {loadingBlockers ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Checking account status and active records…</span>
              </div>
            ) : blockers && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-foreground space-y-3">
                <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Blocking records prevent account deletion</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cancel all draft, published, or sold-out events and resolve all pending refunds before this account can be deleted.
                </p>
                {blockers.events && blockers.events.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      Active or draft events ({blockers.events.length}):
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {blockers.events.map((ev) => (
                        <li key={ev.id} className="flex items-center justify-between rounded bg-background/60 px-2 py-1 text-xs">
                          <span className="font-medium truncate max-w-[220px]">
                            {ev.title} <span className="text-muted-foreground font-mono">({ev.status})</span>
                          </span>
                          <Link
                            href={ev.link}
                            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline ml-2 shrink-0"
                          >
                            Manage event <ExternalLink className="h-3 w-3" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {blockers.refunds && blockers.refunds.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      Pending refunds ({blockers.refunds.length}):
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {blockers.refunds.map((ref) => (
                        <li key={ref.bookingId} className="flex items-center justify-between rounded bg-background/60 px-2 py-1 text-xs">
                          <span className="font-medium truncate max-w-[220px]">
                            {ref.eventTitle} · {formatPrice(ref.amount)} <span className="text-muted-foreground font-mono">({ref.status})</span>
                          </span>
                          <Link
                            href={ref.link}
                            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline ml-2 shrink-0"
                          >
                            View refunds <ExternalLink className="h-3 w-3" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <input
              type="text"
              placeholder="Type DELETE"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeleteConfirmation('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteConfirmation !== 'DELETE' || deleting}
                onClick={() => void permanentDeleteAccount()}
              >
                {deleting ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  'Permanently delete'
                )}
              </Button>
            </div>
          </div>
        )}
      </section>}
    </div>
  );
}
