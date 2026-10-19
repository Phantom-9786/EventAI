'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import { getOrganizerProfile, type OrganizerProfile } from '@/lib/organizer';
import { authFetch } from '@/lib/auth';
import { PreviewHeading } from '@/components/approved/ui';
export default function OrganizationSettings() {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<OrganizerProfile | null>(null),
    [busy, setBusy] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [form, setForm] = useState({
      organizationName: '',
      description: '',
      website: '',
      phone: '',
    });
  useEffect(() => {
    let live = true;
    if (!user) return;
    getOrganizerProfile()
      .then((p) => {
        if (live) {
          setProfile(p);
          if (p)
            setForm({
              organizationName: p.organizationName,
              description: p.description || '',
              website: p.website || '',
              phone: p.phone || '',
            });
        }
      })
      .catch(() => {
        if (live) setError('Unable to load organization settings. Please reload.');
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [user]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const r = await authFetch('/organizers/me', {
        method: 'PATCH',
        body: JSON.stringify({
          organizationName: form.organizationName.trim(),
          description: form.description.trim() || null,
          website: form.website.trim() || null,
          phone: form.phone.trim() || null,
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(
          Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message || 'Unable to save organization.',
        );
      setProfile((p) => (p ? { ...p, ...data.organizer } : p));
      setMessage('Organization details saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      setSaving(false);
    }
  }
  if (loading || (busy && user))
    return <p role="status">Loading organization settings…</p>;
  if (!user)
    return (
      <div className="empty">
        <h1>Sign in to manage your organization</h1>
        <Link className="btn" href="/signin?returnUrl=/organizer/settings">
          Sign in
        </Link>
      </div>
    );
  return (
    <>
      <PreviewHeading
        title="Your organization."
        sub="Public organization details are separate from your personal account."
        action={
          <Link className="btn outline" href="/account">
            Personal profile
          </Link>
        }
      />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!busy && !profile ? (
        <div className="notice">
          <p>Create an organizer profile to manage your organization.</p>
          <Link className="text-link" href="/dashboard">
            Organizer dashboard →
          </Link>
        </div>
      ) : (
        <form className="panel ep-organization-form" onSubmit={save}>
          <h2>Organization profile</h2>
          <label>
            Organization name
            <input
              required
              minLength={2}
              maxLength={100}
              value={form.organizationName}
              onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
            />
          </label>
          <label>
            About your organization
            <textarea
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <div className="ep-form-columns">
            <label>
              Organization website
              <input
                type="url"
                placeholder="https://example.com"
                maxLength={500}
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </label>
            <label>
              Organization phone
              <input
                type="tel"
                maxLength={20}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
          </div>
          <p className="help">
            These details appear with your events and venues. Your personal email and
            account name are managed in Personal profile.
          </p>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save organization'}
          </button>
          <Link href="/organizer/events" className="text-link">
            Manage your events →
          </Link>
        </form>
      )}
    </>
  );
}
