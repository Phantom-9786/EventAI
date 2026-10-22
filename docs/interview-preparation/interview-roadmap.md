# Interview roadmap: foundations to advanced

Assumption: preparation for a junior/full-stack role using JavaScript/TypeScript. Priority is a reasoned study recommendation based on this project's core flows, **not a measured ranking of interview frequency**. Employers and roles vary.

- **P0:** be able to explain and trace this without notes.
- **P1:** understand the design and at least one failure case.
- **P2:** understand the purpose, boundaries and a reasonable alternative.
- Difficulty is the depth of explanation, not how important the topic is.

## Ranked topics

| Learning order | Topic | Difficulty | Priority | Questions to practise |
|---|---|---|---|---|
| 1 | Product and architecture | Foundation | P0 | Who are the three user roles? Trace one click from browser to database and back. |
| 2 | JavaScript/TypeScript | Foundation | P0 | Promises, async/await, closures, objects and arrays; why doesn't a TS interface validate JSON? |
| 3 | HTTP and REST | Foundation | P0 | Methods, status codes, request/response bodies, middleware, validation and error handling? |
| 4 | React state and effects | Foundation–intermediate | P0 | State vs props; controlled inputs; effect dependencies; cleanup; why can navigation replay an initial prompt? |
| 5 | Next.js server/client boundaries | Intermediate | P0 | Why is the homepage a server component while the chat composer needs client state? What can run in each? |
| 6 | Node.js concurrency | Intermediate | P0 | How does async I/O differ from parallel CPU work? Why can local embedding inference affect latency? |
| 7 | Relational schema and SQL | Intermediate | P0 | Why BookingItem? Which relationships are one-to-many? What do unique constraints and indexes protect? |
| 8 | Authentication and authorization | Intermediate | P0 | JWT vs session; password hashing vs encryption; refresh rotation; ownership checks; cookie and local-storage tradeoffs? |
| 9 | Search and pagination | Intermediate | P1 | Why server pagination? Stable sorting? FTS vs substring search? Offset vs cursor pagination? |
| 10 | Cache and freshness | Intermediate | P1 | Cache-aside, TTL and invalidation? What remains correct if Redis fails? What is intentionally rejected? |
| 11 | Booking race conditions | Advanced | P0 | Two people buy the final ticket: why does a conditional update matter? What rolls back on partial failure? |
| 12 | Idempotency and expiry | Advanced | P0 | Duplicate booking clicks? Reused keys across users? Expiry and confirmation arriving together? |
| 13 | Payments and webhooks | Advanced | P0 | Why not trust browser success? What do signatures protect? How do duplicate, delayed or out-of-order events behave? |
| 14 | RAG and embeddings | Intermediate–advanced | P0 | What is retrieved? Why send text rather than vectors to generation? Keyword vs semantic search? Why not send all events? |
| 15 | AI reliability and evaluation | Advanced | P0 | Hard filters, unsupported claims, clarification, language, retries, prompt injection, budgets and stale evidence? |
| 16 | CI and deployment | Intermediate | P1 | Why can one failed test fail the run? CI vs deployment? Where are environment variables read? How would you roll back? |
| 17 | Security and observability | Advanced | P1 | CORS vs authorization, XSS/CSRF, rate limits, logging sensitive data, request IDs and diagnosing latency? |
| 18 | Scaling and architecture alternatives | Advanced | P1 | When split services? When use pgvector/indexing? Why would a durable queue help? What breaks with several API instances? |
| 19 | Styling, accessibility and media | Foundation–intermediate | P2 | Responsive layouts, keyboard focus, chart interactions, image aspect ratios, upload ownership and loading states? |
| 20 | Provider operations and domain setup | Intermediate | P2 | DNS vs application hosting, TLS, API origin, email sender authentication and third-party outages? |

## A 15-session study route

These are study sessions, not a promise that the same amount of time works for everyone. Progress when you can answer the checkpoint.

