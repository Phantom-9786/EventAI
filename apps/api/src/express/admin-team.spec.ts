import type { Server } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { UserRole, AdminRoleType, AdminInvitationStatus } from '@eventai/types';
import { AdminService } from '../modules/admin/admin.service';

describe('Admin Team & Access Management Integration', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';

  // Valid UUIDs
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const delegatedAdminId = '22222222-2222-4222-8222-222222222222';
  const customerId = '33333333-3333-4333-8333-333333333333';
  const invitedUserId = '44444444-4444-4444-8444-444444444444';

  const ownerUser = {
    id: ownerId,
    email: 'owner@eventpoint.test',
    firstName: 'Platform',
    lastName: 'Owner',
    role: UserRole.ADMIN,
    adminRole: 'OWNER',
    isActive: true,
    isEmailVerified: true,
    createdAt: new Date('2025-01-01'),
  };

  const delegatedAdminUser = {
    id: delegatedAdminId,
    email: 'delegated@eventpoint.test',
    firstName: 'Delegated',
    lastName: 'Admin',
    role: UserRole.ADMIN,
    adminRole: 'ADMIN',
    isActive: true,
    isEmailVerified: true,
    createdAt: new Date('2025-02-01'),
  };

  const normalCustomerUser = {
    id: customerId,
    email: 'customer@eventpoint.test',
    firstName: 'Normal',
    lastName: 'Attendee',
    role: UserRole.CUSTOMER,
    adminRole: null,
    isActive: true,
    isEmailVerified: true,
    createdAt: new Date('2025-03-01'),
  };

  const invitedNewUser = {
    id: invitedUserId,
    email: 'colleague@eventpoint.test',
    firstName: 'Invited',
    lastName: 'Colleague',
    role: UserRole.CUSTOMER,
    adminRole: null,
    isActive: true,
    isEmailVerified: true,
    createdAt: new Date('2025-04-01'),
  };

  let ownerToken: string;
  let delegatedAdminToken: string;
  let customerToken: string;
  let invitedUserToken: string;

  // In-memory mock database state
  let usersDb: Record<string, any>;
  let invitationsDb: Record<string, any>;
  let auditLogsDb: any[];
  let lastSentEmailToken: string | null = null;

  beforeAll((done) => {
    ownerToken = jwt.sign(
      { sub: ownerUser.id, email: ownerUser.email, role: ownerUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    delegatedAdminToken = jwt.sign(
      { sub: delegatedAdminUser.id, email: delegatedAdminUser.email, role: delegatedAdminUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    customerToken = jwt.sign(
      { sub: normalCustomerUser.id, email: normalCustomerUser.email, role: normalCustomerUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    invitedUserToken = jwt.sign(
      { sub: invitedNewUser.id, email: invitedNewUser.email, role: invitedNewUser.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    // Initialize mock db
    usersDb = {
      [ownerUser.id]: { ...ownerUser },
      [delegatedAdminUser.id]: { ...delegatedAdminUser },
      [normalCustomerUser.id]: { ...normalCustomerUser },
      [invitedNewUser.id]: { ...invitedNewUser },
    };
    invitationsDb = {};
    auditLogsDb = [];

    const mockPrisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $transaction: jest.fn().mockImplementation(async (arg) => {
        if (typeof arg === 'function') {
          return arg(mockPrisma);
        }
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg;
      }),
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id) {
            return Promise.resolve(usersDb[where.id] ? { ...usersDb[where.id] } : null);
          }
          if (where.email) {
            const found = Object.values(usersDb).find(
              (u: any) => u.email.toLowerCase() === where.email.toLowerCase(),
            );
            return Promise.resolve(found ? { ...found } : null);
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockImplementation(({ where }) => {
          let list = Object.values(usersDb);
          if (where?.role) {
            list = list.filter((u: any) => u.role === where.role);
          }
          if (where?.isActive !== undefined) {
            list = list.filter((u: any) => u.isActive === where.isActive);
          }
          return Promise.resolve(list.map((u: any) => ({ ...u })));
        }),
        findFirst: jest.fn().mockImplementation(({ where, orderBy }) => {
          let list = Object.values(usersDb);
          if (where?.email?.equals) {
            list = list.filter(
              (u: any) => u.email.toLowerCase() === where.email.equals.toLowerCase(),
            );
          } else if (where?.email) {
            list = list.filter((u: any) => u.email.toLowerCase() === where.email.toLowerCase());
          }
          if (where?.role) list = list.filter((u: any) => u.role === where.role);
          if (where?.isActive !== undefined) list = list.filter((u: any) => u.isActive === where.isActive);
          if (where?.adminRole) list = list.filter((u: any) => u.adminRole === where.adminRole);
          if (orderBy?.createdAt === 'asc') {
            list.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          }
          return Promise.resolve(list[0] ? { ...list[0] } : null);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          if (!usersDb[where.id]) throw new Error('User not found');
          usersDb[where.id] = { ...usersDb[where.id], ...data };
          return Promise.resolve({ ...usersDb[where.id] });
        }),
      },
      organizer: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      adminInvitation: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id) {
            return Promise.resolve(invitationsDb[where.id] ? { ...invitationsDb[where.id] } : null);
          }
          if (where.token) {
            const found = Object.values(invitationsDb).find((i: any) => i.token === where.token);
            return Promise.resolve(found ? { ...found } : null);
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          let list = Object.values(invitationsDb);
          if (where?.email?.equals) {
            list = list.filter(
              (i: any) => i.email.toLowerCase() === where.email.equals.toLowerCase(),
            );
          } else if (where?.email) {
            list = list.filter((i: any) => i.email.toLowerCase() === where.email.toLowerCase());
          }
          if (where?.status) {
            list = list.filter((i: any) => i.status === where.status);
          }
          if (where?.expiresAt?.gt) {
            list = list.filter((i: any) => new Date(i.expiresAt) > where.expiresAt.gt);
          }
          return Promise.resolve(list[0] ? { ...list[0] } : null);
        }),
        findMany: jest.fn().mockImplementation(() => {
          return Promise.resolve(
            Object.values(invitationsDb).map((inv: any) => ({
              ...inv,
              invitedBy: usersDb[inv.invitedById]
                ? {
                    id: usersDb[inv.invitedById].id,
                    email: usersDb[inv.invitedById].email,
                    firstName: usersDb[inv.invitedById].firstName,
                    lastName: usersDb[inv.invitedById].lastName,
                  }
                : { id: inv.invitedById, email: 'unknown', firstName: '', lastName: '' },
              acceptedBy: inv.acceptedById && usersDb[inv.acceptedById]
                ? {
                    id: usersDb[inv.acceptedById].id,
                    email: usersDb[inv.acceptedById].email,
                    firstName: usersDb[inv.acceptedById].firstName,
                    lastName: usersDb[inv.acceptedById].lastName,
                  }
                : null,
            })),
          );
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const id = crypto.randomUUID();
          const newInv = {
            id,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          invitationsDb[id] = newInv;
          const { token: _t, ...safeInvitation } = newInv;
          return Promise.resolve({
            ...safeInvitation,
            invitedBy: usersDb[data.invitedById] || { email: '', firstName: '', lastName: '' },
          });
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          if (!invitationsDb[where.id]) throw new Error('Invitation not found');
          invitationsDb[where.id] = { ...invitationsDb[where.id], ...data, updatedAt: new Date() };
          return Promise.resolve({ ...invitationsDb[where.id] });
        }),
      },
      auditLog: {
        create: jest.fn().mockImplementation(({ data }) => {
          auditLogsDb.push({ id: crypto.randomUUID(), ...data, createdAt: new Date() });
          return Promise.resolve({ id: crypto.randomUUID(), ...data });
        }),
      },
    };

    const mockNotificationsService: any = {
      sendAdminInvitationEmail: jest.fn().mockImplementation((payload) => {
        lastSentEmailToken = payload.invitationToken;
        return Promise.resolve(true);
      }),
    };

    const adminService = new AdminService(
      mockPrisma,
      null as any, // cache
      mockNotificationsService,
    );

    const app = createExpressApp({
      prisma: mockPrisma,
      adminService,
      jwtSecret: JWT_SECRET,
      cache: { ping: jest.fn().mockResolvedValue(true) } as any,
      rateLimit: false,
    });

    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('1. Authentication and Authorization on Team Endpoints', () => {
    it('rejects unauthenticated requests to GET /api/admin/team with 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team`);
      expect(res.status).toBe(401);
    });

    it('rejects non-admin (customer) requests to GET /api/admin/team with 403', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('allows active admin to list team members and invitations', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.currentUser).toBeDefined();
      expect(body.currentUser.isOwner).toBe(true);
      expect(Array.isArray(body.members)).toBe(true);
      expect(Array.isArray(body.invitations)).toBe(true);
      expect(body.members.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('2. Platform Owner Invitation Permissions & Non-Owner Restriction', () => {
    it('forbids delegated admin (non-owner) from inviting new administrators (403)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${delegatedAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'newperson@eventpoint.test',
          role: 'ADMIN',
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.message).toMatch(/Only platform owners/i);
    });

    it('rejects invitations attempting to specify role OWNER (400 validation error)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'attemptedowner@eventpoint.test',
          role: 'OWNER',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('allows Platform Owner to invite a new administrator with secure hashed token', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: invitedNewUser.email,
          role: 'ADMIN',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.invitation).toBeDefined();
      expect(body.invitation.email).toBe(invitedNewUser.email.toLowerCase());

      // Verify raw token was sent via email service but NOT in API response
      expect(body.invitation.token).toBeUndefined();
      expect(lastSentEmailToken).toBeTruthy();
      expect(typeof lastSentEmailToken).toBe('string');

      // Verify token in DB is hashed with SHA-256
      const expectedHash = crypto.createHash('sha256').update(lastSentEmailToken!).digest('hex');
      const savedInvitation = Object.values(invitationsDb).find(
        (i: any) => i.email === invitedNewUser.email.toLowerCase(),
      );
      expect(savedInvitation).toBeDefined();
      expect(savedInvitation.token).toBe(expectedHash);
      expect(savedInvitation.token).not.toBe(lastSentEmailToken);
    });

    it('rejects duplicate pending invitations for the same email address', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: invitedNewUser.email,
          role: 'ADMIN',
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.message).toMatch(/active invitation/i);
    });
  });

  describe('3. Invitation Acceptance Flow & Security Safeguards', () => {
    it('rejects invitation acceptance when user is unauthenticated (401)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: lastSentEmailToken }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects invitation acceptance when user email does NOT match invited email (403)', async () => {
      // Customer tries to accept invitation that was sent to invitedNewUser
      const res = await fetch(`${baseUrl}/api/admin/team/invitations/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: lastSentEmailToken }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.message).toMatch(/This invitation was issued to/i);
    });

    it('rejects invitation acceptance with invalid or tampered token (400)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${invitedUserToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'invalid-nonexistent-token-1234567890' }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.message).toMatch(/Invalid, revoked, or previously used/i);
    });

    it('successfully accepts invitation when authenticated as the intended recipient', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${invitedUserToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: lastSentEmailToken }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.role).toBe('ADMIN');

      // Check that user role in DB was upgraded
      expect(usersDb[invitedNewUser.id].role).toBe(UserRole.ADMIN);
      expect(usersDb[invitedNewUser.id].adminRole).toBe('ADMIN');

      // Check invitation status in DB
      const invitation = Object.values(invitationsDb).find(
        (i: any) => i.email === invitedNewUser.email.toLowerCase(),
      );
      expect(invitation.status).toBe('ACCEPTED');
      expect(invitation.acceptedAt).toBeDefined();
    });

    it('prevents reusing an already accepted invitation token (single-use token protection)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${invitedUserToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: lastSentEmailToken }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.message).toMatch(/Invalid, revoked, or previously used/i);
    });
  });

  describe('4. Expiry, Revocation, and Last Owner Protection Safeguards', () => {
    let secondToken: string;
    let secondInvId: string;

    it('allows Platform Owner to invite another colleague and revoke the pending invitation', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'second@eventpoint.test',
          role: 'ADMIN',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      secondInvId = body.invitation.id;
      secondToken = lastSentEmailToken!;

      // Revoke the invitation
      const revokeRes = await fetch(`${baseUrl}/api/admin/team/invitations/${secondInvId}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      expect(revokeRes.status).toBe(200);

      // Verify revoked token cannot be accepted
      const acceptRes = await fetch(`${baseUrl}/api/admin/team/invitations/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: secondToken }),
      });
      expect(acceptRes.status).toBe(400);
      const acceptBody = (await acceptRes.json()) as any;
      expect(acceptBody.message).toMatch(/Invalid, revoked, or previously used/i);
    });

    it('protects the last active Platform Owner from being demoted or revoked', async () => {
      // Try to revoke ownerUser
      const res = await fetch(`${baseUrl}/api/admin/team/members/${ownerUser.id}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.message).toMatch(/Cannot revoke your own administrator access|last active platform owner/i);
    });

    it('allows Platform Owner to revoke delegated admin access', async () => {
      const res = await fetch(`${baseUrl}/api/admin/team/members/${delegatedAdminUser.id}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.message).toMatch(/revoked/i);

      // In DB, delegatedAdminUser role should now be CUSTOMER
      expect(usersDb[delegatedAdminUser.id].role).toBe(UserRole.CUSTOMER);
      expect(usersDb[delegatedAdminUser.id].adminRole).toBeNull();
    });

    it('denies protected admin endpoints to the revoked administrator on subsequent requests', async () => {
      // delegatedAdminUser was revoked, so requests with their token should be denied 403
      const res = await fetch(`${baseUrl}/api/admin/team`, {
        headers: { Authorization: `Bearer ${delegatedAdminToken}` },
      });
      expect(res.status).toBe(403);
    });
  });
});
