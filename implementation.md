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
**Status: IN PROGRESS — Authentication, Authorization, User Profiles, Event System (organizer CRUD + publishing + categories + FTS discovery backend), Ticket Types, Venue completion, and frontend event pages complete; booking engine (Phase 3) next**

### Authentication
- [x] Registration (email/password)
- [x] Login
- [x] Logout
- [x] Password hashing (Argon2id)
- [x] JWT tokens / session management (rotating refresh sessions, hashed at rest)
- [x] Secure cookies (httpOnly, sameSite=lax, path-scoped refresh cookie)
- [x] Password reset architecture (hashed single-use tokens, 1h expiry; email delivery deferred to Phase 4 worker)
- [x] Email verification architecture (schema-ready: `is_email_verified`; flow pending)
- [x] Change password
- [x] Rate limiting on auth endpoints (ThrottlerGuard, 10 req/min on auth)

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
- [ ] Map coordinates (schema-ready: latitude/longitude; Leaflet integration pending)
- [ ] Leaflet + OpenStreetMap integration
- [x] Seating configuration (organizer seat sections with bulk seat generation, Excel-style row letters)

### Ticket Types
- [x] Ticket type model (name, price, quantity, sale dates, limits)
- [x] Ticket type CRUD (organizer-only on owned events; quantity edits preserve sold stock; delete blocked once booked)
- [x] Availability tracking (availableQuantity derived on create/update; sold-out and low-stock surfaced in public event detail)

### Frontend Event Pages
- [x] API client (`apps/web/src/lib/api.ts` — typed fetchers, `NEXT_PUBLIC_API_URL` override, paise→₹ formatting, date formatting)
- [x] Events listing page (`/events` — search, city filter, category chips from live API, sorting, pagination; server-rendered)
- [x] Event detail page (`/events/[slug]` — venue/date info, ticket types with availability and sale windows, FAQs, policies, organizer card, generateMetadata)
- [ ] Categories/Venues/AI/signin pages (header links exist; pages pending)
- [ ] Auth integration on the frontend (Phase 2 backend ready; UI pending)

---

## Phase 3 — Booking Engine
**Status: NOT STARTED**

### Seat Management
- [ ] Seat states (AVAILABLE, HELD, BOOKED, BLOCKED)
- [ ] Seat selection UI
- [ ] Temporary seat holds (Redis + BullMQ expiration)
- [ ] Concurrency protection (PostgreSQL transactions + row locking)

### Booking System
- [ ] Booking states (PENDING, PAYMENT_PENDING, CONFIRMED, CANCELLED, EXPIRED, REFUNDED)
- [ ] Booking creation flow
- [ ] State machine transitions
- [ ] Booking history

### Payment
- [ ] Razorpay sandbox integration
- [ ] Order creation
- [ ] Payment initiation
- [ ] Backend payment verification
- [ ] Webhook handling
- [ ] Signature verification
- [ ] Idempotency
- [ ] Failure handling

### Digital Tickets
- [ ] Ticket generation after booking
- [ ] Unique ticket identifiers
- [ ] QR code generation
- [ ] Ticket retrieval

### Ticket Validation
- [ ] QR scanning architecture
- [ ] Ticket lookup
- [ ] Valid/invalid/used states
- [ ] Validation timestamp + validator tracking

### Cancellation / Refund
- [ ] Cancellation eligibility checks
- [ ] Booking cancellation flow
- [ ] Refund state management
- [ ] User notification on cancellation

---

## Phase 4 — Platform Engineering
**Status: NOT STARTED**

### Redis Caching
- [ ] Event caching
- [ ] Cache invalidation strategy
- [ ] Rate limiting via Redis

### BullMQ Workers
- [ ] Worker app connected to Redis
- [ ] Seat hold expiration jobs
- [ ] Email notification jobs
- [ ] Ticket generation jobs
- [ ] Payment processing jobs

### Real-Time (Socket.IO)
- [ ] WebSocket server setup
- [ ] Seat availability updates
- [ ] Booking status updates
- [ ] Notification delivery
- [ ] Reconnection handling

