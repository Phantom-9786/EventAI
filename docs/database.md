# Database

PostgreSQL 16 via Prisma ORM 6 (schema: `packages/database/prisma/schema.prisma`, migration `20261008195519_init`).

## Domain overview

| Group | Tables |
|-------|--------|
| Identity | `users`, `sessions` (hashed refresh tokens), `password_resets` |
| Organizers | `organizers` (1:1 user), `venues`, `seat_sections`, `seats` |
| Catalog | `categories`, `events` (+FTS `search_vector`), `event_faqs`, `ticket_types` |
| Commerce | `bookings`, `booking_items`, `payments`, `tickets` |
| Platform | `notifications`, `ai_conversations`, `audit_logs` |

## Notable details

- **Full-text search**: `events.search_vector` is a `tsvector` maintained by trigger `events_search_vector_trigger` (weights: title A, tags B, short description C, description D) with a GIN index; the API queries it with `websearch_to_tsquery` + `ts_rank` over parameterised raw SQL.
- **Stock accounting**: `ticket_types.total_quantity` vs `available_quantity`; `available_quantity` is initialised on create and re-derived on quantity edits (`new = total − sold`) so booked stock is never oversold by edits.
- **Booking state machine**: `PENDING → PAYMENT_PENDING → CONFIRMED | EXPIRED | CANCELLED | REFUNDED`. `expires_at` (seat hold TTL) drives expiry; expiry, refunds, and confirmations all re-check state inside their transaction so concurrent operations win safely.
- **Tickets**: unique `ticket_code` (`TKT-` + 16 hex chars), `qr_data` JSON `{ code, bookingId, eventId }`, status `VALID → USED` with `validated_at`/`validated_by` stamped at check-in.

## Commands

```bash
npm run db:migrate   # dev migration
npm run db:seed      # categories + demo users/organizer/events
npm run db:studio    # Prisma Studio
```

Seeded accounts (password `DemoPass123`): `admin@eventai.test` (ADMIN), `demo.organizer@eventai.test` (ORGANIZER with venue + published events), `customer@eventai.test` (CUSTOMER).

> Note: the native Windows Postgres on this dev machine occupies 5432, so Docker maps Postgres to host port **5433** (`DATABASE_URL` uses 5433).
