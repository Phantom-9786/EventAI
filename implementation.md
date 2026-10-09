# Implementation Roadmap

## Phase 1 — Foundation
**Status: COMPLETE**

### Repository & Monorepo
- [x] Initialize Turborepo monorepo
- [x] Configure `turbo.json` pipelines
- [x] Create root `package.json`
- [x] Configure root TypeScript

### Shared Packages
- [x] `packages/config` — shared ESLint + TS configs
- [x] `packages/types` — shared TypeScript types
- [x] `packages/validation` — shared Zod schemas
- [x] `packages/database` — Prisma ORM + schema

### Backend (apps/api)
- [x] Initialize NestJS application
- [x] Configure modular architecture
- [x] REST API foundation (validation, error handling, config)
- [x] Health endpoint
- [x] Environment configuration

### Frontend (apps/web)
- [x] Initialize Next.js application
- [x] Configure Tailwind CSS
- [x] Configure shadcn/ui (button + cn utility, CSS-variable theme)
- [x] Basic layout (header, footer, navigation)
- [x] Responsive navigation
- [x] Error/loading states

### Worker (apps/worker)
- [x] Initialize worker application skeleton

### Database
- [x] PostgreSQL connection via Prisma (global PrismaService)
- [x] Initial schema (User, Session, Role tables — full schema beyond Phase 1 scope)
- [x] Run initial migration (`20261008195519_init` incl. FTS trigger + GIN index; postgres on host port 5433)

### Infrastructure
- [x] Docker Compose (postgres, redis services)
- [x] Dockerfiles for web, api, worker
- [x] `.env.example`

### Quality
- [x] ESLint configuration
- [x] Prettier/formatting
- [x] TypeScript strict mode
- [x] Basic test setup (Jest + health controller unit tests)

---

