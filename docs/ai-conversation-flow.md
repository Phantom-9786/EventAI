# EventPoint conversation flow

The chat uses Groq for ordinary conversation as well as discovery. Greetings and
thanks are not implemented as a list of fixed application replies.

## Request context

- The web client sends up to 12 messages. The API sends the most recent six
  messages to Groq, capped at 6,000 characters, preserving the complete current
  message (up to the existing 2,000-character input limit).
- Assistant messages include up to six displayed event slugs. The API re-reads
  published, upcoming events and supplies compact metadata in the displayed order.
  Browser-supplied titles, prices and descriptions are not treated as facts.
- The most recent search filters are stored with the assistant message in the
  existing session transcript and sent as `discoveryContext`. This retains
  preferences when the original request falls outside the message window.
- Context is advisory: the latest request decides whether to reuse, change, or
  clear it. New searches must not inherit unrelated old moods.
- The previous two event-card groups travel separately from the transcript
  window, preserving positions even if a card is no longer available.
- Groq updates an at-most-800-character preference summary in its normal
  interpretation response. It is saved in the existing browser session transcript,
  not a cross-user database or vector index. No extra summarization call is made.
- Interpretation receives active category names/slugs, not an event catalog
  sample or complete event descriptions. Live details are retrieved only when
  required. Static instructions precede dynamic session data for prefix caching.

## Interpretation and retrieval

`conversation-policy.ts` defines the model contract and examples. Groq chooses
`answer`, `clarify`, `search`, or `details`. The response and search filter shapes are
validated. Invalid structured output gets one bounded repair attempt.

- Answers and clarification questions are returned without a database search.
- Search filters use structured city/date/category/price constraints; a model
  supplied English `semanticQuery` activates the existing hybrid retrieval.
  This path does not require a keyword such as "calm" in the original message.
- Missing city, dates or budget do not block retrieval. Clarification is useful
  for genuinely ambiguous preferences, rather than a mandatory questionnaire.
- Search results are fetched live, then sent back to Groq for the final wording.
  Event cards and counts always come from the server's search, never the model.
- Detail questions resolve references into a self-contained English evidence
  query and current/displayed slugs. The server rejects unknown slugs, loads live
  published event data and chunks descriptions, policies and FAQs into overlapping
  passages. Every passage retains its event title and section.
- Passage retrieval uses BM25 lexical scores and local MiniLM embeddings, combined
  with reciprocal rank fusion. At most 16 candidates are embedded/ranked; at most
  six passages are sent to Groq. A 512-entry content-hash cache reuses passage/query
  vectors and naturally invalidates edited text. No external embedding API is used.
  A three-second encoder deadline returns lexical evidence during a cold start;
  the bounded background work can still warm the vector cache.
- Ticket prices, stock and booking limits are read live rather than embedded.
  Passage answers distinguish incomplete evidence from a confirmed absence.

The older reply/search/slugs and trailer parser remains compatible with legacy
provider responses. The new intent contract takes precedence over its keyword
recovery rules, so an explicit model clarification is not forced into a search.

## Limits and failure behavior

Normal conversation uses one model completion. Discovery or detail retrieval generally
uses two: interpretation and a response grounded in retrieved events/passages. Both share
the existing 40-second request budget, bounded attempts, credential cooldowns and
provider rate-limit handling. The final wording call has an eight-second timeout.
If it fails, already retrieved event cards and accurate counts are returned with
a factual fallback reply. For detail retrieval, selected source excerpts are
returned instead of discarding the evidence. Discovery keyword fallback is identified.

Logs record prompt/output/cached token counts reported by Groq, along with context
character counts. They do not log user messages or event passages. Groq caching is
automatic for supported models, not guaranteed; this does not increase account quotas
or remove request-per-minute limits.

The policy does not guarantee perfect model behavior. It does not provide an
unlimited transcript: only recent messages, recent displayed cards, last search
filters and the compact model summary are sent. Summaries can omit details;
recent corrections take priority. Session reset clears this context. Semantic
similarity is not proof of seating, stock, amenities, or safety.

## Design references

- [Microsoft: conversational RAG prompts and context budgets](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-prompt-engineering)
- [Anthropic: contextual chunks, lexical/vector retrieval and rank fusion](https://www.anthropic.com/research/contextual-retrieval)
- [Groq: static prefix layout and cached-token usage](https://console.groq.com/docs/prompt-caching)

This implementation uses deterministic event/section labels for passage context;
it does not run Anthropic's separate model-generated contextualization process.
