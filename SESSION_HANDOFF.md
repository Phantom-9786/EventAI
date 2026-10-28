# EventPoint — Session Handoff & Reboot Guide

**Date:** October 13, 2026  
**Project Path:** `E:\Project - Copy`  
**Purpose:** Ensure seamless, safe continuation of work after machine reboot.

---

## 1. Git Repository State

* **Active Branch:** `feat/local-workflow-fixes-and-ui`
* **Base / Latest Commit:** `398746e` (`feat: complete product rescue, repair, redesign, and end-to-end delivery (#3)`)
* **Working Tree State:** All modifications and untracked files are strictly preserved (no stashes, commits, resets, or discards).

### Modified Tracked Files (33)
* **Backend (`apps/api`):**
  * `apps/api/src/modules/bookings/bookings.service.ts` & `bookings.service.spec.ts`
  * `apps/api/src/modules/events/events.service.ts`, `events.service.spec.ts`, `event-media.controller.ts`, `event-media.service.ts`
  * `apps/api/src/modules/notifications/notifications.module.ts`, `notifications.service.ts`, `notifications.service.spec.ts`
  * `apps/api/src/modules/organizers/organizers.controller.ts`, `organizers.service.ts`, `organizers.service.spec.ts`
  * `apps/api/src/modules/payments/payments.service.ts`, `payments.service.spec.ts`
  * `apps/api/src/modules/users/users.controller.ts`, `users.service.ts`, `users.service.spec.ts`
* **Frontend (`apps/web`):**
  * `apps/web/next.config.mjs`
  * `apps/web/src/app/account/page.tsx`
  * `apps/web/src/app/events/[slug]/page.tsx`
  * `apps/web/src/app/globals.css`
  * `apps/web/src/components/booking/booking-widget.tsx`
  * `apps/web/src/components/layout/header.tsx`
  * `apps/web/src/components/organizer/event-editor.tsx`
  * `apps/web/src/components/organizer/event-form.tsx`
  * `apps/web/src/components/organizer/refund-requests.tsx`
  * `apps/web/src/lib/api.ts`, `auth.ts`, `organizer.ts`
* **Shared / Documentation:**
  * `context.md`
  * `implementation.md`
  * `packages/validation/src/event.ts`
  * `e2e/product-lifecycle.spec.ts`

### Untracked Files (7)
* `apps/api/src/modules/events/event-media.service.spec.ts`
* `apps/api/src/modules/notifications/notifications.controller.ts`
* `apps/web/src/components/notifications/` (notification popover and bell component)
* `apps/web/src/components/ui/date-time-picker.tsx`
* `apps/web/src/lib/notifications.ts`
* `e2e/priority-bugfixes.spec.ts`
* `e2e/verification-flows.spec.ts`

---

## 2. Infrastructure & Services (Ports & Local URLs)

* **Web Frontend:** `http://localhost:3000` (Next.js)
* **API Backend:** `http://localhost:4000/api` (NestJS)
  * Swagger Docs: `http://localhost:4000/api/docs`
  * Health Check: `http://localhost:4000/api/health`
* **Local PostgreSQL:** Host Port `5433` -> Container `eventai-postgres` (Docker)
* **Local Redis:** Host Port `6379` -> Container `eventai-redis` (Docker)

---

## 3. What Has Been Completed & Verified

