# Project Context

## Project Overview

**EventAI** — Discover. Book. Experience.

AI-powered Event Discovery and Ticket Booking Platform built as a modular monolith with Turborepo.

## Current Architecture

Modular monolith using Turborepo monorepo with three apps:
- `apps/web` — Next.js 14 frontend (App Router, Tailwind, shadcn-style components)
- `apps/api` — NestJS backend API (port 4000, global prefix `/api`)
- `apps/worker` — BullMQ background worker (skeleton with Redis connection + graceful shutdown)

Shared packages:
- `packages/database` — Prisma ORM + full schema
- `packages/types` — Shared TypeScript types
- `packages/validation` — Zod validation schemas
- `packages/config` — Shared ESLint (base/nestjs/nextjs) + TypeScript (base/nestjs/nextjs) configs

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui-style components |
| Backend | NestJS, TypeScript, REST APIs |
| Database | PostgreSQL 16, Prisma ORM 6 |
| Cache | Redis 7 |
| Background Jobs | BullMQ + Redis |
| Real-Time | Socket.IO |
| Payments | Razorpay (Sandbox) |
| Maps | Leaflet + OpenStreetMap |
| Search | PostgreSQL Full-Text Search |
| AI/LLM | Grok/xAI (via provider abstraction) |
| Vector DB | Pinecone |
| Email | Resend |
| Containers | Docker + Docker Compose |
| Monorepo | Turborepo + npm workspaces |
| CI/CD | GitHub Actions |

## Repository Structure

```
eventai/
├── apps/
│   ├── web/          — Next.js frontend
│   ├── api/          — NestJS backend
│   └── worker/       — BullMQ worker
├── packages/
│   ├── config/       — Shared ESLint/TS config
│   ├── database/     — Prisma schema + client
│   ├── types/        — Shared TypeScript types
│   └── validation/   — Zod schemas
├── docker/           — api/web/worker Dockerfiles
├── docs/             — Architecture documentation
├── context.md
├── implementation.md
├── docker-compose.yml
├── turbo.json
└── README.md
```

## Implemented Features

Phase 1 (Foundation) — COMPLETE:
- Turborepo monorepo (build/lint/type-check/test pipelines) with npm workspaces
- Shared packages: config (ESLint + TS presets), types, validation, database
- Full Prisma schema: User, Session, PasswordReset, Organizer, Category, Event (+FTS vector), EventFAQ, Venue, SeatSection, Seat, TicketType, Booking, BookingItem, Payment, Ticket, Notification, AIConversation, AuditLog
- NestJS API: global ConfigModule with env validation (fail-fast), global PrismaService, global exception filter (consistent error envelope), validation pipe (whitelist/transform), Helmet, CORS, cookie-parser, Swagger at `/api/docs`, health endpoint at `/api/health` with DB connectivity check
- Next.js web: root layout with sticky responsive header (desktop + mobile menu) and footer, landing page (hero, features, categories), error/loading/not-found states, shadcn-style Button + cn utility, dark-mode-ready CSS variable theme
- Worker: BullMQ skeleton with queue name registry, processor registration, Redis connection, graceful shutdown
- Docker Compose (postgres 16, redis 7 with healthchecks); multi-stage Dockerfiles for api/web/worker
- Quality: ESLint wired through `@eventai/config`, Prettier (`.prettierrc` + `.prettierignore`), strict TypeScript, Jest unit tests

