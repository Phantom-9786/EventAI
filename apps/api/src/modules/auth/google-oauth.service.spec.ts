import { ServiceUnavailableException, UnauthorizedException } from '../../common/exceptions';
import { ConfigService } from '../../common/config/config.service';
import { createHmac } from 'crypto';
import { GoogleOauthService } from './google-oauth.service';

// Mock the google-auth-library OAuth2Client — tests assert how we use it,
// not that Google's SDK works.
const getToken = jest.fn();
const verifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ getToken, verifyIdToken })),
}));

describe('GoogleOauthService', () => {
  const buildService = (env: Record<string, string>) => {
    const configService = { get: jest.fn((key: string) => env[key]) };
    return { service: new GoogleOauthService(configService as unknown as ConfigService), configService };
  };

  const configuredEnv = {
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    JWT_SECRET: 'test-secret-test-secret',
    PORT: '4000',
  };

  beforeEach(() => {
    getToken.mockReset();
    verifyIdToken.mockReset();
  });

  describe('feature gating', () => {
    it('reports unconfigured when credentials are missing or blank', () => {
      expect(buildService({}).service.isConfigured).toBe(false);
      expect(buildService({ GOOGLE_CLIENT_ID: '' }).service.isConfigured).toBe(false);
      expect(buildService({ GOOGLE_CLIENT_ID: 'x' }).service.isConfigured).toBe(false);
      expect(buildService(configuredEnv).service.isConfigured).toBe(true);
    });

    it('throws 503 from exchangeCode when not configured', async () => {
      const { service } = buildService({});
      await expect(service.exchangeCode('code')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('state signing', () => {
    const signPayload = (payload: object) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = createHmac('sha256', 'test-secret-test-secret')
        .update(encoded)
        .digest('base64url');
      return `${encoded}.${signature}`;
    };

    it('round-trips createState -> verifyState and validates the redirect path', () => {
      const { service } = buildService(configuredEnv);
      const state = service.createState('/tickets');
      expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(service.verifyState(state, state)).toBe('/tickets');
    });

    it('rejects a validly-signed state with an external redirect (open redirect)', () => {
      const { service } = buildService(configuredEnv);
      const state = signPayload({ redirect: 'https://evil.example.com', exp: Date.now() + 60_000 });
      expect(service.verifyState(state, state)).toBeNull();
    });

    it('rejects mismatched cookie and query state (CSRF)', () => {
      const { service } = buildService(configuredEnv);
      const attacker = service.createState('/events');
      const victim = service.createState('/tickets');
      expect(service.verifyState(attacker, victim)).toBeNull();
    });

    it('rejects a tampered signature', () => {
      const { service } = buildService(configuredEnv);
      const state = service.createState('/events');
      const [payload, sig] = state.split('.');
      const flipped = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
      expect(service.verifyState(`${payload}.${flipped}`, `${payload}.${flipped}`)).toBeNull();
    });

    it('rejects expired state', () => {
      const { service } = buildService(configuredEnv);
      const state = signPayload({ redirect: '/events', exp: Date.now() - 1000 });
      expect(service.verifyState(state, state)).toBeNull();
    });

    it('rejects missing cookie or query state', () => {
      const { service } = buildService(configuredEnv);
      const state = service.createState('/events');
      expect(service.verifyState(undefined, state)).toBeNull();
      expect(service.verifyState(state, undefined)).toBeNull();
      expect(service.verifyState(undefined, undefined)).toBeNull();
    });
  });

  describe('authorization URL', () => {
    it('points at Google with openid email profile scope and the state', () => {
      const { service } = buildService(configuredEnv);
      const url = new URL(service.buildAuthorizationUrl('state-value'));
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:4000/api/auth/google/callback',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('state')).toBe('state-value');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges the code and returns a normalized verified profile', async () => {
      const { service } = buildService(configuredEnv);
      getToken.mockResolvedValue({ tokens: { id_token: 'id-token' } });
      verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'sub-123',
          email: 'User@Example.com',
          email_verified: true,
          given_name: 'Ada',
          family_name: 'Lovelace',
          picture: 'https://pic',
        }),
      });

      const profile = await service.exchangeCode('auth-code');

      expect(getToken).toHaveBeenCalledWith('auth-code');
      expect(verifyIdToken).toHaveBeenCalledWith({
        idToken: 'id-token',
        audience: 'test-client-id.apps.googleusercontent.com',
      });
      expect(profile).toEqual({
        sub: 'sub-123',
        email: 'user@example.com',
        emailVerified: true,
        firstName: 'Ada',
        lastName: 'Lovelace',
        picture: 'https://pic',
      });
    });

    it('rejects when Google does not return an id_token', async () => {
      const { service } = buildService(configuredEnv);
      getToken.mockResolvedValue({ tokens: {} });
      await expect(service.exchangeCode('auth-code')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the token exchange fails', async () => {
      const { service } = buildService(configuredEnv);
      getToken.mockRejectedValue(new Error('invalid_grant'));
      await expect(service.exchangeCode('bad-code')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an id_token without sub/email claims', async () => {
      const { service } = buildService(configuredEnv);
      getToken.mockResolvedValue({ tokens: { id_token: 'id-token' } });
      verifyIdToken.mockResolvedValue({ getPayload: () => ({ email_verified: true }) });
      await expect(service.exchangeCode('auth-code')).rejects.toThrow(UnauthorizedException);
    });

    it('propagates email_verified=false so callers can refuse account linking', async () => {
      const { service } = buildService(configuredEnv);
      getToken.mockResolvedValue({ tokens: { id_token: 'id-token' } });
      verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'sub-123',
          email: 'user@example.com',
          email_verified: false,
        }),
      });
      const profile = await service.exchangeCode('auth-code');
      expect(profile.emailVerified).toBe(false);
    });
  });
});
