import { HEADERS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { REFRESH_TOKEN_COOKIE } from './auth.service';

describe('AuthController', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const authService = { refreshCookieMaxAge: 30 * 24 * 60 * 60 * 1000 };
  let controller: AuthController;

  beforeEach(() => {
    controller = new AuthController(
      authService as never,
      {} as never,
      { get: jest.fn() } as never,
    );
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('sets a secure cross-site refresh cookie in production', () => {
    process.env.NODE_ENV = 'production';
    const response = { cookie: jest.fn() };

    (controller as unknown as { setRefreshCookie: (res: typeof response, token: string) => void })
      .setRefreshCookie(response, 'opaque-refresh-token');

    expect(response.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'opaque-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/auth',
        maxAge: authService.refreshCookieMaxAge,
      }),
    );
  });

  it('keeps the refresh cookie same-site in local development', () => {
    process.env.NODE_ENV = 'development';
    const response = { cookie: jest.fn() };

    (controller as unknown as { setRefreshCookie: (res: typeof response, token: string) => void })
      .setRefreshCookie(response, 'opaque-refresh-token');

    expect(response.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'opaque-refresh-token',
      expect.objectContaining({ secure: false, sameSite: 'lax' }),
    );
  });

  it('prevents authenticated profile responses from being cached', () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, AuthController.prototype.me)).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });
  });
});
