'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield,
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  listAdminTeam,
  inviteAdminMember,
  resendAdminInvitation,
  revokeAdminInvitation,
  revokeAdminMemberAccess,
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

  // Modals state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AdminRoleType>('ADMIN');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Revoke member access modal
  const [revokeMemberTarget, setRevokeMemberTarget] = useState<AdminTeamMember | null>(null);
  const [revokeMemberLoading, setRevokeMemberLoading] = useState(false);

  // Revoke invitation modal
  const [revokeInviteTarget, setRevokeInviteTarget] = useState<AdminInvitationSummary | null>(null);
  const [revokeInviteLoading, setRevokeInviteLoading] = useState(false);

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
      await inviteAdminMember({
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setSuccessMessage(`Invitation successfully sent to ${inviteEmail.trim()}`);
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
      await resendAdminInvitation(invitation.id);
      setSuccessMessage(`Invitation resent to ${invitation.email}`);
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

  // Filter members and invitations by search query
  const filteredMembers = useMemo(() => {
    if (!data?.members) return [];
    if (!searchQuery.trim()) return data.members;
    const q = searchQuery.toLowerCase();
    return data.members.filter(
      (m) => m.email.toLowerCase().includes(q) || m.fullName.toLowerCase().includes(q),
    );
  }, [data?.members, searchQuery]);

  const filteredInvitations = useMemo(() => {
    if (!data?.invitations) return [];
    if (!searchQuery.trim()) return data.invitations;
    const q = searchQuery.toLowerCase();
    return data.invitations.filter((i) => i.email.toLowerCase().includes(q));
  }, [data?.invitations, searchQuery]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
        <p className="text-sm font-medium">Loading administrative team & access...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Team & Access Management
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage administrative personnel, assign delegated roles, and control access permissions.
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
              className="gap-2 shadow-sm"
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
          role="status"
          className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"
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
            {data?.members.filter((m) => m.adminRole === 'OWNER').length ?? 0} Platform Owners,{' '}
            {data?.members.filter((m) => m.adminRole === 'ADMIN').length ?? 0} Delegated
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
            {data?.invitations.filter((i) => i.status === 'PENDING').length ?? 0}
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
            {isOwner ? 'Platform Owner' : 'Delegated Admin'}
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
          <h3 className="font-semibold text-base text-foreground">Active Administrators</h3>
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
            {filteredMembers.map((member) => (
              <div
                key={member.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 transition-colors hover:bg-muted/10"
              >
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                    {member.fullName ? member.fullName.charAt(0).toUpperCase() : member.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">
                        {member.fullName || 'Unnamed Account'}
                      </span>
                      {member.isCurrentUser && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          You
                        </span>
                      )}
                      {member.adminRole === 'OWNER' ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                          <Crown className="h-3 w-3" />
                          Platform Owner
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
                          <ShieldCheck className="h-3 w-3" />
                          Delegated Admin
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
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
                  {isOwner && !member.isCurrentUser && (
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
                  {member.isCurrentUser && (
                    <span className="text-xs text-muted-foreground italic">Current session</span>
                  )}
                  {!isOwner && !member.isCurrentUser && (
                    <span className="text-xs text-muted-foreground italic">View only</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Invitations */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4 bg-muted/20">
          <h3 className="font-semibold text-base text-foreground">Invitations</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pending, accepted, expired, or revoked administrative invitations.
          </p>
        </div>

        {filteredInvitations.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No invitations found.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredInvitations.map((inv) => {
              const isPending = inv.status === 'PENDING';
              const isAccepted = inv.status === 'ACCEPTED';
              const isExpired = inv.status === 'EXPIRED';
              const isRevoked = inv.status === 'REVOKED';

              return (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 transition-colors hover:bg-muted/10"
                >
                  <div className="flex items-start sm:items-center gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{inv.email}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50 font-medium">
                          {inv.role === 'OWNER' ? 'Platform Owner' : 'Delegated Admin'}
                        </span>
                        {isPending && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <Clock className="h-3 w-3" />
                            Pending
                          </span>
                        )}
                        {isAccepted && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Accepted
                          </span>
                        )}
                        {isExpired && (
                          <span className="rounded-full border border-muted-foreground/30 bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                            Expired
                          </span>
                        )}
                        {isRevoked && (
                          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                            Revoked
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                        <span>Invited by {inv.invitedBy.fullName || inv.invitedBy.email}</span>
                        <span>•</span>
                        <span>Created {new Date(inv.createdAt).toLocaleDateString()}</span>
                        {isPending && (
                          <>
                            <span>•</span>
                            <span>Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                          </>
                        )}
                        {isAccepted && inv.acceptedAt && (
                          <>
                            <span>•</span>
                            <span>Accepted {new Date(inv.acceptedAt).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {isOwner && (isPending || isExpired) && (
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
                    )}
                    {isOwner && isPending && (
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
                    )}
                  </div>
                </div>
              );
            })}
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
            <label htmlFor="invite-email" className="block text-xs font-semibold text-foreground mb-1.5">
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
              If the colleague does not have an account yet, they can register with this email and accept.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Assigned Role
            </label>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <ShieldCheck className="h-4 w-4 text-blue-500" />
                Administrator (Delegated Admin)
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Granted access to manage events, moderate users, view bookings, and inspect audit logs. Platform Owner status remains strictly reserved.
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

      {/* Revoke Invitation Modal */}
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
    </div>
  );
}