1. **Banner Image Upload (P0):** Fixed multipart body forwarding in `next.config.mjs` and NestJS Multer setup. Verified upload via API and browser.
2. **Attendee Refund Button:** Enabled for eligible confirmed bookings in `/tickets` and booking detail modal.
3. **Public Venue Visibility:** Fixed visibility rules so venue details correctly render on public event detail pages.
4. **Theme & Date-Time Picker:** Created robust dark/light theme date-time picker with high contrast and smooth transitions.
5. **In-App Notifications:** Implemented notification bell in both attendee and organizer navigation headers with polling and unread count badges.
6. **Account Deletion Safeguards:** Implemented validation blockers for accounts with active organizer events or pending bookings, with clear UI messages.
7. **Event Creation Wizard:** 6-step creation flow with ticket tiers, capacity calculation, and validation verified.
8. **Razorpay 401 Authentication Diagnosis:**
   - **Root Cause Confirmed:** The test key generated Oct 11, 2026 invalidated the older Oct 10 test key. Project `.env` files held the revoked Oct 10 credentials.
   - **Resolution:** Synchronized the active Oct 11 test credentials across `.env` and `apps/api/.env` (without logging or exposing secrets).
   - **Dynamic Client Lifecycle:** Updated `ensureClient()` in `payments.service.ts` to reload credentials dynamically without stale caching.
   - **Unit Tests:** All 48 test cases in `apps/api/src/modules/payments/payments.service.spec.ts` pass (`48 passed, 48 total`).

---

## 4. Current Razorpay Situation & Safety Rules

> [!IMPORTANT]
> **Strict Payment & Refund Safety Rules:**
> - The existing October 11 Test Mode credentials were synchronized into `.env` and `apps/api/.env`.
> - A safe, read-only Razorpay API request (`GET /v1/items?count=1`) confirmed **HTTP 200 OK**.
> - The existing **₹1,499 DevCon Mumbai 2026 refund** remains in **`REFUND_PENDING`** state.
> - Reconciliation against the local API endpoint returned:
>   `{ status: "REFUND_PENDING", outcome: "unknown", message: "Provider settlement is still in progress. No settled refund record has been indexed yet." }`
> - **DO NOT** approve, retry, initiate, or trigger another refund.
> - **DO NOT** claim the refund has completed; it remains pending upstream settlement.

---

## 5. Post-Reboot Recovery Steps

When your machine finishes rebooting:

### Step 1: Check Docker Containers
Ensure Docker Desktop has started, then verify PostgreSQL and Redis containers:
```powershell
docker ps
```
If containers are stopped, start them **without resetting volumes or data**:
```powershell
docker start eventai-postgres eventai-redis
```

### Step 2: Start EventPoint Dev Servers
From the repository root (`E:\Project - Copy`):
```powershell
npm run dev
```
This starts:
- Frontend on `http://localhost:3000`
- Backend on `http://localhost:4000/api`

### Step 3: Verify Service Health
Run a quick health check:
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/health"
```
Expect: `status: ok`, `database: up`, `redis: up`.

---

## 6. Single Next Action to Continue

Proceed with the **manual visual inspection** in the local browser (`http://localhost:3000`) across the 6 key user workflows:
1. Complete 6-step event creation wizard (`/organizer/events/new`).
2. Organizer refund tabs and reconciliation message (`/organizer/refunds` - inspect the ₹1,499 pending settlement message).
3. Notification bell in attendee and organizer headers.
4. Account deletion blocker messages (`/account`).
5. Date/time picker and dark/light theme toggle.
6. Public venue visibility (`/events/devcon-mumbai-2026`).

---

## 7. Session 2, Phase 2: Authentication & Users Migration Status

* **Status:** COMPLETE
* **Verified Features:**
  * User registration and login with Argon2id hashing and Zod validation.
  * Access JWT (1h) + opaque rotating refresh tokens with SHA-256 hash persistence in `sessions`.
  * Secure `eventai_refresh_token` httpOnly cookie with environment-aware SameSite/Secure policies.
  * Session revocation and cookie clearing on logout.
  * Token refresh rotation (`POST /api/auth/refresh`) issuing new access tokens and rotating refresh tokens.
  * Self-service password reset with single-use, 1h-expiring hashed tokens (`/forgot-password`, `/reset-password`).
  * Email verification token lifecycle (`/verify-email`, `resend-verification`).
  * Google OAuth 2.0 authorization-code flow, state verification, CSRF defense, and frontend redirect fragment.
  * User profile retrieval (`/api/users/me`), profile updates (`PATCH /api/users/me`), and preference JSON merging.
  * Avatar upload with 5 MB Multer limit, format filtering (JPEG, PNG, WebP, GIF), and static serving.
  * Account deactivation and permanent anonymization deletion with blocker checks.
  * Role-based access control (`requireRoles`) enforcing `CUSTOMER`, `ORGANIZER`, `ADMIN`.
  * In-memory rate limiting with `X-RateLimit-*` and `Retry-After` headers.