| Session | Focus | Checkpoint |
|---|---|---|
| 1 | Product, repository and architecture | Give a 60-second introduction and draw the main services. |
| 2 | JavaScript/TypeScript foundations | Explain async/await and identify compile-time vs runtime validation. |
| 3 | React and Next.js | Trace data loading, client state and one effect cleanup. |
| 4 | REST, Express and middleware | Follow the browsing CodeTour and explain one failed request. |
| 5 | Schema, relations, queries and indexes | Draw the booking schema and explain its constraints. |
| 6 | Authentication | Trace login, refresh, logout and an unauthorized organizer operation. |
| 7 | Inventory transactions | Explain the final-ticket race using a timeline of two requests. |
| 8 | Idempotency, cancellation and expiry | Handle a duplicate click and expiry/confirmation competition. |
| 9 | Payment confirmation and refunds | Draw webhook/callback ordering and a late capture. |
| 10 | Cache, pagination and performance | Explain stale reads, stable pages, cold starts and SQL round trips separately. |
| 11 | AI interpretation and memory | Distinguish greetings, preferences, follow-ups and event-specific questions. |
| 12 | Retrieval and embeddings | Trace structured search, semantic search and passage retrieval. |
| 13 | AI failure cases | Explain how to measure relevance, factuality, valid references, latency and fallback behaviour. |
| 14 | CI, deployment, security and monitoring | Diagnose a failed CI step and describe safe troubleshooting. |
| 15 | Mock interview and architecture defence | Explain the project, then defend three choices and three limitations. |

## High-value questions with answer outlines

### “How do you prevent overselling?”

Explain the pending reservation and transaction. The stock decrement includes an availability condition. Inspect the affected-row count, reject if it cannot reserve, and roll back related changes. Explain why checking inventory earlier in application code is not sufficient. Mention idempotency and guarded inventory release as separate protections.

### “What if Razorpay says paid but the browser closes?”

The server must use verified provider information; a browser callback is not the sole authority. Explain the signed webhook path, the stored booking/order relationship, verification of payment facts and idempotent confirmation. Then discuss late capture and refund handling rather than assuming all callbacks arrive on time.

### “Why PostgreSQL rather than MongoDB?”

Relational data, constraints, transactional inventory, joins and built-in search fit the current design. MongoDB is capable of transactions, but document modelling would change the relationship/query design. Acknowledge MySQL as another reasonable relational choice.

### “Is your AI just a prompt around an LLM?”

Describe orchestration: bounded conversation, intent and preference interpretation, validated business filters, live event retrieval, local embeddings when useful, passage retrieval for facts, grounding and output/reference validation. Not all messages should launch event search. Give one concrete example and point to the corresponding source.

### “Does RAG send only vectors to Groq?”

No. Vectors help identify relevant records/passages. Retrieved text and structured event facts provide useful context to the language model. RAG may reduce irrelevant prompt content but adds retrieval work and does not remove model/provider limits or guarantee correct answers.

### “Why does your notification count use polling?”

For the current admin UI, one shared aggregate request and periodic refresh keep implementation small. Explain the refresh after actions, hidden zero badges and stale-read behaviour. SSE or WebSockets would be alternatives if push requirements justify persistent connection infrastructure. Do not say Socket.IO is already running.

### “How would this scale?”

Start with measurement: p95 request latency, query plans, contention, connection use, error rates, embedding CPU, provider limits and cache hit rate. Discuss proper indexed retrieval, durable job processing and shared coordination only in response to identified pressure. Microservices alone do not fix a slow SQL query.

## Practice rubric

For every P0 topic, check:

- [ ] Explain the user problem in plain language.
- [ ] Name the relevant files without searching randomly.
- [ ] Describe the normal flow and one failure flow.
- [ ] Identify the source of truth and the invariant.
- [ ] Explain an alternative fairly.
- [ ] State what is implemented, configured, demonstrated or only scaffolded.

Do not memorise sample answers word for word. Use the diagrams as prompts, close the guide, and redraw the flow yourself.
