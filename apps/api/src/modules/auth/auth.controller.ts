import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthService, REFRESH_TOKEN_COOKIE } from './auth.service';

@ApiTags('auth')
@Controller('auth')
// Stricter rate limiting on all auth endpoints (per IP)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: this.authService.refreshCookieMaxAge,
    });
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
}