* **Test Verification:**
  * `src/express/auth.spec.ts`: 29 tests passed.
  * `src/express/users.spec.ts`: 20 tests passed.
  * Total Express tests in `src/express/`: **191/191 passed across 11 test suites**.
  * Total API tests: **633/633 passed across 38 test suites**.
  * Monorepo type-check: **12/12 successful**.

---

## 8. Session 2, Phase 3: Events & Venues Migration Status

* **Status:** COMPLETE
* **Verified Features:**
  * Public event listing, search, filtering, pagination, sorting, and event details.
  * Applied query coercion schema (`validateQuery(eventSearchSchema)`) on Express `GET /api/events` ensuring numerical query parameters (`page`, `limit`) with defaults (`page=1`, `limit=20`), handling empty search inputs without `NaN` SQL offset errors.
  * Category listing and venue management, including organizer venue creation and seat-section generation (`/api/organizers/venues/:venueId/sections`).
  * Seat section generation and validation rejecting non-UUID identifiers with 400 Bad Request.
  * Organizer event creation, editing, ownership checks, and lifecycle validation (`startDate < endDate`).
  * Ticket-type and catalog integration needed by event creation and editing (`POST /api/ticket-types`, `PATCH /api/ticket-types/:id`, `DELETE /api/ticket-types/:id`).
  * Search indexing and cache invalidation triggered on event publish, updates, and cancellations.
  * Event-media route integration and failure handling (`POST /api/events/upload-image` without file returning structured 400 error rather than 500s).
  * Admin moderation integration: pending, unapproved, and rejected events isolated from public discoverability (`GET /api/events/:idOrSlug` returns 404).
* **Test Verification:**
  * Express Events & Moderation suite (`src/express/events-moderation.spec.ts`): **35/35 passed** (expanded with 13 focused test cases).
  * Total Express tests in `src/express/`: **204/204 passed across 11 test suites**.
  * Total API tests (`npm test --prefix apps/api`): **646/646 passed across 38 test suites**.
  * Monorepo type-check (`npm run type-check`): **12/12 successful across all 7 packages**.
  * Playwright E2E browser suites: **17/17 passed**.

---

## 9. Session 2, Phase 4: Bookings & Payments Migration Status

* **Status:** COMPLETE
* **Verified Features:**
  * Concurrency-safe ticket inventory reservations inside transactions with deterministic sorting of ticket-type locks preventing PostgreSQL deadlocks.
  * Seat holds with configurable TTL (`SEAT_HOLD_TTL_SECONDS`), lazy expiration on booking lookups/listings, and minute cron sweep safely releasing seats back to `AVAILABLE` and restoring stock.
  * Fast-path and concurrent race handling for idempotency keys (`idempotencyKey`); rejecting stolen or cross-user idempotency keys with 403 Forbidden.
  * Event lifecycle safeguards preventing booking on started events or outside ticket sale windows, with maxPerBooking limit enforcement.
  * Razorpay order creation (`POST /api/payments/order`) with open-order reuse, rejecting expired or already paid/cancelled bookings.
  * Razorpay checkout verification (`POST /api/payments/verify`) using HMAC SHA-256 signatures, amount parity verification, and idempotent booking return on duplicate calls.
  * Webhook raw-body verification via express.json verify buffer callback (`req.rawBody`), validating signatures against `RAZORPAY_WEBHOOK_SECRET`.
  * Duplicate and out-of-order webhook resilience: duplicate captured events return `{ received: true, handled: false }`; late failed webhooks after capture are ignored without corrupting state.
  * Digital ticket generation with unique codes (`TKT-...`), QR payload data, and secure data-URL QR delivery (`GET /api/payments/tickets/:id/qr`).
  * Digital ticket check-in at the door (`POST /api/organizers/events/:eventId/tickets/validate`) with single-scan enforcement, returning 409 Conflict with timestamp on duplicate scans and blocking cancelled tickets.
  * Door check-in statistics (`GET /api/organizers/events/:eventId/tickets/stats`) returning live status counts (`VALID`, `USED`, `CANCELLED`, `EXPIRED`).
  * Complete cancellation & refund lifecycle: unpaid reservations can be cancelled directly by attendees with stock restored; confirmed reservations submit structured refund requests requiring organizer review.
  * Organizer refund oversight (`/api/organizers/refund-requests`) supporting approval, rejection, reconciliation, and recovery without real financial provider calls during tests.
  * Admin refund reconciliation (`POST /api/admin/bookings/:id/refund/reconcile`) preserving pending refund settlement states.
