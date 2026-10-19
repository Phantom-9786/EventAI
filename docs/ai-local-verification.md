# Local AI and UI verification — 19 October 2026

## Completed UI changes
- Primary navigation text is darker and semibold in light mode, with readable light text in dark mode. Hover changes text colour; the active section stays purple. No navigation hover containers were added.
- Category names and section headings have stronger contrast. Secondary text uses a darker grey in light mode.
- Signed-in attendee navigation has My Tickets, linking to /bookings. The link gains a purple container on hover or keyboard focus.

## Local storage and fixtures
The local launcher enforces localhost PostgreSQL (5433) and Redis (6379), and clears Cloudinary credentials. Added 30 published sample events to the local database, bringing the total to 40. Music has 14 events. Other added counts: Technology 7, Food & Drink 4, Arts & Theatre 3, Health & Wellness 2, Comedy 1, Business 1. Each sample has two active pass tiers. These fixtures created no paid bookings.
Sample covers are SVG files under apps/web/public/local-samples. No Neon database writes or Cloudinary uploads were made for these fixtures. Existing externally hosted image URLs may still load their images when a page displays them. Groq requests do consume the provider's AI quota; email service is enabled locally for recovery.

## AI behavior
Discovery conversations are sent to Groq, not xAI Grok. A deterministic local classifier selects openai/gpt-oss-20b for simple requests and openai/gpt-oss-120b for moderate/complex requests with current settings. Simple category searches and multi-constraint group requests have dedicated routing checks. This is rule-based routing, not another LLM classification call.
Groq returns JSON containing a reply, search filter, and optional catalog slugs. The backend validates the filter and searches the entire database. At most six cards are returned, with a More related events link that preserves the same filter in Discover. JSON mode follows https://console.groq.com/docs/structured-outputs.
Filters cover category, keywords, city, dates, per-person prices, group size and excluded activities. Known calm/no-dancing requests receive an additional constraint check so a missing mood field does not silently broaden them. This remains model-assisted filtering, not a guarantee of interpreting every possible prompt correctly.
Ranking uses valid/used admissions on confirmed bookings with captured nonzero payments. Earlier-created listings break ties. Wishlist counts are not used: current saved events are browser-local, not a server-wide popularity measure. Precise user distance is not available.
Event-specific pass questions read all active tiers directly from PostgreSQL and omit a generic event card. Those factual replies need no Groq generation. Main chat is retained in account-scoped tab sessionStorage; event popup chat is temporary.

## Rate limits and caching
Redis-backed AI guard: 10 requests per identity per minute, 120 global per minute, maximum 20 concurrent. Redis protection fails closed. Provider rate-limit responses create a shared cooldown rather than rotating keys to evade quota.
Public event detail is cached for 60 seconds and similar events for 120 seconds. AI replies are not cached. Redis also maintains provider cooldowns and rate-limit counters.

## Retrieval / RAG clarification
Database event facts are supplied as context and structured filters retrieve final results. This is database-grounded retrieval-augmented generation in the broad sense. There is no embedding pipeline, vector database, pgvector index, or semantic vector search.

## Technologies
- Web: Next.js 14, React 18, TypeScript, Tailwind CSS and project CSS, Lucide icons, React Markdown.
- API: Node.js, Express 4, TypeScript, Zod validation, Prisma 6.
- Data: PostgreSQL 16 with full-text search, Redis 7 through ioredis, Docker Compose for local services.
- AI: Groq Chat Completions, GPT-OSS 20B/120B, structured JSON output, local complexity routing.
- Auth: JWT access tokens, rotating refresh sessions, Argon2 password hashing; Google OAuth integration requires configuration.
- Integrations: Brevo email; Cloudinary media and Razorpay payments available in code but disabled in this local launcher; Leaflet/OpenStreetMap maps.
- Tooling: npm workspaces, Turborepo, Jest, Playwright, ESLint, TypeScript checks.

## Verification performed
- 58 focused unit/HTTP tests passed (42 AI service/router/guard tests and 16 Express AI tests).
- Web/API TypeScript checks and web lint passed.
- Live Groq greeting: 200, no event cards.
- Live all-events request: six cards, total 40; same Discover filter returned all 40.
- Live Music request: six cards, total 14; same Discover filter returned all 14.
- Live group request: five friends, total INR 5000, November 2026, calm/seated, no dance: six cards from eight matches; per-person price ceiling INR 1000 and party size 5 in the filter.
- Browser check: Music produces six cards and More related events (14); clicking opens Discover with 14 matches over two pages. Returning to the chat retains the conversation.
- A real Groq 429 was observed; provider cooldown blocked subsequent requests as intended. No attempt was made to evade it.

No deployment performed. This verifies representative scenarios, not every possible AI response or production integration.
