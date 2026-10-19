# Mood-based hybrid semantic RAG — phase three

## Scope
Mood/vibe requests use pretrained semantic retrieval alongside existing structured filters. Ordinary category/city/date/price searches stay on the existing path. Groq still interprets conversation and selects filters; existing model routing and Redis request limits remain active. No phase-four reset was performed.

## Flow
1. Detect experiential intent such as peaceful, intimate, romantic, chill, aaram or sukoon.
2. Retrieve related public event facts using sentence embeddings before generation and add concise facts to the Groq prompt.
3. Groq returns positive English semanticQuery plus dates, city, price ceiling, party size and excluded activities.
4. Validate the filter; enforce dates, price, availability and group limits in SQL. Score current published event embeddings using cosine similarity (normalized dot product), with a minimum similarity of 0.28.
5. Rank relevance in 0.05-wide buckets, then confirmed paid admissions and earlier-created listings.
6. Return at most six cards. More related events carries the same semantic and structured filter to paginated Discover.

## Embeddings and storage
The encoder is Xenova/all-MiniLM-L6-v2, quantized q8, 384 dimensions, using Transformers.js 3.8.1 and ONNX Runtime on CPU. No event or user text is sent to an embedding API. The public model is downloaded from Hugging Face and cached on the server. Groq continues to receive the conversational prompt and selected public event facts as before.
Vectors live in event_semantic_embeddings, a PostgreSQL table with double-precision arrays, source timestamps, model IDs and content hashes. No separate vector service or pgvector extension is required for the current small catalog. Exact similarity scanning is intentional for phase three; a larger catalog should move scoring to an indexed pgvector/hybrid retrieval plan after measurement. This is real pretrained embedding retrieval, not a mood-keyword lookup table.

## Freshness and fallback
On semantic searches, index missing/changed future published events in batches of four. Hash and source_updated_at checks prevent stale vectors from being used after edits. Current status/date/stock constraints apply during retrieval. Event deletion cascades to its vector row. Query vectors have a bounded 100-entry in-process cache.
The API warms the encoder asynchronously. A cold model download or index taking more than ten seconds produces an explicit keyword-fallback message, preserving hard filters; it is never labelled a successful semantic result. Regular searches and factual pass-tier answers do not need semantic inference.

## Deployment
Apply 20261020010000_semantic_event_embeddings with the normal Prisma migrate deploy release step. SEMANTIC_RAG_ENABLED defaults to enabled; set false to disable semantic inference. SEMANTIC_MODEL_CACHE_DIR optionally selects a writable model cache. The API Dockerfile uses Debian/glibc for native ONNX compatibility and a writable cache owned by its non-root user. Render native Node supports this runtime. The Docker image was updated but not built in this task.

## Requested live fixtures
Ten published Phase 3 Preview listings were copied/adapted from the original local catalog under the existing verified organizer attached to tarunkumarsahu2551@gmail.com. Five categories have two previews each: Music, Technology, Arts & Theatre, Food & Drink, Health & Wellness. Existing users/events/bookings were preserved. These are explicitly marked testing previews. Existing image URLs were reused; no Cloudinary uploads or fabricated paid bookings. The private backup and created-ID manifest remain outside Git.
The repeatable provisioning script defaults to read-only preview: node scripts/publish-phase3-preview-events.cjs. Only --apply writes; it validates the named account and target, takes a backup, writes an atomic set of missing fixtures and leaves existing matching slugs untouched.

## Verification
- Real local encoder produced finite normalized 384-dimensional vectors.
- Local index: 40 future published events embedded.
- Production index backfill: 11 future published events embedded (10 new previews plus the existing upcoming listing).
- Local semantic search for a peaceful intimate acoustic evening returned acoustic/listening experiences; ordinary Music remained structured retrieval with 14 matches.
- Live local Groq group request (five friends, total INR 5000, November, seated/chatting, no dance) returned six cards from nine filtered matches, including a semanticQuery, partySize=5 and priceMax=100000 paise.
- Semantic and structured result counts match paginated Discover queries.
- 89 focused service/routing/Express tests passed; API build and web TypeScript checks passed.

## References
https://huggingface.co/docs/transformers.js/en/index
https://huggingface.co/Xenova/all-MiniLM-L6-v2