* **Test Verification:**
  * Express Bookings & Payments suite (`src/express/bookings-payments.spec.ts`): **51/51 passed** (expanded from 21 with 30 focused test cases).
  * Total Express tests in `src/express/`: **234/234 passed across 11 test suites**.
  * Total API tests (`npm test --prefix apps/api`): **676/676 passed across 38 test suites**.
  * Monorepo type-check (`npm run type-check`): **12/12 successful across all 7 packages**.
  * Playwright E2E browser suites: **17/17 passed**.

---

## 10. Session 2, Phase 5: Notifications, AI, and Admin Migration Status

* **Status:** COMPLETE
* **Verified Features:**
  * In-app notification polling and CRUD (`GET /api/notifications` with default 30 and clamped max 100 limits; `PATCH /api/notifications/:id/read`; `POST /api/notifications/read-all`).
  * Email notification delivery via Brevo / SMTP with exponential backoff retries (3 attempts), non-retryable 4xx rejection handling, and graceful skipping when unconfigured without uncaught 500s.
  * AI assistant chat endpoint (`POST /api/ai/chat`) with live catalog event grounding and unconfigured-provider fallback.
  * AI server-sent events (SSE) streaming mode (`text/event-stream`, `Cache-Control: no-cache, no-transform`, chunk format `data: ...\n\n`, `data: [DONE]\n\n`, client disconnect detection).
  * Groq key pool rotation on 401 Unauthorized, rate limit backoff on 429 Too Many Requests, and multi-key fallback.
  * Redis-backed `AiRequestGuard` rate-limiting requests across instances and returning 429 Too Many Requests with `Retry-After`.
  * Provider cooldown circuit breaker returning 503 Service Unavailable when upstream providers are in cooldown.
  * Admin platform metrics and health (`GET /api/admin/stats`, `GET /api/admin/users`, `GET /api/admin/bookings`, `GET /api/admin/audit-logs`).
  * Admin organizer application approval and rejection workflows with reasons (`POST /api/admin/organizers/:id/approve`, `POST /api/admin/organizers/:id/reject`).
  * Admin organizer verification status toggling (`PATCH /api/admin/organizers/:id/verification`).
  * Admin event moderation and review with action/reason (`POST /api/admin/events/:id/review`, `POST /api/admin/events/:id/moderate`).
  * Self-deactivation blocker preventing admins from deactivating their own administrative account.
  * Strict role-based access control (`requireRoles(UserRole.ADMIN)`) blocking unauthenticated, customer, and organizer users with 401/403.
* **Test Verification:**
  * Express Notifications spec (`src/express/notifications.spec.ts`): **10/10 passed** (expanded from 4).
  * Express AI & Streaming spec (`src/express/ai.spec.ts`): **15/15 passed**.
  * Express Admin & Security spec (`src/express/admin.spec.ts`): **26/26 passed** (expanded from 18).
  * Total Express tests in `src/express/`: **248/248 passed across 11 test suites** (increased from 234).
  * Total API tests (`npm test --prefix apps/api`): **690/690 passed across 38 test suites** (increased from 676).
  * Monorepo type-check (`npm run type-check`): **12/12 successful across all 7 packages**.
  * Playwright E2E browser suites: **17/17 passed**.

