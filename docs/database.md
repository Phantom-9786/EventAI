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

`npm run db:seed` is blocked unless `NODE_ENV=development` and does not create an ADMIN account. It creates demo organizer/customer accounts and content with development-only credentials. Do not rely on older demo-account documentation for existing databases: a database seeded by an earlier version may still contain a legacy ADMIN. Never run the seed against production.

Use `npm run db:migrate --workspace=@eventai/database` for development migrations and `npm run db:deploy --workspace=@eventai/database` for production migration deployment. Select the corresponding database URL in the command environment first. Production deployment must use `migrate deploy`, never `db push` or `migrate dev`.

To provision the first administrator, first verify the target database contains no existing ADMIN, and confirm that the intended account already exists, is active, and has a verified email. Then run `npm run db:provision-admin --workspace=@eventai/database` locally and confirm the prompt. The script is one-time and records an audit entry; it must not be run against a database until the operator has confirmed its target and current admin state.

> Note: the native Windows Postgres on this dev machine occupies 5432, so Docker maps Postgres to host port **5433** (`DATABASE_URL` uses 5433).
