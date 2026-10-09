import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { createHmac, timingSafeEqual } from 'crypto';

// ═══════════════════════════════════════════════════
// Google OAuth 2.0 plumbing: authorization URL,
// signed CSRF state, authorization-code exchange and
// ID-token verification (signature, audience, expiry).
//
// The service is feature-gated: without GOOGLE_CLIENT_ID
// and GOOGLE_CLIENT_SECRET every call throws a
// ServiceUnavailableException and /api/auth/google
// returns 503 — the rest of the app keeps working.
// ═══════════════════════════════════════════════════

export interface GoogleProfile {
  /** Google's immutable account id ("sub" claim) */
  sub: string;
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  picture: string | null;
}

interface StatePayload {
  redirect: string;
  exp: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class GoogleOauthService {
  private readonly logger = new Logger(GoogleOauthService.name);
  private client: OAuth2Client | null = null;

  constructor(private readonly configService: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private get clientId(): string | undefined {
    const id = this.configService.get<string>('GOOGLE_CLIENT_ID');
    return id && id.trim() !== '' ? id.trim() : undefined;
  }

  private get clientSecret(): string | undefined {
    const secret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    return secret && secret.trim() !== '' ? secret.trim() : undefined;
  }

  private get callbackUrl(): string {
    return (
      this.configService.get<string>('GOOGLE_CALLBACK_URL') ??
      `http://localhost:${this.configService.get<number>('PORT', 4000)}/api/auth/google/callback`
    );
  }

  private getClient(): OAuth2Client {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    if (!this.client) {
      this.client = new OAuth2Client(this.clientId, this.clientSecret, this.callbackUrl);
    }
    return this.client;
  }

  buildAuthorizationUrl(state: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.clientId ?? '');
    url.searchParams.set('redirect_uri', this.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    // select_account prevents silently logging in with a stale Google session
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('access_type', 'online');
    return url.toString();
  }

  /**
   * Builds a CSRF state value: base64url(payload).hmac(payload).
   * Stateless (no server-side storage) — the same value is set as a
   * cookie and sent through Google; the callback requires that the
   * cookie and the query parameter match AND the signature is valid.
   */
  createState(redirect: string): string {
    const payload = Buffer.from(
      JSON.stringify({ redirect, exp: Date.now() + STATE_TTL_MS } satisfies StatePayload),
    ).toString('base64url');
    return `${payload}.${this.signState(payload)}`;
  }

  /**
   * Verifies that the cookie state and the state returned by Google are
   * identical and authentic, and returns the validated redirect path.
   * Returns null on any mismatch (never throws — the caller redirects
   * to the frontend with a generic error).
   */
  verifyState(cookieState: string | undefined, queryState: string | undefined): string | null {
    if (!cookieState || !queryState || cookieState !== queryState) return null;
    const dot = cookieState.lastIndexOf('.');
    if (dot <= 0) return null;
    const payload = cookieState.slice(0, dot);
    const signature = cookieState.slice(dot + 1);
    const expected = this.signState(payload);
    const sigA = Buffer.from(signature);
    const sigB = Buffer.from(expected);
    if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) return null;

    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as StatePayload;
      if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
      if (typeof parsed.redirect !== 'string') return null;
      // Only allow same-site relative paths (no open redirect)
      if (!parsed.redirect.startsWith('/') || parsed.redirect.startsWith('//')) return null;
      return parsed.redirect;
    } catch {
      return null;
    }
  }

  /**
   * Exchanges the authorization code for tokens and verifies the ID token
   * server-side (signature, audience and expiry are checked by
   * OAuth2Client.verifyIdToken against Google's public keys).
   */
  async exchangeCode(code: string): Promise<GoogleProfile> {
    const client = this.getClient();
    let tokens;
    try {
      ({ tokens } = await client.getToken(code));
    } catch (err) {
      this.logger.warn(
        `Google token exchange failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new UnauthorizedException('Google authorization failed');
    }
    if (!tokens.id_token) {
      throw new UnauthorizedException('Google authorization failed');
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Google authorization failed');
    }

    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      firstName: payload.given_name ?? null,
      lastName: payload.family_name ?? null,
      picture: payload.picture ?? null,
    };
  }

  private signState(payload: string): string {
    const secret = this.configService.get<string>('JWT_SECRET') ?? '';
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }
}
