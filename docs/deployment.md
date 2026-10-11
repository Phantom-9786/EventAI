# Deployment

## Local development

```bash
npm install
npm run docker:up          # PostgreSQL 16 (:5433) + Redis 7 (:6379), healthchecked
cp .env.example .env       # set DATABASE_URL (port 5433), JWT_SECRET, REDIS_URL
npm run db:generate && npm run db:migrate
npm run db:seed            # category and organizer demo data; does not create an ADMIN
npm run dev                # API :4000 + web :3000
```

Health: `GET http://localhost:4000/api/health` → `{ status, dependencies: { database, redis } }`.

## Environment

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | always | e.g. `postgresql://eventai:eventai_dev@localhost:5433/eventai` |
| `NODE_ENV` | always | exactly `development`, `test`, or `production`; unknown/missing modes fail startup |
| `JWT_SECRET` | always | ≥16 chars generally and ≥32 in production; non-placeholder |
| `REDIS_URL` | production and AI chat | valid `redis://` or `rediss://` URL; AI protection fails closed if unavailable (ordinary cache reads still degrade gracefully) |
| `FRONTEND_URL` | production | must be `https://`; used as the single CORS origin |
| `NEXT_PUBLIC_API_URL` | web build | public HTTPS API base URL ending in `/api`; baked into browser bundles at build time (for example `https://api.staging.example.com/api`) |
| `RAZORPAY_KEY_ID/_SECRET/_WEBHOOK_SECRET` | production | optional in dev (checkout shows an honest "not configured" error) |
| `GROQ_API_KEY` or `GROQ_API_KEYS` | optional | AI chat returns 503 until a valid key is set; 401/403 failover is bounded and 429 cooldown applies to the whole configured pool |
| `GROQ_MODEL`, `GROQ_SIMPLE_MODEL`, `GROQ_MODERATE_MODEL`, `GROQ_COMPLEX_MODEL` | optional | Groq model IDs; tier-specific values override defaults; model access depends on the Groq project |
| `AI_RATE_LIMIT_USER_PER_MINUTE`, `AI_RATE_LIMIT_GLOBAL_PER_MINUTE`, `AI_MAX_CONCURRENT_REQUESTS` | optional | Shared Redis AI limits; defaults 10, 120, and 20 |
| `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS` | optional | AI request bounds; defaults 30000 ms and 600 output tokens |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | optional | API error monitoring; fully disabled without a DSN (see "Sentry" below) |
| `BREVO_API_KEY` / `EMAIL_FROM` | required in production | optional in development; verification and password-reset links require a configured Brevo API key and verified sender |
| `SEAT_HOLD_TTL_SECONDS` | optional | seat-hold window (default 600) |
| `RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` | optional | non-AI global throttle window/limit (in-memory per API instance; see security limitations) |

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

- A `beforeSend` scrubber runs on **both** apps: it deletes credential headers, strips query strings (reset tokens / OAuth params), and redacts payment-provider fields/signatures, ticket codes/QR data, contact fields, and other credential patterns in request data and extras.
- The SDK's default PII collection is off; no user IPs or cookies are sent.
- Events carry the API's `X-Request-Id` as a `request_id` tag so Sentry issues line up with the structured JSON logs.
- No DSN configured → the SDK is never initialized (startup, latency, and behavior are unchanged; both paths are unit-tested).

## CI/CD

`.github/workflows/ci.yml` runs on push/PR: npm cache → install → `lint` → `type-check` → `test` → `build` on Node 20. Verification runs live once the repo is pushed to GitHub.

## Containers

Per-app multi-stage Dockerfiles live in `docker/` (api, web, worker); `docker-compose.yml` provides postgres + redis with healthchecks. Full containerized end-to-end (building app images, compose-up of the whole stack) is pending final deployment wiring.

## Production startup and migrations

Set `NODE_ENV=production` in the deployment environment before starting the API. The API now rejects missing/unknown runtime modes and validates production database/cache URLs, the HTTPS frontend origin, signing-secret length, and payment credential placeholders before listening. Do not place production values in the repository or Docker build arguments; inject them through the deployment platform's secret/environment facility.

For a non-container Node deployment, build once and use the production API launcher with the platform-injected environment:

```bash
npm run build --workspace=@eventai/api
npm run start:prod --workspace=@eventai/api
```

