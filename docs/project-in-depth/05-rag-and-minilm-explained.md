# RAG, MiniLM and the model that writes the answer

## The short answer

EventPoint implements RAG. MiniLM is the small sentence-embedding encoder used in retrieval. It is not the model that writes the assistant's answers. Generation is handled separately by the language model called through Groq.

RAG is a system pattern: **retrieve relevant information → add that information to the model's context → generate an answer**. It is not a model size, a product tier, or a requirement to use one particular vector database.

## Separate the roles

| Component | Receives | Produces | Purpose |
|---|---|---|---|
| MiniLM sentence encoder | A query, event description or selected passage | A 384-dimensional numeric embedding | Compare meaning and retrieve relevant information |
| PostgreSQL and retrieval logic | Filters, embeddings, public event facts and passages | Ranked event matches / selected evidence | Find usable information and enforce business constraints |
| Generative model accessed through Groq | User message, bounded history, instructions, selected readable evidence and tool results | Assistant response and structured tool calls | Conversation, interpretation and answer generation |

Groq is the inference provider; it is not itself the embedding model or the RAG system. The generation model IDs are configurable in `model-router.ts`; do not assume “Groq” names one specific language model.

## Why use MiniLM for retrieval?

1. **It is designed for sentence similarity and semantic search.** An embedding encoder is the appropriate component for turning text into comparable vectors. Using a large chat model is not a required replacement for that component.
2. **It can run locally in the current Node.js service.** The implementation uses Transformers.js and ONNX on CPU, avoiding a separate embedding API request. Local inference still costs CPU, memory and startup time.
3. **Its vectors are compact enough for the current exact-scan approach.** The application stores 384-dimensional event vectors in PostgreSQL arrays without an additional vector service.
4. **It is a practical initial trade-off for this catalog.** This does not establish that it is the best-performing encoder for our queries: that would require a representative retrieval evaluation.

The `Mini` name reflects a compact model family; it does not classify the entire assistant as a miniature or incomplete RAG system. In this implementation, q8 is a separate quantization setting used for the local model. Quantization can reduce resource requirements and can affect quality; it is not a different definition of RAG.

## A concrete example

User: “I want a quiet acoustic evening in Delhi, under ₹1,000.”

1. Semantic retrieval can connect “quiet acoustic evening” with relevant descriptions even when the exact same words do not occur.
2. SQL enforces the applicable published-status, city, date, budget and availability constraints on the search results.
3. Selected event facts/passages and relevant tool results are supplied as text to the generation model.
4. The assistant can explain the matches and show event cards.

The vectors help choose evidence. The numeric arrays are not a substitute for the readable text that the generation model needs.

## Why not send the entire database to a large model?

That is an alternative context-loading strategy, not a more complete definition of RAG. Sending everything can increase prompt size, latency and cost, introduce irrelevant information, and eventually exceed context limits. It also does not replace database checks for current availability or permissions.

For a tiny data set, giving a model a short complete context can sometimes be simple and sufficient. Retrieval becomes useful when it selects the relevant subset. Its quality still needs evaluation: RAG does not guarantee correct evidence or a correct final answer.

## What makes our implementation lightweight?

- Event vectors use exact similarity scoring in ordinary PostgreSQL arrays, not an approximate-nearest-neighbor index.
- Passage retrieval uses a bounded authorized evidence set, lexical candidate selection, semantic scoring and reciprocal rank fusion. It does not perform exhaustive dense retrieval over every passage in the catalog.
- The local encoder is compact and includes keyword fallback if semantic processing is unavailable.

These are scale and resource choices inside a working RAG pipeline. “Lightweight” does not mean fake. Equally, “RAG implemented” does not mean it includes every possible production capability.

## When would we choose something larger or more advanced?

| Observed issue | Candidate change | What to measure first |
|---|---|---|
| Relevant events are missed, especially multilingual or subtle queries | Evaluate a stronger multilingual embedding model or hosted encoder | Recall of relevant results, ranking quality, language coverage, latency and cost |
| Exact vector scans become slow as the corpus grows | Evaluate pgvector with an appropriate ANN index, or a dedicated vector service | Catalog size, query concurrency, filtered-search behavior and recall/latency trade-offs |
| Correct evidence is retrieved but the answer is wrong | Improve grounding/instructions, evaluate the generation model and consider output checks | Evidence relevance separately from answer faithfulness |
| Policies or event facts change and stale results appear | Strengthen freshness/invalidation and evaluate re-indexing workflows | Stale-evidence rate and time to reflect updates |

Changing only the embedding model will not automatically repair a conversation-state bug, provider failure or incorrect SQL filter. Diagnose the failing stage first.

## Interview wording

“EventPoint uses hybrid RAG. A local MiniLM sentence encoder supports semantic retrieval, and PostgreSQL stores event vectors and business facts. Selected text evidence is passed to a generative model through Groq. Structured database queries enforce constraints such as date, budget and availability. Our current vector search uses exact scans, which is a deliberate small-catalog trade-off rather than a large-scale indexed vector architecture.”

## Source references

- [Semantic retrieval implementation](../../apps/api/src/modules/ai/semantic-retrieval.service.ts)
- [Evidence chunking, lexical retrieval and context budgeting](../../apps/api/src/modules/ai/retrieval-context.ts)
- [AI orchestration](../../apps/api/src/modules/ai/ai.service.ts)
- [Generation model routing](../../apps/api/src/modules/ai/model-router.ts)
- [Official sentence-transformers model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [Transformers.js-compatible ONNX model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
