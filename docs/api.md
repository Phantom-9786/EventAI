# API

Base URL `http://localhost:4000/api` (global prefix). Interactive docs at `/api/docs` (Swagger, dev only). Auth: JWT bearer access token; refresh via httpOnly cookie (`POST /auth/refresh`). Errors use a consistent envelope: `{ success: false, statusCode, message, path, timestamp }` — no stack leaks. Every response carries an `X-Request-Id` header.

## Endpoint map

| Area | Endpoints |
|------|-----------|
| Health | `GET /health` (database + redis status) |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/me`, `POST /auth/change-password` |
| Users | `GET/PATCH /users/me`, `PATCH /users/me/preferences`, `POST /users/me/avatar`, `GET /users/:id` (public), `DELETE /users/me` (deactivate) |
| Organizers | `POST /organizers`, `GET /organizers/me`, `GET /organizers/me/events`, `GET /organizers/me/stats`, venue CRUD under `/organizers/venues*`, seat sections `/organizers/venues/:id/sections`, door: `POST /organizers/events/:eventId/tickets/validate`, `GET /organizers/events/:eventId/tickets/stats`, `GET /organizers/events/:eventId/bookings` |
| Categories | `GET /categories` (public), `POST/PATCH/DELETE /categories` (admin) |
| Events | `GET /events` (public FTS search + filters), `GET /events/:idOrSlug` (public), `GET /events/:idOrSlug/similar`, organizer CRUD `POST /events`, `PATCH/DELETE /events/:idOrSlug`, `POST /events/:idOrSlug/publish`, `POST /events/:idOrSlug/cancel`, `GET /events/:idOrSlug/manage` |
| Tickets | `POST/GET /events/:idOrSlug/tickets`, `PATCH/DELETE /ticket-types/:id` (organizer, owned) |
| Venues | `GET /venues`, `GET /venues/:id` (public) |
| Bookings | `POST /bookings` (idempotency key), `GET /bookings`, `GET /bookings/:id`, `POST /bookings/:id/cancel` (delegates to refund when CONFIRMED) |
| Payments | `POST /payments/order`, `POST /payments/verify`, `POST /payments/webhook` (public, raw-body HMAC), `POST /payments/refund`, `GET /payments/tickets/:id/qr` |
| AI | `POST /ai/chat` (public; 503 with actionable message when `GROK_API_KEY` is missing/placeholder) |
| Admin | `GET /admin/stats` (admin) |

## Conventions

- **Validation**: every write body/query passes a Zod schema (`@eventai/validation`) via `ZodValidationPipe`; unknown fields are rejected.
- **RBAC**: `@Roles('ORGANIZER'|'ADMIN')` + ownership checks (organizer resources are scoped by `organizerId`).
- **Rate limits**: global throttler (`RATE_LIMIT_TTL`/`RATE_LIMIT_MAX`); auth endpoints are limited to 10 req/min per IP.
- **Money**: amounts are integer paise; totals are computed server-side from current DB prices.
- **Caching**: `GET /events/:idOrSlug`, `/similar`, and `/categories` are Redis-cached (60s/120s/300s TTL) and invalidated on relevant writes; a `Cache-Control`-free JSON response is always authoritative after invalidation.
