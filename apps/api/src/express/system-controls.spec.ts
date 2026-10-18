import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';
import { SystemControlsService } from '../modules/admin/system-controls.service';

describe('System Controls & Maintenance Modes Integration', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const adminUser = {
    id: 'admin-uuid-1',
    email: 'admin@eventpoint.test',
    role: UserRole.ADMIN,
    isActive: true,
  };

  const organizerUser = {
    id: 'organizer-uuid-1',
    email: 'organizer@eventpoint.test',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  const customerUser = {
    id: 'customer-uuid-1',
    email: 'customer@eventpoint.test',
    role: UserRole.CUSTOMER,
    isActive: true,
  };

  const testerCustomerUser = {
    id: 'tester-customer-uuid',
    email: 'tester-customer@eventpoint.test',
    role: UserRole.CUSTOMER,
    isActive: true,
  };

  const testerOrganizerUser = {
    id: 'tester-organizer-uuid',
    email: 'tester-organizer@eventpoint.test',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  let mockPrisma: any;
  let mockSystemControlsService: any;
  let adminToken: string;
  let organizerToken: string;
  let customerToken: string;
  let testerCustomerToken: string;
  let testerOrganizerToken: string;

  beforeAll((done) => {
    adminToken = jwt.sign(
      { sub: adminUser.id, email: adminUser.email, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    organizerToken = jwt.sign(
      { sub: organizerUser.id, email: organizerUser.email, role: organizerUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    customerToken = jwt.sign(
      { sub: customerUser.id, email: customerUser.email, role: customerUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    testerCustomerToken = jwt.sign(
      { sub: testerCustomerUser.id, email: testerCustomerUser.email, role: testerCustomerUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    testerOrganizerToken = jwt.sign(
      { sub: testerOrganizerUser.id, email: testerOrganizerUser.email, role: testerOrganizerUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === adminUser.id) return Promise.resolve(adminUser);
          if (where.id === organizerUser.id) return Promise.resolve(organizerUser);
          if (where.id === customerUser.id) return Promise.resolve(customerUser);
          if (where.id === testerCustomerUser.id) return Promise.resolve(testerCustomerUser);
          if (where.id === testerOrganizerUser.id) return Promise.resolve(testerOrganizerUser);
          return Promise.resolve(null);
        }),
      },
      organizer: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === organizerUser.id || where.userId === organizerUser.id) {
            return Promise.resolve({
              id: organizerUser.id,
              userId: organizerUser.id,
              organizationName: 'Organizer Org',
              isVerified: true,
            });
          }
          if (where.id === testerOrganizerUser.id || where.userId === testerOrganizerUser.id) {
            return Promise.resolve({
              id: testerOrganizerUser.id,
              userId: testerOrganizerUser.id,
              organizationName: 'Tester Organizer Org',
              isVerified: true,
            });
          }
          return Promise.resolve(null);
        }),
      },
    };

    let currentSettings = {
      websiteMaintenance: false,
      websiteMaintenanceMessage: 'Site maintenance',
      aiMaintenance: false,
      aiMaintenanceMessage: 'AI maintenance',
      eventCreationMaintenance: false,
      eventCreationMaintenanceMessage: 'Creation maintenance',
    };

    mockSystemControlsService = {
      getSettings: jest.fn().mockImplementation(() => Promise.resolve({ ...currentSettings })),
      updateSettings: jest.fn().mockImplementation((_userId, updates) => {
        currentSettings = { ...currentSettings, ...updates };
        return Promise.resolve({ ...currentSettings });
      }),
      isAuthorizedMaintenanceTester: jest.fn().mockImplementation((userId) => {
        return Promise.resolve(userId === 'tester-customer-uuid' || userId === 'tester-organizer-uuid');
      }),
      verifyTesterSessionAcquisition: jest.fn().mockImplementation((callerAdminId, targetEmail) => {
        if (callerAdminId !== adminUser.id) {
          const err = new Error('Only active administrators can switch to maintenance test accounts');
          (err as any).status = 403;
          throw err;
        }
        if (targetEmail === 'unlinked@eventpoint.test') {
          const err = new Error(
            'Test account unlinked@eventpoint.test is not registered as an authorized maintenance tester',
          );
          (err as any).status = 404;
          throw err;
        }
        return Promise.resolve({
          id: testerCustomerUser.id,
          email: testerCustomerUser.email,
          role: testerCustomerUser.role,
        });
      }),
    };

    const mockCategoriesService = {
      listActive: jest.fn().mockResolvedValue([
        { id: 'cat-1', name: 'Music', slug: 'music', icon: null, color: null },
      ]),
    };

    const mockAiService = {
      chat: jest.fn().mockResolvedValue({
        reply: 'Hello from AI',
        events: [],
      }),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    const mockEventsService = {
      createEvent: jest.fn().mockResolvedValue({
        id: 'event-1',
        title: 'New Event',
        slug: 'new-event',
      }),
      searchEvents: jest.fn().mockResolvedValue({
        events: [],
        total: 0,
        page: 1,
        pages: 1,
      }),
      getPublishedEvent: jest.fn().mockResolvedValue({
        id: 'event-1',
        title: 'New Event',
      }),
    };

    const mockModerationService = {
      getEventModerationStatus: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
      requireApprovedOrganizer: jest.fn().mockResolvedValue(organizerUser.id),
      getOrganizerApplicationStatus: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
    };

    const mockOrganizersService = {
      requireOrganizerId: jest.fn().mockResolvedValue(organizerUser.id),
      getOwnOrganizerProfile: jest.fn().mockImplementation((userId) =>
        Promise.resolve({
          id: 'org-' + userId,
          userId,
          organizationName: 'Organizer Org',
          isVerified: true,
        }),
      ),
    };

    const mockCache = {
      ping: jest.fn().mockResolvedValue('PONG'),
      consumeAiRequest: jest.fn().mockResolvedValue({ allowed: true }),
      releaseAiRequest: jest.fn().mockResolvedValue(undefined),
      providerCooldownMs: jest.fn().mockResolvedValue(0),
      setProviderCooldown: jest.fn().mockResolvedValue(undefined),
    };

    const mockAuthService = {
      requestPasswordReset: jest.fn().mockImplementation((_email: string) =>
        Promise.resolve({
          message: 'If an account with that email exists, a reset link has been sent',
        }),
      ),
      resetPassword: jest.fn().mockImplementation((_token: string, _newPassword: string) =>
        Promise.resolve({
          message: 'Password reset successfully',
        }),
      ),
      createSession: jest.fn().mockImplementation((userId, email, role) =>
        Promise.resolve({
          accessToken: 'mock-switched-access-token',
          refreshToken: 'mock-switched-refresh-token',
        }),
      ),
      refreshCookieMaxAge: 30 * 24 * 60 * 60 * 1000,
    };

    const mockGoogleOauthService = {
      isConfigured: true,
      createState: jest.fn().mockReturnValue('mock-state-random-token'),
      buildAuthorizationUrl: jest.fn().mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?mock=true',
      ),
      verifyState: jest.fn().mockReturnValue('/events'),
      exchangeCode: jest.fn().mockResolvedValue({
        sub: 'google-sub-123',
        email: 'tester@google.test',
        emailVerified: true,
        firstName: 'Google',
        lastName: 'Tester',
      }),
    };

    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache as any,
      authService: mockAuthService as any,
      googleOauthService: mockGoogleOauthService as any,
      categoriesService: mockCategoriesService as any,
      aiService: mockAiService as any,
      eventsService: mockEventsService as any,
      moderationService: mockModerationService as any,
      organizersService: mockOrganizersService as any,
      systemControlsService: mockSystemControlsService,
      jwtSecret: JWT_SECRET,
      rateLimit: false,
      logger: nullLogger,
    });

    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    mockSystemControlsService.updateSettings('admin', {
      websiteMaintenance: false,
      aiMaintenance: false,
      eventCreationMaintenance: false,
    });
  });

  it('1. GET /api/system-controls returns public settings without auth', async () => {
    const res = await fetch(`${baseUrl}/api/system-controls`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('websiteMaintenance', false);
    expect(json).toHaveProperty('aiMaintenance', false);
    expect(json).toHaveProperty('eventCreationMaintenance', false);
  });

  it('2. GET /api/admin/system-controls enforces ADMIN authorization', async () => {
    // Unauthenticated
    const resAnon = await fetch(`${baseUrl}/api/admin/system-controls`);
    expect(resAnon.status).toBe(401);

    // Customer
    const resCust = await fetch(`${baseUrl}/api/admin/system-controls`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(resCust.status).toBe(403);

    // Admin
    const resAdmin = await fetch(`${baseUrl}/api/admin/system-controls`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resAdmin.status).toBe(200);
    const json = (await resAdmin.json()) as any;
    expect(json.websiteMaintenance).toBe(false);
  });

  it('3. PATCH /api/admin/system-controls updates control switches for ADMIN only', async () => {
    const updatePayload = {
      websiteMaintenance: true,
      websiteMaintenanceMessage: 'Upgrading EventPoint infrastructure',
    };

    // Customer cannot update
    const resCust = await fetch(`${baseUrl}/api/admin/system-controls`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    });
    expect(resCust.status).toBe(403);

    // Admin updates successfully
    const resAdmin = await fetch(`${baseUrl}/api/admin/system-controls`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatePayload),
    });
    expect(resAdmin.status).toBe(200);
    const json = (await resAdmin.json()) as any;
    expect(json.websiteMaintenance).toBe(true);
    expect(json.websiteMaintenanceMessage).toBe('Upgrading EventPoint infrastructure');
  });

  it('4. Website Maintenance Mode restricts non-admin traffic but allows admin and health recovery', async () => {
    await mockSystemControlsService.updateSettings('admin', {
      websiteMaintenance: true,
      websiteMaintenanceMessage: 'Down for scheduled maintenance',
    });

    // Public visitor is blocked with 503
    const resPublic = await fetch(`${baseUrl}/api/categories`);
    expect(resPublic.status).toBe(503);
    const jsonPublic = (await resPublic.json()) as any;
    expect(jsonPublic.code).toBe('MAINTENANCE_MODE');
    expect(jsonPublic.message).toBe('Down for scheduled maintenance');

    // Authenticated customer is blocked with 503
    const resCustomer = await fetch(`${baseUrl}/api/categories`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(resCustomer.status).toBe(503);

    // Health check remains available (200)
    const resHealth = await fetch(`${baseUrl}/api/health`);
    expect(resHealth.status).toBe(200);

    // Public system-controls status check remains available
    const resControls = await fetch(`${baseUrl}/api/system-controls`);
    expect(resControls.status).toBe(200);

    // Admin with Bearer token can bypass maintenance and access the platform
    const resAdmin = await fetch(`${baseUrl}/api/categories`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resAdmin.status).toBe(200);

    // Admin with eventai_access_token cookie (used in SSR) can access attendee endpoints during maintenance
    const resAdminCookie = await fetch(`${baseUrl}/api/categories`, {
      headers: { Cookie: `eventai_access_token=${adminToken}` },
    });
    expect(resAdminCookie.status).toBe(200);

    // Regular customer with cookie is still strictly blocked with 503
    const resCustomerCookie = await fetch(`${baseUrl}/api/categories`, {
      headers: { Cookie: `eventai_access_token=${customerToken}` },
    });
    expect(resCustomerCookie.status).toBe(503);

    // Admin system controls endpoint remains accessible
    const resAdminControls = await fetch(`${baseUrl}/api/admin/system-controls`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resAdminControls.status).toBe(200);

    // Authorized Maintenance Tester (CUSTOMER role) can query published events & categories (200)
    const resTesterCustomer = await fetch(`${baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${testerCustomerToken}` },
    });
    expect(resTesterCustomer.status).toBe(200);

    // Authorized Maintenance Tester with cookie can query published events (SSR compatibility)
    const resTesterCustomerCookie = await fetch(`${baseUrl}/api/events`, {
      headers: { Cookie: `eventai_access_token=${testerCustomerToken}` },
    });
    expect(resTesterCustomerCookie.status).toBe(200);

    // Authorized Maintenance Tester (ORGANIZER role) can access Organizer Hub endpoints (/api/organizers/me)
    const resTesterOrganizer = await fetch(`${baseUrl}/api/organizers/me`, {
      headers: { Authorization: `Bearer ${testerOrganizerToken}` },
    });
    expect(resTesterOrganizer.status).toBe(200);

    // Ordinary Organizer (not authorized maintenance tester) is strictly blocked with 503
    const resOrdinaryOrganizer = await fetch(`${baseUrl}/api/organizers/me`, {
      headers: { Authorization: `Bearer ${organizerToken}` },
    });
    expect(resOrdinaryOrganizer.status).toBe(503);

    // Invitation acceptance remains blocked during website maintenance (503)
    const resAcceptInvite = await fetch(`${baseUrl}/api/admin/team/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: 'some-token' }),
    });
    expect(resAcceptInvite.status).toBe(503);
  });

  it('4b. Website Maintenance Mode allows password-recovery endpoints while enforcing 503 for normal public routes', async () => {
    await mockSystemControlsService.updateSettings('admin', {
      websiteMaintenance: true,
      websiteMaintenanceMessage: 'Down for scheduled maintenance',
    });

    // 1. Password reset request endpoint (POST /api/auth/forgot-password) is permitted
    const resForgotApi = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@eventpoint.test' }),
    });
    expect(resForgotApi.status).toBe(200);
    const jsonForgotApi = (await resForgotApi.json()) as any;
    expect(jsonForgotApi.message).toBe(
      'If an account with that email exists, a reset link has been sent',
    );

    // 2. Non-/api alias (POST /auth/forgot-password) is also permitted
    const resForgot = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@eventpoint.test' }),
    });
    expect(resForgot.status).toBe(200);

    // 3. Password reset completion endpoint (POST /api/auth/reset-password) is permitted
    const resResetApi = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'test-reset-token-1234567890',
        newPassword: 'NewPassword123!',
      }),
    });
    expect(resResetApi.status).toBe(200);
    const jsonResetApi = (await resResetApi.json()) as any;
    expect(jsonResetApi.message).toBe('Password reset successfully');

    // 4. Non-/api alias (POST /auth/reset-password) is also permitted
    const resReset = await fetch(`${baseUrl}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'test-reset-token-1234567890',
        newPassword: 'NewPassword123!',
      }),
    });
    expect(resReset.status).toBe(200);

    // 5. Normal public routes remain blocked with 503
    const resCategories = await fetch(`${baseUrl}/api/categories`);
    expect(resCategories.status).toBe(503);
    const jsonCategories = (await resCategories.json()) as any;
    expect(jsonCategories.code).toBe('MAINTENANCE_MODE');

    const resEvents = await fetch(`${baseUrl}/api/events`);
    expect(resEvents.status).toBe(503);
    const jsonEvents = (await resEvents.json()) as any;
    expect(jsonEvents.code).toBe('MAINTENANCE_MODE');

    // 6. Non-recovery auth endpoints (e.g. registration) remain blocked with 503
    const resRegister = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@eventpoint.test',
        password: 'Password123!',
        firstName: 'New',
        lastName: 'User',
      }),
    });
    expect(resRegister.status).toBe(503);
    const jsonRegister = (await resRegister.json()) as any;
    expect(jsonRegister.code).toBe('MAINTENANCE_MODE');
  });

  it('4c. Website Maintenance Mode exempts Google OAuth initiation and callback endpoints', async () => {
    await mockSystemControlsService.updateSettings('admin', {
      websiteMaintenance: true,
      websiteMaintenanceMessage: 'Down for scheduled maintenance',
    });

    // 1. Google OAuth start endpoint (/api/auth/google) redirects (302) without 503
    const resGoogle = await fetch(`${baseUrl}/api/auth/google?redirect=%2Fevents`, {
      redirect: 'manual',
    });
    expect(resGoogle.status).toBe(302);
    expect(resGoogle.headers.get('location')).toContain('accounts.google.com');

    // 2. Google OAuth callback endpoint is also exempt from 503
    const resCallback = await fetch(`${baseUrl}/api/auth/google/callback?error=access_denied`, {
      redirect: 'manual',
    });
    expect(resCallback.status).toBe(302);
    expect(resCallback.headers.get('location')).toContain('/signin?error=google_cancelled');
  });

  it('4d. Admin can acquire session for explicitly linked maintenance tester without password re-entry', async () => {
    await mockSystemControlsService.updateSettings('admin', {
      websiteMaintenance: true,
      websiteMaintenanceMessage: 'Down for scheduled maintenance',
    });

    // 1. Anonymous request is rejected (401)
    const resAnon = await fetch(`${baseUrl}/api/admin/maintenance-testers/switch-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testEmail: testerCustomerUser.email }),
    });
    expect(resAnon.status).toBe(401);

    // 2. Non-admin request is rejected (403)
    const resCustomer = await fetch(`${baseUrl}/api/admin/maintenance-testers/switch-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ testEmail: testerCustomerUser.email }),
    });
    expect(resCustomer.status).toBe(403);

    // 3. Admin switching to unlinked account is rejected (404)
    const resUnlinked = await fetch(`${baseUrl}/api/admin/maintenance-testers/switch-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ testEmail: 'unlinked@eventpoint.test' }),
    });
    expect(resUnlinked.status).toBe(404);

    // 4. Admin switching to explicitly linked tester account succeeds (200) with tokens
    const resSuccess = await fetch(`${baseUrl}/api/admin/maintenance-testers/switch-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ testEmail: testerCustomerUser.email }),
    });
    expect(resSuccess.status).toBe(200);
    const jsonSuccess = (await resSuccess.json()) as any;
    expect(jsonSuccess.accessToken).toBe('mock-switched-access-token');
    expect(jsonSuccess.user.email).toBe(testerCustomerUser.email);
    expect(jsonSuccess.user.isMaintenanceTester).toBe(true);
    expect(resSuccess.headers.get('set-cookie')).toContain('eventai_refresh_token=');
  });

  it('5. AI Maintenance Mode blocks AI chat (503) while keeping non-AI endpoints operational', async () => {
    await mockSystemControlsService.updateSettings('admin', {
      aiMaintenance: true,
      aiMaintenanceMessage: 'AI Assistant undergoing model tuning',
    });

    // AI chat is rejected with 503
    const resAi = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What events are in Mumbai?' }],
      }),
    });
    expect(resAi.status).toBe(503);
    const jsonAi = (await resAi.json()) as any;
    expect(jsonAi.code).toBe('AI_MAINTENANCE');
    expect(jsonAi.message).toBe('AI Assistant undergoing model tuning');

    // Non-AI routes continue to work normally (200)
    const resCatalog = await fetch(`${baseUrl}/api/categories`);
    expect(resCatalog.status).toBe(200);

    // When disabled, AI chat works again
    await mockSystemControlsService.updateSettings('admin', {
      aiMaintenance: false,
    });
    const resAiRestored = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What events are in Mumbai?' }],
      }),
    });
    expect(resAiRestored.status).toBe(200);
  });

  it('6. Event Creation Maintenance Mode blocks event creation (503) while allowing existing events', async () => {
    await mockSystemControlsService.updateSettings('admin', {
      eventCreationMaintenance: true,
      eventCreationMaintenanceMessage: 'Event creation is paused today',
    });

    // Event creation is rejected with 503
    const resCreate = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${organizerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'New Concert 2026',
        description: 'Concert event description exceeding minimum chars',
        categoryId: 'a0000000-0000-4000-8000-000000000001',
        venueId: 'b0000000-0000-4000-8000-000000000002',
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 172800000).toISOString(),
      }),
    });
    expect(resCreate.status).toBe(503);
    const jsonCreate = (await resCreate.json()) as any;
    expect(jsonCreate.code).toBe('EVENT_CREATION_MAINTENANCE');
    expect(jsonCreate.message).toBe('Event creation is paused today');

    // Generic image upload for new event is also blocked with 503
    const resUpload = await fetch(`${baseUrl}/api/events/upload-image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${organizerToken}`,
      },
    });
    expect(resUpload.status).toBe(503);

    // Browsing existing events remains fully operational (200)
    const resBrowse = await fetch(`${baseUrl}/api/events`);
    expect(resBrowse.status).toBe(200);

    // Viewing specific event remains operational (200)
    const resDetail = await fetch(`${baseUrl}/api/events/event-1`);
    expect(resDetail.status).toBe(200);

    // When disabled, event creation is restored
    await mockSystemControlsService.updateSettings('admin', {
      eventCreationMaintenance: false,
    });
    const resCreateRestored = await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${organizerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'New Concert 2026',
        description: 'Concert event description exceeding minimum chars',
        categoryId: 'a0000000-0000-4000-8000-000000000001',
        venueId: 'b0000000-0000-4000-8000-000000000002',
        startDate: new Date(Date.now() + 86400000).toISOString(),
        endDate: new Date(Date.now() + 172800000).toISOString(),
      }),
    });
    expect(resCreateRestored.status).toBe(201);
  });
});
