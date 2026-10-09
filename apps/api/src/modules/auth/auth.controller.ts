import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthService, REFRESH_TOKEN_COOKIE } from './auth.service';
import { GoogleOauthService } from './google-oauth.service';

const GOOGLE_STATE_COOKIE = 'eventai_google_state';

/** Only same-site relative paths may be used as post-login redirect targets. */
function sanitizeRedirectPath(raw: string | undefined): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) {
    return raw;
  }
  return '/events';
}

@ApiTags('auth')
@Controller('auth')
// Stricter rate limiting on all auth endpoints (per IP)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly googleOauthService: GoogleOauthService,
    private readonly configService: ConfigService,
  ) {}

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: this.authService.refreshCookieMaxAge,
    });
  }

  private get frontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Start Google sign-in (redirects to Google consent)' })
  startGoogleLogin(
    @Query('redirect') redirect: string | undefined,
    @Res() response: Response,
  ): void {
    if (!this.googleOauthService.isConfigured) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        message: 'Google sign-in is not configured on this server',
      });
      return;
    }

    const target = sanitizeRedirectPath(redirect);
    const state = this.googleOauthService.createState(target);

    // CSRF state: signed and mirrored via a short-lived cookie; the
    // callback requires the cookie and the query param to match.
    response.cookie(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 10 * 60 * 1000,
    });
    response.redirect(HttpStatus.FOUND, this.googleOauthService.buildAuthorizationUrl(state));
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth 2.0 redirect URI' })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') googleError: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const frontend = this.frontendUrl;
    const fail = (error: string) =>
      response.redirect(HttpStatus.FOUND, `${frontend}/signin?error=${error}`);

    response.clearCookie(GOOGLE_STATE_COOKIE, { path: '/api/auth' });

    if (googleError) {
      // User denied consent or Google reported a problem
      this.logger.warn(`Google sign-in aborted by Google: ${googleError}`);
      return fail('google_cancelled');
    }

    const redirect = this.googleOauthService.verifyState(
      response.req.cookies?.[GOOGLE_STATE_COOKIE] as string | undefined,
      state,
    );
    if (!redirect) {
      return fail('google_state_mismatch');
    }
    if (!code) {
      return fail('google_failed');
    }

    try {
      const profile = await this.googleOauthService.exchangeCode(code);
      const { tokens } = await this.authService.loginWithGoogle(profile);

      this.setRefreshCookie(response, tokens.refreshToken);
      // Access token travels in the URL fragment: fragments are never
      // sent to any server, so they do not end up in logs or Referer.
      const fragment = new URLSearchParams({
        access_token: tokens.accessToken,
        redirect,
      });
      response.redirect(HttpStatus.FOUND, `${frontend}/auth/callback#${fragment.toString()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('not verified')) return fail('google_email_unverified');
      if (message.includes('disabled')) return fail('google_account_disabled');
      this.logger.error(
        `Google sign-in failed: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return fail('google_failed');
    }
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new customer account' })
  async register(
    @Body(new ZodValidationPipe(registerSchema))
    body: { email: string; password: string; firstName: string; lastName: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user, tokens } = await this.authService.register(body);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { user, accessToken: tokens.accessToken };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user, tokens } = await this.authService.login(body);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { user, accessToken: tokens.accessToken };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get a new access token' })
  async refresh(@Res({ passthrough: true }) response: Response) {
    const refreshToken = response.req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    const tokens = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current session and clear the refresh cookie' })
  async logout(@Res({ passthrough: true }) response: Response) {
    const refreshToken = response.req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    await this.authService.logout(refreshToken);
    response.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
    return { message: 'Logged out' };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  async me(@CurrentUser('id') userId: string) {
    return { user: await this.authService.getProfile(userId) };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password (revokes all sessions)' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: { currentPassword: string; newPassword: string },
  ) {
    await this.authService.changePassword(userId, body.currentPassword, body.newPassword);
    return { message: 'Password changed. Please log in again.' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: { email: string },
  ) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset the password with a reset token' })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: { token: string; newPassword: string },
  ) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the account email with a verification token' })
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: { token: string },
  ) {
    return this.authService.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the email verification link (authenticated)' })
  async resendVerification(@CurrentUser('id') userId: string) {
    return this.authService.resendEmailVerification(userId);
  }
}
