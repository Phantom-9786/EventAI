'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  UserPlus,
  Mail,
  RefreshCw,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Crown,
  UserCheck,
  Loader2,
  Calendar,
  Lock,
  AlertTriangle,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { AdminQueueBadge } from './pending-counts';
import {
  listAdminTeam,
  inviteAdminMember,
  resendAdminInvitation,
  revokeAdminInvitation,
  revokeAdminMemberAccess,
  deleteAdminInvitationHistory,
  clearAcceptedAdminInvitations,
  type AdminTeamResponse,
  type AdminTeamMember,
  type AdminInvitationSummary,
  type AdminRoleType,
} from '@/lib/admin';

export function TeamAccessSection() {
  const [data, setData] = useState<AdminTeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Invitation tab: 'pending' | 'accepted' | 'archived'
  const [invitationTab, setInvitationTab] = useState<'pending' | 'accepted' | 'archived'>(
    'pending',
  );

  // Modals state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AdminRoleType>('ADMIN');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Revoke member access modal
  const [revokeMemberTarget, setRevokeMemberTarget] = useState<AdminTeamMember | null>(
    null,
  );
  const [revokeMemberLoading, setRevokeMemberLoading] = useState(false);

  // Revoke pending invitation modal
  const [revokeInviteTarget, setRevokeInviteTarget] =
    useState<AdminInvitationSummary | null>(null);
  const [revokeInviteLoading, setRevokeInviteLoading] = useState(false);

  // Bulk clear accepted modal
  const [bulkClearModalOpen, setBulkClearModalOpen] = useState(false);
  const [bulkClearLoading, setBulkClearLoading] = useState(false);

  // Single clear record target
  const [singleClearTarget, setSingleClearTarget] =
    useState<AdminInvitationSummary | null>(null);
  const [singleClearLoading, setSingleClearLoading] = useState(false);

  // Action loading indicators
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);

  const loadTeamData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listAdminTeam();
      setData(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load team data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  const isOwner = Boolean(data?.currentUser?.isOwner);
  const deliveryWarning = Boolean(
    successMessage &&
    /email (could not be delivered|delivery failed)/.test(successMessage),
  );

  // Handle invitation submission
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteError('Please enter a valid email address.');
      return;
    }

    try {
      setInviteLoading(true);
      setInviteError(null);
      const result = await inviteAdminMember({
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setSuccessMessage(
        result.emailDeliveryFailed
          ? 'Invitation created, but the email could not be delivered. Check the email service and resend.'
          : `Invitation sent to ${inviteEmail.trim()}`,
      );
      setInviteModalOpen(false);
      setInviteEmail('');
      setInviteRole('ADMIN');
      await loadTeamData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation';
      setInviteError(message);
    } finally {
      setInviteLoading(false);
    }
  };

  // Handle resend invitation
  const handleResendInvitation = async (invitation: AdminInvitationSummary) => {
    try {
      setResendingInviteId(invitation.id);
      setError(null);
      const result = await resendAdminInvitation(invitation.id);
      setSuccessMessage(
        result.emailDeliveryFailed
          ? 'Invitation updated, but email delivery failed. Check the email service before resending.'
          : `Invitation resent to ${invitation.email}`,
      );
      await loadTeamData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resend invitation';
      setError(message);
    } finally {
      setResendingInviteId(null);
    }
  };

  // Handle revoke invitation confirmation
  const handleConfirmRevokeInvitation = async () => {
    if (!revokeInviteTarget) return;
    try {
      setRevokeInviteLoading(true);
      setError(null);
      await revokeAdminInvitation(revokeInviteTarget.id);
      setSuccessMessage(`Invitation for ${revokeInviteTarget.email} was revoked.`);
      setRevokeInviteTarget(null);
      await loadTeamData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revoke invitation';
      setError(message);
    } finally {
      setRevokeInviteLoading(false);
    }
  };

  // Handle revoke member access confirmation
  const handleConfirmRevokeMemberAccess = async () => {
    if (!revokeMemberTarget) return;
    try {
      setRevokeMemberLoading(true);
      setError(null);
      await revokeAdminMemberAccess(revokeMemberTarget.id);
      setSuccessMessage(`Administrative access revoked for ${revokeMemberTarget.email}.`);
      setRevokeMemberTarget(null);
      await loadTeamData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revoke access';
      setError(message);
    } finally {
      setRevokeMemberLoading(false);
    }
  };

  // Handle clear single historical record
  const handleConfirmClearSingleHistory = async () => {
    if (!singleClearTarget) return;
    try {
      setSingleClearLoading(true);
      setError(null);
      await deleteAdminInvitationHistory(singleClearTarget.id);
      setSuccessMessage(`Cleared invitation record for ${singleClearTarget.email}.`);
      setSingleClearTarget(null);
      await loadTeamData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to clear record';
      setError(message);
    } finally {
      setSingleClearLoading(false);
    }
  };

  // Handle bulk clear accepted invitations
  const handleConfirmBulkClear = async () => {
    try {
      setBulkClearLoading(true);
      setError(null);
      const res = await clearAcceptedAdminInvitations();
      setSuccessMessage(
        `Successfully cleared ${res.clearedCount} accepted invitation records from history.`,
      );
      setBulkClearModalOpen(false);
      await loadTeamData();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to clear accepted history';
      setError(message);
    } finally {
      setBulkClearLoading(false);
    }
  };

  // Filter members by search query
  const filteredMembers = useMemo(() => {
    if (!data?.members) return [];
    if (!searchQuery.trim()) return data.members;
    const q = searchQuery.toLowerCase();
    return data.members.filter(
      (m) => m.email.toLowerCase().includes(q) || m.fullName.toLowerCase().includes(q),
    );
  }, [data?.members, searchQuery]);

  // Invitations categorized
  const pendingInvitations = useMemo(() => {
    const list =
      data?.pendingInvitations ||
      data?.invitations.filter((i) => i.status === 'PENDING') ||
      [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((i) => i.email.toLowerCase().includes(q));
  }, [data, searchQuery]);

  const acceptedInvitations = useMemo(() => {
    const list =
      data?.acceptedInvitations ||
      data?.invitations.filter((i) => i.status === 'ACCEPTED') ||
      [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((i) => i.email.toLowerCase().includes(q));
  }, [data, searchQuery]);

  const historicalInvitations = useMemo(() => {
    const list =
      data?.historicalInvitations ||
      data?.invitations.filter((i) => i.status === 'REVOKED' || i.status === 'EXPIRED') ||
      [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((i) => i.email.toLowerCase().includes(q));
  }, [data, searchQuery]);

  if (loading && !data) {
    return (
      <div
        className="flex flex-col items-center justify-center py-24 text-muted-foreground"
        role="status"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
        <p className="text-sm font-medium">Loading administrative team & access...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 ep-team-access">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground mt-1">
            Invite administrators and manage access to the platform.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isOwner ? (
            <Button
              type="button"
              onClick={() => {
                setInviteError(null);
                setInviteModalOpen(true);
              }}
              className="gap-2 shadow-sm ep-invite-admin-button"
              id="invite-admin-button"
            >
              <UserPlus className="h-4 w-4" />
              Invite Administrator
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-md border">
              <Lock className="h-3.5 w-3.5" />
              Platform Owner access required to invite members
            </div>
          )}
        </div>
      </div>

      {/* Success / Error Banners */}
      {successMessage && (
        <div
          role={deliveryWarning ? 'alert' : 'status'}
          className={
            deliveryWarning
              ? 'ep-delivery-warning flex items-center justify-between rounded-lg border px-4 py-3 text-sm'
              : 'flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400'
          }
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-xs font-semibold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-xs font-semibold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Administrators
            </span>
            <ShieldCheck className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {data?.members.length ?? 0}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Owners: {data?.members.filter((m) => m.adminRole === 'OWNER').length ?? 0} ·
            Administrators:{' '}
            {data?.members.filter((m) => m.adminRole === 'ADMIN').length ?? 0}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pending Invitations
            </span>
            <Mail className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {pendingInvitations.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Awaiting recipient acceptance & verification
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your Permission
            </span>
            {isOwner ? (
              <Crown className="h-4 w-4 text-amber-500" />
            ) : (
              <UserCheck className="h-4 w-4 text-blue-500" />
            )}
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {isOwner ? 'Platform Owner' : 'Administrator'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isOwner
              ? 'Full authority over team and controls'
              : 'Authorized for moderation and oversight'}
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter team members or invites..."
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      {/* Section 1: Active Administrators */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4 bg-muted/20">
          <h3 className="font-semibold text-base text-foreground">
            Active Administrators
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accounts with active administrative access to the platform.
          </p>
        </div>

        {filteredMembers.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No administrators found matching your query.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredMembers.map((member) => {
              const isCurrentUser =
                member.isCurrentUser || member.id === data?.currentUser?.id;
              const isMemberOwner = member.adminRole === 'OWNER' || member.isOwner;

              return (
                <div
                  key={member.id}
                  className="ep-team-member flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 transition-colors hover:bg-muted/10"
                >
                  <div className="ep-team-member-person flex items-start sm:items-center gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                      {member.fullName
                        ? member.fullName.charAt(0).toUpperCase()
                        : member.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="ep-team-member-name flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">
                          {member.fullName || 'Unnamed Account'}
                        </span>
                        {isCurrentUser && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            You
                          </span>
                        )}
                        {isMemberOwner ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <Crown className="h-3 w-3" />
                            Platform Owner
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
                            <ShieldCheck className="h-3 w-3" />
                            Administrator
                          </span>
                        )}
                      </div>
                      <div className="ep-team-member-meta flex items-center gap-4 text-xs text-muted-foreground mt-1">
                        <span>{member.email}</span>
                        <span className="hidden sm:inline">•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Added {new Date(member.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {/* ISSUE 1: Do not render Revoke Access for current user or platform owner */}
                    {isOwner && !isCurrentUser && !isMemberOwner && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRevokeMemberTarget(member)}
                        className="text-destructive hover:bg-destructive/10 border-destructive/30 hover:border-destructive/60"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Revoke Access
                      </Button>
                    )}
                    {isCurrentUser && (
                      <span className="text-xs text-muted-foreground italic">
                        Current session
                      </span>
                    )}
                    {!isCurrentUser && isMemberOwner && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        Protected Owner
                      </span>
                    )}
                    {!isOwner && !isCurrentUser && !isMemberOwner && (
                      <span className="text-xs text-muted-foreground italic">
                        View only
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Invitations & History (ISSUE 2: Organized into tabs) */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4 bg-muted/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-semibold text-base text-foreground">
              Invitations & History
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage pending invitations and inspect historical administrative
              invitations.
            </p>
          </div>

          {/* Tab selector */}
          <div className="ep-team-invitation-tabs flex items-center gap-1 bg-muted/60 p-1 rounded-lg border text-xs">
            <button
              type="button"
              onClick={() => setInvitationTab('pending')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                invitationTab === 'pending'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Pending <AdminQueueBadge section="team" />
            </button>
            <button
              type="button"
              onClick={() => setInvitationTab('accepted')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                invitationTab === 'accepted'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Accepted History ({acceptedInvitations.length})
            </button>
            <button
              type="button"
              onClick={() => setInvitationTab('archived')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                invitationTab === 'archived'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Revoked / Expired ({historicalInvitations.length})
            </button>
          </div>
        </div>

        {/* Tab 1: Pending Invitations */}
        {invitationTab === 'pending' && (
          <div>
            {pendingInvitations.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No pending invitations awaiting acceptance.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {pendingInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 transition-colors hover:bg-muted/10"
                  >
                    <div className="flex items-start sm:items-center gap-3.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">
                            {inv.email}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50 font-medium">
                            {inv.role === 'OWNER' ? 'Platform Owner' : 'Administrator'}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <Clock className="h-3 w-3" />
                            Pending Acceptance
                          </span>
                          {inv.emailDeliveryFailed && (
                            <span
                              title="The email delivery service reported a delivery issue. You can resend or have the recipient register and sign in."
                              className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-400"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Delivery Notice
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          <span>
                            Invited by {inv.invitedBy.fullName || inv.invitedBy.email}
                          </span>
                          <span>•</span>
                          <span>Sent {new Date(inv.createdAt).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>
                            Expires {new Date(inv.expiresAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {isOwner && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={resendingInviteId === inv.id}
                            onClick={() => handleResendInvitation(inv)}
                            className="gap-1.5"
                          >
                            {resendingInviteId === inv.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            Resend
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setRevokeInviteTarget(inv)}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            Revoke
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Accepted / Approved History */}
        {invitationTab === 'accepted' && (
          <div>
            <div className="px-6 py-3 bg-muted/10 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Accepted invitation history records. Clearing historical entries does{' '}
                <strong>not</strong> revoke administrator access or modify audit logs.
              </span>
              {isOwner && acceptedInvitations.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkClearModalOpen(true)}
                  className="self-end sm:self-center text-xs h-7 gap-1.5 text-muted-foreground hover:text-foreground border-dashed"
                >
                  <History className="h-3 w-3" />
                  Clear Accepted History
                </Button>
              )}
            </div>

            {acceptedInvitations.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No accepted invitation records in history.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {acceptedInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 transition-colors hover:bg-muted/10"
                  >
                    <div className="flex items-start sm:items-center gap-3.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">
                            {inv.email}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50 font-medium">
                            {inv.role === 'OWNER' ? 'Platform Owner' : 'Administrator'}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Accepted
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          <span>
                            Invited by {inv.invitedBy.fullName || inv.invitedBy.email}
                          </span>
                          <span>•</span>
                          <span>
                            Invited {new Date(inv.createdAt).toLocaleDateString()}
                          </span>
                          {inv.acceptedAt && (
                            <>
                              <span>•</span>
                              <span>
                                Accepted {new Date(inv.acceptedAt).toLocaleDateString()}
                              </span>
                            </>
                          )}
                          {inv.acceptedBy && (
                            <>
                              <span>•</span>
                              <span>
                                Claimed by{' '}
                                {inv.acceptedBy.fullName || inv.acceptedBy.email}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {isOwner && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSingleClearTarget(inv)}
                          className="text-muted-foreground hover:text-destructive text-xs"
                          title="Clear this record from history"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Clear Entry
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Revoked / Expired History */}
        {invitationTab === 'archived' && (
          <div>
            <div className="px-6 py-3 bg-muted/10 border-b text-xs text-muted-foreground">
              Historical records of invitations that expired or were cancelled before
              acceptance.
            </div>

            {historicalInvitations.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No revoked or expired invitation records found.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {historicalInvitations.map((inv) => {
                  const isRevoked = inv.status === 'REVOKED';
                  return (
                    <div
                      key={inv.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 transition-colors hover:bg-muted/10 opacity-80 hover:opacity-100"
                    >
                      <div className="flex items-start sm:items-center gap-3.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-foreground">
                              {inv.email}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50 font-medium">
                              {inv.role === 'OWNER' ? 'Platform Owner' : 'Administrator'}
                            </span>
                            {isRevoked ? (
                              <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                                Revoked
                              </span>
                            ) : (
                              <span className="rounded-full border border-muted-foreground/30 bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                                Expired
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                            <span>
                              Invited by {inv.invitedBy.fullName || inv.invitedBy.email}
                            </span>
                            <span>•</span>
                            <span>
                              Created {new Date(inv.createdAt).toLocaleDateString()}
                            </span>
                            <span>•</span>
                            <span>
                              Expires {new Date(inv.expiresAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {isOwner && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSingleClearTarget(inv)}
                            className="text-muted-foreground hover:text-destructive text-xs"
                            title="Clear this record from history"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invite Administrator Modal */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Invite Administrator"
        description="Send an invitation to grant administrative access. The invitee must authenticate and accept before privileges take effect."
        maxWidth="md"
      >
        <form onSubmit={handleInviteSubmit} className="space-y-4 pt-2">
          {inviteError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{inviteError}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="invite-email"
              className="block text-xs font-semibold text-foreground mb-1.5"
            >
              Email Address
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              If the colleague does not have an account yet, they can register with this
              email and accept.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Assigned Role
            </label>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <ShieldCheck className="h-4 w-4 text-blue-500" />
                Administrator
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Granted access to manage events, moderate users, view bookings, and
                inspect audit logs. Platform Owner status remains strictly reserved.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              disabled={inviteLoading}
              onClick={() => setInviteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={inviteLoading} className="gap-2">
              {inviteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Invitation
            </Button>
          </div>
        </form>
      </Modal>

      {/* Revoke Member Access Modal */}
      <Modal
        isOpen={Boolean(revokeMemberTarget)}
        onClose={() => setRevokeMemberTarget(null)}
        title="Revoke Administrator Access?"
        description={`Are you sure you want to revoke administrative permissions for ${revokeMemberTarget?.email}? They will immediately lose access to the admin dashboard. Their existing attendee and organizer capabilities will remain intact.`}
        confirmLabel="Revoke Admin Access"
        confirmVariant="destructive"
        isLoading={revokeMemberLoading}
        onConfirm={handleConfirmRevokeMemberAccess}
      />

      {/* Revoke Pending Invitation Modal */}
      <Modal
        isOpen={Boolean(revokeInviteTarget)}
        onClose={() => setRevokeInviteTarget(null)}
        title="Revoke Pending Invitation?"
        description={`Are you sure you want to revoke the invitation for ${revokeInviteTarget?.email}? Any invitation link sent to this email will be immediately invalidated.`}
        confirmLabel="Revoke Invitation"
        confirmVariant="destructive"
        isLoading={revokeInviteLoading}
        onConfirm={handleConfirmRevokeInvitation}
      />

      {/* Bulk Clear Accepted History Modal */}
      <Modal
        isOpen={bulkClearModalOpen}
        onClose={() => setBulkClearModalOpen(false)}
        title="Clear Accepted Invitation History?"
        description="Are you sure you want to clear all accepted invitation entries from this view? Active administrators will NOT be revoked, and security audit logs are safely preserved."
        confirmLabel="Clear Accepted Records"
        confirmVariant="destructive"
        isLoading={bulkClearLoading}
        onConfirm={handleConfirmBulkClear}
      />

      {/* Clear Single History Record Modal */}
      <Modal
        isOpen={Boolean(singleClearTarget)}
        onClose={() => setSingleClearTarget(null)}
        title="Clear Invitation History Record?"
        description={`Remove historical invitation record for ${singleClearTarget?.email}? Active administrator accounts and audit logs will not be affected.`}
        confirmLabel="Clear Record"
        confirmVariant="destructive"
        isLoading={singleClearLoading}
        onConfirm={handleConfirmClearSingleHistory}
      />
    </div>
  );
}
