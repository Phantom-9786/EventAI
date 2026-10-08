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

## Current Database Schema

Complete Phase 1+ schema in `packages/database/prisma/schema.prisma` (see "Implemented Features"). Migration `20261008195519_init` applied (all 18 tables + enums + FKs). `search_vector` on Event is `Unsupported("tsvector")`: the column is created by Prisma in the migration; a trigger (`events_search_vector_trigger`, weights title=A, tags=B, short_description=C, description=D) and a GIN index (`events_search_vector_idx`, declared in the schema via `@@index([searchVector], type: Gin)`) are appended in the same migration. Verified end-to-end with a rolled-back insert + `websearch_to_tsquery` match. Prisma client generated (v6.19.3).

## Authentication

Implemented (Phase 2). See "Implemented Features — Phase 2". Session model in use: `sessions.token` = SHA-256 of the access JWT, `sessions.refresh_token` = SHA-256 of the opaque refresh token, `expires_at` = refresh expiry. JWT payload: `{ sub, email, role }`.

## Booking Architecture

Not yet implemented. Schema ready (Booking, BookingItem, Seat states, idempotency key).

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
- 42 passing unit tests (health: 3; auth service: 6; users service: 14; events service: 19 — CRUD, ownership, publish/cancel/delete transitions, FTS raw-SQL shape + hydration order, draft-hiding)
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
- Venue management is partial: organizers can create/list venues, but update/delete/public venue browsing and seating configuration are not built yet
- Event image upload not implemented (images/coverImage are URL arrays, schema-ready)
- Ticket types are not implemented yet, so price filters/sorts operate over empty ticket sets (events with no tickets are excluded by price filters; minPrice/maxPrice are null)
- Landing page uses placeholder content; no API integration yet
- API boot requires reachable PostgreSQL (PrismaService fails fast)
- Password reset email delivery not wired (token logged in dev; email worker planned for Phase 4)

## Important Architecture Decisions

See `docs/architecture-decisions.md` (ADRs 001–013).

## Current Phase

Phase 1 — Foundation (COMPLETE). Phase 2 — Core Platform: Authentication & RBAC (COMPLETE), User Profiles (COMPLETE), Event System incl. FTS discovery backend (COMPLETE). Remaining in Phase 2: venue completion (update/delete/public browse, seating), ticket types, frontend event pages.

## Current Task

Event System implemented and verified end-to-end: register → become organizer → create venue → create draft (hidden publicly) → publish → FTS search finds it with correct filters/sorting → update → cancel → delete rules enforced; customer role 403 on organizer routes; categories seeded and admin-gated. Full monorepo pipeline green: 21/21 tasks, 42 unit tests.

## Next Task

Phase 2 continuation: Ticket Types (CRUD for organizers on their events, sale windows, quantity/availability) and Venue completion (update/delete, public venue browse, seating sections), then frontend event listing/detail pages hitting the new APIs.

## Last Completed Checkpoint

Phase 2 — Event System complete (commit "feat: complete event system with FTS search"); prior checkpoints: user profiles (990e83f), authentication (0c051b7).
