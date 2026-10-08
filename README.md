# EventAI — Discover. Book. Experience.

AI-powered Event Discovery and Ticket Booking Platform built as a modular monolith with Turborepo.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui-style components |
| Backend | NestJS, TypeScript, REST APIs |
| Database | PostgreSQL 16, Prisma ORM |
| Cache / Queue | Redis 7 |
| Background Jobs | BullMQ |
| Real-Time | Socket.IO |
| Payments | Razorpay (Sandbox) |
| Maps | Leaflet + OpenStreetMap |
| Search | PostgreSQL Full-Text Search |
| AI/LLM | Grok/xAI (via provider abstraction) |
| Vector DB | Pinecone |
| Email | Resend |
| Monorepo | Turborepo, npm workspaces |

## Project Structure

```
eventai/
├── apps/
│   ├── web/          — Next.js frontend
│   ├── api/          — NestJS backend API
│   └── worker/       — BullMQ background worker
├── packages/
│   ├── config/       — Shared ESLint + TypeScript configs
│   ├── database/     — Prisma schema + client
│   ├── types/        — Shared TypeScript types
│   └── validation/   — Shared Zod schemas
├── docker/           — Dockerfiles (api, web, worker)
├── docs/             — Architecture documentation
├── docker-compose.yml
├── turbo.json
└── README.md
```

## Prerequisites

- Node.js >= 18 (20 recommended)
- Docker (for PostgreSQL + Redis)

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL + Redis
npm run docker:up

# 3. Configure environment
cp .env.example .env
# Edit .env with real values (JWT_SECRET, etc.)

# 4. Generate Prisma client and push schema
npm run db:generate
npm run db:push

# 5. Run everything in dev mode
npm run dev
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Swagger docs | http://localhost:4000/api/docs |
| Health check | http://localhost:4000/api/health |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run all apps in dev mode |
| `npm run build` | Build all apps and packages |
| `npm run lint` | Lint all apps and packages |
| `npm run type-check` | TypeScript check across the monorepo |
| `npm run test` | Run tests |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run docker:up` / `docker:down` | Start/stop PostgreSQL + Redis |

## Current Status

**Phase 1 — Foundation: complete.** See `implementation.md` for the full roadmap and `context.md` for the live project state.

- Monorepo with Turborepo + npm workspaces
- Shared packages (config, types, validation, database)
- Full Prisma schema (users, events, venues, seats, bookings, payments, tickets, notifications, AI conversations, audit logs)
- NestJS API with global validation, error envelope filter, env validation, health endpoint
- Next.js web app with Tailwind + shadcn-style components, responsive layout, error/loading states
- BullMQ worker skeleton with Redis connection and graceful shutdown
- Docker Compose (postgres, redis) and per-app Dockerfiles

## License

Private project — all rights reserved.
