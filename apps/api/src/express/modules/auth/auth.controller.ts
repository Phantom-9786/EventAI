import type { Request, Response, NextFunction } from 'express';
import { AuthService, REFRESH_TOKEN_COOKIE } from '../../../modules/auth/auth.service';
import { GoogleOauthService } from '../../../modules/auth/google-oauth.service';
import { ServiceUnavailableError, UnauthorizedError } from '../../types';

const GOOGLE_STATE_COOKIE = 'eventai_google_state';

function sanitizeRedirectPath(raw: string | undefined): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) {
    return raw;
  }
  return '/events';
}

export class ExpressAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOauthService: GoogleOauthService,
    private readonly frontendUrl: string,
  ) {}

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/api/auth',
      maxAge: this.authService.refreshCookieMaxAge,
    });
  }

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user, tokens } = await this.authService.register(req.body);
      this.setRefreshCookie(res, tokens.refreshToken);
      res.status(201).json({ user, accessToken: tokens.accessToken });
    } catch (err) {
      next(err);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user, tokens } = await this.authService.login(req.body);
      this.setRefreshCookie(res, tokens.refreshToken);
      res.status(200).json({ user, accessToken: tokens.accessToken });
    } catch (err) {
      next(err);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
      const tokens = await this.authService.refresh(refreshToken);
      this.setRefreshCookie(res, tokens.refreshToken);
      res.status(200).json({ accessToken: tokens.accessToken });
    } catch (err) {
      next(err);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
      await this.authService.logout(refreshToken);
      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
      res.status(200).json({ message: 'Logged out' });
    } catch (err) {
      next(err);
    }
  };

  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }
      res.setHeader('Cache-Control', 'no-store');
      const user = await this.authService.getProfile(userId);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  };

  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }
      await this.authService.changePassword(
        userId,
        req.body.currentPassword,
        req.body.newPassword,
      );
      res.status(200).json({ message: 'Password changed. Please log in again.' });
    } catch (err) {
      next(err);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.requestPasswordReset(req.body.email);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.resetPassword(req.body.token, req.body.newPassword);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.authService.verifyEmail(req.body.token);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  resendVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }
      const result = await this.authService.resendEmailVerification(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  startGoogleLogin = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!this.googleOauthService.isConfigured) {
        throw new ServiceUnavailableError('Google sign-in is not configured on this server');
      }

      const target = sanitizeRedirectPath(req.query.redirect as string | undefined);
      const state = this.googleOauthService.createState(target);

      res.cookie(GOOGLE_STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 10 * 60 * 1000,
      });

      res.redirect(302, this.googleOauthService.buildAuthorizationUrl(state));
    } catch (err) {
      next(err);
    }
  };

  googleCallback = async (req: Request, res: Response): Promise<void> => {
    const frontend = this.frontendUrl;
    const fail = (error: string) => res.redirect(302, `${frontend}/signin?error=${error}`);

    res.clearCookie(GOOGLE_STATE_COOKIE, { path: '/api/auth' });

    if (req.query.error) {
      return fail('google_cancelled');
    }

    const state = req.query.state as string | undefined;
    const code = req.query.code as string | undefined;
    const cookieState = req.cookies?.[GOOGLE_STATE_COOKIE] as string | undefined;

    const redirect = this.googleOauthService.verifyState(cookieState, state);
    if (!redirect) {
      return fail('google_state_mismatch');
    }
    if (!code) {
      return fail('google_failed');
    }

    try {
      const profile = await this.googleOauthService.exchangeCode(code);
      const { tokens } = await this.authService.loginWithGoogle(profile);

      this.setRefreshCookie(res, tokens.refreshToken);
      const fragment = new URLSearchParams({
        access_token: tokens.accessToken,
        redirect,
      });
      res.redirect(302, `${frontend}/auth/callback#${fragment.toString()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('not verified')) return fail('google_email_unverified');
      if (message.includes('disabled')) return fail('google_account_disabled');
      return fail('google_failed');
    }
  };
}
