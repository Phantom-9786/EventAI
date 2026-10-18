import { Router, type RequestHandler } from 'express';
import {
  adminModerateEventSchema,
  adminSetOrganizerVerificationSchema,
  adminSetUserStatusSchema,
  adminUpdateSystemControlsSchema,
  adminInviteTeamMemberSchema,
  adminAcceptInvitationSchema,
  adminLinkMaintenanceTesterSchema,
} from '@eventai/validation';
import { validateBody, validateUuidParam } from '../../middleware/validation';
import { UserRole } from '@eventai/types';
import type { ExpressAdminController } from './admin.controller';

export interface AdminRouterDependencies {
  controller: ExpressAdminController;
  authenticateJwt: RequestHandler;
  requireRoles: (...roles: UserRole[]) => RequestHandler;
}

export function createAdminRouter({
  controller,
  authenticateJwt,
  requireRoles,
}: AdminRouterDependencies): Router {
  const router = Router();

  // Authentication required for all endpoints
  router.use(authenticateJwt);

  // Invitation acceptance can be performed by any authenticated user who was invited
  router.post(
    '/team/invitations/accept',
    validateBody(adminAcceptInvitationSchema),
    controller.acceptInvitation,
  );

  // All administrative operations require ADMIN role
  router.use(requireRoles(UserRole.ADMIN));

  // Team & Access management
  router.get('/team', controller.listTeam);
  router.post(
    '/team/invitations',
    validateBody(adminInviteTeamMemberSchema),
    controller.inviteAdministrator,
  );
  router.post(
    '/team/invitations/:id/resend',
    validateUuidParam('id'),
    controller.resendInvitation,
  );
  router.post(
    '/team/invitations/:id/revoke',
    validateUuidParam('id'),
    controller.revokeInvitation,
  );
  router.delete(
    '/team/invitations/:id',
    validateUuidParam('id'),
    controller.deleteInvitationHistory,
  );
  router.post(
    '/team/invitations/clear-accepted',
    controller.clearAcceptedInvitations,
  );
  router.post(
    '/team/members/:id/revoke',
    validateUuidParam('id'),
    controller.revokeAdminAccess,
  );

  // Authorized Maintenance Testers management
  router.get('/maintenance-testers', controller.listMaintenanceTesters);
  router.post(
    '/maintenance-testers',
    validateBody(adminLinkMaintenanceTesterSchema),
    controller.linkMaintenanceTester,
  );
  router.post('/maintenance-testers/unlink', controller.unlinkMaintenanceTester);
  router.post('/maintenance-testers/switch-session', controller.switchTesterSession);

  // Platform stats
  router.get('/stats', controller.stats);

  // User management
  router.get('/users', controller.listUsers);
  router.patch(
    '/users/:id/status',
    validateUuidParam('id'),
    validateBody(adminSetUserStatusSchema),
    controller.setUserStatus,
  );

  // Booking & payment oversight
  router.get('/bookings', controller.listBookings);
  router.get('/bookings/:id', validateUuidParam('id'), controller.bookingDetail);
  router.post('/bookings/:id/refund/reconcile', validateUuidParam('id'), controller.reconcileRefund);
  router.post('/bookings/:id/refund/recover', validateUuidParam('id'), controller.recoverRefund);

  // Organizer management & applications
  router.get('/organizers', controller.listOrganizers);
  router.get('/organizers/applications/pending', controller.listPendingApplications);
  router.patch(
    '/organizers/:id/verification',
    validateUuidParam('id'),
    validateBody(adminSetOrganizerVerificationSchema),
    controller.setOrganizerVerification,
  );
  router.post('/organizers/:id/approve', validateUuidParam('id'), controller.approveOrganizer);
  router.post('/organizers/:id/reject', validateUuidParam('id'), controller.rejectOrganizer);

  // Event management & moderation
  router.get('/events', controller.listEvents);
  router.get('/events/:id', validateUuidParam('id'), controller.getEventDetail);
  router.post(
    '/events/:id/moderate',
    validateUuidParam('id'),
    validateBody(adminModerateEventSchema),
    controller.moderateEvent,
  );
  router.post('/events/:id/review', validateUuidParam('id'), controller.reviewEvent);

  // Audit logs
  router.get('/audit-logs', controller.listAuditLogs);

  // System controls & maintenance modes
  router.get('/system-controls', controller.getSystemControls);
  router.patch(
    '/system-controls',
    validateBody(adminUpdateSystemControlsSchema),
    controller.updateSystemControls,
  );

  return router;
}
