# Roadmap: beginner to advanced

The priorities below are an assessment for explaining this full-stack project in interviews, not a measured ranking of question frequency across employers. Difficulty: 1 = introductory; 5 = advanced. Learn the foundations first even when an advanced topic has higher interview value.

## Learning sequence and checkpoints

| Stage | Learn | Trace in this project | You are ready when… |
|---|---|---|---|
| 1. Product | Attendee, organizer, admin; problem and boundaries | Discover → event → tickets; organizer creation/review | You can explain the product in 60 seconds without naming every library. |
| 2. Web basics | HTTP, JSON, promises, async/await, browser/server, cookies | frontend API client → Express route | You can explain what happens after clicking an event and where a network failure appears. |
| 3. React/Next | Props, state, effects, server/client components, routing, loading states | event page and EventCard; booking widget | You can distinguish rendering on the server from browser interaction and explain the repeated-prompt navigation bug. |
| 4. Backend | Routes, middleware, controllers, services, validation and errors | Express app and a single events route | You can draw one request through each layer and explain why frontend validation is insufficient. |
| 5. Database | Keys, relationships, joins, indexes, migrations and transactions | User → Organizer → Event → TicketType; Booking → Payment/Ticket | You can draw the core ER relationships and explain why one ticket type can issue many tickets. |
| 6. Security | Password hashing, JWTs, refresh rotation, OAuth, RBAC and ownership | auth service and middleware | You can distinguish authentication, authorization, hashing and encryption. |
| 7. Booking/payment | Server pricing, reservations, conditional updates, idempotency and webhooks | BookingsService → PaymentsService → issued tickets | You can reason through two users buying the last ticket and a duplicated payment callback. |
| 8. Search/performance | Pagination, indexes, cache TTL/invalidation and cold starts | EventsService and CacheService | You can explain why cache can improve a read but cannot safely replace authoritative inventory. |
| 9. AI/RAG | Prompt/history budget, embeddings, BM25, similarity, evidence and tool filters | AiService → semantic retrieval → SQL | You can explain why retrieved text, not embedding arrays, goes into the LLM prompt. |
| 10. Reliability | Timeouts, retries, degraded mode, process restarts, background jobs | scheduler, provider failures and expiry | You can explain what happens when Redis, Groq or a payment callback is unavailable. |
| 11. Delivery | CI, unit/integration tests, environments, DNS/HTTPS and deployment | GitHub Actions and deployment boundaries | You can interpret a failed CI step without assuming the entire website is down. |
| 12. Advanced design | Scaling, measurement, queues, ANN indexes and observability | Discuss changes without claiming they are already implemented | You can explain which bottleneck you would measure before adding infrastructure. |

## Interview topic ranking

| Priority | Topic | Difficulty | Example questions to practise |
|---|---|---:|---|
| P0: essential | End-to-end architecture | 2/5 | What problem does EventPoint solve? Trace one complete request. Why a modular monolith? |
| P0: essential | JavaScript/TypeScript and asynchronous code | 2/5 | How do promises differ from callbacks? Does a TypeScript interface validate a request? |
| P0: essential | React and Next.js boundaries | 3/5 | When does useEffect run? Why is the booking widget a client component? How do server pages call the API? |
| P0: essential | SQL model, keys and indexes | 3/5 | Why PostgreSQL? Which relationships are one-to-many? Which index helps a particular query? |
| P0: essential | Auth and authorization | 4/5 | What if a token is stolen? How do refresh rotation and logout work? Can one organizer edit another's event? |
| P0: differentiator | Concurrent booking and idempotency | 5/5 | Two users buy the final ticket: what protects stock? What does retrying the same booking key do? |
| P0: differentiator | Payment verification and webhooks | 5/5 | Why not trust checkout success? Why verify the raw webhook body? What if payment arrives after expiry? |
| P0: differentiator | RAG and reliable AI | 5/5 | RAG vs fine-tuning? Why hybrid retrieval? How do you enforce budget/date/stock rather than trusting prose? |
| P1: strong | REST, middleware and runtime validation | 2/5 | What belongs in a controller vs service? Which status code should an unauthorized request return? |
| P1: strong | Pagination and search | 3/5 | Why not load 200 events at once? Offset vs cursor pagination? Why FTS instead of Elasticsearch here? |
| P1: strong | Redis and cache consistency | 4/5 | What is cache-aside? How do stale prices happen? What if Redis is down? |
| P1: strong | Unit, integration and end-to-end testing | 3/5 | What does a mocked test miss? Why test against PostgreSQL? What did the CI failure actually mean? |
| P1: strong | Deployment and performance diagnosis | 3/5 | Distinguish slow DB queries, cold starts and a blocked UI. Where does DNS fit? |
| P1: strong | Error handling and observability | 3/5 | What gets retried? How do request IDs help? What must not be logged? |
| P2: deeper | RAG ranking mathematics | 5/5 | Why normalize vectors? Explain dot product/cosine, BM25 and reciprocal rank fusion. What is the candidate-retrieval limitation? |
| P2: deeper | Background jobs and scale-out | 5/5 | What happens if the API sleeps? Does a local overlap guard coordinate multiple instances? When would BullMQ be justified? |
| P2: deeper | Vector-index and search evolution | 5/5 | When would exact scans become unsuitable? What trade-off does approximate nearest-neighbor search introduce? |

## Five scenarios to master

1. **Last ticket race:** identify the guarded database update, transaction boundary and losing request's error. Explain rollback.
2. **Repeated payment message:** identify signature verification, current state checks and protection against duplicate ticket creation. Do not promise exactly-once network delivery.
3. **Assistant says “thanks” incorrectly:** explain conversation intent, bounded history and retrieval relevance. An LLM integration is not automatically a correct conversation system.
4. **Paid event shows From ₹0:** related-event API omitted price fields; the formatter converted missing data to zero. Explain the corrected contract and “unknown ≠ free.”
5. **CI goes red:** identify the failing step and exact assertion. Explain why one failure stops the combined pipeline, and why passing local type checks did not prove the test suite passed.

## How to answer “why not X?”

Use this structure: **our requirement → chosen approach → alternative's strengths → why extra complexity was unnecessary here → when I would reconsider**.

Example: “Bookings relate users, ticket inventory, payment states and issued tickets. PostgreSQL gives us relationships and transactional updates in one place. MongoDB could support transactions too, but it did not simplify our relational access pattern. I'd reconsider the storage model for a different workload, not because SQL is always better.”

## Readiness exercise

For each stage, write a 30-second answer, draw a small flow, open the relevant source, and describe one failure case. Then answer the same question without looking at the code. Treat unexplained library names as unfinished topics.
