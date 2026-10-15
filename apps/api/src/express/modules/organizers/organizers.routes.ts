import { Router, type RequestHandler } from 'express';
import {
  becomeOrganizerSchema,
  createSeatSectionSchema,
  createVenueSchema,
  updateVenueSchema,
  validateTicketSchema,
} from '@eventai/validation';
import { validateBody, validateUuidParam } from '../../middleware/validation';
import { UserRole } from '@eventai/types';
import type { ExpressOrganizersController } from './organizers.controller';

export interface OrganizersRouterDependencies {
  controller: ExpressOrganizersController;
  authenticateJwt: RequestHandler;
  requireRoles: (...roles: UserRole[]) => RequestHandler;
}

export function createOrganizersRouter({
  controller,
  authenticateJwt,
  requireRoles,
}: OrganizersRouterDependencies): Router {
  const router = Router();

  // All organizer routes require authentication
  router.use(authenticateJwt);

  // Application / profile creation (attendees can apply)
  router.post('/', validateBody(becomeOrganizerSchema), controller.becomeOrganizer);
  router.post('/apply', validateBody(becomeOrganizerSchema), controller.becomeOrganizer);

  // Authenticated profile & status
  router.get('/me', controller.getMe);
  router.delete('/me', requireRoles(UserRole.ORGANIZER), controller.leaveOrganizer);

  // Organizer operations (requires ORGANIZER role and verified organizer profile)
  router.get('/me/events', requireRoles(UserRole.ORGANIZER), controller.listOwnEvents);
  router.get('/me/stats', requireRoles(UserRole.ORGANIZER), controller.getDashboardStats);

  // Organizer Venues
  router.post(
    '/venues',
    requireRoles(UserRole.ORGANIZER),
    validateBody(createVenueSchema),
    controller.createVenue,
  );
  router.get('/venues', requireRoles(UserRole.ORGANIZER), controller.listOwnVenues);
  router.patch(
    '/venues/:venueId',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('venueId'),
    validateBody(updateVenueSchema),
    controller.updateVenue,
  );
  router.delete(
    '/venues/:venueId',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('venueId'),
    controller.deleteVenue,
  );

  // Seat Sections
  router.post(
    '/venues/:venueId/sections',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('venueId'),
    validateBody(createSeatSectionSchema),
    controller.createSeatSection,
  );
  router.get(
    '/venues/:venueId/sections',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('venueId'),
    controller.listSeatSections,
  );

  // Tickets & Check-in
  router.post(
    '/events/:eventId/tickets/validate',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('eventId'),
    validateBody(validateTicketSchema),
    controller.validateTicket,
  );
  router.get(
    '/events/:eventId/tickets/stats',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('eventId'),
    controller.eventTicketStats,
  );
  router.get(
    '/events/:eventId/bookings',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('eventId'),
    controller.eventAttendees,
  );

  // Organizer Refunds
  router.get('/refund-requests', requireRoles(UserRole.ORGANIZER), controller.refundRequests);
  router.post(
    '/refund-requests/:bookingId/approve',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('bookingId'),
    controller.approveRefundRequest,
  );
  router.post(
    '/refund-requests/:bookingId/reject',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('bookingId'),
    controller.rejectRefundRequest,
  );
  router.post(
    '/refund-requests/:bookingId/reconcile',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('bookingId'),
    controller.reconcileRefundRequest,
  );
  router.post(
    '/refund-requests/:bookingId/recover',
    requireRoles(UserRole.ORGANIZER),
    validateUuidParam('bookingId'),
    controller.recoverRefundRequest,
  );

  return router;
}