Phase 2 — Authentication & RBAC (COMPLETE):
- Register (email/password, Zod-validated, Argon2id hashing, role CUSTOMER), login, logout (revokes session, clears cookie)
- JWT access tokens (Authorization bearer) + opaque rotating refresh tokens stored only as SHA-256 hashes in the `sessions` table; refresh token delivered in an httpOnly, sameSite=lax, path-scoped cookie (`eventai_refresh_token`)
- `POST /api/auth/refresh` rotates the refresh token and issues a new access token; password change and reset revoke all sessions
- Password reset flow (`forgot-password` / `reset-password`) backed by the `password_resets` table with hashed, single-use, 1h-expiring tokens; email delivery deferred to the Phase 4 email worker (token logged in dev)
- `GET /api/auth/me`, `POST /api/auth/change-password`
- Global guards: ThrottlerGuard (rate limiting via `RATE_LIMIT_TTL`/`RATE_LIMIT_MAX`), JwtAuthGuard (all routes require JWT unless `@Public()`), RolesGuard (enforces `@Roles()`); auth endpoints are stricter-limited to 10 req/min per IP
- `JwtStrategy` (passport-jwt) validates the user exists and is active on every request

Phase 2 — User Profiles (COMPLETE, `apps/api/src/modules/users/`):
- `GET /api/users/me` full own profile (email, preferences, verification state); `PATCH /api/users/me` updates firstName/lastName/username/bio/location with P2002 → 409 on taken usernames
- `PATCH /api/users/me/preferences` merges keys into the `users.preferences` JSON (string/boolean/number values)
- `POST /api/users/me/avatar`: Multer multipart upload, 5 MB limit, JPEG/PNG/WebP/GIF only (415 otherwise); stored under `UPLOAD_DIR` as `<userId>-<random><ext>`, served statically at `/uploads/*` via `useStaticAssets` in `main.ts`; previous locally-stored avatar deleted on replacement
- `GET /api/users/:id` (@Public, UUID-parsed): public profile only — never email/preferences; inactive users 404
- `DELETE /api/users/me`: deactivates the account (`isActive=false`) and revokes all sessions in one transaction; idempotent; deactivated users fail JWT validation and login
- Validation schemas in `packages/validation/src/user.ts` (`updateProfileSchema`, `updatePreferencesSchema`, `usernameSchema`: 3–30 chars, `[a-zA-Z0-9_]`)

Phase 2 — Event System (COMPLETE, `apps/api/src/modules/{events,organizers,categories}/`):
- Organizer onboarding: `POST /api/organizers` creates the Organizer profile and upgrades the user role to ORGANIZER in one transaction; `GET /api/organizers/me` (profile + event/venue counts), `GET /api/organizers/me/events` (all statuses, paginated)
- Organizer venues: `POST /api/organizers/venues` + `GET /api/organizers/venues` (venue creation is a prerequisite for events; full Venue Management remains a separate roadmap item)
- Event CRUD (all organizer-only via `@Roles('ORGANIZER')` + ownership checks; id-or-slug addressing): `POST /api/events` (DRAFT, unique slug `slugified-title-hex`, future start date required, category must be active and venue must belong to the organizer), `PATCH /api/events/:idOrSlug` (blocked on CANCELLED/COMPLETED; end>start enforced against effective dates), `DELETE /api/events/:idOrSlug` (DRAFT only — 409 otherwise)
- Publishing workflow: `POST .../publish` (DRAFT→PUBLISHED, rejects past start dates), `POST .../cancel` (DRAFT/PUBLISHED→CANCELLED)
- Categories: 8 seeded via `packages/database/prisma/seed.ts` (`npm run db:seed`); `GET /api/categories` public with published-event counts; create/update/deactivate are ADMIN-only (deactivate = soft delete)
- Public search `GET /api/events` (@Public): parameterised raw SQL over `events e JOIN venues v` — FTS via `search_vector @@ websearch_to_tsquery('english', $query)` with `ts_rank` relevance ordering when `query` is present; filters: categoryId, city (ILIKE), dateFrom/dateTo, priceMin/priceMax (min ticket price subquery), isFeatured; sorting: relevance (search) or date/price/popularity (booking count)/createdAt with sortDir; page/limit pagination with total/pages; ids selected via `Prisma.sql` fragments (injection-safe), hydrated through Prisma with category/venue/organizer and computed minPrice/maxPrice
- Drafts and non-PUBLISHED events are invisible to the public routes (search + `GET /api/events/:idOrSlug` 404); organizers view their own via `GET /api/events/:idOrSlug/manage` or the own-events list
- `Roles()` decorator now accepts string literals; `eventSearchSchema.isFeatured` uses an explicit preprocess (plain `z.coerce.boolean()` treats the string "false" as true)

