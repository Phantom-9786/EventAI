import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { AuthService } from '../modules/auth/auth.service';
import { UnauthorizedException, ConflictException, ForbiddenException } from '../common/exceptions';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';

describe('Express Authentication Module', () => {
  let server: Server;
  let baseUrl: string;
  let mockAuthService: jest.Mocked<Partial<AuthService>>;
  let mockGoogleOauthService: any;
  let mockPrisma: any;
  const JWT_SECRET = 'super-secret-jwt-key-for-testing-purposes-only-32-chars';

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const mockCache = {
    ping: jest.fn().mockResolvedValue('PONG'),
    consumeAiRequest: jest.fn().mockResolvedValue({ allowed: true }),
    releaseAiRequest: jest.fn().mockResolvedValue(undefined),
    providerCooldownMs: jest.fn().mockResolvedValue(0),
    setProviderCooldown: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  } as any;

  beforeAll((done) => {
    mockAuthService = {
      refreshCookieMaxAge: 30 * 24 * 60 * 60 * 1000,
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getProfile: jest.fn(),
      changePassword: jest.fn(),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
      verifyEmail: jest.fn(),
      verifyOtp: jest.fn(),
      resendOtp: jest.fn(),
      resendEmailVerification: jest.fn(),
    };
    (mockAuthService as any).loginWithGoogle = jest.fn();

    mockGoogleOauthService = {
      isConfigured: true,
      createState: jest.fn().mockReturnValue('mock-state-random-token'),
      buildAuthorizationUrl: jest.fn().mockImplementation((state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
      verifyState: jest.fn().mockImplementation((cookieState?: string, queryState?: string) => {
        if (cookieState && queryState && cookieState === queryState) return '/events';
        return null;
      }),
      exchangeCode: jest.fn().mockResolvedValue({
        sub: 'google-sub-123',
        email: 'google@example.com',
        emailVerified: true,
        firstName: 'Google',
        lastName: 'User',
      }),
    };

    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      user: {
        findUnique: jest.fn(),
      },
    };

    const app = createExpressApp({
      authService: mockAuthService as unknown as AuthService,
      googleOauthService: mockGoogleOauthService,
      prisma: mockPrisma,
      cache: mockCache,
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
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      role: 'CUSTOMER',
      isActive: true,
      isEmailVerified: true,
    });
  });

  describe('POST /api/auth/register', () => {
    it('registers user without setting refresh cookie or returning access token', async () => {
      const mockUser = {
        id: 'u1',
        email: 'test@example.com',
        role: 'CUSTOMER' as UserRole,
        isEmailVerified: false,
      };
      (mockAuthService.register as jest.Mock).mockResolvedValue({
        user: mockUser,
        message: 'Registration successful. A 6-digit verification code has been sent to your email.',
        emailDeliveryFailed: false,
      });

      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123!',
          firstName: 'John',
          lastName: 'Doe',
        }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.user).toEqual(mockUser);
      expect(data.accessToken).toBeUndefined();

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeNull();
    });

    it('rejects registration with invalid email or weak password (400)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'weak',
          firstName: '',
          lastName: '',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
      expect(data.errors).toBeDefined();
    });

    it('returns 409 Conflict when account already exists', async () => {
      (mockAuthService.register as jest.Mock).mockRejectedValue(
        new ConflictException('An account with this email already exists'),
      );

      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existing@example.com',
          password: 'Password123!',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('An account with this email already exists');
      expect(data.error).toBe('Conflict');
    });
  });

  describe('POST /api/auth/login', () => {
    it('authenticates valid credentials and sets refresh cookie', async () => {
      const mockUser = { id: 'u1', email: 'test@example.com', role: 'CUSTOMER' as UserRole };
      (mockAuthService.login as jest.Mock).mockResolvedValue({
        user: mockUser,
        tokens: { accessToken: 'acc-token-login', refreshToken: 'ref-token-login' },
      });

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123!',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data).toEqual({
        user: mockUser,
        accessToken: 'acc-token-login',
      });

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('eventai_refresh_token=ref-token-login');
      expect(setCookie).toContain('HttpOnly');
    });

    it('returns 401 Unauthorized on invalid credentials', async () => {
      (mockAuthService.login as jest.Mock).mockRejectedValue(
        new UnauthorizedException('Invalid email or password'),
      );

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'wrong@example.com',
          password: 'WrongPassword123!',
        }),
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Invalid email or password');
    });

    it('returns 403 Forbidden when user email is unverified', async () => {
      (mockAuthService.login as jest.Mock).mockRejectedValue(
        new ForbiddenException({
          message: 'Email verification required. Please verify your email before logging in.',
          error: 'EmailNotVerified',
          isEmailVerified: false,
          email: 'unverified@example.com',
        }),
      );

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'unverified@example.com',
          password: 'Password123!',
        }),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toContain('Email verification required');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates refresh token and returns new access token', async () => {
      (mockAuthService.refresh as jest.Mock).mockResolvedValue({
        accessToken: 'new-acc-token',
        refreshToken: 'new-ref-token',
      });

      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: 'eventai_refresh_token=old-ref-token',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data).toEqual({ accessToken: 'new-acc-token' });
      expect(mockAuthService.refresh).toHaveBeenCalledWith('old-ref-token');

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('eventai_refresh_token=new-ref-token');
    });

    it('returns 401 when refresh token cookie is missing', async () => {
      (mockAuthService.refresh as jest.Mock).mockRejectedValue(
        new UnauthorizedException('Missing refresh token'),
      );

      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Missing refresh token');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes session and clears the refresh cookie', async () => {
      (mockAuthService.logout as jest.Mock).mockResolvedValue(undefined);

      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: 'eventai_refresh_token=active-token',
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data).toEqual({ message: 'Logged out' });
      expect(mockAuthService.logout).toHaveBeenCalledWith('active-token');

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('eventai_refresh_token=;');
    });
  });

  describe('GET /api/auth/me (Protected Route)', () => {
    it('returns authenticated user profile when given a valid Bearer token', async () => {
      const validToken = jwt.sign(
        { sub: 'user-123', email: 'user@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: true,
      });

      (mockAuthService.getProfile as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'user@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        role: 'CUSTOMER',
      });

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const data = (await res.json()) as any;
      expect(data.user).toEqual({
        id: 'user-123',
        email: 'user@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        role: 'CUSTOMER',
      });
    });

    it('rejects request with 401 when Authorization header is missing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });

    it('rejects request with 401 when Bearer token is expired', async () => {
      const expiredToken = jwt.sign(
        { sub: 'user-123', email: 'user@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '-1s' },
      );

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Token expired');
    });

    it('rejects request with 401 when user is deactivated in database', async () => {
      const validToken = jwt.sign(
        { sub: 'user-inactive', email: 'inactive@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-inactive',
        email: 'inactive@example.com',
        role: 'CUSTOMER',
        isActive: false,
      });

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.message).toBe('User not found or deactivated');
    });

    it('rejects request with 403 when user is unverified', async () => {
      const validToken = jwt.sign(
        { sub: 'user-unverified', email: 'unverified@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-unverified',
        email: 'unverified@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: false,
      });

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Email verification required');
    });

    it('rejects request with 401 when Authorization header does not use Bearer scheme', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: 'Basic dXNlcjpwYXNz',
        },
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });

    it('rejects request with 401 when token has an invalid signature', async () => {
      const invalidSigToken = jwt.sign(
        { sub: 'user-123', email: 'user@example.com', role: 'CUSTOMER' },
        'different-secret-key-that-does-not-match',
        { expiresIn: '1h' },
      );

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${invalidSigToken}`,
        },
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Invalid token');
    });

    it('rejects request with 401 when token payload lacks sub claim', async () => {
      const badPayloadToken = jwt.sign(
        { email: 'user@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${badPayloadToken}`,
        },
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Invalid token payload');
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('changes password when authenticated and valid payload provided', async () => {
      const validToken = jwt.sign(
        { sub: 'u1', email: 'u1@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u1@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: true,
      });

      (mockAuthService.changePassword as jest.Mock).mockResolvedValue(undefined);

      const res = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'OldPassword123!',
          newPassword: 'NewPassword123!',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data).toEqual({ message: 'Password changed. Please log in again.' });
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(
        'u1',
        'OldPassword123!',
        'NewPassword123!',
      );
    });
  });

  describe('POST /api/auth/forgot-password & reset-password', () => {
    it('returns generic response for forgot-password to prevent account enumeration', async () => {
      (mockAuthService.requestPasswordReset as jest.Mock).mockResolvedValue({
        message: 'If an account with that email exists, a reset link has been sent',
      });

      const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'anyuser@example.com' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('reset link has been sent');
    });

    it('resets password with valid token', async () => {
      (mockAuthService.resetPassword as jest.Mock).mockResolvedValue({
        message: 'Password has been reset. Please log in again.',
      });

      const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-reset-token-32-chars-long',
          newPassword: 'NewPassword123!',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('Password has been reset');
    });
  });

  describe('POST /api/auth/verify-otp', () => {
    it('verifies OTP successfully with status 200', async () => {
      (mockAuthService.verifyOtp as jest.Mock).mockResolvedValue({
        success: true,
        message: 'Email verified successfully. You can now log in.',
      });

      const res = await fetch(`${baseUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', otp: '123456' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.message).toContain('verified successfully');
    });

    it('rejects invalid OTP format (not 6 digits) with 400', async () => {
      const res = await fetch(`${baseUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', otp: '123' }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
    });
  });

  describe('POST /api/auth/resend-otp', () => {
    it('resends OTP successfully with status 200', async () => {
      (mockAuthService.resendOtp as jest.Mock).mockResolvedValue({
        message: 'A new verification code has been sent to your email.',
        cooldownSeconds: 60,
      });

      const res = await fetch(`${baseUrl}/api/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('verification code has been sent');
    });

    it('rejects invalid email with 400', async () => {
      const res = await fetch(`${baseUrl}/api/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('verifies email with valid verification token', async () => {
      (mockAuthService.verifyEmail as jest.Mock).mockResolvedValue({
        message: 'Email verified. Thank you!',
      });

      const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-verify-token' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Email verified. Thank you!');
    });
  });

  describe('POST /api/auth/resend-verification', () => {
    it('resends verification for authenticated user', async () => {
      const validToken = jwt.sign(
        { sub: 'u1', email: 'u1@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u1@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockAuthService.resendEmailVerification as jest.Mock).mockResolvedValue({
        message: 'If your email is unverified, a new verification link has been sent',
      });

      const res = await fetch(`${baseUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('verification link has been sent');
    });
  });

  describe('Google OAuth 2.0 Flows', () => {
    it('redirects to Google authorization URL and sets state cookie', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google?redirect=/dashboard`, {
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(res.headers.get('set-cookie')).toContain('eventai_google_state=');
      expect(mockGoogleOauthService.createState).toHaveBeenCalledWith('/dashboard');
    });

    it('returns 503 Service Unavailable when Google OAuth is unconfigured', async () => {
      mockGoogleOauthService.isConfigured = false;

      const res = await fetch(`${baseUrl}/api/auth/google`, {
        redirect: 'manual',
      });

      mockGoogleOauthService.isConfigured = true; // reset

      expect(res.status).toBe(503);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toContain('Google sign-in is not configured');
    });

    it('redirects to signin with google_cancelled on user cancellation', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/callback?error=access_denied`, {
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost:3000/signin?error=google_cancelled');
    });

    it('redirects to signin with google_state_mismatch on state mismatch or missing state', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/callback?state=tampered-state&code=valid-code`, {
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost:3000/signin?error=google_state_mismatch');
    });

    it('redirects to signin with google_failed when authorization code is absent', async () => {
      const res = await fetch(`${baseUrl}/api/auth/google/callback?state=mock-state-random-token`, {
        headers: {
          Cookie: 'eventai_google_state=mock-state-random-token',
        },
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost:3000/signin?error=google_failed');
    });

    it('exchanges code, sets refresh cookie, and redirects to frontend callback on success', async () => {
      (mockAuthService as any).loginWithGoogle.mockResolvedValue({
        user: { id: 'u-google', email: 'google@example.com', role: 'CUSTOMER' },
        tokens: { accessToken: 'google-access-jwt-token', refreshToken: 'google-refresh-token' },
      });

      const res = await fetch(
        `${baseUrl}/api/auth/google/callback?state=mock-state-random-token&code=google-auth-code-123`,
        {
          headers: {
            Cookie: 'eventai_google_state=mock-state-random-token',
          },
          redirect: 'manual',
        },
      );

      expect(res.status).toBe(302);
      const location = res.headers.get('location');
      expect(location).toContain('http://localhost:3000/auth/callback#');
      expect(location).toContain('access_token=google-access-jwt-token');
      expect(location).toContain('redirect=%2Fevents');

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('eventai_refresh_token=google-refresh-token');
    });

    it('maps email unverified error to signin?error=google_email_unverified', async () => {
      (mockAuthService as any).loginWithGoogle.mockRejectedValue(
        new Error('Google email is not verified'),
      );

      const res = await fetch(
        `${baseUrl}/api/auth/google/callback?state=mock-state-random-token&code=code-with-unverified-email`,
        {
          headers: {
            Cookie: 'eventai_google_state=mock-state-random-token',
          },
          redirect: 'manual',
        },
      );

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost:3000/signin?error=google_email_unverified');
    });
  });

  describe('Role-Based Authorization (requireRoles)', () => {
    it('denies access with 403 Forbidden when user does not have the required role', async () => {
      const customerToken = jwt.sign(
        { sub: 'u-cust', email: 'cust@example.com', role: 'CUSTOMER' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-cust',
        email: 'cust@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: true,
      });

      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: {
          Authorization: `Bearer ${customerToken}`,
        },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Forbidden');
      expect(data.message).toBe('You do not have permission to access this resource');
    });

    it('allows access when user has the required role', async () => {
      const adminToken = jwt.sign(
        { sub: 'u-admin', email: 'admin@example.com', role: 'ADMIN' },
        JWT_SECRET,
        { expiresIn: '1h' },
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-admin',
        email: 'admin@example.com',
        role: 'ADMIN',
        isActive: true,
        isEmailVerified: true,
      });

      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('Rate Limiting on Auth Endpoints', () => {
    let rateLimitedServer: Server;
    let rateLimitedUrl: string;

    beforeAll((done) => {
      const rateLimitedApp = createExpressApp({
        authService: mockAuthService as unknown as AuthService,
        prisma: mockPrisma,
        cache: mockCache,
        jwtSecret: JWT_SECRET,
        logger: nullLogger,
        rateLimit: { limit: 2, windowMs: 10_000 },
        env: {
          JWT_SECRET,
          FRONTEND_URL: 'http://localhost:3000',
          NODE_ENV: 'test',
        },
      });

      rateLimitedServer = rateLimitedApp.listen(0, () => {
        const address = rateLimitedServer.address() as AddressInfo;
        rateLimitedUrl = `http://127.0.0.1:${address.port}`;
        done();
      });
    });

    afterAll((done) => {
      rateLimitedServer.close(done);
    });

    it('enforces limit and returns 429 Too Many Requests when exceeded', async () => {
      (mockAuthService.login as jest.Mock).mockResolvedValue({
        user: { id: 'u1', email: 'test@example.com', role: 'CUSTOMER' },
        tokens: { accessToken: 'a', refreshToken: 'r' },
      });

      // Request 1: OK
      const res1 = await fetch(`${rateLimitedUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
      });
      expect(res1.status).toBe(200);

      // Request 2: OK
      const res2 = await fetch(`${rateLimitedUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
      });
      expect(res2.status).toBe(200);

      // Request 3: Exceeds limit (2) -> 429
      const res3 = await fetch(`${rateLimitedUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
      });
      expect(res3.status).toBe(429);
      const data = (await res3.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Too Many Requests');
      expect(data.message).toBe('Too many requests, please try again later');
    });

    it('prevents rate-limit bypass via spoofed X-Forwarded-For headers', async () => {
      // Send request with spoofed IP header — must still be rate limited from the same client
      const res = await fetch(`${rateLimitedUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.77',
        },
        body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
      });
      expect(res.status).toBe(429);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(429);
    });
  });
});

