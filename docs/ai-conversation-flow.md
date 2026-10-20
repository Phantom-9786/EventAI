# EventPoint conversation flow

The chat uses Groq for ordinary conversation as well as discovery. Greetings and
thanks are not implemented as a list of fixed application replies.

## Request context

- The web client sends the last 12 messages, preserving the user's wording.
- Assistant messages include up to six displayed event slugs. The API re-reads
  published, upcoming events and attaches their facts in the displayed order.
  Browser-supplied titles, prices and descriptions are not treated as facts.
- The most recent search filters are stored with the assistant message in the
  existing session transcript and sent as `discoveryContext`. This retains
  preferences when the original request falls outside the message window.
- Context is advisory: the latest request decides whether to reuse, change, or
  clear it. New searches must not inherit unrelated old moods.

## Interpretation and retrieval

`conversation-policy.ts` defines the model contract and examples. Groq chooses
`answer`, `clarify`, or `search`. The response and search filter shapes are
validated. Invalid structured output gets one bounded repair attempt.

- Answers and clarification questions are returned without a database search.
- Search filters use structured city/date/category/price constraints; a model
  supplied English `semanticQuery` activates the existing hybrid retrieval.
  This path does not require a keyword such as "calm" in the original message.
- Missing city, dates or budget do not block retrieval. Clarification is useful
  for genuinely ambiguous preferences, rather than a mandatory questionnaire.
- Search results are fetched live, then sent back to Groq for the final wording.
  Event cards and counts always come from the server's search, never the model.

The older reply/search/slugs and trailer parser remains compatible with legacy
provider responses. The new intent contract takes precedence over its keyword
recovery rules, so an explicit model clarification is not forced into a search.

## Limits and failure behavior

Normal conversation uses one model completion. Successful discovery generally
uses two: interpretation and a response grounded in retrieved events. Both share
the existing 40-second request budget, bounded attempts, credential cooldowns and
provider rate-limit handling. The final wording call has an eight-second timeout.
If it fails, already retrieved event cards and accurate counts are returned with
a factual fallback reply. Keyword fallback is identified as such.

The policy does not guarantee perfect model behavior. It does not provide an
unlimited transcript: only the recent messages, recent displayed cards, and last
search filters are retained. Session reset clears this context. Semantic
similarity is not proof of seating, stock, amenities, or safety.
