'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Save, UserRound } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { Button, buttonVariants } from '@/components/ui/button';
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
  isEmailVerified: boolean;
}

type ProfileForm = Pick<OwnProfile, 'firstName' | 'lastName'> & {
  username: string;
  bio: string;
  location: string;
};

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
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authFetch('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          username: form.username.trim() || null,
          bio: form.bio.trim() || null,
          location: form.location.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string | string[] };
        throw new Error(
          Array.isArray(body.message)
            ? body.message.join(', ')
            : body.message ?? `Profile update failed (${response.status})`,
        );
      }
      const body = (await response.json()) as { user: OwnProfile };
      setProfile(body.user);
      setMessage('Profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  async function deactivateAccount() {
    if (!window.confirm('Deactivate your account? You will be signed out and cannot use it until it is reactivated.')) return;
    setDeactivating(true);
    setError(null);
    try {
      const response = await authFetch('/users/me', { method: 'DELETE' });
      if (!response.ok) throw new Error(`Account deactivation failed (${response.status})`);
      await signOut();
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not deactivate your account.');
      setDeactivating(false);
    }
  }

  if (authLoading || (user && loading)) {
    return <div className="container flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <UserRound className="h-10 w-10 text-muted-foreground/50" />
        <h1 className="mt-4 text-xl font-semibold">Sign in to manage your account</h1>
        <Link href="/signin" className={cn(buttonVariants(), 'mt-6')}>Sign in</Link>
      </div>
    );
  }

  const inputClass = 'mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const textareaClass = 'mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="container max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">My Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Update your profile and account preferences.</p>
      {error && <p role="alert" className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="mt-6 rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm">{message}</p>}

      <form onSubmit={(event) => void saveProfile(event)} className="mt-8 space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <label htmlFor="account-email" className="text-sm font-medium">Sign-in email</label>
          <input id="account-email" value={profile?.email ?? user.email} readOnly className={inputClass} />
          <p className="mt-1 text-xs text-muted-foreground">{profile?.isEmailVerified ? 'Verified contact email.' : 'Email verification is pending.'} Email changes are not supported here.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor="account-first-name" className="text-sm font-medium">First name
            <input id="account-first-name" required maxLength={50} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} className={inputClass} />
          </label>
          <label htmlFor="account-last-name" className="text-sm font-medium">Last name
            <input id="account-last-name" required maxLength={50} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} className={inputClass} />
          </label>
        </div>
        <label htmlFor="account-username" className="block text-sm font-medium">Username
          <input id="account-username" maxLength={30} pattern="[A-Za-z0-9_]{3,30}" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className={inputClass} />
          <span className="mt-1 block text-xs text-muted-foreground">3–30 letters, numbers, or underscores.</span>
        </label>
        <label htmlFor="account-location" className="block text-sm font-medium">Location
          <input id="account-location" maxLength={100} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className={inputClass} />
        </label>
        <label htmlFor="account-bio" className="block text-sm font-medium">About you
          <textarea id="account-bio" maxLength={500} value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} className={textareaClass} />
          <span className="mt-1 block text-xs text-muted-foreground">{form.bio.length}/500 characters.</span>
        </label>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save profile
        </Button>
      </form>

      <section className="mt-10 rounded-lg border border-destructive/30 p-6">
        <h2 className="font-semibold text-destructive">Deactivate account</h2>
        <p className="mt-1 text-sm text-muted-foreground">This signs you out and prevents further account access. Your booking and event records are retained.</p>
        <Button type="button" variant="destructive" className="mt-4" disabled={deactivating} onClick={() => void deactivateAccount()}>
          {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Deactivate my account
        </Button>
      </section>
    </div>
  );
}