Phase 2 — Ticket Types (COMPLETE, `apps/api/src/modules/tickets/`):
- Organizer-only CRUD on owned events: `POST /api/events/:idOrSlug/tickets`, `GET /api/events/:idOrSlug/tickets` (incl. inactive, manage view), `PATCH /api/ticket-types/:id`, `DELETE /api/ticket-types/:id` (delete refused once any tickets are booked — deactivate instead)
- Guarded creation: no tickets on CANCELLED/COMPLETED events; sale window validated (end > start, end ≤ event start); `sectionId` must belong to the event's venue
- Availability tracking: `availableQuantity` initialised to `totalQuantity` on create and derived on quantity edits (`newAvailable = newTotal − sold`), so booked stock is never oversold; reduction below sold count is a 409
- Prices are integers in paise with per-type `currency`; `maxPerBooking` (1–10, default 5); `isActive` soft-hides types from the public event detail (manage view still sees them)
- Public event detail returns only active ticket types with availability, sale windows, section names — the search/listing endpoints expose `minPrice`/`maxPrice` over those

Phase 2 — Venue Completion (COMPLETE, `apps/api/src/modules/{organizers,venues}/`):
- Organizer venue management: `PATCH /api/organizers/venues/:venueId`, `DELETE /api/organizers/venues/:venueId` (409 when events reference the venue; sections cascade), seat sections `POST/GET /api/organizers/venues/:venueId/sections`
- Seat generation: sections create `rows × seatsPerRow` seats in one call via chunked `createMany` (1000/batch) with Excel-style row labels (A…Z, AA…) and stable `label` = `RowNumber`
- Public venue discovery (`@Public`): `GET /api/venues` (name/city ILIKE filters + pagination, published-event counts) and `GET /api/venues/:id` (venue + organizer + seat sections); validation in `venueSearchSchema`
- Map coordinates remain schema-only (Leaflet integration is still pending — see Current Limitations)

Phase 2 — Frontend Event Pages (COMPLETE, `apps/web/src/app/events/`):
- API client `apps/web/src/lib/api.ts`: typed fetchers for events search/detail/categories, `cache: 'no-store'`, base URL from `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api`), paise→₹ and en-IN date formatters
- `/events` listing (server component): full-text search box, city filter, sort dropdown (date/price/popularity × direction), category chips from the live categories API, result count, empty state, prev/next pagination preserving filters; API failures degrade to an empty result set
- `/events/[slug]` detail (server component): hero image/category/tags, date & venue cards, description, ticket table with per-type availability (sold-out / low-stock "Only N left"), max-per-booking, sale-window notes, paise prices; FAQs (native `<details>`), policies, sticky booking sidebar with "from" price (booking button disabled until Phase 3), organizer card with verified badge; `generateMetadata` per event and `notFound()` on missing/unpublished events
- `EventCard` shared component in `apps/web/src/components/events/event-card.tsx`

Phase 2 — Frontend Auth & Browse Pages (COMPLETE, `apps/web/src/app/{signin,signup,categories,venues}/`):
- `/signin` and `/signup`: client forms with client-side validation mirroring `@eventai/validation` rules (email, 8+ char password with upper/lower/digit), API error envelopes surfaced inline (`ApiError` from `lib/auth.ts`), redirect to `/events` on success with `router.refresh()`
- `AuthProvider` (`components/auth/auth-provider.tsx`): React context holding the user; `fetchCurrentUser` on mount (localStorage bearer token → silent `/auth/refresh` via httpOnly cookie when absent/expired); `signIn`/`signUp`/`signOut`; `authFetch` retries once on 401 after refresh
- Header now consumes auth state: skeleton while loading, "Hi, {name}" + Sign Out when authenticated, Sign In / Get Started otherwise (desktop + mobile menus)
- `/categories`: server-rendered grid of live categories with colored icon tiles and published-event counts, each linking to `/events?category=slug`
- `/venues` + `/venues/[id]`: server-rendered venue browse (name/city search, pagination, published-event counts, capacity) and venue detail (address, description, amenities, seating-section table with rows × seats and totals, organizer with verified badge, "Events in {city}" cross-link); graceful empty states when the API is unreachable

