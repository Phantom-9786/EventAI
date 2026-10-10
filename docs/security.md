# Security

## Implemented controls

| Control | Implementation |
|---------|----------------|
| Password hashing | argon2id (`argon2.hash` with default memory/time params) |
| Sessions | opaque rotating refresh tokens stored **only** as SHA-256 hashes; httpOnly, sameSite=lax, path-scoped cookie; access JWT (`{ sub, email, role }`) via bearer header |
| RBAC | global `JwtAuthGuard` (all routes JWT unless `@Public()`) + `RolesGuard` (`@Roles()`), organizer ownership checks on every organizer resource |
| Input validation | Zod schemas on every write endpoint (`ZodValidationPipe`, whitelist + reject unknown fields) |
| Rate limiting | global `ThrottlerGuard` (`RATE_LIMIT_TTL`/`RATE_LIMIT_MAX`); auth endpoints stricter (10 req/min/IP) |
| Headers | Helmet enabled |
| CORS | single-origin allow-list from `FRONTEND_URL`, credentials enabled; production env validation requires an `https://` `FRONTEND_URL` |
| Request size | Express JSON body limit (100 kB default) + Multer avatar cap (5 MB, mimetype allow-list → 415/413) |
| Error responses | global exception filter returns a consistent envelope with no stack traces; operational logs omit query strings and raw exception/provider messages |
| Webhooks | Razorpay HMAC-SHA256 over the **raw** body, constant-time compare |
| Tokens at rest | refresh/session/password-reset tokens hashed (SHA-256) before storage, single-use reset with 1h expiry |
| Google OAuth | ID token verified server-side (`verifyIdToken`: signature, audience, expiry); HMAC-signed CSRF state mirrored via httpOnly cookie; existing accounts auto-linked **only** when Google reports `email_verified`; access token returned via URL fragment; post-login redirect restricted to same-site relative paths |
| Uploads | served statically only under `/uploads/*` with 1-day cache |
| Env | fail-fast validation on boot; runtime mode, production URLs, HTTPS origin, signing-secret length, payment placeholders, and Sentry trace sample rate are validated; unsafe `X-Request-Id` values are replaced |
| Sentry privacy | API and web `beforeSend` scrubbers remove credentials, payment provider fields/signatures, ticket codes/QR data, contact fields, and URL query strings |
| Logging privacy | verification tokens are never logged; email recipients, ticket codes, query parameters, and raw provider error text are omitted from operational logs |
| Readiness | `/api/health` returns 503 when PostgreSQL is unavailable so the API container healthcheck cannot report a database-disconnected process ready |

## CSRF posture

The API is bearer-token driven (no ambient cookie auth for API calls). The only cookie (`eventai_refresh_token`) is httpOnly, `SameSite=Lax`, and path-scoped to `/api/auth/refresh`, so cross-site POSTs cannot reach state-changing endpoints with it. A formal CSRF-token layer is therefore not required today; revisit if cookie-based session auth is ever added for the API.

## Operational limitations

- Audit logging covers admin provisioning and refund transitions, but it is not a general audit trail for all administrative actions.
- Sentry is implemented for API and web; dashboard event visibility still requires live verification in each Sentry project.
- The throttler store is in-memory and per-instance; configure a shared store before horizontally scaling so rate limits apply across API replicas.