---

## 11. Session 2, Phase 6: Cutover & Rollback Readiness Strategy

* **Status:** READY FOR CUTOVER (Awaiting User Execution Approval)
* **Goal:** Transition production and staging API traffic safely from NestJS to the standalone Express backend (`apps/api/src/express/main.ts`) with zero downtime, byte-for-byte signature verification, shared database continuity, and deterministic rollback procedures.

### 11.1 Required Environment Variables & Secrets Matrix
The standalone Express server consumes the exact same configuration keys validated by `@eventai/config` and `apps/api/src/config/env.validation.ts`:
* `NODE_ENV`: `'production'` | `'staging'` | `'development'` (Enforces HTTPS, non-placeholder secrets, and secure cookie attributes).
* `PORT`: Service port (default `4000`).
* `DATABASE_URL`: Managed PostgreSQL connection URI with SSL parameter (`sslmode=require`). Shared without modification between NestJS and Express.
* `REDIS_URL`: Managed Redis connection URI (`redis://` or `rediss://`) for cache invalidation, session data, and `AiRequestGuard`.
* `JWT_SECRET`: Minimum 32-character high-entropy secret. Tokens issued by NestJS decode transparently in Express and vice versa.
* `JWT_EXPIRY`: Token expiry string (e.g. `15m`, `1h`, `7d`).
* `FRONTEND_URL`: Canonical web application origin for CORS preflight headers and email action links.
* `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: Active credentials. Both backends use the identical HMAC SHA-256 signature algorithm against raw payload buffers.
* `BREVO_API_KEY`, `EMAIL_FROM`: Transactional email credentials.
* `GROQ_API_KEY` / `GROQ_API_KEYS`: Groq AI API keys for chatbot catalog grounding and streaming.
* `UPLOAD_DIR`: Persistent volume mount (`/app/uploads`).

### 11.2 Database Migration Compatibility & Backup Requirements
* **Schema Compatibility:** Both NestJS and Express utilize the identical `@eventai/database` Prisma client (`packages/database/prisma/schema.prisma`). Zero schema divergence, new tables, or incompatible enum values were introduced.
* **Pre-Cutover Backup:**
  1. Trigger an on-demand, manual snapshot of the managed PostgreSQL database before any routing change:
     ```bash
     # Example managed provider CLI or AWS RDS snapshot
     aws rds create-db-snapshot --db-instance-identifier eventai-prod --db-snapshot-identifier pre-express-cutover-$(date +%s)
     ```
  2. Confirm Point-In-Time Recovery (PITR) is active with continuous WAL archiving.
* **Migration Safeguard:** No pending migrations need to be applied for cutover. `npm run db:deploy` remains idempotent across releases.

### 11.3 Health Checks & Smoke Test Sequence
Before directing ingress traffic to Express:
1. **Liveness / Readiness Probe:**
   - Execute: `GET https://api-express.internal/api/health` and `GET https://api-express.internal/health`
   - Expect: HTTP 200 OK with `{"status":"ok","database":"up","redis":"up"}`.
   - If database or Redis is disconnected, probe returns HTTP 503 Service Unavailable, preventing traffic ingress.
2. **Pre-Traffic Automated Smoke Tests:**
   - Verify public event discovery: `GET /api/events?page=1&limit=5` -> HTTP 200 with items array.
   - Verify categories: `GET /api/categories` -> HTTP 200.
   - Verify auth rejection: `GET /api/users/me` without Bearer token -> HTTP 401 Unauthorized.
   - Verify CORS preflight: `OPTIONS /api/events` with `Origin: $FRONTEND_URL` -> HTTP 204 with `Access-Control-Allow-Origin: $FRONTEND_URL`.

