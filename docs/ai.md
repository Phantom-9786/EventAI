# AI Layer

## Assistant

`POST /api/ai/chat` (public, rate-limited to 10 requests/min per IP on top of the global throttle) forwards a validated message history (≤12 turns) to Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1/chat/completions`, model from `GROQ_MODEL`, default `openai/gpt-oss-120b`, 30s timeout).

- **Grounding**: the system prompt injects the next 12 upcoming published events (title, city, category, from-price, link path) and instructs the model to recommend only catalog events — no hallucinated events, no user data leaves the system.
- **Configuration detection**: `isConfigured()` treats a missing key and the shipped `gsk_xxxx…` placeholder as unconfigured and returns **503** with an operator-actionable message instead of leaking an upstream error.
- **Errors**: upstream failures map to 503 with a stable message; the frontend (`/ai`) renders them inline.

## Recommendations

`GET /api/events/:idOrSlug/similar` ranks upcoming published events by content similarity: same-category first, then same-city, computed in Postgres (two-pronged `$transaction`) — no external vector store. The event detail page renders the top matches as "You might also like".

## Deliberate deferrals

- **Pinecone RAG**: needs `PINECONE_API_KEY` and a real embedding use case (FAQ/policy retrieval). Catalog grounding covers discovery today.
- **Tool calling / authenticated context**: the assistant is read-only discovery; booking-intent tools come after the catalog-grounded UX is validated.
- **Conversation persistence**: history is client-held; the `ai_conversations` table is schema-ready.