## Current Database Schema

Complete Phase 1+ schema in `packages/database/prisma/schema.prisma` (see "Implemented Features"). Migration `20261008195519_init` applied (all 18 tables + enums + FKs). `search_vector` on Event is `Unsupported("tsvector")`: the column is created by Prisma in the migration; a trigger (`events_search_vector_trigger`, weights title=A, tags=B, short_description=C, description=D) and a GIN index (`events_search_vector_idx`, declared in the schema via `@@index([searchVector], type: Gin)`) are appended in the same migration. Verified end-to-end with a rolled-back insert + `websearch_to_tsquery` match. Prisma client generated (v6.19.3).

## Authentication

Implemented (Phase 2). See "Implemented Features — Phase 2". Session model in use: `sessions.token` = SHA-256 of the access JWT, `sessions.refresh_token` = SHA-256 of the opaque refresh token, `expires_at` = refresh expiry. JWT payload: `{ sub, email, role }`.

## Booking Architecture

Phase 3 implemented (`apps/api/src/modules/bookings/`), complete except seat-level assignment (deferred):
- `POST /api/bookings` (auth): body `{ eventId, items[{ticketTypeId, quantity}], idempotencyKey }` (schemas in `packages/validation/src/booking.ts`). Validates the event is PUBLISHED and not started, ticket types belong to the event and are active with an open sale window, and merged per-type quantities respect `maxPerBooking`. Total is computed server-side from current DB prices (never trusted from the client).
- Concurrency safety: stock is reserved via conditional `ticketType.updateMany` decrement (`availableQuantity: { gte: qty }` as a WHERE condition) inside the booking transaction — concurrent bookings cannot oversell; a lost decrement aborts the whole transaction with 409.
- Idempotency: `bookings.idempotency_key` is unique; a repeated key returns the original booking (403 if the key belongs to another user). Concurrent same-key requests are resolved by the P2002 unique-violation fallback path.
- Expiry: PENDING bookings carry `expiresAt = now + SEAT_HOLD_TTL_SECONDS` (default 600s). Stock is released lazily — on `GET /api/bookings` (sweep of the user's stale bookings) and on `GET /api/bookings/:id` — via a transaction that re-checks status before expiring (a concurrent payment can win).
- Cancellation: `POST /api/bookings/:id/cancel` releases reserved stock for unpaid bookings; CONFIRMED bookings delegate to the Razorpay refund flow (payment → REFUNDED, booking → REFUNDED, VALID tickets → CANCELLED, stock restored).
- `GET /api/bookings` returns paginated own bookings newest-first with items + event/venue summary; detail includes payment status when present.
- Expiry + seat-level assignment: a minute-level cron now also sweeps stale PENDING/PAYMENT_PENDING bookings (see Background Jobs); seat-level ticket assignment is the only deferred item (schema-ready).

## Payment Architecture

Implemented — see "Payments & Digital Tickets Architecture" below (order → verify/webhook → refunds).

## Real-Time Architecture

Not yet implemented (deferred). Socket.IO dependencies installed in API.

## Redis Usage

Worker skeleton connects via `REDIS_URL` (ioredis, BullMQ-compatible). No application usage yet — booking expiry runs on an in-process cron instead (see Background Jobs); Redis caching deferred.

## Background Jobs

In-process scheduling via `@nestjs/schedule` (BullMQ worker split deferred and documented):
- `BookingsService` minute-level `@Cron(EVERY_MINUTE)` sweeps up to 200 stale PENDING **and** PAYMENT_PENDING bookings past `expiresAt`; each expiry is a transaction that re-checks status first, so a concurrent payment wins; stock is incremented back.
- `NotificationsService` sends confirmation emails via the Resend REST API, fire-and-forget after the confirm transaction (both verify and webhook paths); skipped with a dev log when `RESEND_API_KEY` is missing/placeholder.

## AI Architecture

Implemented (Phase 5, catalog-grounded):
- `POST /api/ai/chat` (@Public): xAI Grok via the OpenAI-compatible `https://api.x.ai/v1/chat/completions` endpoint (model from `GROK_MODEL`, default `grok-3-mini`, 30s timeout).
- Grounding: the system prompt injects the next 12 upcoming PUBLISHED events (title, city, category, from-price, slug) and instructs the model to recommend only catalog events.
- `isConfigured()` treats missing keys and the shipped `xai-xxxx…` placeholder as unconfigured → 503 with an actionable operator message instead of confusing upstream errors. **Blocker: no real `GROK_API_KEY` in `.env` — AI chat returns 503 until one is provided.**
- Conversation persistence (AIConversation model) and authenticated tool-calling deferred.

## RAG Architecture

Deferred by design: similar-event recommendations use a Postgres-based scoring query (same-category first, then same-city, upcoming published only — `GET /api/events/:idOrSlug/similar`) instead of Pinecone embeddings; no `PINECONE_API_KEY` needed. Vector RAG remains a future option if the use case demands it.

## Security Architecture

Helmet, CORS (FRONTEND_URL origin, credentials), cookie-parser, global ValidationPipe (whitelist + forbidNonWhitelisted), consistent error envelope (no stack leaks), fail-fast env validation, Zod-based body validation (`ZodValidationPipe` + `@eventai/validation`), Argon2id password hashing, hashed-at-rest refresh/session/reset tokens, httpOnly refresh cookie, global rate limiting (ThrottlerGuard; 10 req/min on auth), JWT auth with `@Public()` opt-out, RBAC via `@Roles()` + RolesGuard. Avatar uploads: mimetype allow-list + 5 MB cap enforced in the service (415/413 responses); uploads served with 1-day cache; only `/uploads/*` static prefix is exposed.

## Current Environment Configuration

`.env.example` covers: NODE_ENV, PORT, FRONTEND_URL, DATABASE_URL, REDIS_URL, JWT_SECRET/JWT_EXPIRY/REFRESH_TOKEN_EXPIRY, Razorpay, Grok, Pinecone, Resend, uploads, rate limiting, seat hold TTL. Copy to `.env` before running. Env validation requires real `DATABASE_URL` and non-placeholder `JWT_SECRET` (>= 16 chars). On this machine, `.env` copies exist at the repo root, `packages/database/` (Prisma CLI) and `apps/api/` (NestJS ConfigModule reads from each app's cwd). DATABASE_URL uses host port 5433 (see Known Issues).

## Testing Status

- Jest configured in `apps/api` (unit) with `test/jest-e2e.json` for e2e
- 106 passing unit tests across 10 suites (health: 3; auth service: 6; users service: 14; events service: 19 — CRUD, ownership, publish/cancel/delete transitions, FTS raw-SQL shape + hydration order, draft-hiding; tickets service: 7 — creation guards, sale windows, section-venue checks, availability derivation on quantity edits, delete-with-bookings refusal; organizers service: 13 — venue update/delete guards, seat-section generation incl. Excel row labels and chunking, ticket validation (VALID→USED, already-used 409) and per-status ticket stats; venues service: 5 — public search filters/pagination, detail include shape, 404; bookings service: 14 — idempotency fast-path + foreign-key rejection, event/ticket guards, started-event refusal, maxPerBooking merge, sale windows, conditional decrement + server-side pricing, mid-transaction stock-failure rollback, cross-user booking hiding, cancel/closed/confirmed rules, confirmed-cancel refund delegation; payments service: 19 — order reuse on retry, new-order creation + PAYMENT_PENDING, paid/expired booking refusal, signature confirm + ticket minting, tampered-signature rejection, idempotent re-verify, cross-user hiding, webhook captured/failed/invalid-signature/duplicate/unknown-order, QR data URL + cross-user ticket hiding, refund (Razorpay refund call before state tx, double-refund prevention, ticket cancellation, stock restore); AI service: 3 — catalog-grounded prompt building, unconfigured-key 503, upstream error mapping)
- No tests yet in web/worker/packages

## Deployment Status

Docker Compose infra services + per-app Dockerfiles exist. GitHub Actions CI workflow added at `.github/workflows/ci.yml` (Node 20, npm cache, lint → type-check → test → build, placeholder env vars for CI) — will run on first push to GitHub.

## Known Issues

- A native Windows PostgreSQL service occupies host port 5432, so docker-compose maps the container to host port **5433** (`DATABASE_URL` uses 5433 accordingly).
- Shared packages (`types`, `validation`, `database`) now emit CommonJS to `dist/` with `main` pointing there (previously `main` pointed at raw TS sources, which broke `node dist/main.js`). Packages are built before apps via turbo `dependsOn: ["^build"]` — run `npm run build` (or `turbo run build`) before starting any app directly.
- `apps/api` previously had no `tsconfig.build.json`, so `nest build` silently produced no output; fixed, and `incremental` is disabled for production builds to avoid the deleted-outDir/no-emit pitfall.
- turbo `type-check` depends on `["^build", "build"]` (not just `^build`) because `apps/web` includes `.next/types/**` which only `next build` generates — without the own-package dependency, web type-check raced its build and failed intermittently.
- npm install-scripts approval list configured (argon2 native build, prisma, esbuild, etc.) — new native deps will need approval.

## Current Limitations

- AI chat requires a real `GROK_API_KEY` (currently a placeholder in `.env`) — the endpoint returns a clear 503 until configured; confirmation emails are skipped with a dev log until a real `RESEND_API_KEY` is set (both documented credential blockers)
- Venue map coordinates are schema-only: no Leaflet/OpenStreetMap rendering anywhere yet
- Seat sections generate physical seats, but no seat-level ticket assignment or seat-selection UX exists (intentionally deferred)
- Event image upload not implemented (images/coverImage are URL arrays, schema-ready); event cards fall back to a placeholder icon
- Frontend routes: `/`, `/events`, `/events/[slug]`, `/categories`, `/venues`, `/venues/[id]`, `/signin`, `/signup`, `/tickets`, `/dashboard`, `/ai`; missing: admin dashboard UI, organizer scanner UI
- Frontend has no tests yet (API client, auth provider, pages are untested; web `test` script is a placeholder)
- Landing page uses placeholder content; not yet backed by the API
- API boot requires reachable PostgreSQL (PrismaService fails fast); frontend pages degrade gracefully to empty states when the API is unreachable
- Password reset email delivery not wired (token logged in dev; same Resend dependency as confirmation emails)

## Payments & Digital Tickets Architecture

Implemented (`apps/api/src/modules/payments/` + booking confirm path), complete with refunds:
- `POST /api/payments/order` (auth): creates a Razorpay order for a booking (amount = booking.totalAmount from the DB, receipt = bookingId). Booking → PAYMENT_PENDING. One payment row per booking (`idempotencyKey = order:{bookingId}` unique); retry reuses the open order, a FAILED payment row is recycled with a fresh order id. Refuses paid/closed/expired bookings.
- `POST /api/payments/verify` (auth): HMAC-SHA256 over `razorpayOrderId|razorpayPaymentId` with `RAZORPAY_KEY_SECRET`, constant-time compared. Confirm transaction: payment → CAPTURED (+method/reason cleared), booking → CONFIRMED + confirmedAt, mints one digital ticket per unit (idempotent — skipped if tickets exist). Idempotent once captured.
- `POST /api/payments/webhook` (@Public): signature over the RAW body (`rawBody: true` in main.ts) with `RAZORPAY_WEBHOOK_SECRET`. `payment.captured` → same confirm path (safe for out-of-order delivery: captured beats failed; duplicates no-op). `payment.failed` → payment FAILED + failureReason (paid beats failed). Unknown orders ignored with 200.
- Digital tickets: `TKT-` + 16 hex chars (unique), `qrData` JSON { code, bookingId, eventId }, holderName from user; included in booking detail (`GET /api/bookings/:id`) and the verify response. `GET /api/payments/tickets/:id/qr` (auth) returns a PNG data URL rendered by the confirmation panel.
- Frontend: `BookingWidget` on `/events/[slug]` — quantity steppers (maxPerBooking/stock-capped), live total, sign-in gate, then createBooking → createPaymentOrder → Razorpay Checkout.js → verifyPayment → ticket codes + QRs. Checkout dismissal keeps seats held until expiry; missing keys yield an honest "payments not configured" error.
- Refunds: `POST /api/payments/refund` (auth, own booking) — Razorpay `payments.refund` called BEFORE the state transaction (money movement first) with bookingId/reason notes; inside the tx the payment status is re-checked as CAPTURED (double-refund prevention), then payment → REFUNDED (+refundId/refundAmount), booking → REFUNDED, VALID tickets → CANCELLED, stock incremented back. Booking cancel on a CONFIRMED booking delegates here.
- Ticket check-in (organizer): `POST /api/organizers/events/:eventId/tickets/validate` — looks up a ticket code on the organizer's own event, VALID→USED with `validatedAt`/`validatedBy`, already-used → 409; `GET .../tickets/stats` returns per-status counts.
- Confirmation emails: fire-and-forget via Resend after capture (both verify + webhook paths); skipped in dev without a real key.
- Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` optional in dev, enforced in production by env validation.
- Seat-level selection: deferred (schema-ready).

## Important Architecture Decisions

See `docs/architecture-decisions.md` (ADRs 001–013).

## Current Phase

Phase 1 — Foundation (COMPLETE). Phase 2 — Core Platform (COMPLETE except Leaflet maps, deferred). Phase 3 — Booking Engine (COMPLETE except seat-level selection, deferred and documented): booking core + Razorpay payments + refunds + digital tickets with QR + check-in + booking UI. Phase 4 — Platform Engineering (PARTIAL): expiry cron, Resend confirmation emails, organizer stats + dashboard UI shipped; Redis caching and BullMQ worker split deferred. Phase 5 — AI Layer (PARTIAL): catalog-grounded Grok chat + similar-event recommendations + `/ai` page shipped (blocked on a real `GROK_API_KEY`); Pinecone RAG and tool-calling deferred. Phase 6 — Production Polish (PARTIAL): 106 unit tests, CI workflow, docs updates shipped; e2e tests, observability tooling, and the remaining docs/ set pending.

## Current Task

Docs and CI checkpoint: `context.md`/`implementation.md` updated to reflect refunds, ticket check-in, My Tickets page, expiry cron, notifications, organizer stats/dashboard, AI assistant + recommendations, the `/ai` page, the 106-test suite, the credential blockers (placeholder `GROK_API_KEY` / `RESEND_API_KEY`), and the CI workflow.

## Next Task

Optional remaining polish (all documented in implementation.md): Playwright e2e tests, Helmet/CSRF/CORS production audit, observability tooling, admin dashboard UI, organizer scanner UI, and the docs/ set. Live payment/AI behavior requires real Razorpay sandbox keys, a real `GROK_API_KEY`, and a `RESEND_API_KEY` in `.env`.

## Last Completed Checkpoint

Phase 6 partial — docs update + CI workflow (commit "chore: update docs and add CI workflow"); prior checkpoints this phase: AI assistant + recommendations + `/ai` page (638a9a3), expiry cron + notifications + organizer stats/dashboard (1216b3d), refunds + ticket check-in + My Tickets page (7463023), Razorpay payments + digital tickets (b4e06a2); earlier: booking engine core (f7551e0), frontend auth & browse pages (2064811), ticket types + venues + event pages (b93a276), event system (052363e).
