# Deployment

## Local development

```bash
npm install
npm run docker:up          # PostgreSQL 16 (:5433) + Redis 7 (:6379), healthchecked
cp .env.example .env       # set DATABASE_URL (port 5433), JWT_SECRET, REDIS_URL
npm run db:generate && npm run db:migrate
npm run db:seed            # categories + demo users (see docs/database.md)
npm run dev                # API :4000 + web :3000
```

Health: `GET http://localhost:4000/api/health` → `{ status, dependencies: { database, redis } }`.

## Environment

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | always | e.g. `postgresql://eventai:eventai_dev@localhost:5433/eventai` |
| `JWT_SECRET` | always | ≥16 chars, non-placeholder (fail-fast on boot) |
| `REDIS_URL` | always | cache degrades gracefully if unreachable |
| `FRONTEND_URL` | production | must be `https://`; used as the single CORS origin |
| `RAZORPAY_KEY_ID/_SECRET/_WEBHOOK_SECRET` | production | optional in dev (checkout shows an honest "not configured" error) |
| `GROK_API_KEY` / `GROK_MODEL` | optional | AI chat 503s with an actionable message until a real key is set |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional | confirmation emails skip with a dev log until set |
| `SEAT_HOLD_TTL_SECONDS` | optional | seat-hold window (default 600) |
| `RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` | optional | global throttle window/limit |

## CI/CD

`.github/workflows/ci.yml` runs on push/PR: npm cache → install → `lint` → `type-check` → `test` → `build` on Node 20. Verification runs live once the repo is pushed to GitHub.

## Containers

Per-app multi-stage Dockerfiles live in `docker/` (api, web, worker); `docker-compose.yml` provides postgres + redis with healthchecks. Full containerized end-to-end (building app images, compose-up of the whole stack) is pending final deployment wiring.

## Production checklist

1. Provision Postgres + Redis; set all production env vars (validation enforces the critical ones).
2. `prisma migrate deploy` (never `db push`).
3. Build and run `apps/api` behind TLS; keep the web app as the only allowed CORS origin.
4. Point the Razorpay dashboard webhook at `POST /api/payments/webhook`.
5. Smoke-test: `/api/health` shows database + redis up; register → book → pay (sandbox) → ticket QR → door validate.