## Phase 2 — Core Platform
**Status: COMPLETE — Authentication (incl. Google OAuth 2.0, live-verified up to Google's consent screen; the final consent→session round-trip awaits one real user sign-in), Authorization, User Profiles, Event System, Ticket Types, Venue completion (incl. Leaflet maps), and the full public frontend (event listing/detail, categories, venues, auth pages, AI assistant page, organizer dashboard) complete**

### Authentication
- [x] Registration (email/password)
- [x] Login
- [x] Logout
- [x] Password hashing (Argon2id)
- [x] JWT tokens / session management (rotating refresh sessions, hashed at rest)
- [x] Secure cookies (httpOnly, sameSite=lax, path-scoped refresh cookie)
- [x] Password reset architecture (hashed single-use tokens, 1h expiry) + complete self-service flow: `sendPasswordResetEmail` via Resend (skipped-with-log without a key), `/forgot-password` + `/reset-password` pages, "Forgot password?" link on `/signin` — verified live end-to-end against the seeded DB
- [x] Email verification flow: `EmailVerificationToken` model (hashed single-use token, 24h expiry, one per user) + migration `20261009150000_email_verification`; `POST /api/auth/verify-email` (public, single-use transaction) + `POST /api/auth/resend-verification` (authenticated); register issues a token, Google-linked accounts skip verification; `/verify-email` page + `EmailVerificationBanner` (resend + dismiss); verified live (register → resend → verify → `isEmailVerified:true`, reuse rejected)
- [x] Change password
- [x] Rate limiting on auth endpoints (ThrottlerGuard, 10 req/min on auth)
- [x] Google OAuth 2.0 sign-in (authorization-code flow, server-side `verifyIdToken`, HMAC-signed CSRF state, verified-email-only account linking, passwordless accounts; frontend buttons + `/auth/callback`; feature-gated 503 without credentials, see `docs/google-oauth.md`). Live-verified 2026-10-09 with real Cloud Console credentials: auth redirect carries the registered `redirect_uri` + signed state; all callback failure paths exercised (`google_state_mismatch`/`google_cancelled`/`google_failed` incl. a real token-exchange rejection with a fake code); frontend button + error mapping confirmed; empty-`GOOGLE_CALLBACK_URL` default bug fixed (86481ed). Final consent→create/link→session round-trip still requires a real user sign-in.

### Authorization
- [x] RBAC (CUSTOMER, ORGANIZER, ADMIN)
- [x] Guards/middleware for role-based access (JwtAuthGuard + RolesGuard global, `@Public()` / `@Roles()`)
- [x] Backend-enforced authorization (global guards; role checks applied per-route as features land)

### User Profiles
- [x] User profile retrieval (`GET /api/users/me`, plus `GET /api/auth/me`)
- [x] User profile CRUD (`PATCH /api/users/me` — firstName/lastName/username/bio/location, unique-username conflict handling; `GET /api/users/:id` public profile)
- [x] Profile image upload (`POST /api/users/me/avatar` — Multer, 5 MB limit, JPEG/PNG/WebP/GIF, stored in `UPLOAD_DIR`, served at `/uploads/*`, previous local avatar replaced)
- [x] Preferences (`PATCH /api/users/me/preferences` — JSON key merge into `users.preferences`)
- [x] Account settings (`DELETE /api/users/me` — deactivates account and revokes all sessions; login blocked for deactivated users)

### Event System
- [x] Event model (title, slug, description, category, images, dates, venue, policies, FAQs, status)
- [x] Organizer onboarding (`POST /api/organizers` creates profile + upgrades role to ORGANIZER; `GET /api/organizers/me`, `GET /api/organizers/me/events`)
- [x] Organizer venue creation (`POST/GET /api/organizers/venues` — prerequisite for event creation; full Venue Management stays its own roadmap item)
- [x] Event CRUD (organizer: create draft with unique slug, update with ownership checks, delete drafts only; by id or slug)
- [x] Event publishing/unpublishing (`POST /api/events/:idOrSlug/publish` DRAFT→PUBLISHED with future-date guard; `POST /api/events/:idOrSlug/cancel` DRAFT/PUBLISHED→CANCELLED)
- [x] Category management (8 categories seeded via `prisma/seed.ts`; public `GET /api/categories` with published-event counts; admin-only create/update/soft-deactivate)

### Event Discovery (backend)
- [x] PostgreSQL Full-Text Search (parameterised raw SQL over `search_vector` with `websearch_to_tsquery` + `ts_rank` relevance ordering)
- [x] Category filtering
- [x] Location filtering (venue city ILIKE)
- [x] Date filtering (dateFrom on start_date, dateTo on end_date)
- [x] Price filtering (min ticket price subquery)
- [x] Sorting (relevance when searching; date/price/popularity/createdAt otherwise, with sortDir)
- [x] Pagination (page/limit + total/pages)
- [x] Event detail page (frontend) — see "Frontend Event Pages"

### Venues
- [x] Venue model
- [x] Venue CRUD (organizer-owned create/list + update/delete guarded against venues with events)
- [x] Public venue browse (`GET /api/venues` city/name filter + pagination; `GET /api/venues/:id` with seat sections + organizer)
- [x] Map coordinates (schema-ready: latitude/longitude)
- [x] Leaflet + OpenStreetMap integration (`apps/web/src/components/venues/venue-map.tsx` on the venue detail page; graceful fallback without coordinates)
- [x] Seating configuration (organizer seat sections with bulk seat generation, Excel-style row letters)

### Ticket Types
- [x] Ticket type model (name, price, quantity, sale dates, limits)
- [x] Ticket type CRUD (organizer-only on owned events; quantity edits preserve sold stock; delete blocked once booked)
- [x] Availability tracking (availableQuantity derived on create/update; sold-out and low-stock surfaced in public event detail)

### Frontend Event Pages
- [x] API client (`apps/web/src/lib/api.ts` — typed fetchers, `NEXT_PUBLIC_API_URL` override, paise→₹ formatting, date formatting)
- [x] Events listing page (`/events` — search, city filter, category chips from live API, sorting, pagination; server-rendered)
- [x] Event detail page (`/events/[slug]` — venue/date info, ticket types with availability and sale windows, FAQs, policies, organizer card, generateMetadata)
- [x] Categories page (`/categories` — live categories with published-event counts, linking to filtered `/events`)
- [x] Venues pages (`/venues` browse with search/city filter + pagination; `/venues/[id]` detail with amenities, seating sections, organizer card)
- [x] Auth pages (`/signin`, `/signup` — validated forms, error envelopes surfaced, redirect on success; `AuthProvider` context with bearer token + silent refresh via httpOnly cookie; header shows user state and Sign Out)
- [x] AI assistant page (Phase 5 — `/ai` chat UI)
- [x] Organizer dashboard UI (Phase 4 — `/dashboard` stats + event list, `/dashboard/scan` QR door scanner)

---

## Phase 3 — Booking Engine
**Status: COMPLETE (seat-level selection intentionally deferred — ticket-type booking shipped; schema-ready for seat picking)**

### Payment
- [x] Razorpay sandbox integration (lazy Razorpay client; keys optional in dev, required in production via env validation; rawBody enabled for webhooks)
- [x] Order creation (`POST /api/payments/order` — amount server-priced from the booking, receipt = bookingId, booking → PAYMENT_PENDING, open-order reuse on retry, failed-payment row recycled with a fresh order)
- [x] Backend payment verification (`POST /api/payments/verify` — HMAC-SHA256 `order|payment` signature check with constant-time compare; confirm transaction marks payment CAPTURED, booking CONFIRMED, mints tickets; idempotent once captured)
- [x] Webhook handling (`POST /api/payments/webhook` — @Public, `x-razorpay-signature` over the raw body, `payment.captured` confirms (out-of-order delivery safe, duplicate-safe), `payment.failed` marks the payment FAILED)
- [x] Signature verification (checkout HMAC + webhook HMAC, both constant-time; foreign orders/users 404)
- [x] Idempotency (1 payment row per booking, `idempotencyKey = order:{bookingId}` unique; verify returns the captured booking on repeat)
- [x] Failure handling (failed webhook → FAILED + reason; checkout dismissal → seats stay held until expiry; expired/closed bookings refuse orders/verification)

### Digital Tickets
- [x] Ticket generation after booking (one per unit inside the confirm transaction, idempotent — skipped if already minted; holder from user name)
- [x] Unique ticket identifiers (`TKT-` + 16 hex chars, unique index)
- [x] QR code generation (`qrData` JSON { code, bookingId, eventId }; `GET /api/payments/tickets/:id/qr` returns a PNG data URL, own-ticket only, cancelled tickets refused)
- [x] Ticket retrieval (tickets included in `GET /api/bookings/:id` and the verify response; frontend shows codes + QR images after payment)
- [x] My Tickets page (`/tickets` — all own bookings with status chips, per-ticket QR codes for VALID tickets, event/venue details, sign-in gate)

### Seat Management
- [ ] Seat states (AVAILABLE, HELD, BOOKED, BLOCKED) — schema-ready; deferred: ticket-type-level booking is the shipped flow
- [ ] Seat selection UI
- [x] Temporary holds (expiresAt on bookings + minute expiry cron; Redis/BullMQ not required for this flow)
- [x] Concurrency protection (PostgreSQL transactions + conditional decrement — no overselling; covered by tests)

### Booking System
- [x] Booking states (PENDING, PAYMENT_PENDING, CONFIRMED, CANCELLED, EXPIRED, REFUNDED)
- [x] Booking creation flow (`POST /api/bookings` — server-priced, sale-window + maxPerBooking checks, stock reserved via conditional availability decrement inside a transaction)
- [x] Concurrency protection (conditional `updateMany` decrement — concurrent requests can never oversell; transaction rollback on any failure)
- [x] Idempotency (`idempotencyKey` unique per booking; repeated key returns the original booking, foreign key rejected)
- [x] Booking expiry (`SEAT_HOLD_TTL_SECONDS` default 10 min; lazy release on read/list plus a minute cron sweeping all stale PENDING/PAYMENT_PENDING bookings inside re-checked transactions)
- [x] Booking history (`GET /api/bookings` paginated newest-first; `GET /api/bookings/:id` own detail with items + event summary)
- [x] Cancellation (`POST /api/bookings/:id/cancel` — unpaid bookings release stock; CONFIRMED bookings delegate to the refund flow)

### Ticket Validation
- [x] Validation endpoint (`POST /api/organizers/events/:eventId/tickets/validate` — organizer-only on owned events; looks up by ticket code)
- [x] Ticket lookup (code → ticket with event match check; unknown/foreign codes 404)
- [x] Valid/invalid/used states (VALID → USED; already-used 409 with timestamp; CANCELLED/EXPIRED refused)
- [x] Validation timestamp + validator tracking (`validatedAt`, `validatedBy` stamped)
- [x] Door summary (`GET /api/organizers/events/:eventId/tickets/stats` — per-status counts + checkedIn)

### Booking UI (Frontend)
- [x] Booking widget on the event detail page (`apps/web/src/components/booking/booking-widget.tsx` — per-type quantity steppers capped by maxPerBooking/stock, live total, sale-window filtering, sign-in gate)
- [x] End-to-end checkout (create booking → create order → Razorpay Checkout.js → verify → confirmation panel with ticket codes + QR images fetched from the QR endpoint)
- [x] Failure handling in UI (checkout dismissed → held-seats message and retry; missing Razorpay keys → honest "payments not configured" error; per-step busy states)

### Cancellation / Refund
- [x] Cancellation eligibility checks (closed bookings 409; state re-checked inside the transaction)
- [x] Booking cancellation flow (`POST /api/bookings/:id/cancel` with optional reason; unpaid → CANCELLED + stock released)
- [x] Refund state management (`POST /api/payments/refund` — Razorpay `payments.refund`, payment → REFUNDED with refundId/refundAmount, booking → REFUNDED, VALID tickets → CANCELLED, stock restored; CONFIRMED cancel delegates here; re-check prevents double refund)
- [x] User notification (confirmation email fired on payment capture; refund status visible in My Tickets)

---

## Phase 4 — Platform Engineering
**Status: COMPLETE (core) — expiry cron, email notifications (confirmation/cancellation/refund), organizer stats + dashboard + door scanner + attendee list, admin management (user status, event moderation, organizer verification — API + UI), and Redis caching shipped. Socket.IO real-time, BullMQ worker split, charts/analytics, and audit logs intentionally deferred (in-process scheduling + Resend REST cover the current scale; see context.md)**

### Redis Caching
- [x] Event caching (CacheService — ioredis-backed `apps/api/src/common/cache/cache.service.ts`; events list/search + categories cached with TTL)
- [x] Cache invalidation strategy (pattern-based invalidation on event/category writes)
- [x] Rate limiting (in-memory @nestjs/throttler guard on all routes; Redis-backed store deferred)

### Background Jobs
- [x] Seat/booking expiration jobs (`@nestjs/schedule` minute cron sweeping stale PENDING/PAYMENT_PENDING bookings, stock-releasing inside re-checked transactions)
- [x] Email notification delivery (Resend REST via NotificationsService, fire-and-forget after payment capture; graceful skip without RESEND_API_KEY)
- [ ] Worker app split (BullMQ + Redis) — deferred; single-process scheduling suffices for current volume

### Real-Time (Socket.IO)
- [ ] WebSocket server setup
- [ ] Seat availability updates
- [ ] Booking status updates
- [ ] Notification delivery
- [ ] Reconnection handling

### Notifications
- [x] Booking confirmation notifications (email with event details, amounts, ticket codes)
- [ ] Notification model (in-app inbox) — deferred
- [ ] Payment / cancellation notifications — email service ready, not yet hooked

### Organizer Dashboard
- [x] Stats endpoint (`GET /api/organizers/me/stats` — events by status, confirmed revenue (paise), confirmed/refunded bookings, tickets issued, checked-in)
- [x] Dashboard UI (`/dashboard` — stat cards, events table with statuses, inline organizer onboarding form for non-organizers, header link for ORGANIZER role)
- [x] Ticket validation API (door check-in via ticket code; see Phase 3)
- [x] Ticket validation scanner UI (camera/QR input — `/dashboard/scan` paste-or-camera code entry against the validate endpoint)
- [x] Booking/attendee management UI (attendee list per event on the organizer dashboard via `GET /api/organizers/events/:eventId/bookings`)
- [ ] Charts/deeper analytics

### Admin Dashboard
- [ ] User management (list/search + activate/deactivate with session revocation — `GET/PATCH /api/admin/users*`, Users tab on `/admin`; edit-role UI pending)
- [ ] Organizer management (list/search + verified-badge toggle — `GET/PATCH /api/admin/organizers*`, Organizers tab; edit UI pending)
- [x] Event moderation (list all events + cancel published ones with logged reason — `GET /api/admin/events`, `POST /api/admin/events/:id/moderate`, Events tab)
- [x] Category management (backend complete since Phase 2; admin UI pending)
- [ ] Audit logs
- [x] Platform statistics (`GET /api/admin/stats` + `/admin` Overview tab — users/organizers/bookings/revenue/tickets by status)

### Analytics
- [x] Organizer analytics (bookings, revenue, occupancy via the stats endpoint + dashboard)
- [ ] Admin analytics (users, events, platform activity)

---

## Phase 5 — AI Layer
**Status: PARTIAL — catalog-grounded Grok assistant (with graceful degradation) and content-based recommendations shipped; Pinecone RAG and tool-calling deferred (see context.md for the credential blocker)**

### AI Provider
- [x] xAI (Grok) integration via the OpenAI-compatible `api.x.ai/v1/chat/completions` endpoint (model configurable via `GROK_MODEL`, default `grok-3-mini`; 30s timeout; errors mapped to 503 with clear messages)
- [x] Credential detection (`isConfigured()` — missing or placeholder `GROK_API_KEY` → 503 "not configured"; frontend surfaces an actionable notice)
- [ ] Provider abstraction interface (single provider today; extract when a second provider is needed)

### AI Event Assistant
- [x] Chat endpoint (`POST /api/ai/chat` — public, zod-validated message history ≤12 turns)
- [x] Catalog grounding (system prompt injects the next 12 upcoming published events with city, date, category, from-price and link path — the model is instructed to recommend only real events)
- [x] Chat UI (`/ai` — message list, busy state, error surfacing, header "AI Assistant" link)
- [ ] Tool calling (searchEvents/booking-intent tools) — deferred; catalog grounding covers discovery
- [ ] Conversation persistence — deferred (client-held history)

### Recommendations
- [x] Similar-events endpoint (`GET /api/events/:idOrSlug/similar` — same-category first, then same-city, upcoming published only)
- [x] "You might also like" section on the event detail page
- [ ] Booking-history-based personalization
- [ ] Pinecone + RAG (FAQ/policy indexing) — deferred; needs PINECONE_API_KEY and a real embedding use case

### AI Security
- [x] Input validation (zod schema, content length caps, message-count cap)
- [x] Rate limiting (global throttler applies to the AI endpoint)
- [x] Grounding prompt injection defense (model told to only recommend catalog events; no user data is exposed to the model)
- [ ] Authenticated-user context/tools (deferred with tool calling)

---

## Phase 6 — Production Polish
**Status: PARTIAL — 163 unit tests, structured logging, Playwright smoke suite (7/7), CI workflow verified green on GitHub (Phantom-9786/EventAI), and the full docs/ set shipped; error tracking, integration tests, and live third-party verification pending**

### Testing
- [x] Unit tests (163 passing across 13 suites: auth incl. Google + password-reset + email-verification cases, google-oauth service, structured logger, users, events incl. FTS, ticket types, venues, organizers incl. check-in, bookings incl. concurrency/rollback/cancellation-email, payments incl. signature/webhook/refund/refund-email, AI service, admin stats + user/event/organizer management, health)
- [ ] Integration tests (needs a live Postgres in CI — natural next step)
- [x] Concurrency logic covered at unit level (conditional-decrement rollback prevents double booking; real parallel-run test pending)
- [x] E2E tests (Playwright smoke suite `e2e/smoke.spec.ts` — 7/7: landing, discovery, search, event detail + tickets, categories/venues, seeded sign-in, auth gate; booking/pay e2e still pending real Razorpay keys)

### Security Review
- [x] Password hashing (argon2id via auth module, verified in unit tests)
- [x] RBAC verification (global guards + @Roles; organizer ownership checks tested)
- [x] Input validation audit (zod schemas on every write endpoint)
- [x] Rate limiting verification (global throttler + stricter auth limits)
- [ ] CORS configuration review (enabled for FRONTEND_URL; production origins audit pending)
- [x] Helmet/security headers (helmet() configured in main.ts since Phase 1)
- [ ] CSRF protection (SPA + bearer-token model mitigates; refresh cookie is path-scoped sameSite=lax — formal review pending)
- [x] Request size limits (json/urlencoded limits in main.ts; avatar 5 MB cap)
- [x] Secure error responses (global exception filter, no stack traces leaked)
- [ ] Audit log verification

### Performance
- [ ] Database index review
- [ ] Query optimization
- [ ] Caching effectiveness
- [ ] Connection pooling

### Docker
- [ ] Full Docker Compose verification
- [ ] All services start correctly
- [ ] Health checks pass

### CI/CD
- [x] GitHub Actions — install, lint, type-check, test, build (`.github/workflows/ci.yml`, Node 20 + npm cache)
- [ ] Workflow verification (runs on first push to GitHub)

### Observability
- [x] Structured logging (`StructuredLogger`: single-line JSON entries with context/level/requestId when `LOG_FORMAT=json` or NODE_ENV=production; human-readable otherwise; request logs carry method/url/statusCode/durationMs/requestId; error envelope now includes `requestId`; 10 unit tests)
- [x] Request IDs (request-id middleware in main.ts, echoed as `X-Request-Id` and correlated into request/error logs)
- [x] Health endpoints (DB connectivity check at `/api/health`; Redis/Worker depth pending)
- [ ] Error tracking setup (Sentry DSN placeholder in `.env.example`; blocked on a real DSN)

### Documentation
- [x] README.md (complete)
- [x] docs/architecture.md
- [x] docs/database.md
- [x] docs/api.md
- [x] docs/booking-engine.md
- [x] docs/ai.md
- [x] docs/security.md
- [x] docs/deployment.md
- [x] docs/architecture-decisions.md (ADRs 001–014, incl. Google OAuth)
- [x] docs/google-oauth.md (flow, account-linking policy, Google Cloud setup, verification checklist)
- [ ] Architecture diagram

### Seed Data
- [x] Users (customer, organizer, admin)
- [x] Categories
- [x] Events
- [x] Venues
- [x] Seats
- [x] Ticket types
- [x] FAQs

### Final Verification
- [ ] Full application startup test
- [ ] Auth flow verification
- [ ] Event CRUD verification
- [ ] Booking flow end-to-end
- [ ] Payment flow verification
- [ ] AI assistant verification
- [ ] Real-time updates verification
- [ ] Docker Compose full stack test
