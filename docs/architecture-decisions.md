# Architecture Decision Records

## ADR-001: PostgreSQL over MongoDB
**Date:** 2026-10-08
**Decision:** Use PostgreSQL as the primary relational database.
**Context:** The platform requires complex relationships (users, events, venues, seats, bookings, payments, tickets), transactional guarantees for booking/payment flows, and row-level locking for concurrency control.
**Options Considered:**
1. PostgreSQL — relational, ACID, mature, FTS built-in, strong concurrency support
2. MongoDB — document-oriented, flexible schema, weaker transaction support
**Chosen:** PostgreSQL
**Reason:** The booking engine requires strict ACID transactions, row-level locking, foreign key constraints, and complex joins. PostgreSQL's full-text search also eliminates the need for a separate search engine.
**Trade-offs:** Less schema flexibility than MongoDB, but the data model is well-defined and relational.

---

## ADR-002: Modular Monolith over Microservices
**Date:** 2026-10-08
**Decision:** Use a modular monolith architecture with separate worker process.
**Context:** The project needs to demonstrate engineering depth but must remain understandable and explainable in interviews.
**Options Considered:**
1. Microservices — independent deployment, separate databases
2. Modular monolith — single deployable with well-separated modules + background worker
**Chosen:** Modular monolith
**Reason:** Microservices add operational complexity (service discovery, distributed transactions, API gateways) without proportional benefit at this scale. A modular monolith with clear module boundaries achieves separation of concerns while remaining simple to deploy and explain.
**Trade-offs:** Less independently scalable, but appropriate for the scale and interview-discussion context.

---

## ADR-003: Redis for Cache and Temporary State
**Date:** 2026-10-08
**Decision:** Use Redis for caching, temporary seat holds, rate limiting, and queue infrastructure.
**Context:** The booking system needs temporary seat holds with TTL, the API needs caching and rate limiting, and BullMQ requires Redis.
**Options Considered:**
1. Redis — in-memory, TTL support, pub/sub, BullMQ compatible
2. Memcached — simpler, no persistence, no pub/sub
**Chosen:** Redis
**Reason:** Redis serves multiple purposes: BullMQ queue backend, temporary seat holds with TTL, API caching, rate limiting, and Socket.IO adapter. Single technology for multiple needs.
**Trade-offs:** Redis is not the source of truth for any business data — PostgreSQL remains authoritative.

---

## ADR-004: BullMQ for Background Jobs
**Date:** 2026-10-08
**Decision:** Use BullMQ with Redis for background job processing.
**Context:** The platform needs asynchronous processing for seat hold expiration, email sending, ticket generation, and AI processing.
**Options Considered:**
1. BullMQ — Redis-based, TypeScript native, reliable, good DX
2. Kafka — overkill for this scale, adds operational complexity
3. RabbitMQ — separate infrastructure, more complex setup
**Chosen:** BullMQ
**Reason:** Leverages existing Redis infrastructure, excellent TypeScript support, built-in retry/backoff, and appropriate for the job types needed.
**Trade-offs:** Tied to Redis, but Redis is already required for other features.

---

## ADR-005: Socket.IO for Real-Time
**Date:** 2026-10-08
**Decision:** Use Socket.IO for real-time updates (seat availability, booking status, notifications).
**Context:** Users need real-time feedback during seat selection and booking.
**Options Considered:**
1. Socket.IO — mature, fallback transports, room support, NestJS integration
2. Server-Sent Events — simpler but one-directional
3. Raw WebSockets — lower level, more work
**Chosen:** Socket.IO
**Reason:** Built-in NestJS gateway support, room-based broadcasting for event-specific updates, automatic reconnection, and fallback transports.
**Trade-offs:** Slightly heavier than raw WebSockets, but the abstraction benefits outweigh the overhead.

---

## ADR-006: Razorpay Sandbox for Payments
**Date:** 2026-10-08
**Decision:** Use Razorpay in sandbox/test mode for payment processing.
**Context:** The platform needs a real payment integration that demonstrates proper payment verification, webhook handling, and idempotency.
**Options Considered:**
1. Razorpay — Indian payment gateway, good test mode, UPI support
2. Stripe — international, excellent DX, but less relevant for Indian market demo
**Chosen:** Razorpay
**Reason:** Directly relevant for Indian market (₹ pricing), free test mode, comprehensive API, webhook support.
**Trade-offs:** India-specific, but appropriate for the target demonstration context.

---

## ADR-007: Leaflet + OpenStreetMap for Maps
**Date:** 2026-10-08
**Decision:** Use Leaflet with OpenStreetMap tiles for venue maps.
**Context:** Venue pages need map display for location.
**Options Considered:**
1. Leaflet + OpenStreetMap — free, open source, no API key required
2. Google Maps — expensive, requires API key and billing
3. Mapbox — freemium, requires API key
**Chosen:** Leaflet + OpenStreetMap
**Reason:** Completely free, no API key required, sufficient for venue location display.
**Trade-offs:** Less feature-rich than Google Maps, but fully adequate for this use case.

