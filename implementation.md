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
**Status: IN PROGRESS — Authentication & RBAC complete; profiles + event system next**

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
- [x] User profile retrieval (`GET /api/auth/me`)
- [ ] User profile CRUD (update profile, `/users` module)
- [ ] Profile image upload
- [ ] Preferences
- [ ] Account settings

### Event System
- [ ] Event model (title, slug, description, category, images, dates, venue, policies, FAQs, status)
- [ ] Event CRUD (organizer)
- [ ] Event publishing/unpublishing
- [ ] Category management

### Event Discovery
- [ ] PostgreSQL Full-Text Search
- [ ] Category filtering
- [ ] Location filtering
- [ ] Date filtering
- [ ] Price filtering
- [ ] Sorting
- [ ] Pagination
- [ ] Event detail page (frontend)

### Venues
- [ ] Venue model
- [ ] Venue CRUD
- [ ] Map coordinates
- [ ] Leaflet + OpenStreetMap integration
- [ ] Seating configuration

### Ticket Types
- [ ] Ticket type model (name, price, quantity, sale dates, limits)
- [ ] Ticket type CRUD
- [ ] Availability tracking

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