For the web app, set `NEXT_PUBLIC_API_URL` to the public API base URL ending in `/api`, then use `npm run build --workspace=@eventai/web` followed by `npm run start --workspace=@eventai/web`. This public URL is compiled into browser bundles and cannot be changed by runtime environment variables. The `NEXT_PUBLIC_*` Sentry settings must also be present at build time. The Docker image requires `--build-arg NEXT_PUBLIC_API_URL=https://<api-host>/api`; its runtime environment cannot repair an image built without the correct endpoint. The Docker image path is separate and is not a complete application deployment definition.

For development, with the development `DATABASE_URL` selected:

```bash
npm run db:migrate --workspace=@eventai/database
```

For production, after taking the provider-recommended backup and selecting the production `DATABASE_URL` in the migration job environment:

```bash
npm run db:deploy --workspace=@eventai/database
```

The production command runs the checked-in migration history once in timestamp order. The Phase 4/5 migrations that must be applied before deploying the current API are:

1. `20261010120000_phase4_query_indexes`
2. `20261010121500_refund_pending_status`
3. `20261010150000_refund_reconciliation_key`

The earlier `20261008195519_init`, `20261009120000_google_oauth`, and `20261009150000_email_verification` migrations are also part of the ordered history and are applied by the same command if not already recorded. Run this as a release step before deploying API code that uses the new enum or reconciliation field. Never use `db:push`, `migrate dev`, `migrate reset`, or `db seed` against production. This repository does not include a full application Docker Compose deployment; build and run the API/web images using the platform's documented container workflow, inject API secrets at runtime, and supply the frontend's public Sentry settings at web build time if enabled.

The API and web images set production mode, run as a non-root user, and have HTTP healthchecks. The web image accepts `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` as build arguments because Next.js bundles public environment variables at build time; provide these non-secret public monitoring settings to the web image build if production frontend monitoring is required. The API readiness check returns 503 if PostgreSQL is unavailable and enables Nest shutdown hooks so Prisma and Redis lifecycle hooks can close on termination. The worker has graceful SIGTERM/SIGINT handling but no healthcheck and registers no job processors; do not deploy it as a required production processing service until queue processors and its operational health behavior are implemented.

## Initial administrator

The seed no longer creates an ADMIN account. Before first-admin provisioning, verify out of band that the intended account already exists, is active, and has verified its email. Check the target database for any existing ADMIN first; if one exists, stop and investigate rather than using the bootstrap command. Then run the one-time local command and follow its prompts:

```bash
npm run db:provision-admin --workspace=@eventai/database
```

The command requires the exact confirmation phrase, checks that no ADMIN exists inside a serializable transaction, updates only the named account, and writes an audit record. It does not create an account or expose a public role-promotion endpoint. This task did not connect to a database, so whether any legacy/demo ADMIN remains is unknown.

## Refund reconciliation limitation

If Razorpay's refund response is ambiguous, the API keeps `REFUND_PENDING` and does not issue another refund. Verified `refund.created`, `refund.processed`, and `refund.failed` webhook events are correlated to the stored refund attempt; the API also provides an ADMIN-only reconciliation operation at `POST /api/admin/bookings/:bookingId/refund/reconcile`, which queries Razorpay and never creates a refund. Only authoritative `processed`/`failed` statuses change local terminal state; missing or ambiguous provider data remains pending. Before production, configure and verify the Razorpay webhook URL, secret, and refund events, and ensure an authorized operator can access the reconciliation route. Never manually mark a booking refunded or restore inventory based only on an ambiguous client response.

## Production checklist

1. Provision Postgres + Redis; configure validated production variables and `NODE_ENV=production` through a secrets manager.
2. Inspect the intended database for existing ADMIN users and take a backup. Run `npm run db:deploy --workspace=@eventai/database` against the intended production `DATABASE_URL`; confirm all pending migrations listed above complete before deploying the current API.
3. If no ADMIN exists, create and verify the intended account, then follow the one-time provisioning procedure above; do not change a role ad hoc.
4. Build and run the API and web images behind TLS; restrict CORS to the exact HTTPS frontend origin. AI limits use Redis shared storage; configure and verify a shared throttler store before scaling non-AI endpoints horizontally.
5. Configure the Razorpay dashboard webhook at `POST /api/payments/webhook` with the matching webhook secret and at least `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, and `refund.failed` events. Confirm signatures are not logged.
6. Smoke-test in staging: `/api/health` dependencies, register/sign in, booking, payment verification, ticket QR, cancellation/refund, organizer/admin authorization, and ADMIN-only pending-refund reconciliation using mocked or Razorpay test-mode outcomes.
7. Do not rely on `apps/worker` for production jobs: it currently registers no processors and idles. Deploy it only after required processors and health monitoring exist; verify current application behavior does not depend on jobs being consumed.
