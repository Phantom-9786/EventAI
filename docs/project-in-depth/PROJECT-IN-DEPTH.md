# EventPoint — Project In Depth

Prepared 22 October 2026 from the current source tree. This is a learning pack, not an application change.

## Read in this order

1. [Technology map and trade-offs](01-stack-and-tradeoffs.md)
2. [Learning roadmap and interview priorities](02-roadmap-and-questions.md)
3. [Architecture and request flows](03-architecture-and-flows.md)
4. [Code visualization tools](04-visualization-tools.md)
5. [Generated API import map](generated-api-map.md)
6. [RAG, MiniLM and the generation model explained](05-rag-and-minilm-explained.md)

This document lives separately under `docs/project-in-depth/`. The repository's main `README.md` remains the project introduction and is not replaced by this guide.

## The project in one sentence

EventPoint is an event discovery and booking platform with attendee, organizer and administrator workflows, server-controlled ticket inventory and payments, and a conversational assistant that combines Groq generation with structured and semantic retrieval.

## A 60-second explanation to practise

“I worked on EventPoint, an event discovery and ticket-booking platform. The frontend is Next.js and React, while the backend is an Express modular monolith written in TypeScript. PostgreSQL stores the business data through Prisma, with transactions and conditional inventory updates protecting reservations. The payment integration verifies Razorpay responses and webhooks on the server and handles retries with idempotent state transitions. The assistant uses Groq with selected event evidence, structured filters and local sentence embeddings. Redis accelerates selected reads but is not the source of truth. The frontend is hosted on Vercel and the API on Render.”

Adapt “I worked on” to your actual contribution. Be ready to explain code you present and acknowledge AI-assisted development when asked. Do not claim performance measurements or real customer sales that were not measured.

## Important corrections to older documents

Some earlier planning documents describe intended architecture. For interviews, follow current code:

| Topic | What to say now |
|---|---|
| Backend framework | Express; compatibility decorators/helpers are not evidence of an active NestJS server. |
| Architecture | Modular monolith API, separate Next.js frontend; not a deployed fleet of microservices. |
| Semantic storage | PostgreSQL `double precision[]` arrays; not Pinecone and not the pgvector extension. |
| Embedding model | Local Transformers.js `Xenova/all-MiniLM-L6-v2`, 384 dimensions, q8. |
| Background work | In-process SchedulerManager runs booking expiration and Cloudinary usage monitoring. |
| BullMQ | Worker skeleton exists, but its processor registry is empty. Do not claim it sends production emails or processes payments. |
| Real-time updates | Do not claim an implemented Socket.IO architecture from the older ADR. Current interfaces use HTTP, refresh and polling where implemented. |
| Email | Brevo HTTP email integration; earlier Resend planning is historical. |
| Tests | CI has substantive API tests and PostgreSQL integration checks. Web/worker test scripts are placeholders; Playwright being installed does not mean there is complete frontend E2E coverage. |
| Demo catalog | Showcase events, illustrative stock photographs and simulated showcase bookings are not confirmed public events or actual customer payments. The Razorpay integration and showcase data are separate concepts. |

## Learning rule

For each feature, explain: **user action → request → validation → authorization → business rule → database change → response → failure/retry behavior**.

Do not memorize a library list without tracing at least one real request through the code.
