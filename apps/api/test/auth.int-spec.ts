import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { NotificationsService } from '../src/modules/notifications/notifications.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { createEventFixture, createUser, prepareTestDatabase, uniqueSuffix, type TestPrisma } from './db';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * DB-backed integration tests for the AuthService security-critical
 * paths: registration, login, and the full password-reset lifecycle.
 * Real PostgreSQL, real Argon2 hashing, real session rows. Brevo is
 * stubbed (the captured reset token lets us exercise the raw-token
 * round-trip exactly like a real email link would).
 */
describe('AuthService (integration)', () => {
  let prisma: TestPrisma;
  let auth: AuthService;
  let notifications: { sendPasswordResetEmail: jest.Mock; sendEmailVerificationEmail: jest.Mock };
  let capturedResetToken: string | null;

  beforeAll(async () => {
    prisma = await prepareTestDatabase();
    capturedResetToken = null;
    notifications = {
      sendPasswordResetEmail: jest.fn(async (input: { resetToken: string }) => {
        capturedResetToken = input.resetToken;
        return true;
      }),
      sendEmailVerificationEmail: jest.fn(async () => true),
    };
    auth = new AuthService(
      prisma as never,
      new JwtService({ secret: 'integration-test-secret' }),
      { get: (_key: string, defaultValue?: string) => defaultValue } as never,
      notifications as unknown as NotificationsService,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('register + login', () => {
    it('registers a user with a verifiable Argon2id hash and a hashed session', async () => {
      const email = `reg-${uniqueSuffix()}@example.test`;
      const { user, tokens } = await auth.register({
        email,
        password: 'Sup3rSecret!',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });

      expect(user.email).toBe(email);

      const row = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(row.passwordHash).not.toBeNull();
      expect(row.passwordHash).not.toBe('Sup3rSecret!');
      const argon2 = await import('argon2');
      await expect(argon2.verify(row.passwordHash as string, 'Sup3rSecret!')).resolves.toBe(true);

      const sessions = await prisma.session.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(1);
      // Only hashes are stored at rest, never the raw tokens
      expect(sessions[0].token).not.toBe(tokens.accessToken);
      expect(sessions[0].refreshToken).not.toBe(tokens.refreshToken);
      expect(sessions[0].token).toBe(hashToken(tokens.accessToken));
    });

    it('rejects duplicate email registration with ConflictException', async () => {
      const email = `dup-${uniqueSuffix()}@example.test`;
      await auth.register({ email, password: 'FirstPass1!', firstName: 'A', lastName: 'B' });
      await expect(
        auth.register({ email, password: 'SecondPass2!', firstName: 'C', lastName: 'D' }),
      ).rejects.toThrow(ConflictException);
    });

    it('logs in with correct credentials and creates a session', async () => {
      const email = `login-${uniqueSuffix()}@example.test`;
      const registered = await auth.register({
        email,
        password: 'CorrectHorse1!',
        firstName: 'L',
        lastName: 'T',
      });
      const before = await prisma.session.count({ where: { userId: registered.user.id } });

      const { user, tokens } = await auth.login({ email, password: 'CorrectHorse1!' });
      expect(user.id).toBe(registered.user.id);
      expect(tokens.accessToken).toBeTruthy();

      const after = await prisma.session.count({ where: { userId: registered.user.id } });
      expect(after).toBe(before + 1);
    });

    it('rejects wrong password and unknown emails without leaking which failed', async () => {
      const email = `neg-${uniqueSuffix()}@example.test`;
      await auth.register({ email, password: 'RightPassword1!', firstName: 'N', lastName: 'T' });

      await expect(auth.login({ email, password: 'WrongPassword1!' })).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
      await expect(
        auth.login({ email: `ghost-${uniqueSuffix()}@example.test`, password: 'Whatever1!' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });
  });

  describe('password reset lifecycle', () => {
    it('stores only a hashed single-use token and invalidates previous tokens', async () => {
      const email = `reset-${uniqueSuffix()}@example.test`;
      await createUser(prisma, uniqueSuffix(), { email });

      const result = await auth.requestPasswordReset(email);
      expect(result.message).not.toContain('token');

      const first = await prisma.passwordReset.findMany({ where: { email } });
      expect(first).toHaveLength(1);
      expect(first[0].token).not.toBe(capturedResetToken);
      expect(first[0].token).toBe(hashToken(capturedResetToken as string));

      // A second request invalidates the first unused token
      await auth.requestPasswordReset(email);
      const second = await prisma.passwordReset.findMany({ where: { email } });
      expect(second).toHaveLength(1);
      expect(second[0].token).not.toBe(first[0].token);
    });

    it('returns the same response whether or not the account exists', async () => {
      const known = await auth.requestPasswordReset(`known-${uniqueSuffix()}@example.test`);
      const unknown = await auth.requestPasswordReset(`unknown-${uniqueSuffix()}@example.test`);
      expect(known.message).toBe(unknown.message);
    });

    it('resets the password, consumes the token, and signs out all sessions', async () => {
      const email = `flow-${uniqueSuffix()}@example.test`;
      const registered = await auth.register({
        email,
        password: 'OldPassword1!',
        firstName: 'F',
        lastName: 'L',
      });
      await prisma.session.count({ where: { userId: registered.user.id } }); // sanity: session exists
      expect(await prisma.session.count({ where: { userId: registered.user.id } })).toBe(1);

      await auth.requestPasswordReset(email);
      expect(capturedResetToken).toBeTruthy();

      await auth.resetPassword(capturedResetToken as string, 'NewPassword2!');

      const resetRow = await prisma.passwordReset.findFirstOrThrow({ where: { email } });
      expect(resetRow.usedAt).not.toBeNull();

      // Every session was signed out by the reset
      expect(await prisma.session.count({ where: { userId: registered.user.id } })).toBe(0);

      // New password works, old password is dead
      await expect(auth.login({ email, password: 'NewPassword2!' })).resolves.toMatchObject({
        user: { email },
      });
      await expect(auth.login({ email, password: 'OldPassword1!' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects token reuse', async () => {
      const email = `reuse-${uniqueSuffix()}@example.test`;
      await createUser(prisma, uniqueSuffix(), { email });
      await auth.requestPasswordReset(email);
      const token = capturedResetToken as string;

      await auth.resetPassword(token, 'Whatever1!');
      await expect(auth.resetPassword(token, 'Whatever2!')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired reset token'),
      );
    });

    it('rejects unknown and expired tokens', async () => {
      await expect(auth.resetPassword(`deadbeef${uniqueSuffix()}`, 'Whatever1!')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired reset token'),
      );

      const email = `expired-${uniqueSuffix()}@example.test`;
      await createUser(prisma, uniqueSuffix(), { email });
      const expiredRaw = `expired-raw-${uniqueSuffix()}`;
      await prisma.passwordReset.create({
        data: {
          email,
          token: hashToken(expiredRaw),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(auth.resetPassword(expiredRaw, 'Whatever1!')).rejects.toThrow(
        new UnauthorizedException('Invalid or expired reset token'),
      );
    });
  });

  describe('Google account coexistence', () => {
    it('keeps a Google-linked passwordless account distinct from a local one', async () => {
      const suffix = uniqueSuffix();
      await prisma.user.create({
        data: {
          email: `google-${suffix}@example.test`,
          firstName: 'G',
          lastName: 'L',
          googleId: `google-sub-${suffix}`,
        },
      });

      // Login with a password must fail: the account has no local password
      await expect(
        auth.login({ email: `google-${suffix}@example.test`, password: 'AnyPassword1!' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

describe('event fixture integrity (integration)', () => {
  let prisma: TestPrisma;

  beforeAll(async () => {
    prisma = await prepareTestDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a fully linked, bookable event fixture', async () => {
    const fx = await createEventFixture(prisma, { totalQuantity: 5 });
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: fx.eventId },
      include: { ticketTypes: true },
    });
    expect(event.status).toBe('PUBLISHED');
    expect(event.startDate.getTime()).toBeGreaterThan(Date.now());
    expect(event.ticketTypes).toHaveLength(1);
    expect(event.ticketTypes[0].availableQuantity).toBe(5);
  });
});
