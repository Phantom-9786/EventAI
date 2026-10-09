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

Phase 3 core implemented (`apps/api/src/modules/bookings/`), payment-backed booking states pending:
- `POST /api/bookings` (auth): body `{ eventId, items[{ticketTypeId, quantity}], idempotencyKey }` (schemas in `packages/validation/src/booking.ts`). Validates the event is PUBLISHED and not started, ticket types belong to the event and are active with an open sale window, and merged per-type quantities respect `maxPerBooking`. Total is computed server-side from current DB prices (never trusted from the client).
- Concurrency safety: stock is reserved via conditional `ticketType.updateMany` decrement (`availableQuantity: { gte: qty }` as a WHERE condition) inside the booking transaction — concurrent bookings cannot oversell; a lost decrement aborts the whole transaction with 409.
- Idempotency: `bookings.idempotency_key` is unique; a repeated key returns the original booking (403 if the key belongs to another user). Concurrent same-key requests are resolved by the P2002 unique-violation fallback path.
- Expiry: PENDING bookings carry `expiresAt = now + SEAT_HOLD_TTL_SECONDS` (default 600s). Stock is released lazily — on `GET /api/bookings` (sweep of the user's stale bookings) and on `GET /api/bookings/:id` — via a transaction that re-checks status before expiring (a concurrent payment can win).
- Cancellation: `POST /api/bookings/:id/cancel` releases reserved stock for unpaid bookings; CONFIRMED bookings are refused until the refund flow ships with payments.
- `GET /api/bookings` returns paginated own bookings newest-first with items + event/venue summary; detail includes payment status when present.
- Payments, seat-level assignment, digital tickets: still pending (schema-ready).

## Payment Architecture

Not yet implemented. Schema ready (Payment with Razorpay fields, webhook verification).

## Real-Time Architecture

Not yet implemented. Socket.IO dependencies installed in API.

## Redis Usage

Worker skeleton connects via `REDIS_URL` (ioredis, BullMQ-compatible). No application usage yet.

## Background Jobs

Queue name registry in `apps/worker/src/index.ts`: seat-hold-expiration, email, ticket-generation, payment-processing. No processors registered yet.

## AI Architecture

Not yet implemented (Phase 5).

## RAG Architecture

Not yet implemented (Phase 5).

## Security Architecture

Helmet, CORS (FRONTEND_URL origin, credentials), cookie-parser, global ValidationPipe (whitelist + forbidNonWhitelisted), consistent error envelope (no stack leaks), fail-fast env validation, Zod-based body validation (`ZodValidationPipe` + `@eventai/validation`), Argon2id password hashing, hashed-at-rest refresh/session/reset tokens, httpOnly refresh cookie, global rate limiting (ThrottlerGuard; 10 req/min on auth), JWT auth with `@Public()` opt-out, RBAC via `@Roles()` + RolesGuard. Avatar uploads: mimetype allow-list + 5 MB cap enforced in the service (415/413 responses); uploads served with 1-day cache; only `/uploads/*` static prefix is exposed.

## Current Environment Configuration

`.env.example` covers: NODE_ENV, PORT, FRONTEND_URL, DATABASE_URL, REDIS_URL, JWT_SECRET/JWT_EXPIRY/REFRESH_TOKEN_EXPIRY, Razorpay, Grok, Pinecone, Resend, uploads, rate limiting, seat hold TTL. Copy to `.env` before running. Env validation requires real `DATABASE_URL` and non-placeholder `JWT_SECRET` (>= 16 chars). On this machine, `.env` copies exist at the repo root, `packages/database/` (Prisma CLI) and `apps/api/` (NestJS ConfigModule reads from each app's cwd). DATABASE_URL uses host port 5433 (see Known Issues).

## Testing Status

- Jest configured in `apps/api` (unit) with `test/jest-e2e.json` for e2e
- 79 passing unit tests (health: 3; auth service: 6; users service: 14; events service: 19 — CRUD, ownership, publish/cancel/delete transitions, FTS raw-SQL shape + hydration order, draft-hiding; tickets service: 7 — creation guards, sale windows, section-venue checks, availability derivation on quantity edits, delete-with-bookings refusal; organizers service: 8 — venue update/delete guards, seat-section generation incl. Excel row labels and chunking; venues service: 5 — public search filters/pagination, detail include shape, 404; bookings service: 14 — idempotency fast-path + foreign-key rejection, event/ticket guards, started-event refusal, maxPerBooking merge, sale windows, conditional decrement + server-side pricing, mid-transaction stock-failure rollback, cross-user booking hiding, cancel/closed/confirmed rules)
- No tests yet in web/worker/packages

## Deployment Status

Docker Compose infra services + per-app Dockerfiles exist. No CI/CD workflow yet (Phase 6).

## Known Issues

- A native Windows PostgreSQL service occupies host port 5432, so docker-compose maps the container to host port **5433** (`DATABASE_URL` uses 5433 accordingly).
- Shared packages (`types`, `validation`, `database`) now emit CommonJS to `dist/` with `main` pointing there (previously `main` pointed at raw TS sources, which broke `node dist/main.js`). Packages are built before apps via turbo `dependsOn: ["^build"]` — run `npm run build` (or `turbo run build`) before starting any app directly.
- `apps/api` previously had no `tsconfig.build.json`, so `nest build` silently produced no output; fixed, and `incremental` is disabled for production builds to avoid the deleted-outDir/no-emit pitfall.
- turbo `type-check` depends on `["^build", "build"]` (not just `^build`) because `apps/web` includes `.next/types/**` which only `next build` generates — without the own-package dependency, web type-check raced its build and failed intermittently.
- npm install-scripts approval list configured (argon2 native build, prisma, esbuild, etc.) — new native deps will need approval.

## Current Limitations

- Bookings, payments, and AI features not yet implemented (schema-ready only)
- Venue map coordinates are schema-only: no Leaflet/OpenStreetMap rendering anywhere yet
- Seat sections generate physical seats, but no seat-level ticket assignment or seat-selection UX exists (Phase 3 scope)
- Event image upload not implemented (images/coverImage are URL arrays, schema-ready); event cards fall back to a placeholder icon
- Frontend covers all public browsing and auth: `/`, `/events`, `/events/[slug]`, `/categories`, `/venues`, `/venues/[id]`, `/signin`, `/signup`; missing pages: `/ai` (Phase 5) and organizer dashboard UI (Phase 4)
- Frontend has no tests yet (API client, auth provider, pages are untested; web `test` script is a placeholder)
- Landing page uses placeholder content; not yet backed by the API
- API boot requires reachable PostgreSQL (PrismaService fails fast); frontend pages degrade gracefully to empty states when the API is unreachable
- Password reset email delivery not wired (token logged in dev; email worker planned for Phase 4)

## Important Architecture Decisions

See `docs/architecture-decisions.md` (ADRs 001–013).

## Current Phase

Phase 1 — Foundation (COMPLETE). Phase 2 — Core Platform (COMPLETE except Leaflet maps + organizer dashboard, deferred to Phase 4). Phase 3 — Booking Engine (IN PROGRESS): booking core (creation with concurrency-safe stock reservation, idempotency, expiry, history, cancellation) COMPLETE; remaining: Razorpay payments, digital tickets, seat-level selection.

## Current Task

Booking engine core implemented and verified: `BookingsModule` with server-priced, idempotent booking creation guarded by conditional availability decrement (no overselling), lazy expiry releasing reserved stock after SEAT_HOLD_TTL, paginated history, and stock-releasing cancellation for unpaid bookings. Full monorepo pipeline green: lint 9/9, type-check 12/12, 79/79 unit tests, build 6/6.

## Next Task

Phase 3 continuation: Razorpay sandbox payment flow (order creation on booking, `verify-payment` signature check, webhook endpoint, failure handling), then digital ticket generation with QR codes after payment capture, then the frontend booking UI on the event detail page.

## Last Completed Checkpoint

Phase 3 — booking engine core (commit "feat: add booking engine core"); prior checkpoints: frontend auth & browse pages (2064811), ticket types + venues + event pages (b93a276), event system (052363e).
