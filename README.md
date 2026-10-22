# EventAI — Discover. Book. Experience.

AI-powered Event Discovery and Ticket Booking Platform built as a modular monolith with Turborepo.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, shadcn/ui-style components |
| Backend | Express, TypeScript, REST APIs |
| Database | PostgreSQL 16, Prisma ORM |
| Cache / Queue | Redis 7 |
| Background Jobs | API scheduler; BullMQ worker scaffold (no processors registered) |
| Payments | Razorpay (Sandbox) |
| Maps | Leaflet + OpenStreetMap |
| Search | PostgreSQL full-text filters + mood-based semantic retrieval |
| AI/LLM | Groq Chat Completions, GPT-OSS 20B/120B with complexity routing |
| Semantic RAG | Local quantized MiniLM embeddings stored in PostgreSQL; exact cosine scoring |
| Email | Brevo |
| Monorepo | Turborepo, npm workspaces |

## Project Structure

```
eventai/
├── apps/
│   ├── web/          — Next.js frontend
│   ├── api/          — Express + TypeScript backend API
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

# 4. Generate Prisma client, push schema, seed demo data
npm run db:generate
npm run db:push
npm run db:seed

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

**All core phases implemented** (booking engine with payments/refunds/check-in, platform engineering, AI layer, production polish). See `implementation.md` for the full roadmap and `context.md` for the live project state. Documentation:

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](docs/architecture.md) | System architecture and key decisions |
| [docs/database.md](docs/database.md) | Schema, state machines, seed data |
| [docs/api.md](docs/api.md) | Full endpoint map and conventions |
| [docs/booking-engine.md](docs/booking-engine.md) | Booking/payment/refund flow and safety mechanisms |
| [docs/ai.md](docs/ai.md) | AI assistant grounding and recommendations |
| [docs/security.md](docs/security.md) | Security controls and posture |
| [docs/google-oauth.md](docs/google-oauth.md) | Google sign-in (OAuth 2.0): flow, linking policy, setup |
| [docs/deployment.md](docs/deployment.md) | Environments, CI, production checklist |
| [docs/architecture-decisions.md](docs/architecture-decisions.md) | ADR log |

## Learn this project

Start with the [interview learning guide](docs/interview-preparation/README.md), [visual gallery](docs/interview-preparation/visual-gallery.md) or the downloadable [interactive atlas](docs/interview-preparation/index.html). The pack includes technology alternatives, a beginner-to-advanced roadmap, 38 CodeTour source stops and an [AI teaching handoff](docs/interview-preparation/AI-HANDOFF.md).

## License

Private project — all rights reserved.
