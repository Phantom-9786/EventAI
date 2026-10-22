# EventPoint: interview preparation

Prepared from the source on 22 October 2026. This is a study guide, not a new feature plan or a production audit. No application behaviour is changed by these materials.

## Start here

**Visual starting point:** open [the interactive learning atlas](index.html) in a browser after downloading or cloning the repository. It works offline, without starting EventPoint. GitHub displays the source of HTML files; use [the visual gallery](visual-gallery.md) for diagrams directly on GitHub.

- [Beginner companion](beginner-companion.md): easy examples and a feature-by-feature explanation.
- [Editable tldraw board](https://www.tldraw.com/f/RNvB-ohzBfBU19zsxH5is): six pages you can rearrange and annotate.
- [AI teaching handoff](AI-HANDOFF.md): give another AI this file with the repository.
- [Personal learning checklist](learning-checklist.md): track what you can explain yourself.

The atlas adds clickable journeys, a searchable technology table, a learning roadmap and short understanding checks. All the original detailed guides below are retained.

1. [Architecture and request journeys](architecture-and-flows.md): what happens after a click.
2. [Technology choices and alternatives](technology-choices.md): what each tool does and how to defend the choice.
3. [Interview roadmap](interview-roadmap.md): topics ordered by difficulty, with priority and practice questions.
4. [Visualization tools](visualization-tools.md): architecture maps, guided code reading and actual runtime debugging.
5. Guided walkthroughs are in the repository's `.tours/` directory. With Microsoft's CodeTour extension installed in VS Code, run **CodeTour: Start Tour** and select a tour.

### Prepared code tours

- [Architecture and browsing](../../.tours/eventpoint-01-architecture.tour) — 9 steps.
- [Booking and payments](../../.tours/eventpoint-02-bookings-payments.tour) — 10 steps.
- [AI and RAG](../../.tours/eventpoint-03-ai-rag.tour) — 10 steps.
- [Authentication and delivery](../../.tours/eventpoint-04-auth-delivery.tour) — 9 steps.

## Your short project introduction

“EventPoint is a full-stack event discovery and ticket-booking platform. Attendees can discover events, ask an AI assistant for recommendations, book tickets and access QR tickets. Organizers manage events and admissions, while administrators review applications and events. The frontend uses Next.js and the backend is an Express modular monolith backed by PostgreSQL and Prisma. The parts I would discuss in depth are transactional inventory reservation, payment verification and idempotency, role-based access, and hybrid retrieval for the AI assistant.”

Use this as an outline. Be ready to explain every phrase in your own words. Describe portfolio bookings as demonstration data, not real customer sales.

## How to study one feature

For each feature, answer these six questions before moving on:

1. What user problem does it solve?
2. Where does the request start in the frontend?
3. Which API route and service handle it?
4. Which data is read or changed, and what must remain true?
5. What happens on duplicate requests, failure or unauthorized access?
6. What alternative would fit a different scale or requirement?

Read code in small journeys, not alphabetically and not all files at once. Start with browsing, then authentication, booking, payments and AI.

## Important distinctions for interview accuracy

- The running backend is **Express**, not NestJS. Decorator-shaped helpers and old documentation do not establish a Nest runtime.
- BullMQ is present in the worker app, but its processors are not registered. Booking expiry currently runs through an **in-process scheduler**.
- Do not claim live Socket.IO updates from an old architecture decision. The current notification UI fetches data through HTTP.
- Semantic retrieval uses a pretrained **MiniLM encoder locally**, and stores arrays in PostgreSQL. The inspected implementation does not use pgvector, Pinecone or a separately operated vector database.
- Groq handles generation; an embedding model handles semantic representations. These are different jobs.
- Some old architecture documents describe an earlier prompt-injection approach and planned services. Prefer the current source and the maps in this folder when they conflict.
- Dependency presence, code implementation and live service configuration are three separate things. For example, Sentry integration exists, but active error reporting depends on deployment configuration.

## Tiny glossary

| Term | Plain meaning in this project |
|---|---|
| API | The HTTP interface the frontend uses to ask the backend to do work |
| ORM | Prisma's typed interface to database queries and relationships |
| Transaction | A group of database changes that commits or rolls back together |
| Invariant | A condition that must stay true, such as inventory never becoming negative |
| Idempotency | Repeating the same intended operation does not create another outcome |
| JWT | A signed access token; signing does not encrypt its contents |
| TTL | How long a cached value or reservation remains valid |
| Webhook | A provider-to-server event notification, independent of the browser |
| Embedding | A numeric representation used to compare semantic similarity |
| RAG | Retrieve relevant facts, then use those facts to ground a generated answer |
| Modular monolith | One backend deployment with separate feature modules |
| CI | Automated checks of a proposed revision; distinct from deployment |

## Completion checkpoint

You are prepared when you can draw the architecture from memory, trace the five request journeys, explain a failure case for each, and defend a tradeoff without claiming the alternatives are universally worse.
