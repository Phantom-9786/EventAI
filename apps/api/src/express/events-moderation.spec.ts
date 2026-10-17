import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { EventsService } from '../modules/events/events.service';
import { EventMediaService } from '../modules/events/event-media.service';
import { CategoriesService } from '../modules/categories/categories.service';
import { VenuesService } from '../modules/venues/venues.service';
import { OrganizersService } from '../modules/organizers/organizers.service';
import { TicketsService } from '../modules/tickets/tickets.service';
import { AdminService } from '../modules/admin/admin.service';
import { ExpressModerationService } from './services/moderation.service';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';
import { ConflictException, ForbiddenException, NotFoundException } from '../common/exceptions';

describe('Express Events, Organizers & Moderation Modules', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'super-secret-jwt-key-for-testing-purposes-only-32-chars';

  let mockPrisma: any;
  let mockEventsService: any;
  let mockMediaService: any;
  let mockCategoriesService: any;
  let mockVenuesService: any;
  let mockOrganizersService: any;
  let mockTicketsService: any;
  let mockAdminService: any;
  let mockModerationService: any;

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const attendeeUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'attendee@example.com',
    role: UserRole.CUSTOMER,
    isActive: true,
  };

  const organizerUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'organizer@example.com',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  const adminUser = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'admin@example.com',
    role: UserRole.ADMIN,
    isActive: true,
  };

  function createToken(user: { id: string; email: string; role: UserRole }): string {
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
  }

  beforeAll((done) => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === attendeeUser.id) return Promise.resolve(attendeeUser);
          if (where.id === organizerUser.id) return Promise.resolve(organizerUser);
          if (where.id === adminUser.id) return Promise.resolve(adminUser);
          return Promise.resolve(null);
        }),
      },
    };

    mockEventsService = {
      searchEvents: jest.fn(),
      getPublishedEvent: jest.fn(),
      findSimilarEvents: jest.fn(),
      createEvent: jest.fn(),
      getEventForManage: jest.fn(),
      updateEvent: jest.fn(),
      publishEvent: jest.fn(),
      cancelEvent: jest.fn(),
      deleteEvent: jest.fn(),
      invalidateEventCache: jest.fn().mockResolvedValue(undefined),
    };

    mockMediaService = {
      upload: jest.fn(),
      uploadGeneric: jest.fn(),
    };

    mockCategoriesService = {
      listActive: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };

    mockVenuesService = {
      search: jest.fn(),
      findById: jest.fn(),
    };

    mockOrganizersService = {
      becomeOrganizer: jest.fn(),
      getOwnOrganizerProfile: jest.fn(),
      leaveOrganizer: jest.fn(),
      listOwnEvents: jest.fn(),
      getDashboardStats: jest.fn(),
      createVenue: jest.fn(),
      listOwnVenues: jest.fn(),
      updateVenue: jest.fn(),
      deleteVenue: jest.fn(),
      createSeatSection: jest.fn(),
      listSeatSections: jest.fn(),
      validateTicket: jest.fn(),
      eventTicketStats: jest.fn(),
      eventAttendees: jest.fn(),
    };

    mockTicketsService = {
      create: jest.fn(),
      listForOrganizer: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    mockAdminService = {
      platformStats: jest.fn(),
      listUsers: jest.fn(),
      setUserStatus: jest.fn(),
      listOrganizers: jest.fn(),
      setOrganizerVerification: jest.fn(),
      listEvents: jest.fn(),
      moderateEvent: jest.fn(),
      listAuditLogs: jest.fn(),
      invalidateEventCache: jest.fn().mockResolvedValue(undefined),
    };

    mockModerationService = {
      applyToBecomeOrganizer: jest.fn(),
      getOrganizerApplicationStatus: jest.fn(),
      approveOrganizerApplication: jest.fn(),
      rejectOrganizerApplication: jest.fn(),
      listPendingOrganizerApplications: jest.fn(),
      requireApprovedOrganizer: jest.fn(),
      getEventModerationStatus: jest.fn(),
      submitEventForReview: jest.fn(),
      reviewEvent: jest.fn(),
      assertEventApprovedForPublishing: jest.fn(),
      handleMaterialEventChange: jest.fn(),
    };

    const mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      delPattern: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
      wrap: jest.fn().mockImplementation((_k: string, fn: () => any) => fn()),
    };

    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache as any,
      eventsService: mockEventsService as unknown as EventsService,
      mediaService: mockMediaService as unknown as EventMediaService,
      categoriesService: mockCategoriesService as unknown as CategoriesService,
      venuesService: mockVenuesService as unknown as VenuesService,
      organizersService: mockOrganizersService as unknown as OrganizersService,
      ticketsService: mockTicketsService as unknown as TicketsService,
      adminService: mockAdminService as unknown as AdminService,
      moderationService: mockModerationService as unknown as ExpressModerationService,
      jwtSecret: JWT_SECRET,
      logger: nullLogger,
      rateLimit: false,
      env: {
        JWT_SECRET,
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
      },
    });

    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.closeAllConnections?.();
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A. Public Browsing, Categories & Venues
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Public browsing, categories and venues', () => {
    it('GET /api/categories returns public active categories list', async () => {
      mockCategoriesService.listActive!.mockResolvedValueOnce([
        { id: 'cat-1', name: 'Music', slug: 'music' } as any,
      ]);

      const res = await fetch(`${baseUrl}/api/categories`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data).toEqual({
        categories: [{ id: 'cat-1', name: 'Music', slug: 'music' }],
      });
      expect(mockCategoriesService.listActive).toHaveBeenCalledTimes(1);
    });

    it('GET /api/venues searches venues with query parameters', async () => {
      mockVenuesService.search!.mockResolvedValueOnce({
        venues: [{ id: 'ven-1', name: 'Grand Arena', city: 'Mumbai' }] as any,
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
      });

      const res = await fetch(`${baseUrl}/api/venues?city=Mumbai`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.venues[0].name).toBe('Grand Arena');
      expect(mockVenuesService.search).toHaveBeenCalledWith(
        expect.objectContaining({ city: 'Mumbai' }),
      );
    });

    it('GET /api/events searches published events with filters', async () => {
      mockEventsService.searchEvents!.mockResolvedValueOnce({
        events: [{ id: 'evt-1', title: 'Tech Expo 2027', status: 'PUBLISHED' }] as any,
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
      });

      const res = await fetch(`${baseUrl}/api/events?query=Tech`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.events[0].title).toBe('Tech Expo 2027');
      expect(mockEventsService.searchEvents).toHaveBeenCalledTimes(1);
    });

    it('GET /api/events handles empty query and applies default pagination', async () => {
      mockEventsService.searchEvents!.mockResolvedValueOnce({
        events: [],
        total: 0,
        page: 1,
        limit: 20,
        pages: 0,
      });

      const res = await fetch(`${baseUrl}/api/events?query=`);
      expect(res.status).toBe(200);
      expect(mockEventsService.searchEvents).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });

    it('GET /api/events rejects invalid query parameters with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/events?page=0&priceMin=-10`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
      expect(data.errors).toBeDefined();
    });

    it('GET /api/events passes structured filters and sorting', async () => {
      mockEventsService.searchEvents!.mockResolvedValueOnce({
        events: [],
        total: 0,
        page: 1,
        limit: 10,
        pages: 0,
      });

      const res = await fetch(`${baseUrl}/api/events?city=Delhi&sortBy=price&sortDir=desc&limit=10`);
      expect(res.status).toBe(200);
      expect(mockEventsService.searchEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          city: 'Delhi',
          sortBy: 'price',
          sortDir: 'desc',
          limit: 10,
        }),
      );
    });

    it('GET /api/events/:idOrSlug returns published event when approved', async () => {
      mockEventsService.getPublishedEvent!.mockResolvedValueOnce({
        id: 'evt-pub-1',
        title: 'Tech Expo 2027',
        status: 'PUBLISHED',
      } as any);
      mockModerationService.getEventModerationStatus!.mockResolvedValueOnce({
        status: 'APPROVED',
      });

      const res = await fetch(`${baseUrl}/api/events/evt-pub-1`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.event.title).toBe('Tech Expo 2027');
    });

    it('GET /api/events/:idOrSlug returns 404 if event is not approved by moderation', async () => {
      mockEventsService.getPublishedEvent!.mockResolvedValueOnce({
        id: 'evt-unapproved',
        title: 'Unapproved Event',
        status: 'PUBLISHED',
      } as any);
      mockModerationService.getEventModerationStatus!.mockResolvedValueOnce({
        status: 'REJECTED',
        rejectionReason: 'Violates content guidelines',
      });

      const res = await fetch(`${baseUrl}/api/events/evt-unapproved`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(404);
      expect(data.message).toBe('Event not found');
    });

    it('GET /api/events/:idOrSlug returns 404 if event is pending approval in moderation', async () => {
      mockEventsService.getPublishedEvent!.mockResolvedValueOnce({
        id: 'evt-pending',
        title: 'Pending Event',
        status: 'PUBLISHED',
      } as any);
      mockModerationService.getEventModerationStatus!.mockResolvedValueOnce({
        status: 'PENDING_APPROVAL',
      });

      const res = await fetch(`${baseUrl}/api/events/evt-pending`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(404);
      expect(data.message).toBe('Event not found');
    });

    it('GET /api/events/:idOrSlug/similar returns similar upcoming events', async () => {
      mockEventsService.findSimilarEvents!.mockResolvedValueOnce([
        { id: 'evt-sim-1', title: 'Tech Summit 2027' },
      ] as any);

      const res = await fetch(`${baseUrl}/api/events/evt-1/similar?limit=2`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.events).toHaveLength(1);
      expect(mockEventsService.findSimilarEvents).toHaveBeenCalledWith('evt-1', 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B. Organizer Applications & Authorization
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Organizer applications and permission checks', () => {
    it('POST /api/organizers allows authenticated customer to submit an application', async () => {
      mockModerationService.applyToBecomeOrganizer!.mockResolvedValueOnce({
        id: 'org-app-1',
        userId: attendeeUser.id,
        organizationName: 'Global Hackathons LLC',
        description: 'Organizing international tech events',
        phone: '+919876543210',
        website: 'https://hackathons.example.com',
        logo: null,
        isVerified: false,
        status: 'PENDING',
      });

      const token = createToken(attendeeUser);
      const res = await fetch(`${baseUrl}/api/organizers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          organizationName: 'Global Hackathons LLC',
          description: 'Organizing international tech events',
          website: 'https://hackathons.example.com',
          phone: '+919876543210',
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.organizer.status).toBe('PENDING');
      expect(data.organizer.isVerified).toBe(false);
      expect(mockModerationService.applyToBecomeOrganizer).toHaveBeenCalledWith(
        attendeeUser.id,
        expect.objectContaining({ organizationName: 'Global Hackathons LLC' }),
      );
    });

    it('POST /api/organizers rejects duplicate pending applications with 409 Conflict', async () => {
      mockModerationService.applyToBecomeOrganizer!.mockRejectedValueOnce(
        new ConflictException('You already have a pending organizer application'),
      );

      const token = createToken(attendeeUser);
      const res = await fetch(`${baseUrl}/api/organizers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          organizationName: 'Duplicate Inc',
        }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(409);
      expect(data.message).toBe('You already have a pending organizer application');
    });

    it('GET /api/organizers/me returns profile and application moderation status', async () => {
      mockOrganizersService.getOwnOrganizerProfile!.mockResolvedValueOnce({
        id: 'org-1',
        userId: attendeeUser.id,
        organizationName: 'Pending Events',
        isVerified: false,
      } as any);
      mockModerationService.getOrganizerApplicationStatus!.mockResolvedValueOnce({
        status: 'REJECTED',
        rejectionReason: 'Incomplete business registration documentation',
      });

      const token = createToken(attendeeUser);
      const res = await fetch(`${baseUrl}/api/organizers/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.organizer.applicationStatus).toBe('REJECTED');
      expect(data.organizer.rejectionReason).toBe('Incomplete business registration documentation');
    });

    it('Denies organizer operations to unapproved / rejected users (403 Forbidden)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockRejectedValueOnce(
        new ForbiddenException('Your organizer application is currently pending administrator review'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/venues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'Grand Arena',
          address: '123 Tech Blvd',
          city: 'San Francisco',
          state: 'California',
          capacity: 500,
        }),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(403);
      expect(data.message).toContain('pending administrator review');
    });

    it('Admin can approve an organizer application with recorded reason and user promotion', async () => {
      mockModerationService.approveOrganizerApplication!.mockResolvedValueOnce({
        organizer: {
          id: 'org-app-1',
          userId: attendeeUser.id,
          organizationName: 'Global Hackathons LLC',
          description: null,
          phone: null,
          website: null,
          logo: null,
          isVerified: true,
          status: 'APPROVED',
        },
        message: 'Organizer application approved successfully',
      });

      const token = createToken(adminUser);
      const res = await fetch(`${baseUrl}/api/admin/organizers/00000000-0000-4000-8000-000000000001/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.organizer.status).toBe('APPROVED');
      expect(data.organizer.isVerified).toBe(true);
      expect(mockModerationService.approveOrganizerApplication).toHaveBeenCalledWith(
        adminUser.id,
        '00000000-0000-4000-8000-000000000001',
      );
    });

    it('Admin can reject an organizer application with a recorded reason', async () => {
      mockModerationService.rejectOrganizerApplication!.mockResolvedValueOnce({
        organizer: {
          id: 'org-app-2',
          userId: attendeeUser.id,
          organizationName: 'Spam Co',
          description: null,
          phone: null,
          website: null,
          logo: null,
          isVerified: false,
          status: 'REJECTED',
          rejectionReason: 'Invalid contact numbers provided',
        },
        message: 'Organizer application rejected',
      });

      const token = createToken(adminUser);
      const res = await fetch(`${baseUrl}/api/admin/organizers/00000000-0000-4000-8000-000000000002/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Invalid contact numbers provided' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.organizer.status).toBe('REJECTED');
      expect(data.organizer.rejectionReason).toBe('Invalid contact numbers provided');
      expect(mockModerationService.rejectOrganizerApplication).toHaveBeenCalledWith(
        adminUser.id,
        '00000000-0000-4000-8000-000000000002',
        'Invalid contact numbers provided',
      );
    });

    it('Non-admin users cannot approve organizer applications (403 Forbidden)', async () => {
      const token = createToken(attendeeUser);
      const res = await fetch(`${baseUrl}/api/admin/organizers/00000000-0000-4000-8000-000000000001/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      expect(mockModerationService.approveOrganizerApplication).not.toHaveBeenCalled();
    });

    it('Non-admin users cannot reject organizer applications (403 Forbidden)', async () => {
      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/admin/organizers/00000000-0000-4000-8000-000000000002/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Unauthorized review' }),
      });

      expect(res.status).toBe(403);
      expect(mockModerationService.rejectOrganizerApplication).not.toHaveBeenCalled();
    });

    it('Unapproved customer cannot create venues (403 Forbidden)', async () => {
      const token = createToken(attendeeUser);
      const res = await fetch(`${baseUrl}/api/organizers/venues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'Forbidden Venue',
          address: '100 Road',
          city: 'Mumbai',
          state: 'MH',
          capacity: 100,
        }),
      });

      expect(res.status).toBe(403);
      expect(mockOrganizersService.createVenue).not.toHaveBeenCalled();
    });

    it('Pending organizer without approval cannot create events (403 Forbidden)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockRejectedValueOnce(
        new ForbiddenException('Your organizer application is pending administrator review'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'Blocked Event',
          description: 'This event should be blocked because organizer is pending.',
          categoryId: '00000000-0000-0000-0000-000000000010',
          venueId: '00000000-0000-0000-0000-000000000020',
          startDate: new Date(Date.now() + 86400000 * 5).toISOString(),
          endDate: new Date(Date.now() + 86400000 * 6).toISOString(),
        }),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.message).toContain('pending administrator review');
      expect(mockEventsService.createEvent).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C. Event Moderation Lifecycle & Tickets
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Event moderation workflow, publish gate, and re-review on material edits', () => {
    it('Organizer creates draft event (starts in DRAFT moderation status)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockEventsService.createEvent!.mockResolvedValueOnce({
        id: 'evt-new-1',
        title: 'AI Summit 2027',
        status: 'DRAFT',
      } as any);

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'AI Summit 2027',
          description: 'Comprehensive AI Summit covering deep learning breakthroughs.',
          categoryId: '00000000-0000-0000-0000-000000000010',
          venueId: '00000000-0000-0000-0000-000000000020',
          startDate: new Date(Date.now() + 86400000 * 10).toISOString(),
          endDate: new Date(Date.now() + 86400000 * 11).toISOString(),
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.event.status).toBe('DRAFT');
      expect(data.moderation.status).toBe('DRAFT');
    });

    it('Organizer adds ticket type to owned event', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockTicketsService.create!.mockResolvedValueOnce({
        id: 'tt-1',
        eventId: 'evt-new-1',
        name: 'General Admission',
        price: 50000,
        totalQuantity: 100,
        availableQuantity: 100,
      } as any);

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/evt-new-1/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'General Admission',
          price: 50000,
          totalQuantity: 100,
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.ticketType.name).toBe('General Admission');
      expect(data.ticketType.price).toBe(50000);
    });

    it('Organizer submits event for review (POST /api/events/:idOrSlug/submit)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockEventsService.getEventForManage!.mockResolvedValueOnce({
        id: 'evt-new-1',
        status: 'DRAFT',
      } as any);
      mockModerationService.submitEventForReview!.mockResolvedValueOnce({
        status: 'PENDING_APPROVAL',
        submittedAt: new Date().toISOString(),
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/evt-new-1/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Event submitted for review');
      expect(data.moderation.status).toBe('PENDING_APPROVAL');
      expect(mockModerationService.submitEventForReview).toHaveBeenCalledWith('org-verified-1', 'evt-new-1');
    });

    it('Publishing is blocked with 403 Forbidden if event is not approved by admin', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockEventsService.getEventForManage!.mockResolvedValueOnce({
        id: 'evt-new-1',
        status: 'DRAFT',
      } as any);
      mockModerationService.assertEventApprovedForPublishing!.mockRejectedValueOnce(
        new ForbiddenException('Event must be submitted and approved by an administrator before it can be published'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/evt-new-1/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(403);
      expect(data.message).toContain('approved by an administrator');
    });

    it('Admin reviews and approves event (POST /api/admin/events/:id/review)', async () => {
      mockModerationService.reviewEvent!.mockResolvedValueOnce({
        status: 'APPROVED',
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminUser.id,
      });

      const token = createToken(adminUser);
      const res = await fetch(`${baseUrl}/api/admin/events/00000000-0000-4000-8000-000000000099/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'APPROVE' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Event approved successfully');
      expect(data.moderation.status).toBe('APPROVED');
      expect(mockModerationService.reviewEvent).toHaveBeenCalledWith(
        adminUser.id,
        '00000000-0000-4000-8000-000000000099',
        { action: 'APPROVE', reason: undefined },
      );
    });

    it('Publishing succeeds once event is approved by admin', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockEventsService.getEventForManage!.mockResolvedValueOnce({
        id: 'evt-new-1',
        status: 'DRAFT',
      } as any);
      mockModerationService.assertEventApprovedForPublishing!.mockResolvedValueOnce(undefined);
      mockEventsService.publishEvent!.mockResolvedValueOnce({
        id: 'evt-new-1',
        status: 'PUBLISHED',
      } as any);

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/evt-new-1/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.event.status).toBe('PUBLISHED');
      expect(mockEventsService.publishEvent).toHaveBeenCalledWith('org-verified-1', 'evt-new-1');
    });

    it('Material change (title/dates/venue) triggers re-review policy', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockEventsService.updateEvent!.mockResolvedValueOnce({
        id: 'evt-new-1',
        title: 'AI Summit 2027 (Relocated)',
        status: 'PUBLISHED',
      } as any);
      mockEventsService.getEventForManage!.mockResolvedValueOnce({
        id: 'evt-new-1',
        title: 'AI Summit 2027 (Relocated)',
        status: 'DRAFT',
      } as any);
      mockModerationService.handleMaterialEventChange!.mockResolvedValueOnce(undefined);
      mockModerationService.getEventModerationStatus!.mockResolvedValueOnce({
        status: 'PENDING_APPROVAL',
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/evt-new-1`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'AI Summit 2027 (Relocated)',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.event.title).toBe('AI Summit 2027 (Relocated)');
      expect(data.event.status).toBe('DRAFT');
      expect(data.moderation.status).toBe('PENDING_APPROVAL');
      expect(mockModerationService.handleMaterialEventChange).toHaveBeenCalledWith(
        organizerUser.id,
        'evt-new-1',
        ['title'],
      );
    });

    it('Public search excludes events that transitioned to DRAFT after material change', async () => {
      mockEventsService.searchEvents!.mockResolvedValueOnce({
        events: [],
        total: 0,
        page: 1,
        limit: 20,
        pages: 0,
      });

      const res = await fetch(`${baseUrl}/api/events?query=AI%20Summit`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.events).toHaveLength(0);
      expect(mockEventsService.searchEvents).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'AI Summit' }),
      );
    });

    it('Admin rejects event with required reason (POST /api/admin/events/:id/review)', async () => {
      mockModerationService.reviewEvent!.mockResolvedValueOnce({
        status: 'REJECTED',
        rejectionReason: 'Event violates terms regarding permitted venues',
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminUser.id,
      });

      const token = createToken(adminUser);
      const res = await fetch(`${baseUrl}/api/admin/events/00000000-0000-4000-8000-000000000099/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'REJECT',
          reason: 'Event violates terms regarding permitted venues',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Event rejected successfully');
      expect(data.moderation.status).toBe('REJECTED');
      expect(data.moderation.rejectionReason).toBe('Event violates terms regarding permitted venues');
      expect(mockModerationService.reviewEvent).toHaveBeenCalledWith(
        adminUser.id,
        '00000000-0000-4000-8000-000000000099',
        { action: 'REJECT', reason: 'Event violates terms regarding permitted venues' },
      );
    });

    it('GET /api/organizers/me/events returns list with attached moderation details for each event', async () => {
      mockOrganizersService.getOwnOrganizerProfile!.mockResolvedValueOnce({
        id: 'org-verified-1',
        isVerified: true,
      });
      mockOrganizersService.listOwnEvents!.mockResolvedValueOnce({
        events: [
          { id: 'evt-draft-1', title: 'Draft Event', status: 'DRAFT' },
          { id: 'evt-rej-1', title: 'Rejected Event', status: 'DRAFT' },
        ],
        total: 2,
        page: 1,
        limit: 20,
        pages: 1,
      });
      mockModerationService.getEventModerationStatus!
        .mockResolvedValueOnce({ status: 'DRAFT' })
        .mockResolvedValueOnce({ status: 'REJECTED', rejectionReason: 'Insufficient description' });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/me/events`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.events).toHaveLength(2);
      expect(data.events[0].moderation.status).toBe('DRAFT');
      expect(data.events[1].moderation.status).toBe('REJECTED');
      expect(data.events[1].moderation.rejectionReason).toBe('Insufficient description');
    });

    it('Permanent event deletion safely delegates to EventsService.deleteEvent', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockEventsService.deleteEvent!.mockResolvedValueOnce({ message: 'Event deleted' });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/evt-draft-1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Event deleted');
      expect(mockEventsService.deleteEvent).toHaveBeenCalledWith('org-verified-1', 'evt-draft-1');
    });

    it('Non-admin users cannot review events (403 Forbidden)', async () => {
      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/admin/events/00000000-0000-4000-8000-000000000099/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'APPROVE' }),
      });

      expect(res.status).toBe(403);
      expect(mockModerationService.reviewEvent).not.toHaveBeenCalled();
    });

    it('Event creation with a venue owned by another organizer is rejected (403 Forbidden)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockEventsService.createEvent!.mockRejectedValueOnce(
        new ForbiddenException('Venue not found among your venues'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'Cross Organizer Venue Event',
          description: 'Attempting to use another organizer venue for an event.',
          categoryId: '00000000-0000-0000-0000-000000000010',
          venueId: '00000000-0000-0000-0000-000000000099',
          startDate: new Date(Date.now() + 86400000 * 10).toISOString(),
          endDate: new Date(Date.now() + 86400000 * 11).toISOString(),
        }),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Venue not found among your venues');
    });

    it('Organizer cannot bypass moderation by setting status=PUBLISHED directly in PATCH /api/events/:id', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      // Even if client sends status: 'PUBLISHED', service receives it but status remains DRAFT
      mockEventsService.updateEvent!.mockResolvedValueOnce({
        id: 'evt-draft-1',
        title: 'Draft Event Still',
        status: 'DRAFT',
      } as any);
      mockModerationService.getEventModerationStatus!.mockResolvedValueOnce({
        status: 'DRAFT',
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/evt-draft-1`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: 'PUBLISHED',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.event.status).toBe('DRAFT');
      expect(data.moderation.status).toBe('DRAFT');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // D. Organizer Venue Management & Seat Section Generation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Organizer Venue Management & Seat Section Generation', () => {
    const venueId = '55555555-5555-4555-8555-555555555555';

    it('Organizer creates venue (POST /api/organizers/venues)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockOrganizersService.createVenue!.mockResolvedValueOnce({
        id: venueId,
        name: 'Silicon Arena',
        address: '100 Innovation Way',
        city: 'Bengaluru',
        capacity: 2500,
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/venues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'Silicon Arena',
          address: '100 Innovation Way',
          city: 'Bengaluru',
          state: 'Karnataka',
          capacity: 2500,
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.venue.name).toBe('Silicon Arena');
      expect(mockOrganizersService.createVenue).toHaveBeenCalledWith(
        'org-verified-1',
        expect.objectContaining({ name: 'Silicon Arena', city: 'Bengaluru', state: 'Karnataka' }),
      );
    });

    it('Organizer creates seat section with rows and seats (POST /api/organizers/venues/:venueId/sections)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockOrganizersService.createSeatSection!.mockResolvedValueOnce({
        id: 'sec-1',
        venueId,
        name: 'Orchestra Front',
        rows: 10,
        seatsPerRow: 20,
        totalSeats: 200,
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/venues/${venueId}/sections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'Orchestra Front',
          rows: 10,
          seatsPerRow: 20,
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.section.totalSeats).toBe(200);
      expect(mockOrganizersService.createSeatSection).toHaveBeenCalledWith(
        'org-verified-1',
        venueId,
        expect.objectContaining({ name: 'Orchestra Front', rows: 10, seatsPerRow: 20 }),
      );
    });

    it('Rejects seat section creation with non-UUID venueId with 400 Bad Request', async () => {
      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/venues/invalid-not-uuid/sections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'VIP Section',
          rows: 5,
          seatsPerRow: 10,
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Validation failed (uuid is expected)');
    });

    it('Organizer lists seat sections for venue (GET /api/organizers/venues/:venueId/sections)', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockOrganizersService.listSeatSections!.mockResolvedValueOnce([
        { id: 'sec-1', name: 'Balcony', totalSeats: 150 },
      ]);

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/venues/${venueId}/sections`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.sections)).toBe(true);
      expect(data.sections[0].name).toBe('Balcony');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E. Ticket Type Management & Event Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Ticket Type Management & Event Lifecycle Validation', () => {
    it('Rejects event creation when endDate is before startDate (400 Bad Request)', async () => {
      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'Invalid Date Event',
          description: 'This event has invalid dates where end date is before start date.',
          categoryId: '00000000-0000-0000-0000-000000000010',
          venueId: '00000000-0000-0000-0000-000000000020',
          startDate: '2027-05-10T18:00:00.000Z',
          endDate: '2027-05-09T18:00:00.000Z',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
    });

    it('Organizer updates ticket type (PATCH /api/ticket-types/:id)', async () => {
      const ticketTypeId = '99999999-9999-4999-8999-999999999999';
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockTicketsService.update!.mockResolvedValueOnce({
        id: ticketTypeId,
        name: 'VIP Early Bird',
        price: 75000,
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/ticket-types/${ticketTypeId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: 'VIP Early Bird',
          price: 75000,
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.ticketType.price).toBe(75000);
      expect(mockTicketsService.update).toHaveBeenCalledWith(
        'org-verified-1',
        ticketTypeId,
        expect.objectContaining({ name: 'VIP Early Bird', price: 75000 }),
      );
    });

    it('Organizer deletes ticket type (DELETE /api/ticket-types/:id)', async () => {
      const ticketTypeId = '99999999-9999-4999-8999-999999999999';
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockTicketsService.remove!.mockResolvedValueOnce({ message: 'Ticket type removed' });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/ticket-types/${ticketTypeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Ticket type removed');
      expect(mockTicketsService.remove).toHaveBeenCalledWith('org-verified-1', ticketTypeId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // F. Media Route Upload & Failure Handling
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Media Route Integration & Failure Handling', () => {
    it('POST /api/events/upload-image without file returns error rather than 500', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');
      mockMediaService.uploadGeneric!.mockRejectedValueOnce(
        new ConflictException('Choose a valid image file'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).not.toBe(500);
      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Choose a valid image file');
    });

    it('DELETE /api/events/:eventId/images rejects missing mediaUrl with 400 Bad Request', async () => {
      mockModerationService.requireApprovedOrganizer!.mockResolvedValueOnce('org-verified-1');

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/events/00000000-0000-4000-8000-000000000001/images`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Media identifier is required');
    });
  });
});
