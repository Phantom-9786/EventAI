'use client';
import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { PreviewHeading } from '@/components/approved/ui';
export default function Page() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking sign-in…</p>;
  if (!user)
    return (
      <div className="ep-app-gate">
        <h1>Sign in to view notifications</h1>
        <Link className="btn" href="/signin?returnUrl=/notifications">
          Sign in
        </Link>
      </div>
    );
  return (
    <>
      <PreviewHeading
        title="Stay in the loop."
        sub="Booking updates, reminders, and platform messages."
      />
      <NotificationBell inline />
    </>
  );
}
