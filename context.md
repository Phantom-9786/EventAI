# Project Context

## Project Overview

**EventAI** — Discover. Book. Experience.

AI-powered Event Discovery and Ticket Booking Platform built as a modular monolith with Turborepo.

## Current Architecture

Modular monolith using Turborepo monorepo with three apps:
- `apps/web` — Next.js frontend
- `apps/api` — NestJS backend API
- `apps/worker` — BullMQ background worker

Shared packages:
- `packages/database` — Prisma ORM + schema
- `packages/types` — Shared TypeScript types
- `packages/validation` — Zod validation schemas
- `packages/config` — Shared configuration (ESLint, TypeScript)

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | NestJS, TypeScript, REST APIs |
| Database | PostgreSQL, Prisma ORM |
| Cache | Redis |
| Background Jobs | BullMQ + Redis |
| Real-Time | Socket.IO |
| Payments | Razorpay (Sandbox) |
| Maps | Leaflet + OpenStreetMap |
| Search | PostgreSQL Full-Text Search |
| AI/LLM | Grok/xAI (via provider abstraction) |
| Vector DB | Pinecone |
| Email | Resend |
| Containers | Docker + Docker Compose |
| Monorepo | Turborepo |
| CI/CD | GitHub Actions |

## Repository Structure

```
eventai/ (e:\BTech-Project)
├── apps/
│   ├── web/          — Next.js frontend
│   ├── api/          — NestJS backend
│   └── worker/       — BullMQ worker
├── packages/
│   ├── database/     — Prisma schema + client
│   ├── types/        — Shared TypeScript types
│   ├── validation/   — Zod schemas
│   └── config/       — Shared ESLint/TS config
├── docs/             — Architecture documentation
├── docker/           — Dockerfiles
├── scripts/          — Utility scripts
├── .github/workflows — CI/CD
├── context.md
├── implementation.md
├── docker-compose.yml
├── turbo.json
└── README.md
```

## Implemented Features

- None yet — project initialization in progress

## Current Database Schema

Not yet created.

## Authentication

Not yet implemented.

## Booking Architecture

Not yet implemented.

## Payment Architecture

Not yet implemented.

## Real-Time Architecture

Not yet implemented.

## Redis Usage

Not yet configured.

## Background Jobs

Not yet configured.

## AI Architecture

Not yet implemented.

## RAG Architecture

Not yet implemented.

## Security Architecture

Not yet implemented.

## Current Environment Configuration

`.env.example` not yet created.

## Testing Status

Not yet configured.

## Deployment Status

Not yet configured.

## Known Issues

None — project not yet started.

## Current Limitations

Project is at initial state.

## Important Architecture Decisions

See `docs/architecture-decisions.md`.

## Current Phase

Phase 1 — Foundation (NOT STARTED)

## Current Task

Repository initialization and monorepo setup.

## Next Task

Create Turborepo monorepo structure.

## Last Completed Checkpoint

None