### Notifications
- [ ] Notification model
- [ ] Booking confirmation notifications
- [ ] Payment notifications
- [ ] Ticket generated notifications
- [ ] Cancellation notifications

### Organizer Dashboard
- [ ] Event management UI
- [ ] Booking management
- [ ] Attendee information
- [ ] Ticket validation UI
- [ ] Revenue display
- [ ] Basic analytics

### Admin Dashboard
- [ ] User management
- [ ] Organizer management
- [ ] Event moderation
- [ ] Category management
- [ ] Audit logs
- [ ] Platform statistics

### Analytics
- [ ] Organizer analytics (bookings, revenue, occupancy)
- [ ] Admin analytics (users, events, platform activity)

---

## Phase 5 — AI Layer
**Status: NOT STARTED**

### AI Provider Abstraction
- [ ] `ai/llm.ts` provider interface
- [ ] `ai/providers/grok.provider.ts`
- [ ] AI service module

### AI Event Assistant
- [ ] Chat interface
- [ ] Natural language event queries
- [ ] Intent extraction
- [ ] Conversation management

### Tool Calling
- [ ] `searchEvents()` tool
- [ ] `getEventDetails()` tool
- [ ] `getEventAvailability()` tool
- [ ] `getVenueDetails()` tool
- [ ] `getUserBookings()` tool
- [ ] `getRecommendations()` tool
- [ ] `getEventFAQ()` tool
- [ ] `getCancellationPolicy()` tool
- [ ] `createBookingIntent()` tool
- [ ] Authentication/authorization on tools

### Pinecone + RAG
- [ ] Pinecone client setup
- [ ] Embedding generation (provider abstraction)
- [ ] Event FAQ indexing
- [ ] Policy document indexing
- [ ] RAG retrieval pipeline
- [ ] Context-augmented responses

### Recommendations
- [ ] User preference tracking
- [ ] Category-based recommendations
- [ ] Location-based recommendations
- [ ] Booking history-based recommendations
- [ ] Semantic similarity scoring
- [ ] Recommendation API

### AI Security
- [ ] Prompt injection protection
- [ ] Tool authorization
- [ ] Cross-user data isolation
- [ ] Input sanitization
- [ ] Rate limiting on AI endpoints

---

## Phase 6 — Production Polish
**Status: NOT STARTED**

### Testing
- [ ] Unit tests (auth, validation, booking logic, seat allocation, pricing)
- [ ] Integration tests (auth, events, booking, payment, ticket validation)
- [ ] Concurrency tests (double booking prevention)
- [ ] E2E tests (Playwright — register, browse, book, pay, ticket)

### Security Review
- [ ] Password hashing verification
- [ ] RBAC verification
- [ ] Input validation audit
- [ ] Rate limiting verification
- [ ] CORS configuration
- [ ] Helmet/security headers
- [ ] CSRF protection
- [ ] Request size limits
- [ ] Secure error responses
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
- [ ] GitHub Actions — install, lint, type-check, test, build
- [ ] Workflow verification

### Observability
- [ ] Structured logging
- [ ] Request IDs
- [ ] Health endpoints (DB, Redis, Worker)
- [ ] Error tracking setup

### Documentation
- [ ] README.md (complete)
- [ ] docs/architecture.md
- [ ] docs/database.md
- [ ] docs/api.md
- [ ] docs/booking-engine.md
- [ ] docs/ai.md
- [ ] docs/security.md
- [ ] docs/deployment.md
- [ ] Architecture diagram

### Seed Data
- [ ] Users (customer, organizer, admin)
- [ ] Categories
- [ ] Events
- [ ] Venues
- [ ] Seats
- [ ] Ticket types
- [ ] FAQs

### Final Verification
- [ ] Full application startup test
- [ ] Auth flow verification
- [ ] Event CRUD verification
- [ ] Booking flow end-to-end
- [ ] Payment flow verification
- [ ] AI assistant verification
- [ ] Real-time updates verification
- [ ] Docker Compose full stack test