---

## ADR-008: PostgreSQL Full-Text Search over Elasticsearch
**Date:** 2026-10-08
**Decision:** Use PostgreSQL's built-in full-text search instead of Elasticsearch/OpenSearch.
**Context:** The platform needs event search by title, description, category, and location.
**Options Considered:**
1. PostgreSQL FTS — built-in, no extra infrastructure, GIN indexes
2. Elasticsearch — powerful but adds significant infrastructure complexity
**Chosen:** PostgreSQL FTS
**Reason:** Eliminates a separate search service, PostgreSQL FTS is sufficient for the data volume, and keeps the architecture simple.
**Trade-offs:** Less powerful for complex search scenarios, but adequate for event search.

---

## ADR-009: LLM Provider — Grok/xAI, migrated to Groq
**Date:** 2026-10-08 (amended 2026-10-10: provider migrated to Groq)
**Decision:** Use Groq as the primary LLM provider. The original decision chose Grok/xAI; the provider was migrated to Groq on 2026-10-10 at the owner's direction.
**Context:** The developer needs an affordable LLM API. The architecture must remain provider-agnostic.
**Options Considered:**
1. OpenAI — expensive, industry standard
2. Gemini — Google, competitive pricing
3. Grok/xAI — affordable, available (original choice)
4. Groq — OpenAI-compatible API, generous free tier, fast inference (final choice)
**Chosen:** Groq (`https://api.groq.com/openai/v1/chat/completions`, default model `llama-3.3-70b-versatile` from Groq's production catalog, configurable via `GROQ_MODEL`)
**Reason:** Budget constraints and free-tier availability. Because both providers expose the same OpenAI-compatible chat-completions shape, the migration touched only one service (`ai.service.ts`) plus env/docs — demonstrating that the "abstraction" this ADR originally promised is effectively delivered by the OpenAI-compatible standard itself rather than a custom adapter layer.
**Honest amendment:** the originally documented abstraction files (`ai/llm.ts`, `providers/grok.provider.ts`) were never implemented — the integration is a single service with a hardcoded OpenAI-compatible endpoint. A future provider swap means editing that one file (and env names), as this migration showed.
**Trade-offs:** Groq's model catalog differs from xAI's; model IDs are configurable via `GROQ_MODEL` to absorb future deprecations (see Groq's deprecation policy). Single-provider integration, no failover (deliberate — see docs/ai.md deferrals).

---

## ADR-010: Pinecone for Vector Search
**Date:** 2026-10-08
**Decision:** Use Pinecone as the vector database for embeddings and RAG.
**Context:** The AI assistant needs semantic search over event FAQs, policies, and knowledge.
**Options Considered:**
1. Pinecone — managed, scalable, good free tier
2. pgvector — keeps everything in PostgreSQL, simpler
3. Weaviate — self-hosted option
**Chosen:** Pinecone
**Reason:** Managed service with free tier, purpose-built for vector search, separates vector concerns from transactional database.
**Trade-offs:** External dependency, but appropriate for demonstrating vector search architecture.

---

## ADR-011: Turborepo for Monorepo Management
**Date:** 2026-10-08
**Decision:** Use Turborepo for monorepo task orchestration.
**Context:** The project has multiple apps and shared packages that need coordinated builds.
**Options Considered:**
1. Turborepo — fast, caching, simple configuration
2. Nx — more features but heavier
3. Lerna — older, less maintained
**Chosen:** Turborepo
**Reason:** Fast incremental builds, simple `turbo.json` configuration, good TypeScript monorepo support.
**Trade-offs:** Fewer features than Nx, but simpler to configure and explain.

---

## ADR-012: Resend for Transactional Email (SUPERSEDED by ADR-015)
**Date:** 2026-10-08
**Status:** Superseded on 2026-10-09 by ADR-015 (Brevo). The integration was migrated; this ADR is retained for history.
**Decision:** Use Resend for transactional email delivery.
**Context:** The platform needs to send booking confirmations, ticket emails, and notifications.
**Options Considered:**
1. Resend — modern API, good DX, free tier
2. SendGrid — established but heavier
3. Nodemailer + SMTP — lower level
**Chosen:** Resend
**Reason:** Simple API, excellent developer experience, adequate free tier for development.
**Trade-offs:** External dependency, but email delivery requires a service.

---

## ADR-013: NestJS as Backend Framework
**Date:** 2026-10-08
**Decision:** Use NestJS as the backend framework.
**Context:** The backend needs a structured, modular framework with dependency injection, decorators, guards, and built-in support for WebSockets.
**Options Considered:**
1. NestJS — modular, DI, decorators, TypeScript-first, WebSocket support
2. Express.js — minimal, less structure
3. Fastify — fast but less ecosystem
**Chosen:** NestJS
**Reason:** Built-in modular architecture supports the modular monolith pattern. Dependency injection, guards, interceptors, and pipes provide clean separation of concerns.
**Trade-offs:** Heavier than Express, but the structure is valuable for a project of this complexity.

## ADR-014: Google OAuth 2.0 Sign-In with Verified-Email-Only Account Linking
**Date:** 2026-10-09
**Decision:** Add "Sign in with Google" as a second authentication method using the authorization-code flow, with conservative account linking.
**Context:** Users expect social login; the existing email/password model must not be weakened. Google accounts can be created for arbitrary email addresses, so linking a Google identity to an existing local account is a potential account-takeover vector if done blindly.
**Options Considered:**
1. Server-side authorization-code flow with `google-auth-library` (`verifyIdToken`) — chosen
2. Client-side Google Identity Services (ID token posted to the API) — simpler but the token transits the browser and the flow is harder to harden server-side
3. Account linking always on match by email — rejected: unsafe when `email_verified` is false
**Chosen:** Server-side authorization-code flow. `GET /api/auth/google` issues an HMAC-SHA256-signed state (10-min expiry) mirrored in an httpOnly cookie; the callback requires cookie/query state match, exchanges the code, and verifies the ID token (signature, audience, expiry). Existing accounts are linked by `googleId` first; otherwise by email ONLY when Google reports `email_verified: true`. New users are created passwordless (`users.passwordHash` nullable, `users.google_id` unique). The access token returns via URL fragment (never sent to servers); refresh tokens reuse the existing hashed rotating-session mechanism.
**Reason:** Server-side verification keeps Google's attestation entirely within the trust boundary; verified-email-only linking makes account takeover require control of the mailbox, matching the threat model of password reset.
**Trade-offs:** Live login is not yet verified against real Google Cloud credentials (feature-gated 503 without them); passwordless accounts cannot use password login or change-password until a reset flow sets a password. Setup steps in `docs/google-oauth.md`.

## ADR-015: Brevo for Transactional Email (supersedes ADR-012)
**Date:** 2026-10-09
**Decision:** Migrate transactional email from Resend to Brevo's REST API (`POST /v3/smtp/email`, `api-key` header).
**Context:** Provider switch requested by the product owner. Brevo's free tier is sufficient for development, and a sender can be verified as a single mailbox (email confirmation) without owning a custom domain — Resend's sandbox sender (`onboarding@resend.dev`) only delivered to the account owner's own inbox and a custom domain would need to be purchased.
**Implementation:** `NotificationsService.sendEmail` now posts `{ sender, to, subject, htmlContent }` to Brevo; `EMAIL_FROM` ("Name <addr>" or bare addr) is parsed into Brevo's `{ name, email }` sender object. Env: `BREVO_API_KEY` (skipped-with-dev-log when missing or `xkeysib-xxxx` placeholder) + `EMAIL_FROM`; `RESEND_API_KEY` removed from code, `turbo.json`, `.env.example`. All five flows (booking confirmation, cancellation, refund, password reset, email verification) and the graceful-failure contract are unchanged. Sender verification requirement: sends from an unverified sender address are rejected by Brevo — the sender must be confirmed in Brevo → Senders & IP (single-mailbox verification is enough for local dev; a verified domain later removes that constraint).
**Trade-offs:** Still fire-and-forget with failures logged (email never breaks bookings/payments/auth); live delivery verified 2026-10-09 via Brevo's event log (`delivered` for a real password-reset email from the verified sender `tarunkumarsahu2551@gmail.com`), and the full reset round-trip was completed by a real user on 2026-10-10.

## ADR-016: DB-Backed Integration Tests Against Real PostgreSQL in CI
**Date:** 2026-10-10
**Decision:** Run integration tests (`apps/api/test/*.int-spec.ts`) against a real PostgreSQL database provisioned by `prisma migrate deploy` — the same migrations production uses — in a dedicated test database; wire them into CI as a step after unit tests with a `postgres:16` service container.
**Context:** The 180 unit tests mock Prisma entirely, so transactional behavior (stock decrements, FTS triggers, unique-constraint effects) was never exercised against a real engine.
**Implementation:** Separate Jest config (`test/jest-integration.json`, serial `maxWorkers: 1`, dedicated `test/tsconfig.integration.json` because the main tsconfig's `rootDir` is `src`). A hard guard in `test/db.ts` refuses to run against any database whose name does not contain "test". Every fixture is namespaced with a unique per-run suffix so assertions stay exact on the shared database. All external services (Brevo, Razorpay, Google, Groq) are stubbed — CI never needs real credentials. Env: `TEST_DATABASE_URL`.
**Findings:** The suite immediately caught a real bug — two logins within the same second produced byte-identical JWTs (same payload + `iat`), violating the unique `sessions.token` hash; fixed by adding a random `jti` claim to the token payload (ADR note: no behavioral change otherwise).
**Trade-offs:** Serial execution is slower than parallel; suites share one database so fixtures must stay self-scoped; CI runs migrations from scratch on every run (cost is ~2s).
