# Architecture

EventAI is a modular monolith served by a Turborepo monorepo.

```
Browser ──► Next.js 14 web (apps/web, :3000)
                 │  REST (JSON, bearer JWT + httpOnly refresh cookie)
                 ▼
            NestJS API (apps/api, :4000/api)
                 ├── Modules: auth, users, organizers, categories, events,
                 │            venues, tickets, bookings, payments,
                 │            notifications, ai, admin, health
                 ├── Guards:   ThrottlerGuard → JwtAuthGuard → RolesGuard
                 ├── Cache:    CacheService (Redis, graceful no-op fallback)
                 ├── Schedule: @nestjs/schedule minute cron (booking expiry)
                 └── Prisma ──► PostgreSQL 16 (FTS + triggers)
```

## Key decisions

- **Monolith over services**: one deployable API; the BullMQ worker app (`apps/worker`) stays a skeleton until volume demands a split (in-process cron + fire-and-forget email cover current scale).
- **Money** is always integer paise, computed server-side; the client never prices a booking.
- **Stock safety**: every inventory change happens inside a Prisma transaction using conditional `updateMany` decrements (`availableQuantity: { gte: qty }`), so concurrent bookings can never oversell; refunds/expiry increment stock back inside re-checked transactions.
- **Idempotency**: bookings carry a unique client `idempotencyKey`; payments are keyed `order:{bookingId}`; the confirm path (verify + webhook) is idempotent and safe for out-of-order delivery.
- **AI grounding over RAG**: the assistant prompt injects the next 12 upcoming published events; similar-event recommendations use Postgres scoring (category, then city). Pinecone remains an option, not a dependency.
- **Caching**: Redis caches hot public reads (event detail 60s, similar events 120s, categories 300s) with prefix-scan invalidation on writes and a 60s TTL bounding availability staleness. The API degrades gracefully when Redis is down.

See `docs/architecture-decisions.md` for the ADR log.
