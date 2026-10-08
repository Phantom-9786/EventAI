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

## ADR-009: Grok/xAI with Provider Abstraction
**Date:** 2026-10-08
**Decision:** Use Grok/xAI as the primary LLM provider, accessed through a provider abstraction layer.
**Context:** The developer needs an affordable LLM API. The architecture must remain provider-agnostic.
**Options Considered:**
1. OpenAI — expensive, industry standard
2. Gemini — Google, competitive pricing
3. Grok/xAI — affordable, available
**Chosen:** Grok/xAI (with abstraction allowing future provider swap)
**Reason:** Budget constraints. The provider abstraction (`ai/llm.ts` → `providers/grok.provider.ts`) ensures the AI layer can be swapped without rewriting business logic.
**Trade-offs:** Grok may have fewer features than OpenAI, but the abstraction mitigates lock-in risk.

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

## ADR-012: Resend for Transactional Email
**Date:** 2026-10-08
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