### 11.4 Traffic Switching & Post-Cutover Monitoring
* **Canary / Weighted Shift Procedure:**
  1. **Phase 1 (Internal & Webhook Canary - 10%):** Route 10% of ingress requests or internal worker queries to the Express service via Cloudflare / AWS ALB / NGINX ingress. Monitor 5xx error rates and p95 latency.
  2. **Phase 2 (Read Traffic - 50%):** Route 50% of traffic. Confirm Redis cache hit rate and session verification stability.
  3. **Phase 3 (Full Cutover - 100%):** Switch 100% of DNS / ingress routing (`api.eventai.example.com`) to the Express container pool.
* **Post-Cutover Monitoring Metrics (First 60 Minutes):**
  - **Error Rate:** HTTP 5xx responses must remain below 0.1%.
  - **Payment Webhook Verification:** 100% of Razorpay webhook deliveries must return HTTP 200 with `{ received: true }`. Zero HMAC signature rejections.
  - **AI Streaming:** SSE responses on `/api/ai/chat` must stream cleanly without socket resets or premature terminations.
  - **Latency:** API p95 response time must remain $\le 150\text{ ms}$.

### 11.5 Rollback Triggers & Fast Rollback Procedure
* **Immediate Rollback Triggers:**
  - Sustained HTTP 5xx error rate $> 1\%$ for more than 2 consecutive minutes.
  - Any failure in Razorpay HMAC webhook signature verification on valid merchant events.
  - Database connection pool exhaustion (`PrismaClientInitializationError` or connection timeouts).
  - Unhandled promise rejection causing container crash loops.
* **Rollback Procedure (< 60 Seconds):**
  1. The NestJS container pool remains running in standby (warm state) during the entire cutover window.
  2. Revert load balancer / reverse proxy upstream target from Express port to NestJS port:
     ```nginx
     # NGINX upstream instant switch
     upstream api_backend {
         server 127.0.0.1:4000; # NestJS Standby
         # server 127.0.0.1:4001; # Express
     }
     ```
  3. Reload reverse proxy (`nginx -s reload` or Cloudflare DNS failover).
  4. Verify NestJS health: `curl -I https://api.eventai.example.com/api/health` -> HTTP 200.
  5. Zero data rollback or database restore is required because both backends share the identical Prisma models and PostgreSQL state.

### 11.6 Scheduled Jobs & Background Processing Ownership
* **Isolation of Schedulers:**
  - NestJS uses `@Cron(CronExpression.EVERY_MINUTE)` inside `BookingsService.handleStaleBookingsCron()`.
  - Express uses the non-overlapping `SchedulerManager` (`apps/api/src/common/scheduler/scheduler.manager.ts`) with `unref()` timers.
* **Cutover Ownership Rule:**
  - During dual-running or canary phases, background schedulers must only run on **one** designated master backend (NestJS during canary; Express once cutover reaches 100%).
  - Both schedulers implement atomic transactional seat-hold release (`UPDATE bookings SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < NOW()`), ensuring that even in the event of accidental concurrent execution, double-expiration or race conditions cannot corrupt seat inventories.

### 11.7 Payment Webhook Routing & Idempotency
* **HMAC Verification Parity:** Express captures the exact raw buffer via `express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })`, ensuring byte-for-byte fidelity with NestJS's raw body buffer.
* **Idempotency Guarantee:**
  - Razorpay events (`payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`) are processed identically.
  - Repeated webhook deliveries return HTTP 200 `{ received: true, handled: false }` without duplicate ticket issuance or double refunds.
  - Upstream settlement for pending refunds (e.g. ₹1,499 DevCon Mumbai) remains strictly protected in `REFUND_PENDING` state.

### 11.8 Criteria for Safely Retiring NestJS
NestJS source code, configuration, and dependencies MUST NOT be deleted during this phase. NestJS retirement may only be scheduled when ALL of the following criteria are met:
1. Express has served 100% of live production traffic continuously for a minimum observation window of **7 consecutive days**.
2. Zero webhook verification failures or payment discrepancies recorded across live transactions.
3. Zero uncaught runtime exceptions or Express routing mismatches reported in production logs / Sentry.
4. Formal user approval is granted to proceed with code deprecation and dependency cleanup.


