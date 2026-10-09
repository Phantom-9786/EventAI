# Google Sign-In (OAuth 2.0)

## Status

> **Implemented, not yet verified against real Google credentials.**
> The full flow is coded and covered by unit tests (authorization URL, CSRF state,
> code exchange, ID-token verification, account linking, session issuing, frontend
> callback). No login has been performed with real Google Cloud credentials yet —
> follow the setup steps below and do one manual sign-in before considering it live.

## How the flow works

```
Browser                  API (NestJS)                     Google
   │  GET /api/auth/google   │                                │
   │────────────────────────>│  set signed state cookie       │
   │<── 302 consent URL ─────┤───────────────────────────────>│
   │                         │   GET /o/oauth2/v2/auth        │
   │  user consents          │<───────────────────────────────│
   │<── 302 callback ────────────────────────────────────────│
   │                         │  GET /api/auth/google/callback │
   │                         │  - state cookie == query state │
   │                         │  - exchange code               │
   │                         │  - verifyIdToken (aud, sig)    │
   │                         │  - link/create user            │
   │                         │  - issue session + refresh     │
   │                         │    cookie (same as email login)│
   │<── 302 /auth/callback#access_token=...&redirect=...      │
   │  stores token, calls /auth/me, continues to redirect     │
```

Key security properties:

- **ID token verified server-side** with `OAuth2Client.verifyIdToken` — signature,
  audience (`GOOGLE_CLIENT_ID`) and expiry are checked against Google's public keys.
  No token is ever trusted from the browser directly.
- **CSRF state**: a base64url payload (redirect target + 10-minute expiry) with an
  HMAC-SHA256 signature (keyed by `JWT_SECRET`). The same value is set as an
  httpOnly cookie (`eventai_google_state`, path `/api/auth`) and sent through
  Google; the callback requires the cookie and query param to match.
- **Access token in the URL fragment**: fragments are never sent to any server, so
  the token does not appear in server logs or the `Referer` header. The frontend
  callback page strips it from the address bar immediately.
- **Refresh token** uses the existing opaque rotating-token cookie mechanism
  (`eventai_refresh_token`) — identical to email/password login.
- **Open-redirect protection**: only same-site relative paths (`/...`, not `//...`)
  are accepted as post-login redirect targets.

## Account linking policy

| Situation | Action |
| --- | --- |
| User with matching `googleId` exists | Sign in (returning Google user) |
| No `googleId` match, email matches an existing account | **Auto-link only if Google reports `email_verified: true`**; sets `googleId`, marks the email verified |
| Google email not verified | Rejected before any database access |
| No matching user | Create a passwordless account (`passwordHash: null`), `role: CUSTOMER`, email marked verified |
| Account disabled (`isActive: false`) | Rejected with `google_account_disabled` |

Auto-linking on verified email is deliberate: Google verifies account ownership of
the email address, so a verified `email_verified` claim is proof the Google account
controls that mailbox. If `email_verified` is false, linking would be an
account-takeover vector and is refused.

Because Google-only accounts have no password:

- `POST /api/auth/login` returns the generic `Invalid email or password`
  (no information leak).
- `POST /api/auth/change-password` returns `400` with a message pointing users
  back to Google sign-in.
- `POST /api/auth/forgot-password` + reset still works — it sets an initial
  local password for the account.

## Database changes

Migration `20261009120000_google_oauth`:

- `users.passwordHash` is now nullable (`String?`) — Google-only accounts have no
  local password.
- New unique column `users.googleId` stores Google's immutable `sub` claim.

Run `npx prisma migrate deploy` (or `npx prisma migrate dev`) as usual.

## Setup steps (Google Cloud)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create
   (or select) a project.
2. **APIs & Services → OAuth consent screen**:
   - User type: *External* (Internal works only for Workspace domains).
   - App name, support email, developer contact — fill in the required fields.
   - Scopes: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
     (the defaults are sufficient).
   - Test users: while the consent screen is in *Testing* mode, add the Google
     accounts you want to sign in with.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs — add **exactly**:
     - Local dev: `http://localhost:4000/api/auth/google/callback`
     - Production: `https://<api-host>/api/auth/google/callback`
   - Copy the **Client ID** and **Client secret**.
4. Set the environment variables (see `.env.example`):

   ```env
   GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<client secret>
   # Optional override; defaults to http://localhost:<PORT>/api/auth/google/callback
   GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
   ```

5. Restart the API. The feature is gated: with no client ID/secret configured,
   `GET /api/auth/google` responds `503` and nothing else in the app changes.
6. Verify manually:
   - Open the app, click **Continue with Google** on `/signin` or `/signup`.
   - Confirm consent → redirect back → session active (`/auth/me` works,
     refresh cookie rotates).
   - Try signing in with a Google account whose email matches an existing
     password account → confirm the accounts were linked (`googleId` set, same
     user id, bookings preserved).
   - Try with a fresh email → confirm a new passwordless user is created.

## Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /api/auth/google?redirect=/events` | Starts the flow (302 to Google). 503 when not configured. |
| `GET /api/auth/google/callback` | Google's redirect URI — not called directly. |

Frontend error redirects land on `/signin?error=google_*`:
`google_cancelled`, `google_state_mismatch`, `google_failed`,
`google_email_unverified`, `google_account_disabled`.

## Tests

- `apps/api/src/modules/auth/auth.service.spec.ts` — login-with-Google: new
  account creation, safe linking, unverified-email refusal, disabled accounts,
  password-login guard for Google-only accounts.
- `apps/api/src/modules/auth/google-oauth.service.spec.ts` — feature gating,
  state signing/tampering/expiry/CSRF, authorization URL shape, code exchange,
  ID-token payload normalization, failure mapping.
