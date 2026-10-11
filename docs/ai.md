# AI Layer

## Assistant

The latest user turn is classified locally as simple, moderate, or complex. Simple questions use `GROQ_SIMPLE_MODEL` (default `openai/gpt-oss-20b`); comparisons and recommendations use `GROQ_MODERATE_MODEL`; complex plans use `GROQ_COMPLEX_MODEL`. The latter two default to legacy `GROQ_MODEL` (default `openai/gpt-oss-120b`). Model access depends on the Groq project, so IDs are configurable. Ambiguous prompts route to moderate without a second classifier call. Transient failures get one retry and at most one profile escalation. Existing catalog grounding and the `EVENTS:` trailer remain unchanged; the current provider has no remote tool-call or JSON-schema-output implementation.

AI traffic is protected by shared Redis-backed per-identity and global request windows and a concurrency lease. Verified JWT user IDs identify signed-in callers; anonymous callers use Express's resolved client IP, not the raw forwarded-for header. Defaults: 10 requests per identity/minute, 120 total/minute, 20 concurrent requests, a 30-second provider timeout, and 600 output tokens. The AI endpoint fails closed with 503 if Redis is unavailable.

`POST /api/ai/chat` uses the request bounds and shared Redis protection described above. Its existing catalog context and structured recommendation response remain active.

- **Grounding**: the system prompt injects the next 12 upcoming published events (title, city, category, from-price, link path) and instructs the model to recommend only catalog events — no hallucinated events, no user data leaves the system.
- **Configuration detection**: `isConfigured()` treats a missing key and the shipped `gsk_xxxx…` placeholder as unconfigured and returns **503** with an operator-actionable message instead of leaking an upstream error.
- **Errors**: upstream failures map to 503 with a stable message; the frontend (`/ai`) renders them inline.
- **Structured recommendations (2026-10-10)**: the model is instructed to append one final machine-readable line `EVENTS: <slug1>, <slug2>` (catalog slugs only). The backend strips the trailer from the prose, tolerates markdown decoration around it (`**EVENTS:**`), maps each slug to a **real, published, upcoming** catalog row (unknown/invented slugs are dropped — the model can never fabricate events, prices, or URLs), and returns `{ reply, events }` where `events` mirrors the web app's `EventSummary`. The `/ai` page renders the prose as safe Markdown (`react-markdown`; bold, lists, links — raw HTML is not rendered) and each event as the existing interactive `<EventCard showDescription />` (title, description, date, venue, price, image, organizer), linking to `/events/[slug]`. Replies with no recommendations are plain conversational Markdown with no cards.

## Multi-key management

The assistant supports multiple Groq API keys with bounded failover (implemented 2026-10-10):

- **Configuration**: `GROQ_API_KEYS=k1,k2,k3` (comma-separated; takes precedence) or the legacy single `GROQ_API_KEY`. Add future keys to this line — no code changes needed. Keys live only in the git-ignored `.env` files; they are never stored in the database, written to logs, or sent to the client.
- **Selection & failover**: on 401/403, that credential is cooled down for 30 minutes and another configured credential may be tried. This is authentication recovery; all credentials remain in one shared quota pool.
- **429 (rate limit)**: all configured credentials are treated as one shared quota pool. Groq `Retry-After` or reset headers are honored up to a 15-minute cooldown, shared through Redis across API instances; the keys are never rotated on 429.
- **Transient failures** (network errors, timeouts, 408/5xx): one retry and at most one escalation to a stronger profile; the call budget is strictly bounded.
- **Other 4xx** (bad request, unknown model): permanent for the request shape — no retry.
- **All keys exhausted**: 503 with `retryAfterSeconds` (time until the earliest key leaves cooldown).
- **Missing/placeholder keys**: the endpoint 503s with an operator-actionable message before any network call (unchanged graceful degradation).

### Adding another key securely

1. Create the key at [console.groq.com/keys](https://console.groq.com/keys).
2. Edit `apps/api/.env` (and the root `.env` if you keep a copy): set `GROQ_API_KEYS=<existing-key>,<new-key>` — or just `GROQ_API_KEY=<new-key>` for single-key setups. Keep `.env` git-ignored (it already is; verify with `git check-ignore apps/api/.env`).
3. Restart the API via the established PowerShell launcher (`%TEMP%\start-api-rzp.ps1`) so the new environment loads.
4. Never paste keys into chat, commits, the database, or issue trackers. If a key leaks, revoke it in the Groq console — the pool will automatically stop using it after the first 401/403.

## Recommendations

`GET /api/events/:idOrSlug/similar` ranks upcoming published events by content similarity: same-category first, then same-city, computed in Postgres (two-pronged `$transaction`) — no external vector store. The event detail page renders the top matches as "You might also like".

## Deliberate deferrals

- **Pinecone RAG**: needs `PINECONE_API_KEY` and a real embedding use case (FAQ/policy retrieval). Catalog grounding covers discovery today.
- **Tool calling / authenticated context**: the assistant is read-only discovery; booking-intent tools come after the catalog-grounded UX is validated.
- **Conversation persistence**: history is client-held; the `ai_conversations` table is schema-ready.
