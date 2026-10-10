# Deployment

## Local development

```bash
npm install
npm run docker:up          # PostgreSQL 16 (:5433) + Redis 7 (:6379), healthchecked
cp .env.example .env       # set DATABASE_URL (port 5433), JWT_SECRET, REDIS_URL
npm run db:generate && npm run db:migrate
npm run db:seed            # categories + demo users (see docs/database.md)
npm run dev                # API :4000 + web :3000
```

Health: `GET http://localhost:4000/api/health` → `{ status, dependencies: { database, redis } }`.

## Environment

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | always | e.g. `postgresql://eventai:eventai_dev@localhost:5433/eventai` |
| `JWT_SECRET` | always | ≥16 chars, non-placeholder (fail-fast on boot) |
| `REDIS_URL` | always | cache degrades gracefully if unreachable |
| `FRONTEND_URL` | production | must be `https://`; used as the single CORS origin |
| `RAZORPAY_KEY_ID/_SECRET/_WEBHOOK_SECRET` | production | optional in dev (checkout shows an honest "not configured" error) |
| `GROQ_API_KEY` / `GROQ_MODEL` | optional | AI chat 503s with an actionable message until a real key is set (Groq; default model `openai/gpt-oss-120b`) |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | optional | API error monitoring; fully disabled without a DSN (see "Sentry" below) |
| `BREVO_API_KEY` / `EMAIL_FROM` | optional | transactional emails skip with a dev log until set; `EMAIL_FROM` must be a sender verified in Brevo |
| `SEAT_HOLD_TTL_SECONDS` | optional | seat-hold window (default 600) |
| `RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` | optional | global throttle window/limit |

## Sentry error monitoring (optional, wired 2026-10-10)

Two separate Sentry projects are recommended (separate platforms, SDKs, issue grouping, and alerting):

- **`eventai-api`** — platform **Node.js/NestJS**: captures unhandled API exceptions via `@sentry/nestjs` (v11 `nestIntegration()`), initialized at the very start of `main.ts` bootstrap.
- **`eventai-web`** — platform **Next.js**: captures browser + SSR/edge errors via `@sentry/nextjs` (`sentry.client|server|edge.config.ts`, injected by `withSentryConfig` in `next.config.mjs`).

### Manual dashboard steps (owner)

1. Sign up / log in at [sentry.io](https://sentry.io) and create an organization.
2. **Create project "eventai-api"** → platform **Node.js** (or NestJS). Copy its DSN.
3. **Create project "eventai-web"** → platform **Next.js**. Copy its DSN.
4. API: set in `apps/api/.env`:
   - `SENTRY_DSN=<eventai-api DSN>`
   - `SENTRY_ENVIRONMENT=development|staging|production`
5. Web: set in `apps/web/.env.local`:
   - `NEXT_PUBLIC_SENTRY_DSN=<eventai-web DSN>`
   - `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development|staging|production`
6. Restart the apps. No test event is sent from this repo — verify by visiting an endpoint that errors, or temporarily log `Sentry.captureMessage('ping')` behind a comment.
7. Optional (CI source-map upload for the web project): create an **auth token** (Settings → Auth Tokens, scope `project:releases`) and set `SENTRY_ORG`, `SENTRY_PROJECT=eventai-web`, `SENTRY_AUTH_TOKEN` as CI secrets — source-map upload stays disabled without it.

### Privacy behavior

- A `beforeSend` scrubber runs on **both** apps: it deletes `authorization`/`cookie` headers, strips query strings (reset tokens / OAuth params), and redacts any key matching password/secret/token/api-key/card/cvv/otp patterns in request data and extras (payment bodies and Groq keys never reach Sentry).
- The SDK's default PII collection is off; no user IPs or cookies are sent.
- Events carry the API's `X-Request-Id` as a `request_id` tag so Sentry issues line up with the structured JSON logs.
- No DSN configured → the SDK is never initialized (startup, latency, and behavior are unchanged; both paths are unit-tested).

## CI/CD

`.github/workflows/ci.yml` runs on push/PR: npm cache → install → `lint` → `type-check` → `test` → `build` on Node 20. Verification runs live once the repo is pushed to GitHub.

## Containers

Per-app multi-stage Dockerfiles live in `docker/` (api, web, worker); `docker-compose.yml` provides postgres + redis with healthchecks. Full containerized end-to-end (building app images, compose-up of the whole stack) is pending final deployment wiring.

## Production checklist

1. Provision Postgres + Redis; set all production env vars (validation enforces the critical ones).
2. `prisma migrate deploy` (never `db push`).
3. Build and run `apps/api` behind TLS; keep the web app as the only allowed CORS origin.
4. Point the Razorpay dashboard webhook at `POST /api/payments/webhook`.
5. Smoke-test: `/api/health` shows database + redis up; register → book → pay (sandbox) → ticket QR → door validate.
